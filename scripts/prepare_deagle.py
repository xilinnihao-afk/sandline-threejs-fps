#!/usr/bin/env python3
"""Prepare the user-provided Desert Eagle, without replacing its source mesh.

Requires numpy and Pillow; run with a Python environment containing both:
  python scripts/prepare_deagle.py [--source /path/to/desert_eagle_.50ae.glb]

The original scene includes a seated magazine plus a second display magazine
and four loose cartridges. Keep the actual assembled gun, preserve all of its
triangles/material channels, and group already-disconnected mechanical islands.
"""
import argparse
import copy
import gzip
import hashlib
import io
import json
import shutil
from pathlib import Path

import numpy as np
from PIL import Image

from prepare_sketchfab_weapons import accessor, geometry, projection, read_glb, write_glb

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'assets-source/deagle-20261025/desert_eagle_.50ae.glb'
OUTPUT = ROOT / 'public/assets/runtime/deagle.glb'
REPORT = ROOT / 'artifacts/deagle-20261025'
SOURCE_SHA256 = 'bde122b6bfb1415bb893d29a0f2909dd544dda586115600f6ea6f763a6eae5df'
KEPT_NODES = {6, 8, 10, 12, 14, 16, 18, 20, 22}
DISPLAY_NODES = {4, 24, 26, 28, 30}
MUZZLE = [0, .069, -.225]
EJECT = [.016, .072, -.065]
SOCKETS = {'support': [-.039, -.015, -.030], 'primaryGrip': [.014762, -.023001, -.011958]}
RELOAD = {'contact': [-.002, -.065, .010], 'travel': [0, -.17, .043],
          'rotation': [0, 0, np.pi], 'rack': [-.026, .078, .009], 'rackTravel': .037}


def connected_triangle_islands(points, triangles):
    """Return existing islands, welding position *for classification only*.

    Exported vertices, normals and seams stay exactly as authored. This avoids
    severing arbitrary triangles to fake a moving sight or control lever.
    """
    _, ids = np.unique(np.round(points, 5), axis=0, return_inverse=True)
    adjacency = [set() for _ in range(int(ids.max()) + 1)]
    for tri in ids[triangles]:
        for index in tri:
            adjacency[index].update(int(other) for other in tri)
    seen = set()
    islands = []
    for seed in range(len(adjacency)):
        if seed in seen:
            continue
        todo = [seed]
        seen.add(seed)
        group = []
        while todo:
            index = todo.pop()
            group.append(index)
            for neighbor in adjacency[index]:
                if neighbor not in seen:
                    seen.add(neighbor)
                    todo.append(neighbor)
        islands.append(np.isin(ids[triangles[:, 0]], group))
    return islands


def mechanical_groups(node_index, points, triangles):
    if node_index == 20:
        return [('bolt', np.ones(len(triangles), dtype=bool), 'authored complete slide')]
    if node_index == 22:
        return [('magazine', np.ones(len(triangles), dtype=bool), 'authored seated magazine')]
    if node_index not in (16, 18):
        return [('body', np.ones(len(triangles), dtype=bool), 'authored fixed gun part')]

    groups = []
    for mask in connected_triangle_islands(points, triangles):
        part = points[triangles[mask].ravel()]
        low, high = part.min(0), part.max(0)
        if node_index == 16:
            # Node 16 is barrel + a fully disconnected rear sight. The barrel
            # stays fixed; the sight travels with the slide on which it sits.
            moving = bool(high[2] < -1.5 and low[1] > 2.85)
            label = 'rear sight' if moving else 'fixed barrel'
        else:
            # Node 18: left/right slide safeties, fixed front sight and hammer.
            moving = bool(low[1] > 2.70 and high[1] < 2.87 and high[2] < -1.38)
            label = 'slide-mounted safety lever' if moving else 'front sight / hammer'
        groups.append(('bolt' if moving else 'body', mask, label))
    return groups


