"""Mechanical partitions of normalized Sketchfab meshes; retains every triangle/UV.

Selection IDs refer to the normalized nodes created by prepare_sketchfab_weapons.
Welded connected components separate material-batched mechanical assemblies.
"""
import copy
import numpy as np

def components(p,ix):
 parent=list(range(len(ix)));seen={}
 def find(a):
  while parent[a]!=a:parent[a]=parent[parent[a]];a=parent[a]
  return a
 for i,tri in enumerate(ix):
  for v in tri:
   key=tuple(np.rint(p[v]*1e6).astype(int))
   if key in seen:parent[find(i)]=find(seen[key])
   else:seen[key]=i
 groups={}
 for i in range(len(ix)):groups.setdefault(find(i),[]).append(i)
 return [np.array(ids) for ids in groups.values()]

NOTES={
 'pistol':'Magazine and slide split by welded components; sights travel with slide. Original seated geometry/UVs retained.',
 'smg':'Curved magazine body and floorplate split from shared barrel material mesh. Original seated geometry/UVs retained.',
 'm4':'Magazine component split from shared receiver/grip material mesh. Original seated geometry/UVs retained.',
 'shotgun':'Original pump retained. Recessed loading-port carrier surface independently lifts into receiver during shell insertion.',
}

def partition(slot,j,b):
 from prepare_sketchfab_weapons import geometry,accessor
 if slot not in NOTES:return b,{}
 if j.get('extras',{}).get('reloadPartitions'):return b,j['extras']['reloadPartitions']
 data=bytearray(b);details={}
 def add_access(a,template):
  a=np.ascontiguousarray(a);data.extend(b'\0'*((-len(data))%4));vi=len(j['bufferViews']);j['bufferViews'].append({'buffer':0,'byteOffset':len(data),'byteLength':a.nbytes});data.extend(a.tobytes())
  ac=copy.deepcopy(template);ac.update(bufferView=vi,byteOffset=0,count=len(a));ac.pop('sparse',None)
  if 'min'in ac:ac['min']=a.min(0).tolist();ac['max']=a.max(0).tolist()
  ai=len(j['accessors']);j['accessors'].append(ac);return ai
 def primitive(pr,ix):
  verts,remap=np.unique(ix,return_inverse=True);out=copy.deepcopy(pr)
  out['attributes']={k:add_access(accessor(j,b,ai)[verts],j['accessors'][ai])for k,ai in pr['attributes'].items()}
  out['indices']=add_access(remap.astype('<u4').reshape(-1,1),{'componentType':5125,'type':'SCALAR'})
  return out
 for ni,name,p,ix,m,pr in list(geometry(j,b)):
  labels=np.full(len(ix),'body',dtype=object)
  for ci,ids in enumerate(components(p,ix)):
   part=None
   if slot=='pistol':
    if ni==7 and ci==1:part='magazine'
    elif ni==7 and ci==0 or ni==6 and ci in [5,6,8]:part='bolt'
   elif slot=='smg' and ni==7 and ci in [1,4]:part='magazine'
   elif slot=='m4' and ni==6 and ci==3:part='magazine'
   if part:labels[ids]=part
  if slot=='shotgun' and ni==5:
   pp=p[ix];gate=(abs(pp[:,:,1]-.03735)<.00001).all(1)&(abs(pp[:,:,0])<.01461).all(1)&(pp[:,:,2]>-.1652).all(1)&(pp[:,:,2]<-.0951).all(1)
   labels[gate]='loading-gate'
  parts=[x for x in sorted(set(labels))if x!='body']
  if not parts:continue
  assert len(j['meshes'][j['nodes'][ni]['mesh']]['primitives'])==1
  template=copy.deepcopy(j['nodes'][ni])
  if (labels=='body').any():j['meshes'][template['mesh']]['primitives']=[primitive(pr,ix[labels=='body'])]
  else:del j['nodes'][ni]['mesh']
  for part in parts:
   ids=labels==part;new=copy.deepcopy(template);new['name']=f'{name}-{part}';new['mesh']=len(j['meshes']);j['meshes'].append({'primitives':[primitive(pr,ix[ids])]})
   idx=len(j['nodes']);j['nodes'].append(new)
   group=next((i for i,n in enumerate(j['nodes'])if n.get('name')==part),None)
   if group is None:
    group=len(j['nodes']);j['nodes'].append({'name':part,'children':[]});j['nodes'][0]['children'].append(group)
   j['nodes'][group]['children'].append(idx)
   j['nodes'][group].setdefault('extras',{})['movingPartAvailable']=True
   if part in ['magazine','bolt','pump']:j['nodes'][0]['extras']['movingParts'][part]=True
   details.setdefault(part,[]).append({'node':ni,'triangles':int(ids.sum())})
 j.setdefault('extras',{})['reloadPartitions']=details
 return bytes(data),details
