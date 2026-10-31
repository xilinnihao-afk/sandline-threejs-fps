#!/usr/bin/env python3
"""Normalize the supplied Classic Knife without rewriting any mesh/image bytes.

Requires numpy and Pillow. The complete original BIN chunk, meshes, accessors,
indices, UVs, normals, materials and embedded PNG remain byte-exact. Only scene
nodes supply the metre frame: +Y tip, XY blade plane, usable grip at the origin.
"""
import copy
import gzip
import hashlib
import io
import json
import shutil
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from prepare_sketchfab_weapons import accessor, geometry, read_glb, write_glb

ROOT = Path(__file__).resolve().parents[1]
SUPPLIED = Path.home() / 'Downloads' / 'classic_knife_-_cs_1.6.glb'
SOURCE = ROOT / 'assets-source/classic-knife-20261026/original.glb'
OUTPUT = ROOT / 'public/assets/runtime/classic-knife.glb'
REPORT = ROOT / 'artifacts/classic-knife-20261026'
LENGTH = .32


def components(points, indices):
    """Weld only for semantic measurements; do not alter exported geometry."""
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
    result = {}
    for i in range(len(points)):
        result.setdefault(root(i), []).append(i)
    return sorted(result.values(), key=len, reverse=True)


def section(points, indices, x):
    """Intersect the actual handle triangles with a source-local X plane."""
    result = []
    for tri in indices:
        for ia, ib in [(tri[0], tri[1]), (tri[1], tri[2]), (tri[2], tri[0])]:
            a, b = points[ia], points[ib]
            if (a[0] - x) * (b[0] - x) <= 0 and abs(b[0] - a[0]) > 1e-10:
                result.append(a + (x - a[0]) / (b[0] - a[0]) * (b - a))
    assert result, 'Grip section does not intersect the source handle'
    return np.asarray(result)


def transform(points, matrix):
    return (np.c_[points, np.ones(len(points))] @ matrix.T)[:, :3]


def measurement(points):
    return {'bounds': {'min': points.min(0).tolist(), 'max': points.max(0).tolist()},
            'dimensions': np.ptp(points, axis=0).tolist(),
            'center': ((points.min(0) + points.max(0)) / 2).tolist()}


def projections(path, entries, landmarks, usable_y):
    """Equal-scale orthographic geometry evidence, with grip and axis labels."""
    image = Image.new('RGB', (1440, 1000), '#edf1f2')
    draw = ImageDraw.Draw(image)
    colors = ['#b66b48', '#477b9a', '#668a51']
    draw.text((28, 20), 'Classic Knife | complete source geometry | total length 320 mm', fill='#15252f')
    draw.text((28, 45), 'Orange: blade   Blue: handle / original trim   Green: guard   Red cross: usable grip centre', fill='#344754')
    panels = [(0, 1, 'FRONT  X / Y', (20, 82, 460, 915)),
              (2, 1, 'SIDE  Z / Y', (500, 82, 940, 915)),
              (0, 2, 'TOP  X / Z', (980, 82, 1420, 915))]
    scale = 2300
    all_points = np.vstack([entry[2] for entry in entries])
    for ax, ay, label, (left, top, right, bottom) in panels:
        draw.rectangle((left, top, right, bottom), outline='#bdc8cf')
        draw.text((left + 16, top + 14), label, fill='#15252f')
        cx = (left + right) / 2
        cy = 748 if ay == 1 else 494

        def project(p):
            return (cx + p[ax] * scale, cy - p[ay] * scale)

        draw.line((cx, top + 50, cx, bottom - 20), fill='#d1dbe0')
        draw.line((left + 14, cy, right - 14, cy), fill='#d1dbe0')
        # Draw all original triangles. Side/top geometry remains at the same
        # scale as the blade face; it is not stretched for readability.
        for i, entry in enumerate(entries):
            points, indices = entry[2], entry[3]
            projected = [project(p) for p in points]
            for tri in indices:
                draw.polygon([projected[int(v)] for v in tri], fill=colors[i])
        x, y = project(np.zeros(3))
        draw.line((x - 10, y, x + 10, y), fill='#b62f37', width=2)
        draw.line((x, y - 10, x, y + 10), fill='#b62f37', width=2)
        if ay == 1:
            for name, point in [('tip', landmarks['tip']), ('handle base', landmarks['handleBase'])]:
                px, py = project(point)
                draw.ellipse((px - 3, py - 3, px + 3, py + 3), fill='#18252c')
                draw.text((left + 14, py - 7), name + ' ' + str(round(point[1] * 1000, 2)) + ' mm', fill='#18252c')
            for bound in usable_y:
                py = cy - bound * scale
                draw.line((cx + 55, py, cx + 90, py), fill='#b62f37', width=2)
            draw.line((cx + 81, cy - usable_y[1] * scale, cx + 81, cy - usable_y[0] * scale), fill='#b62f37', width=2)
        draw.text((left + 14, bottom + 8), '1 grid scale shared across all views', fill='#526773')
    draw.text((28, 960), 'Cutting edge is -X; back/spine is +X. Original thickness and all materials are unchanged.', fill='#15252f')
    image.save(path)


