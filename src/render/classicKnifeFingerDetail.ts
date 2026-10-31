import * as THREE from 'three';

interface Corner {vertex:number;uv:THREE.Vector2;bone:number}
interface Face {corners:[Corner,Corner,Corner]}
interface Edge {a:number;b:number;opposite:number[];mid?:number}

/** A cached, knife-only refinement of the original exposed right-hand skin.
 * Work on the closed grip in a metre-scale wrist frame: soften the source's
 * square finger edges while fixing every open glove boundary. Then unskin
 * into each original joint, so the entire grasp remains rigid to the knife.
 * UV seams survive subdivision; firearms use the untouched source geometry. */
export class ClassicKnifeFingerDetail {
 private readonly mesh:THREE.SkinnedMesh;
 private readonly source:THREE.BufferGeometry;
 private detailed:THREE.BufferGeometry|undefined;

 constructor(private readonly model:THREE.Object3D){
  const mesh=model.getObjectByName('Object_9');
  if(!(mesh instanceof THREE.SkinnedMesh))throw new Error('Missing right finger skin');
  this.mesh=mesh;this.source=mesh.geometry;
 }

 update(enabled:boolean):void{
  if(enabled)this.mesh.geometry=this.detailed??(this.detailed=this.build());
  else this.mesh.geometry=this.source;
 }

