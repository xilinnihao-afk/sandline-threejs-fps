"""Build compact character GLBs; preserve geometry and skin buffers exactly.
Usage: python scripts/prepare_roster_assets.py /path/to/glb2 (requires Pillow).
"""
import argparse,io,json,struct
from pathlib import Path
from PIL import Image, ImageOps
root=Path(__file__).resolve().parents[1]
out=root/'public/assets/characters'
report=[]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('sources',nargs='+',type=Path)
parser.add_argument('--report',type=Path,default=root/'artifacts/character-refresh-20261013/asset-sizes.json')
args=parser.parse_args()
paths=sorted({p for source in args.sources for p in (source.glob('*.glb') if source.is_dir() else [source])})
for path in paths:
 if path.name in {'saintsrow1_-_tanya.glb','cs2_terrorist_rigged.glb'}:continue # Retired from the active roster.
 raw=path.read_bytes();length=struct.unpack_from('<I',raw,12)[0]
 doc=json.loads(raw[20:20+length]);binary=raw[28+length:]
 images={im['bufferView']:im for im in doc.get('images',[])}
 # Bake the renderer's legacy gloss-to-roughness conversion once, offline.
 glossviews={}
 for mat in doc.get('materials',[]):
  legacy=mat.get('extensions',{}).pop('KHR_materials_pbrSpecularGlossiness',None)
  if not legacy:continue
  mat['pbrMetallicRoughness']={'baseColorTexture':legacy.get('diffuseTexture'),'baseColorFactor':legacy.get('diffuseFactor',[1,1,1,1]),'metallicFactor':0,'roughnessFactor':1-legacy.get('glossinessFactor',1)}
  if legacy.get('specularGlossinessTexture'):
   ref=legacy['specularGlossinessTexture'];image=doc['textures'][ref['index']]['source']
   glossviews[doc['images'][image]['bufferView']]=legacy.get('glossinessFactor',1)
   mat['pbrMetallicRoughness'].update(roughnessFactor=1,metallicRoughnessTexture=ref)
 for key in ['extensionsUsed','extensionsRequired']:
  doc[key]=[e for e in doc.get(key,[]) if e!='KHR_materials_pbrSpecularGlossiness']
 colors=set()
 for mat in doc.get('materials',[]):
  for ref in [mat.get('pbrMetallicRoughness',{}).get('baseColorTexture'),mat.get('emissiveTexture'),mat.get('extensions',{}).get('KHR_materials_pbrSpecularGlossiness',{}).get('diffuseTexture')]:
   if ref:colors.add(doc['textures'][ref['index']]['source'])
 colorviews={doc['images'][i]['bufferView'] for i in colors}
 chunks=bytearray()
 for i,view in enumerate(doc['bufferViews']):
  data=binary[view.get('byteOffset',0):view.get('byteOffset',0)+view['byteLength']]
  if i in images:
   im=Image.open(io.BytesIO(data)).convert('RGBA');im.thumbnail((1024,1024) if i in colorviews else (512,512),Image.Resampling.LANCZOS)
   if i in glossviews:
    rough=im.getchannel('A').point(lambda a:round(255-a*glossviews[i]))
    im=Image.merge('RGBA',(Image.new('L',im.size,255),rough,Image.new('L',im.size,0),Image.new('L',im.size,255)))
   buf=io.BytesIO()
   im.save(buf,format='WEBP',lossless=i not in colorviews,quality=90,method=6,exact=True)
   images[i]['mimeType']='image/webp'
   data=buf.getvalue()
  chunks.extend(b'\0'*(-len(chunks)%4));view['byteOffset']=len(chunks);view['byteLength']=len(data);chunks.extend(data)
 for texture in doc.get('textures',[]):
  texture.setdefault('extensions',{})['EXT_texture_webp']={'source':texture.pop('source')}
 for key in ['extensionsUsed','extensionsRequired']:
  doc[key]=list(dict.fromkeys(doc.get(key,[])+['EXT_texture_webp']))
 chunks.extend(b'\0'*(-len(chunks)%4));doc['buffers'][0]['byteLength']=len(chunks)
 meta=json.dumps(doc,separators=(',',':')).encode();meta+=b' '*(-len(meta)%4)
 result=struct.pack('<III',0x46546c67,2,28+len(meta)+len(chunks))+struct.pack('<II',len(meta),0x4e4f534a)+meta+struct.pack('<II',len(chunks),0x004e4942)+chunks
 (out/path.name).write_bytes(result)
 report.append(dict(file=path.name,before=len(raw),after=len(result)))
 print(path.name,len(raw),'->',len(result),flush=True)
args.report.parent.mkdir(parents=True,exist_ok=True)
args.report.write_text(json.dumps(report,indent=2))