def prepare():
    REPORT.mkdir(parents=True, exist_ok=True)
    SOURCE.parent.mkdir(parents=True, exist_ok=True)
    if SOURCE.exists():
        if SUPPLIED.exists():
            assert SOURCE.read_bytes() == SUPPLIED.read_bytes(), 'Do not overwrite a different archived original'
    else:
        shutil.copy2(SUPPLIED, SOURCE)
    original, binary = read_glb(SOURCE)
    assert not original.get('skins') and not original.get('animations')
    assert len(original['meshes']) == 3 and len(original['materials']) == 3 and len(original['images']) == 1
    source_entries = geometry(original, binary)
    assert len(source_entries) == 3
    source_matrix = source_entries[0][4]
    assert all(np.allclose(entry[4], source_matrix) for entry in source_entries)
    local = [accessor(original, binary, entry[5]['attributes']['POSITION']).astype(np.float64) for entry in source_entries]
    indices = [entry[3] for entry in source_entries]
    all_local = np.vstack(local)
    # Material 001 includes three tiny separate trim patches on the blade and
    # guard. Isolate the connected grip body for measurements, retaining every
    # patch in the exported asset.
    handle_parts = components(local[1], indices[1])
    assert [len(ids) for ids in handle_parts] == [162, 4, 4, 4]
    handle_ids = handle_parts[0]
    handle = local[1][handle_ids]
    stations = np.unique(np.round(handle[:, 0], 7))
    gap = int(np.argmax(np.diff(stations)))
    grip_start, grip_end = float(stations[gap]), float(stations[gap + 1])
    assert grip_end - grip_start > 6, 'Reinspect the handle profile if the long grip section changes'
    grip_x = (grip_start + grip_end) / 2
    grip_section = section(local[1], indices[1], grip_x)
    grip_local = (grip_section.min(0) + grip_section.max(0)) / 2
    grip_world = transform(grip_local[None, :], source_matrix)[0]
    # Preserve the source's existing 0.3102 thickness scale. Only a uniform
    # scale and a proper world-space rotation are added by normalization.
    source_axes = source_matrix[:3, :3]
    axis_lengths = np.linalg.norm(source_axes, axis=0)
    source_basis = source_axes / axis_lengths
    assert np.allclose(source_basis.T @ source_basis, np.eye(3), atol=1e-6)
    canonical_basis = np.array([[0., 0., 1.], [1., 0., 0.], [0., 1., 0.]])
    rotation = canonical_basis @ source_basis.T
    assert np.linalg.det(rotation) > .999999
    scale = LENGTH / (float(np.ptp(all_local[:, 0])) * axis_lengths[0])
    normalization = np.eye(4)
    normalization[:3, :3] = rotation * scale
    normalization[:3, 3] = -normalization[:3, :3] @ grip_world
    vertex_matrix = normalization @ source_matrix
    normalized = [transform(points, vertex_matrix) for points in local]
    all_normalized = np.vstack(normalized)
    handle_normalized = normalized[1][handle_ids]
    section_normalized = transform(grip_section, vertex_matrix)
    start_section = transform(section(local[1], indices[1], grip_start + 1e-5), vertex_matrix)
    end_section = transform(section(local[1], indices[1], grip_end - 1e-5), vertex_matrix)
    usable_start = float(transform(np.array([[grip_start, grip_local[1], grip_local[2]]]), vertex_matrix)[0, 1])
    usable_end = float(transform(np.array([[grip_end, grip_local[1], grip_local[2]]]), vertex_matrix)[0, 1])
    tip = normalized[0][np.isclose(local[0][:, 0], all_local[:, 0].max(), atol=1e-6)].mean(0).tolist()
    measurements = {name: measurement(points) for name, points in [('blade', normalized[0]), ('handle', handle_normalized), ('guard', normalized[2])]}
    measurements['usableGrip'] = {
        'selection': 'long straight handle profile between butt-bevel and guard-neck stations; centre uses actual triangle cross-section',
        'sourceLocalStartX': grip_start, 'sourceLocalEndX': grip_end,
        'startY': usable_start, 'endY': usable_end, 'length': usable_end - usable_start,
        'centerSection': measurement(section_normalized),
        'baseSection': measurement(start_section), 'topSection': measurement(end_section)}
    landmarks = {'gripCenter': [0., 0., 0.], 'tip': tip,
                 'handleBase': [0., measurements['handle']['bounds']['min'][1], 0.],
                 'handleTop': [0., measurements['handle']['bounds']['max'][1], 0.],
                 'guardCenter': measurements['guard']['center'],
                 'bladeBase': [0., measurements['blade']['bounds']['min'][1], 0.],
                 'pommelEnd': [0., measurements['handle']['bounds']['min'][1], 0.],
                 'gripStart': [0., usable_start, 0.], 'gripEnd': [0., usable_end, 0.]}
    source_hash = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
    provenance = copy.deepcopy(original['asset'].get('extras', {}))
    metadata = {'assetSource': 'classic-knife-glb', 'assetKind': 'knife', 'assetRevision': 'classic-knife-20261026',
                'source': provenance, 'sourceSha256': source_hash,
                'coordinateSystem': 'metres; +Y blade; XY blade plane; usable grip centre at origin; cutting edge -X',
                'landmarks': landmarks, 'measurements': measurements}
    doc = copy.deepcopy(original)
    nodes = [{'name': 'classic-knife', 'children': [], 'extras': metadata}]
    for entry in source_entries:
        ni, name, _, _, world, _ = entry
        nodes[0]['children'].append(len(nodes))
        nodes.append({'name': name, 'mesh': original['nodes'][ni]['mesh'],
                      'matrix': (normalization @ world).flatten(order='F').tolist(),
                      'extras': {'sourceNodeIndex': ni, 'sourceNodeName': name}})
    for name, point in [('muzzle', tip), ('grip-center', landmarks['gripCenter']),
                        ('guard', landmarks['guardCenter']), ('blade-base', landmarks['bladeBase']),
                        ('pommel', landmarks['pommelEnd']), ('magazine', [0, 0, 0]),
                        ('bolt', [0, 0, 0]), ('pump', [0, 0, 0]), ('eject', [0, 0, 0])]:
        nodes[0]['children'].append(len(nodes))
        nodes.append({'name': name, 'translation': point})
    doc['nodes'] = nodes
    doc['scenes'] = [{'name': 'Classic Knife canonical metres', 'nodes': [0]}]
    doc['scene'] = 0
    doc['extras'] = {**doc.get('extras', {}), 'source': str(SOURCE.relative_to(ROOT)), 'sourceSha256': source_hash}
    doc['asset']['generator'] = 'Sandline Classic Knife canonical frame; unchanged source mesh and image bytes'
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    # Preserve even the original BIN padding; no remeshing, welding, texture
    # conversion, compression, attribute reordering or material substitution.
    write_glb(OUTPUT, doc, binary)
    result_doc, result_binary = read_glb(OUTPUT)
    assert result_binary == binary, 'Source binary payload must remain byte-exact'
    for name in ['meshes', 'accessors', 'bufferViews', 'materials', 'images', 'textures', 'samplers']:
        assert result_doc[name] == original[name], name + ' must remain unchanged'
    result_entries = geometry(result_doc, result_binary)
    for i, entry in enumerate(result_entries):
        assert np.array_equal(entry[3], indices[i])
        assert np.allclose(entry[2], normalized[i], atol=1e-12)
        for semantic, source_accessor in source_entries[i][5]['attributes'].items():
            target_accessor = entry[5]['attributes'][semantic]
            assert np.array_equal(accessor(original, binary, source_accessor), accessor(result_doc, result_binary, target_accessor))
    points = np.vstack([entry[2] for entry in result_entries])
    assert np.isfinite(points).all() and abs(np.ptp(points[:, 1]) - LENGTH) < 1e-10
    assert np.allclose(transform(grip_local[None, :], vertex_matrix), [[0, 0, 0]], atol=1e-12)
    image_report = []
    for index, image_info in enumerate(original['images']):
        view = original['bufferViews'][image_info['bufferView']]
        data = binary[view.get('byteOffset', 0):view.get('byteOffset', 0) + view['byteLength']]
        result_view = result_doc['bufferViews'][result_doc['images'][index]['bufferView']]
        exported_data = result_binary[result_view.get('byteOffset', 0):result_view.get('byteOffset', 0) + result_view['byteLength']]
        assert data == exported_data
        image = Image.open(io.BytesIO(data)); image.load()
        image_report.append({'index': index, 'mimeType': image_info['mimeType'], 'bytes': len(data),
                             'size': list(image.size), 'mode': image.mode, 'encodedBytesExact': True,
                             'sha256': hashlib.sha256(data).hexdigest(),
                             'pixelSha256': hashlib.sha256(np.asarray(image).tobytes()).hexdigest()})
    projections(REPORT / 'asset-runtime-orthographic.png', result_entries, landmarks, [usable_start, usable_end])
    report = {'source': str(SOURCE.relative_to(ROOT)), 'suppliedSource': str(SUPPLIED),
              'file': str(OUTPUT.relative_to(ROOT)), 'sourceSha256': source_hash, 'sourceMetadata': provenance,
              'sha256': hashlib.sha256(OUTPUT.read_bytes()).hexdigest(),
              'sourceBytes': SOURCE.stat().st_size, 'bytes': OUTPUT.stat().st_size,
              'gzipBytes': len(gzip.compress(OUTPUT.read_bytes(), compresslevel=5, mtime=0)),
              'vertices': sum(len(p) for p in local), 'triangles': sum(len(i) for i in indices),
              'meshCount': len(result_entries), 'materialCount': len(doc['materials']),
              'bounds': measurement(points)['bounds'], 'dimensions': np.ptp(points, axis=0).tolist(),
              'landmarks': landmarks, 'measurements': measurements, 'images': image_report,
              'normalization': {'uniformWorldScale': scale, 'rotation': rotation.tolist(),
                                'sourceLocalGrip': grip_local.tolist(), 'sourceWorldGrip': grip_world.tolist(),
                                'sourceWorldToRuntime': normalization.flatten(order='F').tolist(),
                                'sourceVertexToRuntime': vertex_matrix.flatten(order='F').tolist(),
                                'originalSourceAxisScales': axis_lengths.tolist()},
              'geometryNotes': 'Handle material also includes 6 small trim triangles on blade/guard. All are retained; usable grip measurements isolate the connected main handle.',
              'validation': {'finiteBounds': True, 'totalLengthMetres': LENGTH, 'positiveTransformDeterminant': bool(np.linalg.det(vertex_matrix[:3, :3]) > 0),
                             'originalBinaryByteExact': True, 'allMeshDefinitionsExact': True, 'allIndicesExact': True,
                             'allPositionsNormalsUVsExactInSourceFrame': True, 'originalMaterialDefinitionsExact': True,
                             'allEmbeddedImageBytesExact': True, 'sourceProvenancePreserved': True,
                             'externalResources': 0, 'browserVisualCheck': 'integration lead'}}
    (REPORT / 'asset-preparation.json').write_text(json.dumps(report, indent=2) + '\n')
    (SOURCE.parent / 'source.json').write_text(json.dumps({'file': SOURCE.name, 'sha256': source_hash, 'source': provenance,
                                                         'suppliedSource': str(SUPPLIED)}, indent=2) + '\n')
    print(json.dumps({key: report[key] for key in ['bytes', 'triangles', 'vertices', 'dimensions', 'landmarks', 'measurements']}, indent=2))


if __name__ == '__main__':
    prepare()
