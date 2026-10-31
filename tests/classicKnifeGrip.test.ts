import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {loadCPU} from './loadCharacterFixture';
import {prepareClassicAkAssets} from '../src/render/classicAk';
import {ClassicViewArms} from '../src/render/classicViewArms';
import {loadKnifeAsset} from '../src/render/knifeModel';
import {createViewWeapon,updateViewWeapon} from '../src/render/weapons';
import {Simulation} from '../src/game/simulation';
import {WEAPON_VIEW_OFFSETS} from '../src/render/weaponFraming';

test('actual right finger pads close onto the classic knife handle within two millimetres',async t=>{
 const mock=t.mock.method(GLTFLoader.prototype,'loadAsync',async()=>loadCPU('public/assets/runtime/classic-knife.glb'));
 await loadKnifeAsset();mock.mock.restore();
 const [ak,source]=await Promise.all(['cs16-ak47','cs16-arms-rigged'].map(n=>loadCPU('public/assets/runtime/'+n+'.glb')));prepareClassicAkAssets(ak.scene,source.scene);
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),arms=new ClassicViewArms(camera,scene),weapon=createViewWeapon('knife');scene.add(weapon);
 const player=new Simulation(1).state.player;player.shotTime=-10;updateViewWeapon(weapon,player,10,0);arms.update(weapon);scene.updateMatrixWorld(true);
 const pivot=weapon.userData.rig.pivot as THREE.Group,inverse=pivot.matrixWorld.clone().invert();
 const handle=weapon.getObjectByName('Cube_Material001_0') as THREE.Mesh,positions=handle.geometry.attributes.position,index=handle.geometry.index!,triangles:THREE.Triangle[]=[];
 for(let i=0;i<index.count;i+=3){
  const vertices=[0,1,2].map(j=>new THREE.Vector3().fromBufferAttribute(positions,index.getX(i+j)).applyMatrix4(handle.matrixWorld).applyMatrix4(inverse));
  // Exclude the separated trim above the guard; retain the closed main handle.
  if(vertices.every(v=>v.y<.0452))triangles.push(new THREE.Triangle(...vertices as [THREE.Vector3,THREE.Vector3,THREE.Vector3]));
 }
 assert.ok(triangles.length>20,'actual handle surface is missing');
 const signedDistance=(point:THREE.Vector3,surfaces=triangles)=>{
  let nearest=Infinity;const hits:number[]=[],ray=new THREE.Ray(point,new THREE.Vector3(.876,.233,.423).normalize());
  for(const triangle of surfaces){
   nearest=Math.min(nearest,triangle.closestPointToPoint(point,new THREE.Vector3()).distanceTo(point));
   const hit=ray.intersectTriangle(triangle.a,triangle.b,triangle.c,false,new THREE.Vector3());
   if(hit){const distance=hit.distanceTo(point);if(distance>1e-7&&!hits.some(d=>Math.abs(d-distance)<1e-7))hits.push(distance);}
  }
  return nearest*(hits.length%2?-1:1);
 };
 const mesh=arms.model.getObjectByName('Object_9') as THREE.SkinnedMesh;mesh.skeleton.update();
 const ids=mesh.geometry.index!,joints=mesh.geometry.attributes.skinIndex,metrics:Record<string,number>={};
 for(const boneName of ['Bone23_27','Bone19_24','Bone15_21','Bone11_18']){
  const bone=arms.model.getObjectByName(boneName)!,center=new THREE.Vector3();let totalArea=0;
  for(let i=0;i<ids.count;i+=3){
   const vertices=[0,1,2].map(j=>ids.getX(i+j));
   if(!vertices.every(id=>mesh.skeleton.bones[joints.getX(id)].name===boneName))continue;
   const world=vertices.map(id=>mesh.getVertexPosition(id,new THREE.Vector3()).applyMatrix4(mesh.matrixWorld));
   const local=world.map(v=>bone.worldToLocal(v.clone())),triangle=new THREE.Triangle(...local as [THREE.Vector3,THREE.Vector3,THREE.Vector3]);
   // The source's +Z-facing triangles are the actual inward finger-pad shell.
   if(triangle.getNormal(new THREE.Vector3()).z<.55)continue;
   const area=triangle.getArea();totalArea+=area;
   center.add(world.reduce((sum,v)=>sum.add(v),new THREE.Vector3()).multiplyScalar(area/3));
  }
  assert.ok(totalArea>0,'missing finger-pad surface '+boneName);
  center.divideScalar(totalArea).applyMatrix4(inverse);
  const distance=signedDistance(center);metrics[boneName]=distance;
  assert.ok(distance<=.002,boneName+' floats above handle by '+distance+' m');
  assert.ok(distance>=-.001,boneName+' pad centre penetrates handle by '+(-distance)+' m');
 }
 console.log('Signed finger-pad surface gaps (m)',metrics);
 // The real-hand reference keeps the thumb knuckle high at the guard,
 // with the distal pad curling down onto the index finger.
 const thumb=arms.model.getObjectByName('Bone07_30')!,thumbPad=new THREE.Vector3(),thumbFaces:THREE.Triangle[]=[],thumbGuardFaces:THREE.Triangle[]=[];let thumbArea=0;
 for(let i=0;i<ids.count;i+=3){
  const vertices=[0,1,2].map(j=>ids.getX(i+j)),bones=vertices.map(id=>mesh.skeleton.bones[joints.getX(id)].name);
  const world=vertices.map(id=>mesh.getVertexPosition(id,new THREE.Vector3()).applyMatrix4(mesh.matrixWorld));
  if(bones.every(n=>['Bone05_32','Bone06_31','Bone07_30'].includes(n)))thumbGuardFaces.push(new THREE.Triangle(...world.map(v=>v.clone().applyMatrix4(inverse)) as [THREE.Vector3,THREE.Vector3,THREE.Vector3]));
  if(!bones.every(n=>n===thumb.name))continue;
  thumbFaces.push(new THREE.Triangle(...world.map(v=>v.clone().applyMatrix4(inverse)) as [THREE.Vector3,THREE.Vector3,THREE.Vector3]));
  const local=world.map(v=>thumb.worldToLocal(v.clone())),triangle=new THREE.Triangle(...local as [THREE.Vector3,THREE.Vector3,THREE.Vector3]);
  if(triangle.getNormal(new THREE.Vector3()).y>-.55)continue;
  const area=triangle.getArea();thumbArea+=area;thumbPad.add(world.reduce((sum,v)=>sum.add(v),new THREE.Vector3()).multiplyScalar(area/3));
 }
 assert.ok(thumbArea>0&&thumbFaces.length>0,'thumb support surface missing');thumbPad.divideScalar(thumbArea).applyMatrix4(inverse);
 const thumbKnuckle=thumb.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverse);
 assert.ok(thumbKnuckle.y>.042&&thumbKnuckle.y<.052,'thumb knuckle must remain high beside the guard');
 assert.ok(thumbPad.y>.026&&thumbPad.y<.037&&thumbKnuckle.y-thumbPad.y>.008,'thumb pad must curl down over the index rather than lie flat');
 // Contact-centre checks cannot detect a broad thumb triangle crossing the
 // guard. Sample each original palm/finger face, including its interior.
 const guard=weapon.getObjectByName('Cube_Material003_0') as THREE.Mesh,guardFaces:THREE.Triangle[]=[],guardBox=new THREE.Box3();
 const gp=guard.geometry.attributes.position,gi=guard.geometry.index!;
 for(let i=0;i<gi.count;i+=3){
  const vertices=[0,1,2].map(j=>new THREE.Vector3().fromBufferAttribute(gp,gi.getX(i+j)).applyMatrix4(guard.matrixWorld).applyMatrix4(inverse));
  vertices.forEach(v=>guardBox.expandByPoint(v));guardFaces.push(new THREE.Triangle(...vertices as [THREE.Vector3,THREE.Vector3,THREE.Vector3]));
 }
 let thumbGuardGap=Infinity;
 for(const triangle of thumbGuardFaces)for(const point of [triangle.a,triangle.b,triangle.c,triangle.getMidpoint(new THREE.Vector3())])
  thumbGuardGap=Math.min(thumbGuardGap,Math.abs(signedDistance(point,guardFaces)));
 assert.ok(thumbGuardGap<.001,'raised thumb floats away from the guard: '+thumbGuardGap+' m');
 console.log('Thumb support height / guard surface gap (m)',thumbPad.y,thumbGuardGap);
 let deepestGuard=0;
 for(const name of ['Object_7','Object_9']){
  const shell=arms.model.getObjectByName(name) as THREE.SkinnedMesh;shell.skeleton.update();const index=shell.geometry.index!;
  const vertices=Array.from({length:shell.geometry.attributes.position.count},(_,i)=>shell.getVertexPosition(i,new THREE.Vector3()).applyMatrix4(shell.matrixWorld).applyMatrix4(inverse));
  for(let face=0;face<index.count;face+=3){
   const [a,b,c]=[0,1,2].map(j=>vertices[index.getX(face+j)]);
   for(let u=0;u<=8;u++)for(let v=0;v<=8-u;v++){
    const point=a.clone().multiplyScalar(u/8).addScaledVector(b,v/8).addScaledVector(c,1-(u+v)/8);
    if(guardBox.containsPoint(point))deepestGuard=Math.min(deepestGuard,signedDistance(point,guardFaces));
   }
  }
 }
 assert.ok(deepestGuard>=-.0015,'hand intersects the guard by '+(-deepestGuard)+' m');
 console.log('Maximum sampled guard penetration (m)',-deepestGuard);
});

