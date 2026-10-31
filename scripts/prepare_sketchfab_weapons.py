#!/usr/bin/env python3
"""Prepare downloaded Sketchfab weapons. Requires Python 3, numpy and Pillow.

Preserves all source triangles, PBR texture associations and geometric normals.
Mobile texture limits: normal/main colors 512, ORM/auxiliary colors 256. Normals
are resampled in vector space and losslessly PNG encoded; alpha is retained.
Axes and mechanical parts were inspected using orthographic triangle projections.
Run from any directory: python scripts/prepare_sketchfab_weapons.py
"""
import copy, hashlib, io, json, math, pathlib, struct
import numpy as np
from PIL import Image, ImageDraw
ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'assets-source/sketchfab-six-guns-20261008'
OUT = ROOT / 'assets-source/retired-20261023/assets/weapons/sketchfab'
REPORT = ROOT / 'artifacts/sketchfab-integration-20261010'
# axis rotation, total length metres, measured source muzzle, target muzzle.
CONFIG = {
 'rifle': dict(axis='positive-z',length=1.0,muzzle=[.0137,.111,.59878135],target=[0,.066,-.686],parts={'magazine':[7]},main=[1,2,8],support=[-.044,-.014,-.324],grip=[.024,-.095,.032]),
 'pistol':dict(axis='positive-z',length=.235,muzzle=[0,.47,1.0],target=[0,.069,-.199],parts={},main=[0,2],support=[-.035,-.015,-.035],grip=[.024,-.045,-.016]),
 'smg':dict(axis='negative-z',length=.75,muzzle=[0,.071,-.45095467],target=[0,.061,-.501],parts={},main=[0,1,2],support=[-.035,.005,-.303],grip=[.024,-.095,.032]),
 'shotgun':dict(axis='positive-x',length=1.2,muzzle=[.4474419,.199,0],target=[0,.076,-.788],parts={'pump':[10,14]},main=[0],support=[-.035,.024,-.398],grip=[.024,-.018,.048]),
 'm4':dict(axis='positive-z',length=1.0,muzzle=[.069,6.68,52.10388947],target=[0,.061,-.646],parts={},main=[0,2,4],support=[-.035,-.035,-.300],grip=[.024,-.065,.032]),
 'sniper':dict(axis='positive-z',length=1.3,muzzle=[0,1.77,15.86717796],target=[0,.061,-.876],parts={'magazine':[12],'bolt':[10]},main=[2,6,8],support=[-.036,-.012,-.365],grip=[.024,-.06,.032]),
}
NOTES = {
 'rifle':'Separate kheashab magazine. Receiver/bolt share static surfaces; bolt group empty. Sling retained.',
 'pistol':'Source groups are material partitions: Slide_Magazine spans slide and magazine, Barrel_Body spans barrel and grip. No safe independent moving mesh; empty magazine and bolt.',
 'smg':'Magazine and barrel share one mesh; receiver, grip and attachments span multiple mechanical parts. Empty magazine and bolt.',
 'shotgun':'Original Forend and ForendSlider meshes are the pump assembly. Tube magazine and bolt not separate; empty groups.',
 'm4':'Original material-group fragments span receiver/magazine/stock/barrel; no isolated mechanical moving mesh confirmed. Empty magazine and bolt.',
 'sniper':'Object_12 is isolated magazine; Object_10 isolated bolt handle. Bolt group moves handle only; breech receiver remains static.',
}
def read_glb(path):
 b=path.read_bytes();n=struct.unpack_from('<I',b,12)[0]
 assert b[:4]==b'glTF' and struct.unpack_from('<I',b,4)[0]==2
 return json.loads(b[20:20+n]),b[28+n:]
