#!/usr/bin/env python3
"""Lossless geometric conversion of the classic GoldSrc cs_bloodstrike BSP30.

Requires Pillow. Source files remain in artifacts; only the compact render
geometry, original texture pixels/lightmaps, and BSP collision data ship.
Units: 1 GoldSrc unit = 0.0254 m; Three (x,y,z) = GoldSrc (x,z,-y).
"""
from array import array
from collections import defaultdict
from pathlib import Path
import argparse
import hashlib
import json
import math
import re
import struct
from PIL import Image

SCALE = .0254
ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'artifacts/bloodstrike-20261025/assets/source'
TARGET = ROOT / 'public/assets/maps/bloodstrike'


# Keep palette decoding and GoldSrc float32 lightmap projections consistent with
# the existing Assault importer. No new asset-processing dependency is needed.
from import_assault import parse_wad, mip_texture, float32

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=SOURCE)
    parser.add_argument('--target', type=Path, default=TARGET)
    parser.add_argument('--halflife-wad', type=Path, default=ROOT / 'artifacts/assault-20261024/source/halflife.wad')
    args = parser.parse_args()
    source, target = args.source, args.target
    target.mkdir(parents=True, exist_ok=True)
    data = (source / 'cs_bloodstrike.bsp').read_bytes()
    assert struct.unpack_from('<i', data)[0] == 30
    assert hashlib.sha256(data).hexdigest() == '4d274b42c9fea481333dafd53aaac8edc83dbd051511610c448a1b39378eeeba', 'Unexpected Blood Strike source; review a new source before conversion'
    lumps = [struct.unpack_from('<ii', data, 4 + i * 8) for i in range(15)]

    def lump(n):
        offset, size = lumps[n]
        return data[offset:offset + size]

    def records(n, fmt):
        return list(struct.iter_unpack(fmt, lump(n)))

    entities = [dict(re.findall(r'"([^"\n]*)"\s*"([^"\n]*)"', text))
                for text in re.findall(r'\{([^}]+)\}', lump(0).rstrip(b'\0').decode('latin1'))]
    planes = records(1, '<4fi')
    vertices = records(3, '<3f')
    texinfos = records(6, '<8f2i')
    faces = records(7, '<Hhihh4Bi')
    edges = records(12, '<2H')
    surfedges = [i[0] for i in records(13, '<i')]
    models = records(14, '<9f7i')
    lights = lump(8)
    wads = {}
    wad_paths = [args.halflife_wad, source / 'cstrike.wad']
    for path in wad_paths:
        wads.update(parse_wad(path))
    textures, texture_data = [], lump(2)
    for i in range(struct.unpack_from('<i', texture_data)[0]):
        offset = struct.unpack_from('<i', texture_data, 4 + i * 4)[0]
        assert offset >= 0
        name, width, height, image = mip_texture(texture_data, offset)
        if image is None:
            assert name.lower() in wads, f'Missing original texture {name}'
            _, _, _, image = mip_texture(wads[name.lower()])
        textures.append({'name': name, 'width': width, 'height': height, 'image': image})

    visible_models = {0}
    solid_models = {0}
    for entity in entities:
        model, kind = entity.get('model', ''), entity.get('classname', '')
        if not model.startswith('*'):
            continue
        index = int(model[1:])
        if kind in ('func_breakable', 'func_wall', 'func_illusionary'):
            visible_models.add(index)
        if kind in ('func_breakable', 'func_wall'):
            solid_models.add(index)

    polygons = []
    for model_id in sorted(visible_models):
        model = models[model_id]
        for face_id in range(model[14], model[14] + model[15]):
            plane, side, first_edge, count, texinfo, *rest = faces[face_id]
            light_offset = rest[-1]
            info = texinfos[texinfo]
            texture_id = info[8]
            texture = textures[texture_id]
            if texture['name'].lower() in ('sky', 'clip', 'aaatrigger', 'origin', 'null'):
                continue
            points = [vertices[edges[e][0]] if e >= 0 else vertices[edges[-e][1]]
                      for e in surfedges[first_edge:first_edge + count]]
            normal = [planes[plane][k] * (-1 if side else 1) for k in range(3)]
            # BSP T-junction fixing inserts collinear edge vertices. The first
            # three vertices are collinear on 747 original faces, so use the
            # complete polygon area vector to establish winding.
            area = [0., 0., 0.]
            for a, b in zip(points, points[1:] + points[:1]):
                area[0] += (a[1] - b[1]) * (a[2] + b[2])
                area[1] += (a[2] - b[2]) * (a[0] + b[0])
                area[2] += (a[0] - b[0]) * (a[1] + b[1])
            assert abs(sum(area[k] * normal[k] for k in range(3))) > 1e-8, f'Degenerate polygon {face_id}'
            if sum(area[k] * normal[k] for k in range(3)) < 0:
                points.reverse()
            st = [(float32(sum(p[k] * info[k] for k in range(3)) + info[3]),
                   float32(sum(p[k] * info[k + 4] for k in range(3)) + info[7])) for p in points]
            mins = [math.floor(min(q[k] for q in st) / 16) for k in range(2)]
            maxs = [math.ceil(max(q[k] for q in st) / 16) for k in range(2)]
            width, height = [maxs[k] - mins[k] + 1 for k in range(2)]
            if light_offset >= 0:
                lightmap = Image.frombytes('RGB', (width, height), lights[light_offset:light_offset + width * height * 3])
            else:
                # GoldSrc unlit/special faces retain their original texture.
                lightmap = Image.new('RGB', (width, height), (128, 128, 128))
            polygons.append({'face': face_id, 'texture': texture_id, 'points': points, 'normal': normal,
                             'st': st, 'mins': mins, 'lightmap': lightmap})

    # Shelf packing with duplicated borders avoids interpolation between faces.
    atlas_width = 1024
    x = y = row_height = 0
    for polygon in sorted(polygons, key=lambda p: -p['lightmap'].height):
        image = polygon['lightmap']
        width, height = image.width + 4, image.height + 4
        if x + width > atlas_width:
            x, y, row_height = 0, y + row_height, 0
        polygon['atlas'] = (x + 2, y + 2)
        x += width
        row_height = max(row_height, height)
    atlas_height = 2 ** math.ceil(math.log2(y + row_height))
    atlas = Image.new('RGB', (atlas_width, atlas_height))
    for polygon in polygons:
        image = polygon['lightmap']
        x, y = polygon['atlas']
        atlas.paste(image, (x, y))
        atlas.paste(image.crop((0, 0, 1, image.height)).resize((2, image.height)), (x - 2, y))
        atlas.paste(image.crop((image.width - 1, 0, image.width, image.height)).resize((2, image.height)), (x + image.width, y))
        atlas.paste(atlas.crop((x - 2, y, x + image.width + 2, y + 1)).resize((image.width + 4, 2)), (x - 2, y - 2))
        atlas.paste(atlas.crop((x - 2, y + image.height - 1, x + image.width + 2, y + image.height)).resize((image.width + 4, 2)), (x - 2, y + image.height))
    atlas.save(target / 'lightmaps.webp', lossless=True, method=6)

    groups = defaultdict(lambda: {'vertices': array('f'), 'indices': array('I')})
    for polygon in polygons:
        group = groups[polygon['texture']]
        texture = textures[polygon['texture']]
        first = len(group['vertices']) // 7
        ax, ay = polygon['atlas']
        for point, st in zip(polygon['points'], polygon['st']):
            # TextureLoader flipY=false: these coordinates match native BSP rows.
            group['vertices'].extend((point[0] * SCALE, point[2] * SCALE, -point[1] * SCALE,
                                      st[0] / texture['width'], st[1] / texture['height'],
                                      (ax + st[0] / 16 - polygon['mins'][0] + .5) / atlas_width,
                                      (ay + st[1] / 16 - polygon['mins'][1] + .5) / atlas_height))
        for i in range(1, len(polygon['points']) - 1):
            points, normal = polygon['points'], polygon['normal']
            a = [points[i][k] - points[0][k] for k in range(3)]
            b = [points[i + 1][k] - points[0][k] for k in range(3)]
            cross = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
            area = sum(cross[k] * normal[k] for k in range(3))
            if abs(area) < 1e-6:
                continue
            # Quantized BSP coordinates can put a nominally collinear
            # T-junction a fraction of a unit outside the polygon boundary.
            # Keep its exact points and orient even that subpixel sliver.
            triangle = (first, first + i, first + i + 1) if area > 0 else (first, first + i + 1, first + i)
            group['indices'].extend(triangle)

    binary = bytearray()
    entries = []
    for texture_id, group in sorted(groups.items()):
        texture = textures[texture_id]
        assert all(math.isfinite(value) for value in group['vertices']), texture['name']
        assert len(group['vertices']) % 7 == 0 and len(group['indices']) % 3 == 0
        assert all(0 <= index < len(group['vertices']) // 7 for index in group['indices'])
        filename = f'texture-{texture_id:02d}.webp'
        texture['image'].save(target / filename, lossless=True, method=6)
        vertex_offset = len(binary)
        binary.extend(group['vertices'].tobytes())
        index_offset = len(binary)
        binary.extend(group['indices'].tobytes())
        entries.append({'name': texture['name'], 'texture': filename, 'vertexOffset': vertex_offset,
                        'vertexCount': len(group['vertices']) // 7, 'indexOffset': index_offset,
                        'indexCount': len(group['indices']), 'transparent': texture['name'].startswith('{')})
    (target / 'geometry.bin').write_bytes(binary)
    (target / 'cs_bloodstrike.bsp').write_bytes(data)
    # Blood Strike is fully enclosed; its BSP contains no sky faces or skyname.
    assert not entities[0].get('skyname')
    sky_files = []
    metadata = {
        'format': 'sandline-goldsrc-mesh-v1', 'map': 'cs_bloodstrike', 'unitScale': SCALE,
        'sourceSha256': hashlib.sha256(data).hexdigest(), 'geometry': 'geometry.bin',
        'lightmap': 'lightmaps.webp', 'lightmapSize': [atlas_width, atlas_height],
        'sky': sky_files,
        'visibleModels': sorted(visible_models), 'solidModels': sorted(solid_models),
        'triangles': sum(entry['indexCount'] // 3 for entry in entries),
        'faces': len(polygons), 'groups': entries,
    }
    (target / 'manifest.json').write_text(json.dumps(metadata, separators=(',', ':')) + '\n')
    provenance = {
        'bsp': {'repository': 'https://github.com/eallion/csserver-win',
                'commit': '1b89175097bb1a8e3804514c0f011ca1c174951d',
                'path': 'cstrike/maps/cs_bloodstrike.bsp',
                'gitBlob': '167d121235e8cefab16cfc8b99c7aef4ebdf149c',
                'sha256': metadata['sourceSha256'], 'bytes': len(data)},
        'originalAuthor': 'Tim (BSP worldspawn: FTK Blood Strike by Tim)',
        'sourceMapName': 'cs_bloodstrike',
        'naming': 'Classic Blood Strike, using the original cs_bloodstrike file name. No claim that this BSP is a distinct fy_bloodstrike release.',
        'rights': 'Original Counter-Strike community map and Valve artwork; conversion does not change ownership or grant a new license.',
        'conversion': 'Original BSP30 polygons, UV projections, WAD3 palette pixels, baked lightmaps and collision hulls. No artistic geometry substitutions. First baked light style, static state.',
        'coordinates': 'Three(x,y,z) = GoldSrc(x,z,-y) * 0.0254; no whole-map translation or rescaling.',
        'wadFiles': [{'repository': 'https://github.com/eallion/csserver-win',
                      'commit': '1b89175097bb1a8e3804514c0f011ca1c174951d',
                      'path': ('valve/' if path.name == 'halflife.wad' else 'cstrike/') + path.name,
                      'gitBlob': {'halflife.wad': '2f72b240b3943d23e868589861f6bca532a93533', 'cstrike.wad': '061c23520c0e54a47dbfb90654f6d14fbcffac55'}[path.name],
                      'name': path.name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                      'bytes': path.stat().st_size} for path in wad_paths],
        'geometryValidation': {'finiteAttributes': True, 'validTriangleIndices': True,
                               'worldModels': len(models), 'originalSpawnCounts': {
                                   'blue': sum(e.get('classname') == 'info_player_start' for e in entities),
                                   'red': sum(e.get('classname') == 'info_player_deathmatch' for e in entities)}},
        'export': {k: v for k, v in metadata.items() if k != 'groups'},
        'files': [{'name': path.name, 'bytes': path.stat().st_size, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
                  for path in sorted(target.iterdir()) if path.is_file() and path.name != 'navigation.json'],
    }
    (source.parent / 'source-conversion.json').write_text(json.dumps(provenance, indent=2) + '\n')
    print(json.dumps({'triangles': metadata['triangles'], 'faces': len(polygons), 'drawCalls': len(entries),
                      'lightmapSize': metadata['lightmapSize'], 'totalBytes': sum(p.stat().st_size for p in target.iterdir() if p.is_file())}))


if __name__ == '__main__':
    main()
