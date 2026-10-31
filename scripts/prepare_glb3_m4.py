#!/usr/bin/env python3
"""Prepare the user's CS2 M4 for every Sandline weapon presentation.

Requires numpy and Pillow. The source has rigid one-joint skin weights and its
weighted bind matrices are identity: the mesh-local vertices are already the
seated gun. Partition those exact vertices by authored joint, bake the canonical
metre frame, and omit unused skin/animation/UV data from the browser derivative.
Run: python scripts/prepare_glb3_m4.py
"""
import copy
import gzip
import hashlib
import io
import json
from pathlib import Path

import numpy as np
from PIL import Image

from prepare_sketchfab_weapons import accessor, geometry, matrix, projection, read_glb, write_glb

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'assets-source/glb3-20261023/rifle__m4a1_no_silencer_weapon_model_cs2.glb'
OUTPUT = ROOT / 'public/assets/runtime/m4.glb'
REPORT = ROOT / 'artifacts/glb3-replacement-20261023'
MUZZLE = [0, .061, -.646]
SOCKETS = {'support': [-.012, .012, -.330], 'primaryGrip': [.024, -.065, .032]}
RELOAD = {'contact': [-.024, -.090, -.120], 'travel': [0, -.23, -.025],
          'rotation': [0, 0, np.pi / 2], 'rack': [-.030, .083, .040], 'rackTravel': .060}


