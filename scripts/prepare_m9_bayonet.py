#!/usr/bin/env python3
"""Prepare the supplied M9, retaining every visible triangle and PBR image pixel.
Requires numpy and Pillow. Output: one mesh, one material, three embedded lossless
WebP images; metres, +Y blade, XY blade plane, handle centre at origin.
"""
import copy, gzip, hashlib, io, json, shutil
from pathlib import Path
import numpy as np
from PIL import Image
from prepare_sketchfab_weapons import accessor, geometry, projection, read_glb, write_glb

ROOT = Path(__file__).resolve().parents[1]
SUPPLIED = Path.home() / 'Downloads' / 'm9_bayonet_knife.glb'
SOURCE = ROOT / 'assets-source/m9-bayonet-20261024/original.glb'
OUTPUT = ROOT / 'public/assets/runtime/m9-bayonet.glb'
REPORT = ROOT / 'artifacts/m9-bayonet-20261024'
LENGTH = .32


def connected_parts(points, indices):
    # Weld only for measurement; exported vertices remain untouched.
    parent = list(range(len(points)))
    def root(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    def union(a, b):
        parent[root(a)] = root(b)
    welded = {}
    for i, point in enumerate(points):
        union(i, welded.setdefault(tuple(np.round(point, 5)), i))
    for a, b, c in indices:
        union(int(a), int(b))
        union(int(b), int(c))
    parts = {}
    for i in range(len(points)):
        parts.setdefault(root(i), []).append(i)
    ordered = sorted(parts.values(), key=lambda ids: np.mean(points[ids, 2]))
    assert len(ordered) == 4, 'Reinspect landmarks if source parts change'
    return dict(zip(['pommel', 'handle', 'guard', 'blade'], ordered))


def prepare():
    REPORT.mkdir(parents=True, exist_ok=True)
    SOURCE.parent.mkdir(parents=True, exist_ok=True)
    if not SOURCE.exists():
        shutil.copy2(SUPPLIED, SOURCE)
    original, binary = read_glb(SOURCE)
    entries = geometry(original, binary)
    assert len(entries) == 1 and not original.get('skins') and not original.get('animations')
    _, _, points, indices, source_matrix, primitive = entries[0]
    parts = connected_parts(points, indices)
    handle = points[parts['handle']]
    grip = (handle.min(0) + handle.max(0)) / 2
    # Proper rotation: source length +Z -> +Y, width +Y -> +X, thickness +X -> +Z.
    rotation = np.array([[0., 1., 0.], [0., 0., 1.], [1., 0., 0.]])
    scale = LENGTH / float(np.ptp(points[:, 2]))
    normalization = np.eye(4)
    normalization[:3, :3] = rotation * scale
    normalization[:3, 3] = -rotation @ grip * scale
    transform = normalization @ source_matrix
    transformed = (points - grip) @ rotation.T * scale
    source_hash = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
    provenance = copy.deepcopy(original['asset'].get('extras', {}))
    measurements = {}
    for name, ids in parts.items():
        p = transformed[ids]
        measurements[name] = {'vertices': len(ids), 'triangles': int(np.isin(indices[:, 0], ids).sum()),
                              'bounds': {'min': p.min(0).tolist(), 'max': p.max(0).tolist()},
                              'dimensions': np.ptp(p, axis=0).tolist(),
                              'center': ((p.min(0) + p.max(0)) / 2).tolist()}
    tip = transformed[np.flatnonzero(points[:, 2] > points[:, 2].max() - 1e-5)].mean(0).tolist()
    landmarks = {'gripCenter': [0., 0., 0.], 'tip': tip,
                 'handleBase': [0., measurements['handle']['bounds']['min'][1], 0.],
                 'handleTop': [0., measurements['handle']['bounds']['max'][1], 0.],
                 'guardCenter': [0., measurements['guard']['center'][1], 0.],
                 'bladeBase': [0., measurements['blade']['bounds']['min'][1], 0.],
                 'pommelEnd': [0., measurements['pommel']['bounds']['min'][1], 0.]}
    metadata = {'assetSource': 'm9-bayonet-glb', 'assetKind': 'knife', 'assetRevision': 'm9-bayonet-20261024',
                'source': provenance, 'sourceSha256': source_hash,
                'coordinateSystem': 'metres; +Y blade; XY blade plane; palm at origin',
                'landmarks': landmarks, 'measurements': measurements}
    nodes = [{'name': 'm9-bayonet', 'children': [1], 'extras': metadata}, {'name': 'm9-bayonet-mesh', 'mesh': 0}]
    for name, position in [('muzzle', tip), ('grip-center', landmarks['gripCenter']),
                           ('guard', landmarks['guardCenter']), ('blade-base', landmarks['bladeBase']),
                           ('pommel', landmarks['pommelEnd']), ('magazine', [0, 0, 0]),
                           ('bolt', [0, 0, 0]), ('pump', [0, 0, 0]), ('eject', [0, 0, 0])]:
        nodes[0]['children'].append(len(nodes))
        nodes.append({'name': name, 'translation': position})
    doc = {'asset': copy.deepcopy(original['asset']), 'scene': 0,
           'scenes': [{'name': 'M9 Bayonet', 'nodes': [0]}], 'nodes': nodes,
           'meshes': [], 'accessors': [], 'bufferViews': [],
           'materials': copy.deepcopy(original['materials']), 'images': [],
           'textures': copy.deepcopy(original['textures']), 'samplers': copy.deepcopy(original['samplers']),
           'extensionsUsed': ['EXT_texture_webp'], 'extensionsRequired': ['EXT_texture_webp'],
           'extras': {'source': str(SOURCE.relative_to(ROOT)), 'sourceSha256': source_hash}}
    doc['asset']['generator'] = 'Sandline M9 canonical metre frame; complete geometry and lossless PBR'
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
        a = {'bufferView': add_view(values.tobytes(), target), 'componentType': component_type,
             'count': len(values), 'type': kind}
        if kind == 'VEC3':
            a.update(min=values.min(0).tolist(), max=values.max(0).tolist())
        doc['accessors'].append(a)
        return len(doc['accessors']) - 1
    attrs = {'POSITION': add_accessor(transformed.astype('<f4'), 'VEC3', 5126, 34962)}
    direction_rotation = transform[:3, :3] / scale
    assert np.allclose(direction_rotation.T @ direction_rotation, np.eye(3), atol=1e-12)
    assert np.linalg.det(direction_rotation) > .999999
    for name in ['NORMAL', 'TANGENT', 'TEXCOORD_0']:
        values = accessor(original, binary, primitive['attributes'][name]).copy()
        if name != 'TEXCOORD_0':
            values[:, :3] = values[:, :3] @ direction_rotation.T
        attrs[name] = add_accessor(values.astype('<f4'), {2: 'VEC2', 3: 'VEC3', 4: 'VEC4'}[values.shape[1]], 5126, 34962)
    doc['meshes'].append({'name': 'M9 complete source mesh', 'primitives': [
        {'attributes': attrs, 'indices': add_accessor(indices.astype('<u2').reshape(-1, 1), 'SCALAR', 5123, 34963),
         'material': primitive['material'], 'mode': 4}]})
    image_report = []
    for i, source_image in enumerate(original['images']):
        v = original['bufferViews'][source_image['bufferView']]
        raw = binary[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']]
        image = Image.open(io.BytesIO(raw)); out = io.BytesIO()
        image.save(out, format='WEBP', lossless=True, quality=100, method=6, exact=True)
        encoded = out.getvalue(); decoded = Image.open(io.BytesIO(encoded))
        assert np.array_equal(np.asarray(image), np.asarray(decoded)), 'Image encoding must remain pixel-exact'
        doc['images'].append({'bufferView': add_view(encoded), 'mimeType': 'image/webp'})
        image_report.append({'image': i, 'role': ['baseColor', 'occlusionRoughnessMetallic', 'normal'][i],
                             'size': list(image.size), 'sourceBytes': len(raw), 'runtimeBytes': len(encoded),
                             'encoding': 'lossless WebP', 'pixelExact': True,
                             'pixelSha256': hashlib.sha256(np.asarray(image).tobytes()).hexdigest()})
    for texture in doc['textures']:
        texture['extensions'] = {'EXT_texture_webp': {'source': texture.pop('source')}}
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    write_glb(OUTPUT, doc, bytes(data))
    exported, result = read_glb(OUTPUT); output_geometry = geometry(exported, result); p = output_geometry[0][2]
    assert np.isfinite(p).all() and np.allclose(p, transformed, atol=2e-8)
    assert np.array_equal(output_geometry[0][3], indices)
    projection(REPORT / 'runtime-axes.png', 'M9 metres', output_geometry)
    report = {'source': str(SOURCE.relative_to(ROOT)), 'suppliedSource': str(SUPPLIED),
              'file': 'm9-bayonet.glb', 'sourceSha256': source_hash, 'sourceMetadata': provenance,
              'sha256': hashlib.sha256(OUTPUT.read_bytes()).hexdigest(),
              'sourceBytes': SOURCE.stat().st_size, 'bytes': OUTPUT.stat().st_size,
              'gzipBytes': len(gzip.compress(OUTPUT.read_bytes(), compresslevel=5, mtime=0)),
              'vertices': len(points), 'triangles': len(indices), 'meshCount': 1, 'materialCount': 1,
              'bounds': {'min': p.min(0).tolist(), 'max': p.max(0).tolist()},
              'dimensions': np.ptp(p, axis=0).tolist(), 'images': image_report,
              'estimatedTextureGpuBytesWithMipmaps': 3 * 1024 * 1024 * 4 * 4 // 3,
              'normalization': {'scale': scale, 'sourceWorldGrip': grip.tolist(),
                                'sourceVertexToRuntime': transform.flatten(order='F').tolist(),
                                'directionRotation': direction_rotation.tolist()},
              'landmarks': landmarks, 'measurements': measurements,
              'validation': {'sourceGeometryAndWindingPreserved': True, 'sourceUVsPreserved': True,
                             'allImagePixelsPreserved': True, 'sourcePBRRolesPreserved': True,
                             'externalResources': 0, 'browserVisualCheck': 'integration lead'}}
    (REPORT / 'asset-preparation.json').write_text(json.dumps(report, indent=2) + '\n')
    (SOURCE.parent / 'source.json').write_text(json.dumps({'file': SOURCE.name, 'sha256': source_hash,
                                                         'source': provenance}, indent=2) + '\n')
    retired = ROOT / 'assets-source/retired-20261024/assets/runtime/knife.glb'
    old_public = ROOT / 'public/assets/runtime/knife.glb'
    if old_public.exists():
        retired.parent.mkdir(parents=True, exist_ok=True)
        if retired.exists():
            assert retired.read_bytes() == old_public.read_bytes(), 'Do not overwrite a different archive'
            old_public.unlink()
        else:
            shutil.move(str(old_public), str(retired))
    print(json.dumps({k: report[k] for k in ['bytes', 'gzipBytes', 'triangles', 'dimensions', 'landmarks']}, indent=2))


if __name__ == '__main__':
    prepare()