def accessor(j,b,i):
 a=j['accessors'][i];v=j['bufferViews'][a['bufferView']];dtype={5126:'f4',5125:'u4',5123:'u2',5121:'u1',5122:'i2',5120:'i1'}[a['componentType']];n={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']]
 return np.ndarray((a['count'],n),dtype='<'+dtype,buffer=b,offset=v.get('byteOffset',0)+a.get('byteOffset',0),strides=(v.get('byteStride',np.dtype(dtype).itemsize*n),np.dtype(dtype).itemsize))
def matrix(n):
 if 'matrix' in n:return np.array(n['matrix']).reshape((4,4),order='F')
 x,y,z,w=n.get('rotation',[0,0,0,1]);m=np.eye(4);m[:3,:3]=[[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]];m[:3,:3]@=np.diag(n.get('scale',[1,1,1]));m[:3,3]=n.get('translation',[0,0,0]);return m
def geometry(j,b):
 result=[]
 def visit(i,parent):
  n=j['nodes'][i];m=parent@matrix(n)
  if 'mesh' in n:
   for pr in j['meshes'][n['mesh']]['primitives']:
    p=accessor(j,b,pr['attributes']['POSITION']);p=np.c_[p,np.ones(len(p))]@m.T
    ix=accessor(j,b,pr['indices']).ravel().reshape(-1,3) if 'indices'in pr else np.arange(len(p)).reshape(-1,3)
    result.append((i,n.get('name',str(i)),p[:,:3],ix,m,pr))
  for ch in n.get('children',[]):visit(ch,m)
 for i in j['scenes'][j.get('scene',0)]['nodes']:visit(i,np.eye(4))
 return result

def image_roles(j,cfg):
 roles={}
 def add(ref,role,limit):
  if ref is None:return
  ti=ref['index'];ii=j['textures'][ti]['source'];r=roles.setdefault(ii,{'roles':set(),'limit':0});r['roles'].add(role);r['limit']=max(limit,r['limit'])
 for mi,mat in enumerate(j['materials']):
  pbr=mat.get('pbrMetallicRoughness',{});add(pbr.get('baseColorTexture'),'color',512 if mi in cfg['main'] else 256)
  add(pbr.get('metallicRoughnessTexture'),'metallicRoughness',256);add(mat.get('occlusionTexture'),'occlusion',256);add(mat.get('normalTexture'),'normal',512);add(mat.get('emissiveTexture'),'emissive',256)
 return roles

def encode_texture(data,role):
 im=Image.open(io.BytesIO(data));im.load();original=im.size
 # Keep every channel. Avoid lossy encoding on normals and packed PBR maps.
 if im.mode not in ('RGB','RGBA','L','LA'):im=im.convert('RGBA' if 'transparency' in im.info else 'RGB')
 limit=role['limit'];im.thumbnail((limit,limit),Image.Resampling.LANCZOS)
 if 'normal' in role['roles']:
  alpha=im.getchannel('A') if im.mode=='RGBA' else None
  values=np.asarray(im.convert('RGB'),dtype=np.float32)/127.5-1
  values/=np.maximum(np.linalg.norm(values,axis=2,keepdims=True),1e-8)
  im=Image.fromarray(np.rint(np.clip(values*.5+.5,0,1)*255).astype(np.uint8))
  if alpha is not None:im.putalpha(alpha)
 if im.mode=='RGBA' and im.getchannel('A').getextrema()==(255,255):im=im.convert('RGB')
 buf=io.BytesIO();im.save(buf,format='PNG',optimize=True)
 return buf.getvalue(),original,im.size

def write_glb(path,j,b):
 j['buffers']=[{'byteLength':len(b)}];js=json.dumps(j,separators=(',',':'),ensure_ascii=False).encode();js+=b' '*((-len(js))%4);b+=b'\0'*((-len(b))%4)
 path.write_bytes(struct.pack('<4sII',b'glTF',2,28+len(js)+len(b))+struct.pack('<I4s',len(js),b'JSON')+js+struct.pack('<I4s',len(b),b'BIN\0')+b)

def projection(path,slot,g):
 # Geometry-only orientation evidence; not a claim of material/render quality.
 im=Image.new('RGB',(1200,400),'#edf1f2');d=ImageDraw.Draw(im);allp=np.vstack([v[2]for v in g]);lo=allp.min(0);hi=allp.max(0);colors=['#ba6548','#487e9c','#658c51','#a38444','#916591','#449393']
 for col,(ax,ay) in enumerate([(2,1),(0,1),(2,0)]):
  scale=min(365/max(hi[ax]-lo[ax],.001),315/max(hi[ay]-lo[ay],.001));d.text((col*400+12,12),f'{slot}: {"XYZ"[ax]} / {"XYZ"[ay]}',fill='black')
  for k,(_,name,p,ix,_,_) in enumerate(g):
   pts=np.c_[(p[:,ax]-lo[ax])*scale+col*400+14,375-(p[:,ay]-lo[ay])*scale]
   for tri in ix:d.polygon([tuple(v)for v in pts[tri]],fill=colors[k%len(colors)])
 im.save(path)

def prepare(slot,cfg):
 provenance=json.loads((SOURCE/slot/'source.json').read_text());provenance={key:provenance[key] for key in ['uid','url','author','authorUrl','license']}
 source=SOURCE/slot/'model.glb';j,b=read_glb(source);g=geometry(j,b);points=np.vstack([r[2]for r in g]);original_bounds=[points.min(0).tolist(),points.max(0).tolist()]
 rot={'positive-z':np.diag([-1,1,-1]),'negative-z':np.eye(3),'positive-x':np.array([[0,0,1],[0,1,0],[-1,0,0]])}[cfg['axis']]
 axis=0 if cfg['axis']=='positive-x' else 2;scale=cfg['length']/np.ptp(points[:,axis]);norm=np.eye(4);norm[:3,:3]=rot*scale;norm[:3,3]=np.array(cfg['target'])-norm[:3,:3]@np.array(cfg['muzzle'])
 moving={name:bool(cfg['parts'].get(name)) for name in ['magazine','bolt','pump']}
 nodes=[{'name':f'sketchfab-{slot}','children':[1,2,3,4], 'extras':{'assetSource':'sketchfab','assetKind':slot,'source':provenance,'movingParts':moving,'weaponSockets':{'support':cfg['support'],'primaryGrip':cfg['grip']}}}]
 for name in ['body','magazine','bolt','pump']:nodes.append({'name':name,'children':[],'extras':{'movingPartAvailable':moving.get(name,False)}})
 normalized=[]
 for ni,name,p,ix,m,pr in g:
  source_node=j['nodes'][ni];new=copy.deepcopy(source_node)
  for key in ['translation','rotation','scale','children']:new.pop(key,None)
  new['matrix']=(norm@m).flatten(order='F').tolist();new['extras']={'sourceNodeIndex':ni,'sourceNodeName':name};idx=len(nodes);nodes.append(new)
  group=next((part for part,indices in cfg['parts'].items() if ni in indices),'body');nodes[['body','magazine','bolt','pump'].index(group)+1]['children'].append(idx)
  npnt=(np.c_[p,np.ones(len(p))]@norm.T)[:,:3];normalized.append((ni,name,npnt,ix,norm@m,pr))
 for name,pos in [('muzzle',cfg['target']),('eject',[.035,.064,-.085])]:nodes[0]['children'].append(len(nodes));nodes.append({'name':name,'translation':pos})
 j['nodes']=nodes;j['scenes']=[{'name':f'Sketchfab {slot} mobile','nodes':[0]}];j['scene']=0
 roles=image_roles(j,cfg);replacements={};image_report=[];memory=0
 for ii,im in enumerate(j['images']):
  view=j['bufferViews'][im['bufferView']];data=b[view.get('byteOffset',0):view.get('byteOffset',0)+view['byteLength']];role=roles[ii]
  encoded,old,size=encode_texture(data,role);replacements[im['bufferView']]=encoded;im['mimeType']='image/png';memory+=size[0]*size[1]*4*4/3
  image_report.append({'index':ii,'roles':sorted(role['roles']),'originalSize':old,'size':size,'bytes':len(encoded),'encoding':'lossless PNG'})
 rebuilt=bytearray()
 for vi,view in enumerate(j['bufferViews']):
  data=replacements.get(vi,b[view.get('byteOffset',0):view.get('byteOffset',0)+view['byteLength']]);rebuilt.extend(b'\0'*((-len(rebuilt))%4));view['byteOffset']=len(rebuilt);view['byteLength']=len(data);rebuilt.extend(data)
 j['asset']['generator']='Sandline mobile Sketchfab preparation (source geometry and PBR retained)';j.setdefault('extras',{})['source']='assets-source/sketchfab-six-guns-20261008/'+slot+'/model.glb'
 from weapon_reload_parts import partition, NOTES as RELOAD_NOTES
 rebuilt,partitions=partition(slot,j,bytes(rebuilt))
 dest=OUT/f'{slot}.glb';write_glb(dest,j,rebuilt);outj,outb=read_glb(dest);outg=geometry(outj,outb);outp=np.vstack([r[2]for r in outg]);assert np.isfinite(outp).all();assert sum(len(r[3])for r in outg)==sum(len(r[3])for r in g)
 projection(REPORT/f'model-preparation-{slot}.png',slot,outg)
 record={'file':f'{slot}.glb','source':provenance,'bytes':dest.stat().st_size,'sha256':hashlib.sha256(dest.read_bytes()).hexdigest(),'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'sourceForward':cfg['axis'],'sourceUp':'+Y','sourceBounds':original_bounds,'normalizationMatrix':norm.flatten(order='F').tolist(),'bounds':{'min':outp.min(0).tolist(),'max':outp.max(0).tolist()},'dimensions':np.ptp(outp,axis=0).tolist(),'triangles':sum(len(r[3])for r in outg),'meshCount':len(outg),'movingParts':moving,'movingPartSourceNodes':cfg['parts'],'notes':RELOAD_NOTES.get(slot,NOTES[slot]),'reloadPartitions':partitions,'muzzle':cfg['target'],'eject':[.035,.064,-.085],'support':cfg['support'],'primaryGrip':cfg['grip'],'estimatedTextureGpuBytesWithMipmaps':round(memory),'images':image_report,'validation':{'finitePositions':True,'trianglesPreserved':True,'sourceOrientation':'inspected three orthographic triangle projections','gameplayVisual':'requires browser inspection'}}
 print(slot,dest.stat().st_size,record['estimatedTextureGpuBytesWithMipmaps'],flush=True);return record

def main():
 OUT.mkdir(parents=True,exist_ok=True);REPORT.mkdir(parents=True,exist_ok=True)
 records={slot:prepare(slot,cfg)for slot,cfg in CONFIG.items()};manifest={'version':1,'coordinateSystem':'metres; +Y up; -Z forward; physical muzzle matched to game offset','texturePolicy':'normal/main color 512; ORM/auxiliary color 256; lossless PNG; source alpha and PBR channels retained','weapons':records,'totalBytes':sum(r['bytes']for r in records.values()),'estimatedTextureGpuBytesWithMipmaps':sum(r['estimatedTextureGpuBytesWithMipmaps']for r in records.values())}
 assert manifest['estimatedTextureGpuBytesWithMipmaps']<=96*1024*1024
 (OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');(REPORT/'model-preparation.json').write_text(json.dumps(manifest,indent=2)+'\n')
 print('TOTAL',manifest['totalBytes'],'GPU',manifest['estimatedTextureGpuBytesWithMipmaps'],flush=True)
if __name__=='__main__':main()
