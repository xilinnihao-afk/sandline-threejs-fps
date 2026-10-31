#!/usr/bin/env python3
"""Build the live weapon derivatives from non-public source assets.

Requires Pillow. Lossless WebP preserves data maps; albedo uses quality 94 at
the original resolution. Source assets live outside public so production builds
only include browser-ready derivatives.
"""
import copy, gzip, hashlib, io, json, struct
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/assets/runtime'
OUT.mkdir(parents=True, exist_ok=True)

def prepare(path, name):
    raw = path.read_bytes()
    length = struct.unpack_from('<I', raw, 12)[0]
    original = json.loads(raw[20:20+length]); doc = copy.deepcopy(original)
    binary = raw[28+length:]
    colors = set()
    for material in doc.get('materials', []):
        legacy = material.get('extensions', {}).get('KHR_materials_pbrSpecularGlossiness')
        for ref in [material.get('pbrMetallicRoughness', {}).get('baseColorTexture'),
                    material.get('emissiveTexture'), (legacy or {}).get('diffuseTexture')]:
            if ref: colors.add(doc.get('textures', [])[ref['index']]['source'])
    # Compact only the binary views. Accessor offsets, indices, topology,
    # normals, skin matrices, nodes and extras remain byte-for-byte unchanged.
    image_views = {image['bufferView']: i for i, image in enumerate(doc.get('images', []))}
    chunks = bytearray(); image_report = []
    for index, view in enumerate(doc['bufferViews']):
        old = binary[view.get('byteOffset', 0):view.get('byteOffset', 0)+view['byteLength']]
        data = old
        if index in image_views:
            image_index = image_views[index]
            im = Image.open(io.BytesIO(old)).convert('RGBA'); target = io.BytesIO()
            lossless = image_index not in colors
            im.save(target, format='WEBP', lossless=lossless, quality=94, method=6, exact=True)
            data = target.getvalue()
            doc.get('images', [])[image_index]['mimeType'] = 'image/webp'
            image_report.append({'image':image_index,'size':im.size,'lossless':lossless,'before':len(old),'after':len(data)})
        while len(chunks) % 4: chunks.append(0)
        view['byteOffset'] = len(chunks); view['byteLength'] = len(data)
        chunks.extend(data)
    for texture in doc.get('textures', []):
        source = texture.pop('source')
        texture.setdefault('extensions', {})['EXT_texture_webp'] = {'source':source}
    for key in ['extensionsUsed', 'extensionsRequired']:
        doc[key] = list(dict.fromkeys(doc.get(key, []) + (['EXT_texture_webp'] if doc.get('textures') else [])))
    while len(chunks) % 4: chunks.append(0)
    doc['buffers'][0]['byteLength'] = len(chunks)
    metadata = json.dumps(doc, separators=(',', ':')).encode()
    metadata += b' ' * (-len(metadata) % 4)
    result = struct.pack('<III', 0x46546c67, 2, 28+len(metadata)+len(chunks))
    result += struct.pack('<II', len(metadata), 0x4e4f534a)+metadata
    result += struct.pack('<II', len(chunks), 0x004e4942)+chunks
    (OUT / name).write_bytes(result)
    return {'source':str(path.relative_to(ROOT)),'file':name,'before':len(raw),'after':len(result),
            'gzipBytes':len(gzip.compress(result, compresslevel=5, mtime=0)),
            'sha256':hashlib.sha256(result).hexdigest(),'images':image_report}

if __name__ == '__main__':
    # M4 has its own rigid-part import recipe; never rebuild the retired M4.
    from prepare_glb3_m4 import prepare as prepare_m4
    from prepare_deagle import prepare as prepare_deagle
    files = [prepare(ROOT/f'assets-source/retired-20261023/assets/weapons/sketchfab/{kind}.glb', f'{kind}.glb')
             for kind in ['rifle','pistol','smg','shotgun','sniper']]
    files.append(prepare_m4())
    files.append(prepare_deagle())
    (OUT/'manifest.json').write_text(json.dumps({'files':files}, indent=2)+'\n')
    for file in files: print(file['file'],file['before'],'->',file['after'],'gzip',file['gzipBytes'],flush=True)
    print('TOTAL',sum(f['before'] for f in files),'->',sum(f['after'] for f in files),'gzip',sum(f['gzipBytes'] for f in files))
