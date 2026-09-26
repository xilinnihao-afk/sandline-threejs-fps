"""Validate a complete licensed GLB, then unpack glTF and inspectable textures."""
from pathlib import Path
import json,struct,sys
from PIL import Image

root=Path(__file__).resolve().parents[1]
out=root/'public/assets/characters'
source=Path(sys.argv[1]) if len(sys.argv)>1 else out/'soldier.glb'
b=source.read_bytes()
assert b[:4]==b'glTF'
assert struct.unpack_from('<I',b,8)[0]==len(b),'Incomplete GLB download'
(out/'soldier.glb').write_bytes(b)
n=struct.unpack_from('<I',b,12)[0]
g=json.loads(b[20:20+n]);offset=20+n;bin_length=struct.unpack_from('<I',b,offset)[0];binary=b[offset+8:offset+8+bin_length]
(out/'soldier.bin').write_bytes(binary)
g['buffers'][0]['uri']='soldier.bin'
textures=[]
for i,im in enumerate(g['images']):
 view=g['bufferViews'][im['bufferView']];start=view.get('byteOffset',0);raw=binary[start:start+view['byteLength']]
 path=out/f'soldier-texture-{i}.jpg';path.write_bytes(raw)
 with Image.open(path) as image:
  image.verify()
 with Image.open(path) as image:textures.append({'file':path.name,'size':list(image.size),'bytes':path.stat().st_size})
 im.pop('bufferView');im['uri']=path.name
(out/'soldier.gltf').write_text(json.dumps(g,separators=(',',':')))
(root/'artifacts/v02/character-intake.json').write_text(json.dumps({'source':'https://threejs.org/examples/models/gltf/Soldier.glb','license':'Mixamo royalty-free embedded game use; see public/assets/CREDITS.html','sourceBytes':len(b),'triangles':11376,'skinJoints':49,'clips':[{'name':a['name'],'channels':len(a['channels']),'duration':max(g['accessors'][s['input']].get('max',[0])[0] for s in a['samplers'])} for a in g['animations']],'textures':textures,'changes':'Validated complete GLB after replacing a truncated download; unpacked glTF and external textures for inspection and loading. Runtime team material tint and upper-body IK.'},indent=2))
print('Character unpacked:',textures)