test('free knife hand has separated half-curled fingers ahead of the closer, upright gripping hand',async()=>{
 const [ak,source]=await Promise.all(['cs16-ak47','cs16-arms-rigged'].map(n=>loadCPU('public/assets/runtime/'+n+'.glb')));prepareClassicAkAssets(ak.scene,source.scene);
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(56,16/9,.02,5),arms=new ClassicViewArms(camera,scene),weapon=createViewWeapon('knife');scene.add(weapon);
 const player=new Simulation(1).state.player;player.weapon='knife';player.shotTime=-10;
 const offset=WEAPON_VIEW_OFFSETS.knife;weapon.position.set(offset.x,offset.y,offset.z);
 updateViewWeapon(weapon,player,10,0);arms.update(weapon);scene.updateMatrixWorld(true);
 const left=arms.model.getObjectByName('Bone_Righthand_16')!.getWorldPosition(new THREE.Vector3());
 const right=arms.model.getObjectByName('Bone_Lefthand_39')!.getWorldPosition(new THREE.Vector3());
 assert.ok(left.z<right.z-.10,'free hand must guard ahead of the knife wrist');
 assert.ok(right.z>-.56&&right.z<-.45,'knife wrist must sit back toward the body without crowding the camera');
 const blade=new THREE.Vector3(0,1,0).applyQuaternion(weapon.userData.rig.pivot.quaternion);
 assert.ok(blade.y>.995&&Math.abs(blade.x)<.025,'ready blade and gripping hand remain tilted');

 // Check the real skin silhouette, not just authored angles. Each distal
 // fingertip stays ahead of its knuckle, with a soft palmward curl; the former
 // tightly folded middle/ring/little fingers doubled back toward the palm.
 const mesh=arms.model.getObjectByName('Object_13') as THREE.SkinnedMesh;mesh.skeleton.update();
 const palm=arms.model.getObjectByName('Bone26_15')!,origin=palm.getWorldPosition(new THREE.Vector3());
 const forward=palm.localToWorld(new THREE.Vector3(0,-1,0)).sub(origin).normalize();
 const inward=palm.localToWorld(new THREE.Vector3(0,0,1)).sub(origin).normalize();
 const tips:THREE.Vector3[]=[];
 for(const [base,distal] of [['Bone31_5','Bone33_3'],['Bone35_8','Bone37_6'],['Bone39_11','Bone41_9'],['Bone43_14','Bone45_12']]){
  const joint=arms.model.getObjectByName(base)!,tipBone=arms.model.getObjectByName(distal)!,vertices:THREE.Vector3[]=[];
  for(let i=0;i<mesh.geometry.attributes.position.count;i++)
   if(mesh.skeleton.bones[mesh.geometry.attributes.skinIndex.getX(i)].name===distal)
    vertices.push(mesh.getVertexPosition(i,new THREE.Vector3()).applyMatrix4(mesh.matrixWorld));
  assert.ok(vertices.length>0,'actual fingertip surface missing');
  const local=vertices.map(point=>tipBone.worldToLocal(point.clone())),end=Math.min(...local.map(point=>point.y));
  const terminal=vertices.filter((_,i)=>local[i].y<end+.1);
  const tip=terminal.reduce((sum,point)=>sum.add(point),new THREE.Vector3()).divideScalar(terminal.length);
  const reach=tip.clone().sub(joint.getWorldPosition(new THREE.Vector3()));
  assert.ok(reach.dot(forward)>.025,base+' hooks back behind its knuckle');
  assert.ok(reach.dot(inward)>.025&&reach.dot(inward)<.075,base+' loses the relaxed palmward curve');
  tips.push(tip);
 }
 for(let i=1;i<tips.length;i++)assert.ok(tips[i].distanceTo(tips[i-1])>.012,'adjacent fingertips overlap');
});