def prepare(source_override=None):
    if source_override is not None and Path(source_override).resolve() != SOURCE.resolve():
        SOURCE.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source_override, SOURCE)
    if not SOURCE.exists():
        raise FileNotFoundError('Use --source to archive the provided Desert Eagle GLB first')
    REPORT.mkdir(parents=True, exist_ok=True)
    original, binary = read_glb(SOURCE)
    original_geometry = geometry(original, binary)
    assert {entry[0] for entry in original_geometry} == KEPT_NODES | DISPLAY_NODES
    assert not original.get('skins') and not original.get('animations')
    source_hash = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
    assert source_hash == SOURCE_SHA256, 'Source differs; inspect before preparing'
    selected = [entry for entry in original_geometry if entry[0] in KEPT_NODES]
    source_points = np.vstack([entry[2] for entry in selected])
    barrel = next(entry for entry in selected if entry[0] == 16)[2]
    muzzle_tip = barrel[barrel[:, 2] > barrel[:, 2].max() - .0001]
    # Outer muzzle ring is circular in XY; its extrema identify the bore axis.
    source_muzzle = np.array([(muzzle_tip[:, 0].min() + muzzle_tip[:, 0].max()) / 2,
                             (muzzle_tip[:, 1].min() + muzzle_tip[:, 1].max()) / 2,
                             barrel[:, 2].max()])
    scale = .27 / float(np.ptp(source_points[:, 2]))
    rotation = np.diag([-1., 1., -1.])
    translation = np.array(MUZZLE) - rotation @ source_muzzle * scale
    provenance = copy.deepcopy(original['asset'].get('extras', {}))
    metadata = {'assetSource': 'sketchfab', 'assetKind': 'deagle',
                'assetRevision': 'deagle-20261025', 'source': provenance,
                'sourceSha256': source_hash, 'movingParts': {'magazine': True, 'bolt': True, 'pump': False},
                'weaponSockets': SOCKETS, 'reload': RELOAD, 'boltMechanism': 'reciprocating-slide'}
    doc = {'asset': copy.deepcopy(original['asset']), 'scene': 0,
           'scenes': [{'name': 'Desert Eagle .50AE mobile', 'nodes': [0]}],
           'nodes': [{'name': 'sketchfab-deagle', 'children': [1, 2, 3, 4, 5, 6], 'extras': metadata},
                     {'name': 'body', 'children': []},
                     {'name': 'magazine', 'children': [], 'extras': {'movingPartAvailable': True}},
                     {'name': 'bolt', 'children': [], 'extras': {'movingPartAvailable': True}},
                     {'name': 'pump', 'children': [], 'extras': {'movingPartAvailable': False}},
                     {'name': 'muzzle', 'translation': MUZZLE},
                     {'name': 'eject', 'translation': EJECT}],
           'meshes': [], 'accessors': [], 'bufferViews': [],
           'materials': copy.deepcopy(original['materials']), 'images': [],
           'textures': copy.deepcopy(original['textures']),
           'samplers': copy.deepcopy(original.get('samplers', [])),
           'extensionsUsed': ['EXT_texture_webp'], 'extensionsRequired': ['EXT_texture_webp'],
           'extras': {'source': str(SOURCE.relative_to(ROOT)), 'sourceSha256': source_hash,
                      'preparation': 'Complete assembled source gun; loose display props excluded; original triangle islands'}}
    doc['asset']['generator'] = 'Sandline Desert Eagle mobile preparation'
    data = bytearray()

    def add_view(blob, target=None):
        data.extend(b'\0' * (-len(data) % 4))
        view = {'buffer': 0, 'byteOffset': len(data), 'byteLength': len(blob)}
        if target is not None:
            view['target'] = target
        doc['bufferViews'].append(view)
        data.extend(blob)
        return len(doc['bufferViews']) - 1

    def add_accessor(values, kind, component_type, target):
        values = np.ascontiguousarray(values)
        entry = {'bufferView': add_view(values.tobytes(), target), 'componentType': component_type,
                 'count': len(values), 'type': kind}
        if kind == 'VEC3':
            entry.update(min=values.min(0).tolist(), max=values.max(0).tolist())
        doc['accessors'].append(entry)
        return len(doc['accessors']) - 1

    merged = {}
    partition_sources = []
    for node_index, name, points, triangles, world, primitive in selected:
        for group, mask, label in mechanical_groups(node_index, points, triangles):
            chosen = triangles[mask]
            used, remap = np.unique(chosen, return_inverse=True)
            dest = merged.setdefault((group, primitive['material']), {'positions': [], 'normals': [],
                                         'tangents': [], 'uv': [], 'indices': [], 'count': 0})
            positions = points[used] @ rotation.T * scale + translation
            linear = rotation @ world[:3, :3]
            normal_matrix = np.linalg.inv(linear).T
            normals = accessor(original, binary, primitive['attributes']['NORMAL'])[used] @ normal_matrix.T
            normals /= np.linalg.norm(normals, axis=1, keepdims=True)
            tangents = accessor(original, binary, primitive['attributes']['TANGENT'])[used].copy()
            tangents[:, :3] = tangents[:, :3] @ linear.T
            tangents[:, :3] /= np.linalg.norm(tangents[:, :3], axis=1, keepdims=True)
            tangents[:, 3] *= np.sign(np.linalg.det(linear))
            dest['positions'].append(positions)
            dest['normals'].append(normals)
            dest['tangents'].append(tangents)
            dest['uv'].append(accessor(original, binary, primitive['attributes']['TEXCOORD_0'])[used])
            dest['indices'].append(remap + dest['count'])
            dest['count'] += len(used)
            partition_sources.append({'node': node_index, 'name': name, 'group': group,
                                      'component': label, 'triangles': len(chosen)})

    partitions = {}
    for (group, material_index), chunk in merged.items():
        values = {key: np.concatenate(chunk[key]) for key in ['positions', 'normals', 'tangents', 'uv', 'indices']}
        assert len(values['positions']) < 65536
        attrs = {name: add_accessor(values[key].astype('<f4'), kind, 5126, 34962)
                 for name, key, kind in [('POSITION', 'positions', 'VEC3'), ('NORMAL', 'normals', 'VEC3'),
                                         ('TANGENT', 'tangents', 'VEC4'), ('TEXCOORD_0', 'uv', 'VEC2')]}
        mesh_index = len(doc['meshes'])
        doc['meshes'].append({'name': f'deagle-{group}-{material_index}', 'primitives': [{
            'attributes': attrs, 'indices': add_accessor(values['indices'].astype('<u2').reshape(-1, 1), 'SCALAR', 5123, 34963),
            'material': material_index, 'mode': 4}]})
        doc['nodes'][{'body': 1, 'magazine': 2, 'bolt': 3}[group]]['children'].append(len(doc['nodes']))
        doc['nodes'].append({'name': f'deagle-{group}-{material_index}-geometry', 'mesh': mesh_index})
        partitions[f'{group}:{material_index}'] = {'triangles': values['indices'].size // 3,
                                                  'vertices': len(values['positions']),
                                                  'bounds': {'min': values['positions'].min(0).tolist(),
                                                             'max': values['positions'].max(0).tolist()}}

    image_report = []
    gpu_bytes = 0
    for index, original_image in enumerate(original['images']):
        view = original['bufferViews'][original_image['bufferView']]
        old = binary[view.get('byteOffset', 0):view.get('byteOffset', 0) + view['byteLength']]
        image = Image.open(io.BytesIO(old)).convert('RGB')
        original_size = image.size
        role = ['baseColor', 'occlusionRoughnessMetallic', 'normal'][index % 3]
        image.thumbnail((256, 256) if role == 'occlusionRoughnessMetallic' else (512, 512), Image.Resampling.LANCZOS)
        if role == 'normal':
            vectors = np.asarray(image, dtype=np.float32) / 127.5 - 1
            vectors /= np.maximum(np.linalg.norm(vectors, axis=2, keepdims=True), 1e-8)
            image = Image.fromarray(np.rint(np.clip(vectors * .5 + .5, 0, 1) * 255).astype(np.uint8))
        encoded = io.BytesIO()
        image.save(encoded, format='WEBP', lossless=role != 'baseColor', quality=94, method=6, exact=True)
        blob = encoded.getvalue()
        doc['images'].append({'bufferView': add_view(blob), 'mimeType': 'image/webp'})
        gpu_bytes += image.width * image.height * 4 * 4 / 3
        image_report.append({'image': index, 'role': role, 'originalSize': original_size, 'size': image.size,
                             'lossless': role != 'baseColor', 'before': len(old), 'after': len(blob)})
    for texture in doc['textures']:
        texture.setdefault('extensions', {})['EXT_texture_webp'] = {'source': texture.pop('source')}

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    write_glb(OUTPUT, doc, bytes(data))
    exported, result = read_glb(OUTPUT)
    output_geometry = geometry(exported, result)
    all_points = np.vstack([entry[2] for entry in output_geometry])
    source_triangles = sum(len(entry[3]) for entry in selected)
    assert np.isfinite(all_points).all()
    assert sum(len(entry[3]) for entry in output_geometry) == source_triangles
    assert sum(part['triangles'] for part in partitions.values()) == source_triangles
    # Compare the actual exported geometry to the original assembled geometry,
    # independent of grouping, to catch lost/duplicated/remapped triangles.
    def triangle_keys(entries, transform=False):
        keys = []
        for entry in entries:
            points = ((entry[2] @ rotation.T * scale + translation).astype('<f4').astype(np.float64)
                      if transform else entry[2])
            for triangle in points[entry[3]]:
                keys.append(tuple(sorted(tuple(vertex) for vertex in triangle)))
        return sorted(keys)
    assert triangle_keys(selected, True) == triangle_keys(output_geometry)
    for mesh in exported['meshes']:
        for primitive in mesh['primitives']:
            for attribute in ('NORMAL', 'TANGENT'):
                values = accessor(exported, result, primitive['attributes'][attribute])
                assert np.isfinite(values).all()
                assert np.max(np.abs(np.linalg.norm(values[:, :3], axis=1) - 1)) < 1e-5
    assert abs(float(np.ptp(all_points[:, 2])) - .27) < 1e-6
    assert OUTPUT.stat().st_size < 1500000
    projection(REPORT / 'deagle-mobile-geometry.png', 'Desert Eagle', output_geometry)
    report = {'source': str(SOURCE.relative_to(ROOT)), 'file': 'deagle.glb',
              'before': SOURCE.stat().st_size, 'after': OUTPUT.stat().st_size,
              'gzipBytes': len(gzip.compress(OUTPUT.read_bytes(), compresslevel=5, mtime=0)),
              'sha256': hashlib.sha256(OUTPUT.read_bytes()).hexdigest(), 'sourceSha256': source_hash,
              'provenance': provenance, 'images': image_report,
              'estimatedTextureGpuBytesWithMipmaps': round(gpu_bytes),
              'sourceMuzzle': source_muzzle.tolist(), 'muzzle': MUZZLE, 'eject': EJECT,
              'normalization': {'scale': scale, 'rotation': rotation.tolist(), 'translation': translation.tolist()},
              'weaponSockets': SOCKETS, 'reload': RELOAD, 'movingParts': metadata['movingParts'],
              'bounds': {'min': all_points.min(0).tolist(), 'max': all_points.max(0).tolist()},
              'dimensions': np.ptp(all_points, axis=0).tolist(),
              'triangles': source_triangles, 'meshCount': len(output_geometry), 'partitions': partitions,
              'partitionSources': partition_sources,
              'excludedSourceNodes': [{'node': entry[0], 'name': entry[1], 'triangles': len(entry[3])}
                                      for entry in original_geometry if entry[0] in DISPLAY_NODES],
              'validation': {'assembledGunTrianglesPreserved': True, 'finitePositions': True,
                             'exactSourceTrianglesAtFloat32Precision': True, 'unitNormalsAndTangents': True,
                             'sourceMaterialAndTextureRolesPreserved': True, 'noCutTriangles': True,
                             'browserVisualCheck': 'owned by integration lead'}}
    (REPORT / 'deagle-preparation.json').write_text(json.dumps(report, indent=2) + '\n')
    (SOURCE.parent / 'source.json').write_text(json.dumps({'file': SOURCE.name, 'sha256': source_hash,
                                                        'provenance': provenance}, indent=2) + '\n')
    print(json.dumps({key: report[key] for key in ['file', 'after', 'gzipBytes', 'triangles', 'meshCount', 'bounds']}, indent=2))
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path)
    prepare(parser.parse_args().source)
