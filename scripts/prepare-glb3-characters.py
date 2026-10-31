"""Copy the user-supplied character assets without altering geometry or materials."""
from pathlib import Path
import hashlib
import json
import shutil
import struct
import sys

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / 'Downloads/glb3'
OUTPUT = ROOT / 'public/assets/characters'
REPORT = ROOT / 'artifacts/glb3-replacement-20261023/character-intake.json'
FILES = {
    'gign': 'gign_cscz_counter_strike_condition_zero.glb',
    'gsg9': 'gsg9_cscz_counter_strike_condition_zero.glb',
    'sas': 'sas_cscz_counter_strike_condition_zero.glb',
    'urban': 'unarmed_idle_counter_terrorist (1).glb',
    'terrorist1': 'counter_strike_source_terrorist_1reuploaded.glb',
    'terrorist2': 'counter_strike_source_terrorist_2.glb',
    'terrorist3': 'counter_strike_source_terrorist_3.glb',
}

report = []
OUTPUT.mkdir(parents=True, exist_ok=True)
for model_id, filename in FILES.items():
    source = SOURCE / filename
    data = source.read_bytes()
    assert data[:4] == b'glTF' and struct.unpack_from('<I', data, 4)[0] == 2
    assert struct.unpack_from('<I', data, 8)[0] == len(data), f'{filename}: incomplete GLB'
    document = json.loads(data[20:20 + struct.unpack_from('<I', data, 12)[0]])
    primitives = [primitive for mesh in document['meshes'] for primitive in mesh['primitives']]
    assert document.get('skins') and all('JOINTS_0' in p['attributes'] and 'WEIGHTS_0' in p['attributes'] for p in primitives)
    assert all('uri' not in image for image in document.get('images', [])), 'Keep the asset self-contained'
    assert all('uri' not in buffer for buffer in document.get('buffers', [])), 'Keep the asset self-contained'
    output = OUTPUT / (filename.replace(' (1)', '') if model_id == 'urban' else filename)
    shutil.copyfile(source, output)
    digest = hashlib.sha256(data).hexdigest()
    assert hashlib.sha256(output.read_bytes()).hexdigest() == digest
    report.append({
        'id': model_id, 'source': str(source), 'output': str(output.relative_to(ROOT)),
        'bytes': len(data), 'sha256': digest, 'provenance': document['asset'].get('extras', {}),
        'triangles': sum(document['accessors'][p.get('indices', p['attributes']['POSITION'])]['count'] // 3 for p in primitives),
        'skinJoints': [len(skin['joints']) for skin in document['skins']],
        'materials': [material.get('name', '') for material in document.get('materials', [])],
        'clips': [clip.get('name', '') for clip in document.get('animations', [])],
        'changes': 'Byte-identical source copy; runtime semantic bone mapping and animation retargeting only. Authored materials preserved.',
    })
REPORT.parent.mkdir(parents=True, exist_ok=True)
REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'models': len(report), 'bytes': sum(item['bytes'] for item in report), 'report': str(REPORT)}, ensure_ascii=False))
