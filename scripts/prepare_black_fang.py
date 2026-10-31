"""Prepare the user-provided Black Fang GLB; requires numpy and Pillow.
Retains every triangle, UV, normal and PBR association. Only the presentation
axes, metre scale and texture resolution change. Original is kept separately.
"""
import hashlib,json,numpy as np
from pathlib import Path
from prepare_sketchfab_weapons import read_glb,write_glb,geometry,image_roles,encode_texture,projection

ROOT=Path(__file__).resolve().parents[1]
source=ROOT/'assets-source/black-fang-20261016/original.glb'
# Historical asset: regeneration stays outside the browser runtime graph.
dest=ROOT/'assets-source/retired-20261024/assets/runtime/knife.glb'
dest.parent.mkdir(parents=True,exist_ok=True)
report=ROOT/'artifacts/black-fang-20261016'
report.mkdir(parents=True,exist_ok=True)
j,b=read_glb(source)
# Remove the Sketchfab display tilt and exporter axis conversion. The authored
# blade axis is +Y; handle centre is (-.004,-1.05,.033) in source units.
j['nodes'][0]['matrix']=np.eye(4).flatten(order='F').tolist()
j['nodes'][2]['matrix']=np.eye(4).flatten(order='F').tolist()
g=geometry(j,b);points=np.vstack([r[2] for r in g]);scale=.36/np.ptp(points[:,1])
root=j['nodes'][0];root.pop('matrix');root['scale']=[scale]*3
root['translation']=(np.array([.004,1.05,-.033])*scale).tolist()
root['name']='black-fang-knife'
root['extras']={'assetSource':'black-fang-glb','assetKind':'knife','source':j['asset']['extras']}
tip=(np.array([-.011,points[:,1].max(),.033])+np.array([.004,1.05,-.033]))*scale
roles=image_roles(j,{'main':[0,1,2,3,4]});replacements={};images=[]
for ii,im in enumerate(j['images']):
 view=j['bufferViews'][im['bufferView']];data=b[view.get('byteOffset',0):view.get('byteOffset',0)+view['byteLength']]
 encoded,old,size=encode_texture(data,roles[ii]);replacements[im['bufferView']]=encoded
 images.append({'index':ii,'original':old,'runtime':size,'bytes':len(encoded)})
rebuilt=bytearray()
for vi,view in enumerate(j['bufferViews']):
 data=replacements.get(vi,b[view.get('byteOffset',0):view.get('byteOffset',0)+view['byteLength']])
 rebuilt.extend(b'\0'*((-len(rebuilt))%4));view['byteOffset']=len(rebuilt);view['byteLength']=len(data);rebuilt.extend(data)
for name,position in [('muzzle',tip.tolist()),('magazine',[0,0,0]),('bolt',[0,0,0]),('pump',[0,0,0]),('eject',[0,0,0])]:
 j['scenes'][0]['nodes'].append(len(j['nodes']));j['nodes'].append({'name':name,'translation':position})
write_glb(dest,j,rebuilt)
outj,outb=read_glb(dest);outg=geometry(outj,outb);outp=np.vstack([r[2] for r in outg])
triangles=sum(len(r[3]) for r in outg);assert triangles==sum(len(r[3]) for r in g)
assert np.isfinite(outp).all();projection(report/'runtime-axes.png','Black Fang',outg)
data={'source':j['asset']['extras'],'sourceSHA256':hashlib.sha256(source.read_bytes()).hexdigest(),'runtimeSHA256':hashlib.sha256(dest.read_bytes()).hexdigest(),'bytes':dest.stat().st_size,'triangles':triangles,'dimensions':np.ptp(outp,axis=0).tolist(),'bounds':[outp.min(0).tolist(),outp.max(0).tolist()],'tip':tip.tolist(),'images':images}
(report/'asset-preparation.json').write_text(json.dumps(data,indent=2)+'\n')
print(json.dumps({k:data[k] for k in ['bytes','triangles','dimensions','tip']}))
