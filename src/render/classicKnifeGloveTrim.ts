import * as THREE from 'three';

/** Tuck the source glove's flat lower skirt into the closed palm silhouette.
 * Knife-only instance geometry: no deleted faces, no changed wrist/finger seams. */
export class ClassicKnifeGloveTrim {
 private readonly mesh:THREE.SkinnedMesh;
 private readonly source:THREE.BufferGeometry;
 private trimmed:THREE.BufferGeometry|undefined;
 readonly movedVertices:number[]=[];
 constructor(private readonly model:THREE.Object3D){
  const mesh=model.getObjectByName('Object_7');
  if(!(mesh instanceof THREE.SkinnedMesh))throw new Error('Missing right glove');
  this.mesh=mesh;this.source=mesh.geometry;
 }
 update(enabled:boolean):void {this.mesh.geometry=enabled?(this.trimmed??=this.build()):this.source;}
 private build():THREE.BufferGeometry {
  const mesh=this.mesh,hand=this.model.getObjectByName('Bone_Lefthand_39')!;
  this.model.updateWorldMatrix(true,true);mesh.skeleton.update();
  const sourcePosition=this.source.attributes.position,geometry=this.source.clone(),position=geometry.attributes.position as THREE.BufferAttribute;
  const toHand=hand.matrixWorld.clone().invert();
  const world=Array.from({length:sourcePosition.count},(_,i)=>mesh.getVertexPosition(i,new THREE.Vector3()).applyMatrix4(mesh.matrixWorld));
  const boundary:THREE.Vector3[]=[];
  for(const name of ['Object_8','Object_9']){
   const other=this.model.getObjectByName(name) as THREE.SkinnedMesh;other.skeleton.update();
   for(let i=0;i<other.geometry.attributes.position.count;i++)boundary.push(other.getVertexPosition(i,new THREE.Vector3()).applyMatrix4(other.matrixWorld));
  }
  // Semantic control points of the lower palm skirt, including welded UV copies.
  const anchors=[[0,.006],[3,.002],[4,.002],[31,.004],[54,.004],[55,.008],[59,.009]] as const;
  const upInHand=new THREE.Vector3(32.83742711,-5.55128715,1.41344806);
  const skin=this.source.attributes.skinIndex,weight=this.source.attributes.skinWeight;
  for(let i=0;i<position.count;i++){
   const anchor=anchors.find(([id])=>new THREE.Vector3().fromBufferAttribute(sourcePosition,id).distanceToSquared(new THREE.Vector3().fromBufferAttribute(sourcePosition,i))<1e-10);
   if(!anchor||boundary.some(p=>p.distanceToSquared(world[i])<1e-10))continue;
   const joint=skin.getX(i);if(weight.getX(i)!==1||mesh.skeleton.bones[joint]!==hand)throw new Error('Glove trim anchor is not rigidly on palm');
   const skinToWorld=mesh.matrixWorld.clone().multiply(mesh.bindMatrixInverse).multiply(hand.matrixWorld).multiply(mesh.skeleton.boneInverses[joint]).multiply(mesh.bindMatrix);
   const point=world[i].clone().applyMatrix4(toHand).addScaledVector(upInHand,anchor[1]).applyMatrix4(hand.matrixWorld).applyMatrix4(skinToWorld.invert());
   position.setXYZ(i,point.x,point.y,point.z);this.movedVertices.push(i);
  }
  geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();return geometry;
 }
}