def prepare():
    REPORT.mkdir(parents=True, exist_ok=True)
    original, binary = read_glb(SOURCE)
    source_mesh = original['meshes'][0]['primitives'][0]
    attributes = source_mesh['attributes']
    positions = accessor(original, binary, attributes['POSITION'])
    indices = accessor(original, binary, source_mesh['indices']).reshape(-1, 3)
    joints = accessor(original, binary, attributes['JOINTS_0'])[:, 0]
    weights = accessor(original, binary, attributes['WEIGHTS_0'])
    assert np.all(weights == [1, 0, 0, 0]), 'Source must use rigid mechanical weights'
    assert np.all(np.ptp(joints[indices], axis=1) == 0), 'A triangle spans mechanical parts'

    # Verify that flattening the source skin is exact in the seated frame.
    world = {}
    def visit(index, parent):
        world[index] = parent @ matrix(original['nodes'][index])
        for child in original['nodes'][index].get('children', []):
            visit(child, world[index])
    for index in original['scenes'][original.get('scene', 0)]['nodes']:
        visit(index, np.eye(4))
    skin = original['skins'][0]
    bind_accessor = original['accessors'][skin['inverseBindMatrices']]
    bind_view = original['bufferViews'][bind_accessor['bufferView']]
    inverse_binds = np.frombuffer(binary, dtype='<f4', count=16 * bind_accessor['count'],
                                 offset=bind_view.get('byteOffset', 0) + bind_accessor.get('byteOffset', 0))
    inverse_binds = inverse_binds.reshape(-1, 4, 4).transpose(0, 2, 1)
    bind_error = max(float(np.abs(world[skin['joints'][int(joint)]] @ inverse_binds[joint] - np.eye(4)).max())
                     for joint in np.unique(joints))
    assert bind_error < 1e-6, 'Source bind changed: inspect skin before flattening'

    # The no-silencer muzzle ring lies at the positive-Z tip, +Y is up.
    tip = positions[positions[:, 2] > positions[:, 2].max() - .0002]
    source_muzzle = np.array([(tip[:, 0].min() + tip[:, 0].max()) / 2,
                             (tip[:, 1].min() + tip[:, 1].max()) / 2, positions[:, 2].max()])
    scale = 1. / float(np.ptp(positions[:, 2]))
    rotation = np.diag([-1., 1., -1.])
    translation = np.array(MUZZLE) - rotation @ source_muzzle * scale
    transformed = positions @ rotation.T * scale + translation

    provenance = copy.deepcopy(original['asset'].get('extras', {}))
    source_hash = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
    metadata = {'assetSource': 'sketchfab', 'assetKind': 'm4', 'assetRevision': 'glb3-cs2-m4a1',
                'source': provenance, 'sourceSha256': source_hash,
                'movingParts': {'magazine': True, 'bolt': True, 'pump': False},
                'weaponSockets': SOCKETS, 'reload': RELOAD,
                'boltMechanism': 'nonreciprocating-charging-handle'}
    doc = {'asset': copy.deepcopy(original['asset']), 'scene': 0,
           'scenes': [{'name': 'CS2 M4A1 mobile', 'nodes': [0]}],
           'nodes': [{'name': 'sketchfab-m4', 'children': [1, 2, 3, 4, 5, 6], 'extras': metadata},
                     {'name': 'body', 'children': []},
                     {'name': 'magazine', 'children': [], 'extras': {'movingPartAvailable': True}},
                     {'name': 'bolt', 'children': [], 'extras': {'movingPartAvailable': True}},
                     {'name': 'pump', 'children': [], 'extras': {'movingPartAvailable': False}},
                     {'name': 'muzzle', 'translation': MUZZLE},
                     {'name': 'eject', 'translation': [.025, .061, -.065]}],
           'meshes': [], 'accessors': [], 'bufferViews': [],
           'materials': copy.deepcopy(original['materials']),
           'images': [], 'textures': copy.deepcopy(original['textures']),
           'samplers': copy.deepcopy(original.get('samplers', [])),
           'extensionsUsed': list(dict.fromkeys(original.get('extensionsUsed', []) + ['EXT_texture_webp'])),
           'extensionsRequired': ['EXT_texture_webp'],
           'extras': {'source': str(SOURCE.relative_to(ROOT)), 'sourceSha256': source_hash,
                      'preparation': 'Rigid-joint mechanical partitions; exact seated geometry; no source animation downloads'}}
    doc['asset']['generator'] = 'Sandline CS2 M4 rigid-part mobile preparation'
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
        ac = {'bufferView': add_view(values.tobytes(), target), 'componentType': component_type,
              'count': len(values), 'type': kind}
        if kind == 'VEC3':
            ac.update(min=values.min(0).tolist(), max=values.max(0).tolist())
        doc['accessors'].append(ac)
        return len(doc['accessors']) - 1

    # All four material UV sets are byte-identical. Use one; UV4/5 have no material consumer.
    for uv in ['TEXCOORD_1', 'TEXCOORD_2', 'TEXCOORD_3']:
        assert np.array_equal(accessor(original, binary, attributes['TEXCOORD_0']),
                              accessor(original, binary, attributes[uv]))
    for material in doc['materials']:
        for ref in [material.get('normalTexture'), material.get('occlusionTexture'),
                    material['pbrMetallicRoughness'].get('baseColorTexture'),
                    material['pbrMetallicRoughness'].get('metallicRoughnessTexture')]:
            if ref is not None:
                ref.pop('texCoord', None)

    partitions = {}
    for group, joint_ids, node_index in [('body', [1, 3], 1), ('magazine', [2], 2), ('bolt', [4], 3)]:
        selected = indices[np.isin(joints[indices[:, 0]], joint_ids)]
        used, remap = np.unique(selected, return_inverse=True)
        attrs = {'POSITION': add_accessor(transformed[used].astype('<f4'), 'VEC3', 5126, 34962)}
        for name in ['NORMAL', 'TANGENT', 'TEXCOORD_0']:
            values = accessor(original, binary, attributes[name])[used].copy()
            if name in ['NORMAL', 'TANGENT']:
                values[:, :3] = values[:, :3] @ rotation.T
            attrs[name] = add_accessor(values.astype('<f4'), {2: 'VEC2', 3: 'VEC3', 4: 'VEC4'}[values.shape[1]], 5126, 34962)
        assert len(used) <= 65535
        primitive = {'attributes': attrs,
                     'indices': add_accessor(remap.astype('<u2').reshape(-1, 1), 'SCALAR', 5123, 34963),
                     'material': source_mesh['material'], 'mode': 4}
        mesh_index = len(doc['meshes'])
        doc['meshes'].append({'name': f'm4-{group}', 'primitives': [primitive]})
        child = len(doc['nodes'])
        doc['nodes'].append({'name': f'cs2-m4-{group}-geometry', 'mesh': mesh_index,
                             'extras': {'sourceJoints': [original['nodes'][skin['joints'][i]]['name'] for i in joint_ids]}})
        doc['nodes'][node_index]['children'].append(child)
        part_points = transformed[used]
        partitions[group] = {'triangles': len(selected), 'vertices': len(used),
                             'bounds': {'min': part_points.min(0).tolist(), 'max': part_points.max(0).tolist()}}

    image_report = []
    gpu_bytes = 0
    for index, original_image in enumerate(original['images']):
        view = original['bufferViews'][original_image['bufferView']]
        old = binary[view.get('byteOffset', 0):view.get('byteOffset', 0) + view['byteLength']]
        image = Image.open(io.BytesIO(old)).convert('RGB')
        original_size = image.size
        image.thumbnail((512, 512) if index == 1 else (1024, 1024), Image.Resampling.LANCZOS)
        encoded = io.BytesIO()
        image.save(encoded, format='WEBP', lossless=index != 0, quality=94, method=6, exact=True)
        blob = encoded.getvalue()
        doc['images'].append({'bufferView': add_view(blob), 'mimeType': 'image/webp'})
        gpu_bytes += image.width * image.height * 4 * 4 / 3
        image_report.append({'image': index, 'role': ['baseColor', 'occlusionRoughnessMetallic', 'normal'][index],
                             'originalSize': original_size, 'size': image.size, 'lossless': index != 0,
                             'before': len(old), 'after': len(blob)})
    for texture in doc['textures']:
        texture.setdefault('extensions', {})['EXT_texture_webp'] = {'source': texture.pop('source')}

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    write_glb(OUTPUT, doc, bytes(data))
    exported, result = read_glb(OUTPUT)
    output_geometry = geometry(exported, result)
    all_points = np.vstack([entry[2] for entry in output_geometry])
    assert np.isfinite(all_points).all()
    assert sum(len(entry[3]) for entry in output_geometry) == len(indices)
    assert len(doc['meshes']) == 3
    assert 'animations' not in exported and 'skins' not in exported
    projection(REPORT / 'm4-mobile-geometry.png', 'CS2 M4', output_geometry)
    report = {'source': str(SOURCE.relative_to(ROOT)), 'file': 'm4.glb',
              'before': SOURCE.stat().st_size, 'after': OUTPUT.stat().st_size,
              'gzipBytes': len(gzip.compress(OUTPUT.read_bytes(), compresslevel=5, mtime=0)),
              'sha256': hashlib.sha256(OUTPUT.read_bytes()).hexdigest(), 'sourceSha256': source_hash,
              'provenance': provenance, 'images': image_report,
              'estimatedTextureGpuBytesWithMipmaps': round(gpu_bytes),
              'sourceMuzzle': source_muzzle.tolist(), 'muzzle': MUZZLE,
              'normalization': {'scale': scale, 'rotation': rotation.tolist(), 'translation': translation.tolist()},
              'weaponSockets': SOCKETS, 'reload': RELOAD, 'movingParts': metadata['movingParts'],
              'bounds': {'min': all_points.min(0).tolist(), 'max': all_points.max(0).tolist()},
              'triangles': len(indices), 'meshCount': 3, 'partitions': partitions,
              'validation': {'sourceBindIdentityMaxError': bind_error, 'trianglesPreserved': True,
                             'finitePositions': True, 'sourceMaterialAndTextureRolesPreserved': True,
                             'unusedSkinAnimationUVDataRemoved': True, 'browserVisualCheck': 'owned by integration lead'}}
    (REPORT / 'm4-preparation.json').write_text(json.dumps(report, indent=2) + '\n')
    (SOURCE.parent / 'm4-source.json').write_text(json.dumps({'file': SOURCE.name, 'sha256': source_hash,
                                                           'provenance': provenance}, indent=2) + '\n')
    print(json.dumps({key: report[key] for key in ['file', 'before', 'after', 'gzipBytes', 'triangles', 'meshCount', 'bounds']}, indent=2))
    return report


if __name__ == '__main__':
    prepare()