 private build():THREE.BufferGeometry{
  const mesh=this.mesh,source=this.source,hand=this.model.getObjectByName('Bone_Lefthand_39')!;
  this.model.updateWorldMatrix(true,true);mesh.skeleton.update();
  const frame=new THREE.Matrix4().extractRotation(hand.matrixWorld).setPosition(hand.getWorldPosition(new THREE.Vector3()));
  const inverse=frame.clone().invert(),p=source.getAttribute('position'),uv=source.getAttribute('uv'),skin=source.getAttribute('skinIndex');
  const points:THREE.Vector3[]=[],corners:Corner[]=[];
  for(let i=0;i<p.count;i++){
   const point=mesh.getVertexPosition(i,new THREE.Vector3()).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);
   let vertex=points.findIndex(other=>other.distanceToSquared(point)<1e-12);
   if(vertex<0){vertex=points.length;points.push(point);}
   corners.push({vertex,uv:new THREE.Vector2(uv.getX(i),uv.getY(i)),bone:skin.getX(i)});
  }
  let faces:Face[]=[];const index=source.index!;
  for(let i=0;i<index.count;i+=3)faces.push({corners:[0,1,2].map(j=>corners[index.getX(i+j)]) as Face['corners']});
  const original=faces.map(face=>new THREE.Triangle(...face.corners.map(c=>points[c.vertex].clone()) as [THREE.Vector3,THREE.Vector3,THREE.Vector3]));
  const nearest=new THREE.Vector3(),candidate=new THREE.Vector3();
  const limit=(point:THREE.Vector3)=>{
   let distance=Infinity;
   for(const tri of original){tri.closestPointToPoint(point,candidate);const d=candidate.distanceToSquared(point);if(d<distance){distance=d;nearest.copy(candidate);}}
   // At most 0.9 mm of rounding, preserving calibrated handle contact.
   if(distance>.0009*.0009){candidate.copy(point).sub(nearest).setLength(.0009);point.copy(nearest).add(candidate);}
   return point;
  };
  for(let pass=0;pass<2;pass++){
   const edges=new Map<string,Edge>(),neighbors=points.map(()=>new Set<number>());
   const edgeKey=(a:number,b:number)=>a<b?a+':'+b:b+':'+a;
   for(const {corners:c} of faces)for(let i=0;i<3;i++){
    const a=c[i].vertex,b=c[(i+1)%3].vertex,opposite=c[(i+2)%3].vertex,key=edgeKey(a,b);
    const edge=edges.get(key)??{a,b,opposite:[]};edge.opposite.push(opposite);edges.set(key,edge);
    neighbors[a].add(b);neighbors[b].add(a);
   }
   const boundary=new Set<number>();for(const edge of edges.values())if(edge.opposite.length!==2){boundary.add(edge.a);boundary.add(edge.b);}
   const next=points.map((point,i)=>{
    if(boundary.has(i))return point.clone();
    const n=neighbors[i].size,beta=n===3?3/16:3/(8*n),smooth=point.clone().multiplyScalar(1-n*beta);
    for(const other of neighbors[i])smooth.addScaledVector(points[other],beta);
    return limit(point.clone().lerp(smooth,.55));
   });
   for(const edge of edges.values()){
    const a=points[edge.a],b=points[edge.b],mid=a.clone().add(b).multiplyScalar(.5);
    if(edge.opposite.length===2){
     const smooth=a.clone().add(b).multiplyScalar(.375).addScaledVector(points[edge.opposite[0]],.125).addScaledVector(points[edge.opposite[1]],.125);
     mid.lerp(smooth,.65);limit(mid);
    }
    edge.mid=next.length;next.push(mid);
   }
   const middle=(a:Corner,b:Corner):Corner=>({vertex:edges.get(edgeKey(a.vertex,b.vertex))!.mid!,uv:a.uv.clone().add(b.uv).multiplyScalar(.5),bone:Math.min(a.bone,b.bone)});
   const nextFaces:Face[]=[];
   for(const {corners:[a,b,c]} of faces){const ab=middle(a,b),bc=middle(b,c),ca=middle(c,a);for(const corners of [[a,ab,ca],[ab,b,bc],[ca,bc,c],[ab,bc,ca]])nextFaces.push({corners:corners as Face['corners']});}
   points.splice(0,points.length,...next);faces=nextFaces;
  }
  const normals=points.map(()=>new THREE.Vector3());
  for(const {corners:[a,b,c]} of faces){
   const normal=new THREE.Vector3().crossVectors(points[b.vertex].clone().sub(points[a.vertex]),points[c.vertex].clone().sub(points[a.vertex]));
   for(const corner of [a,b,c])normals[corner.vertex].add(normal);
  }
  normals.forEach(n=>n.normalize());
  const frames=new Map<number,{position:THREE.Matrix4;normal:THREE.Matrix3}>();
  for(const corner of corners)if(!frames.has(corner.bone)){
   const toWrist=inverse.clone().multiply(mesh.matrixWorld).multiply(mesh.bindMatrixInverse)
    .multiply(mesh.skeleton.bones[corner.bone].matrixWorld).multiply(mesh.skeleton.boneInverses[corner.bone]).multiply(mesh.bindMatrix);
   frames.set(corner.bone,{position:toWrist.clone().invert(),normal:new THREE.Matrix3().getNormalMatrix(toWrist).invert()});
  }
  const positions:number[]=[],outNormals:number[]=[],uvs:number[]=[],joints:number[]=[],weights:number[]=[],indices:number[]=[],emitted=new Map<string,number>();
  for(const face of faces)for(const c of face.corners){
   const key=[c.vertex,c.uv.x,c.uv.y,c.bone].join('/');let id=emitted.get(key);
   if(id===undefined){
    id=positions.length/3;emitted.set(key,id);const transform=frames.get(c.bone)!;
    positions.push(...points[c.vertex].clone().applyMatrix4(transform.position).toArray());
    outNormals.push(...normals[c.vertex].clone().applyMatrix3(transform.normal).normalize().toArray());
    uvs.push(c.uv.x,c.uv.y);joints.push(c.bone,0,0,0);weights.push(1,0,0,0);
   }
   indices.push(id);
  }
  const geometry=new THREE.BufferGeometry();geometry.setIndex(indices);
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(outNormals,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(joints,4));geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));
  geometry.computeBoundingBox();geometry.computeBoundingSphere();return geometry;
 }
}
