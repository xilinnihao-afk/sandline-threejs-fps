import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {loadCPU} from './loadCharacterFixture';
import {prepareClassicAkAssets} from '../src/render/classicAk';
import {ClassicViewArms} from '../src/render/classicViewArms';
import {createGroundWeapon,createViewWeapon,loadImportedWeaponAssets,updateViewWeapon} from '../src/render/weapons';
import {CLASSIC_VIEW_CONTACTS} from '../src/render/classicHandContacts';
import {Simulation,WEAPONS} from '../src/game/simulation';
import {WEAPON_KINDS,isHandgun} from '../src/game/types';
import {WEAPON_VIEW_OFFSETS} from '../src/render/weaponFraming';
import {loadKnifeAsset} from '../src/render/knifeModel';
import {MELEE_ATTACKS} from '../src/game/melee';

function vertices(root:THREE.Object3D){
 root.updateMatrixWorld(true);const result:THREE.Vector3[]=[];
 root.traverse(object=>{if(object instanceof THREE.SkinnedMesh){object.skeleton.update();for(let i=0;i<object.geometry.attributes.position.count;i++)result.push(object.getVertexPosition(i,new THREE.Vector3()).applyMatrix4(object.matrixWorld));}});
 return result;
}

// Compare every actual skin vertex in its own hand frame. This catches the
// old independent forearm/wrist twist even when the wrist error itself is zero.
function authoredShape(root:THREE.Object3D,handsOnly=false){
 root.updateMatrixWorld(true);const result:THREE.Vector3[]=[];
 root.traverse(object=>{if(object instanceof THREE.SkinnedMesh&&(!handsOnly||['Object_7','Object_9','Object_11','Object_13'].includes(object.name))){
  const left=['Object_11','Object_12','Object_13'].includes(object.name);
  const hand=root.getObjectByName(left?'Bone_Righthand_16':'Bone_Lefthand_39')!;
  const inverse=hand.matrixWorld.clone().invert();object.skeleton.update();
  for(let i=0;i<object.geometry.attributes.position.count;i++)result.push(object.getVertexPosition(i,new THREE.Vector3()).applyMatrix4(object.matrixWorld).applyMatrix4(inverse));
 }});return result;
}

// Palm-anchor error alone misses fingers floating above the handle. Track
// every posed right-hand surface vertex in the actual moving knife frame.
function knifeGripShape(root:THREE.Object3D,knife:THREE.Object3D){
 root.updateMatrixWorld(true);knife.updateWorldMatrix(true,false);
 const inverse=knife.matrixWorld.clone().invert(),points:THREE.Vector3[]=[];
 for(const name of ['Object_7','Object_9']){
  const mesh=root.getObjectByName(name) as THREE.SkinnedMesh;mesh.skeleton.update();
  for(let i=0;i<mesh.geometry.attributes.position.count;i++)points.push(mesh.getVertexPosition(i,new THREE.Vector3()).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse));
 }
 return points;
}

function surfaceDistance(root:THREE.Object3D,point:readonly [number,number,number]){
 root.updateMatrixWorld(true);const target=new THREE.Vector3(...point),tri=new THREE.Triangle(),nearest=new THREE.Vector3();let distance=Infinity;
 root.traverse(object=>{if(object instanceof THREE.Mesh){
  const geo=object.geometry,p=geo.attributes.position,idx=geo.index;
  for(let i=0;i<(idx?.count??p.count);i+=3){
   [tri.a,tri.b,tri.c].forEach((v,j)=>v.fromBufferAttribute(p,idx?idx.getX(i+j):i+j).applyMatrix4(object.matrixWorld));
   distance=Math.min(distance,tri.closestPointToPoint(target,nearest).distanceTo(target));
  }
 }});return distance;
}

test('one CS16 hand asset follows every current weapon through reload, recoil and switches without skin drift',async t=>{
 const requests:string[]=[];
 const mock=t.mock.method(GLTFLoader.prototype,'loadAsync',async(url:string)=>{requests.push(url);return loadCPU('public/assets/runtime/'+url.split('/').at(-1)!.split('?')[0]);});
 await loadImportedWeaponAssets();await loadImportedWeaponAssets();await loadKnifeAsset();mock.mock.restore();
 assert.equal(requests.length,WEAPON_KINDS.length);assert.ok(requests.every(url=>url.includes('/assets/runtime/')));
 const [ak,arms]=await Promise.all(['cs16-ak47','cs16-arms-rigged'].map(file=>loadCPU('public/assets/runtime/'+file+'.glb')));
 prepareClassicAkAssets(ak.scene,arms.scene);
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(56,16/9,.02,5);scene.add(camera);
 const shared=new ClassicViewArms(camera,scene),untouched=new ClassicViewArms(camera,scene);
 const untouchedVertices=vertices(untouched.model);
 const referenceShape=authoredShape(untouched.model);
 const originalMaterials=new Map<THREE.Mesh,THREE.Material|THREE.Material[]>();
 shared.group.traverse(o=>{if(o instanceof THREE.Mesh)originalMaterials.set(o,o.material);});
 const player=new Simulation(42).state.player;player.shotTime=-10;
 let maximumError=0;
 for(const kind of WEAPON_KINDS){
  const gun=createViewWeapon(kind);scene.add(gun);player.weapon=kind;
  if(kind==='rifle'){assert.equal(gun.userData.embeddedArms,true);scene.remove(gun);continue;}
  const offset=WEAPON_VIEW_OFFSETS[kind];gun.position.set(offset.x,offset.y,offset.z);
  const contact=CLASSIC_VIEW_CONTACTS[kind];
  if(contact){
   const geometry=createGroundWeapon(kind);
   if(kind!=='knife')assert.ok(surfaceDistance(geometry,contact.right)<.002,kind+' trigger-hand contact misses real grip');
   if(!isHandgun(kind)&&kind!=='knife')assert.ok(surfaceDistance(geometry,contact.left)<.002,kind+' support contact misses real fore-end');
  }
  player.guns[kind].reloadLeft=0;updateViewWeapon(gun,player,5,0);shared.update(gun);
  const expectedShape=kind==='knife'?authoredShape(shared.model):referenceShape;
  const lengths:number[]=[];
  for(let frame=0;frame<=120;frame++){
   player.guns[kind].reloadLeft=frame===120?0:WEAPONS[kind].reload*(1-frame/120);
   updateViewWeapon(gun,player,5,0);shared.update(gun);
   maximumError=Math.max(maximumError,...shared.errors);
   assert.ok(shared.continuation.seamErrors.every(error=>error<1e-6),kind+' opens a gap at the original elbow rim');
   for(const ring of shared.continuation.terminalPoints)for(const point of ring){
    const ndc=point.clone().project(camera);
    assert.ok(ndc.y<-1.10,kind+' exposes the new arm end during reload');
   }
   assert.ok(shared.errors.every(error=>Number.isFinite(error)&&error<1e-6),kind+' palm misses animated contact');
   for(const [i,[elbow,wrist]] of [['Bone04_17','Bone_Righthand_16'],['Bone01_40','Bone_Lefthand_39']].entries()){
    const a=shared.model.getObjectByName(elbow)!.getWorldPosition(new THREE.Vector3());
    const b=shared.model.getObjectByName(wrist)!.getWorldPosition(new THREE.Vector3());
    if(!frame)lengths[i]=a.distanceTo(b);
    assert.ok(Math.abs(a.distanceTo(b)-lengths[i])<1e-6,kind+' stretches forearm');
    if(i===0&&kind!=='knife')assert.ok(a.y<b.y-.015,kind+' raises the open elbow above the loading hand');
   }
   if(frame%20===0){
    const first=vertices(shared.model);shared.update(gun);const second=vertices(shared.model);
    first.forEach((point,i)=>{assert.ok(point.toArray().every(Number.isFinite));assert.ok(point.distanceTo(second[i])<1e-6,kind+' accumulates skin drift');});
    authoredShape(shared.model).forEach((point,i)=>assert.ok(point.distanceTo(expectedShape[i])<1e-5,kind+' twists or deforms the original AK hand/forearm vertex '+i+' delta '+point.distanceTo(expectedShape[i])+' frame '+frame));
   }
  }
  player.shotTime=10;updateViewWeapon(gun,player,10.03,1/60);shared.update(gun);
  assert.ok(shared.errors.every(error=>error<1e-6));
  // Check the actual terminal skin ring at phone/tablet/portrait ratios and
  // with view sway, not just the forearm bone centre or palm contact.
  for(const aspect of [844/390,4/3,390/844])for(const progress of [0,.15,.4,.65,.88,.98]){
   camera.aspect=aspect;camera.updateProjectionMatrix();
   gun.rotation.set(.06,-.08,.035);gun.position.y=offset.y+.035;
   player.guns[kind].reloadLeft=progress===0?0:WEAPONS[kind].reload*(1-progress);
   updateViewWeapon(gun,player,12+progress,0);shared.update(gun);
   for(const ring of shared.continuation.terminalPoints)for(const point of ring){
    assert.ok(point.clone().project(camera).y<-1.10,kind+' exposes arm end at aspect '+aspect+' progress '+progress);
   }
   assert.ok(shared.continuation.seamErrors.every(error=>error<1e-6));
  }
  camera.aspect=16/9;camera.updateProjectionMatrix();
  if(kind==='knife'){
   for(const [mesh,original] of originalMaterials){
    const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];
    for(const material of materials)if(/view_skin|view_finger|view_glove/i.test(material.name)){
     assert.equal(material.side,THREE.DoubleSide,'curled source finger shells must show their inner faces');
     assert.notEqual(mesh.material,original,'knife material changes must be isolated from firearms');
    }
   }
   gun.rotation.set(0,0,0);gun.position.set(offset.x,offset.y,offset.z);
   player.shotTime=-10;updateViewWeapon(gun,player,10,0);shared.update(gun);
   const idleArms=new ClassicViewArms(camera,scene),idleKnife=createViewWeapon('knife');scene.add(idleKnife);
   idleKnife.position.set(offset.x,offset.y,offset.z);
   const idleActor={...player,shotTime:-10};
   const gripShape=knifeGripShape(shared.model,gun.userData.rig.pivot);
   const freeHand=gun.userData.rig.left.getWorldPosition(new THREE.Vector3());
   for(const attack of ['slash','stab'] as const)for(const aspect of [844/390,16/9,390/844]){
    camera.aspect=aspect;camera.updateProjectionMatrix();player.meleeAttack=attack;player.shotTime=10;
    const spec=MELEE_ATTACKS[attack];
    for(let frame=0;frame<=Math.ceil((spec.interval+.025)*120);frame++){
     updateViewWeapon(gun,player,10+frame/120,1/120);shared.update(gun);
     updateViewWeapon(idleKnife,idleActor,10+frame/120,1/120);idleArms.update(idleKnife);
     assert.ok(shared.errors.every(error=>error<1e-6),'fist drifts from knife handle during '+attack);
     assert.ok(shared.knifeForearm.wristSeamErrors.every(error=>error<1e-7),'wrist cuff opens during '+attack);
     assert.ok(shared.knifeSupportForearm.wristSeamErrors.every(error=>error<1e-7),'free-hand wrist cuff opens during '+attack);
     assert.ok(shared.knifeSupportForearm.lengthError<1e-7,'free arm changes length');
     assert.ok(shared.knifeForearm.lengthError<1e-7,'knife arm changes length');
     assert.ok(shared.continuation.seamErrors.every(error=>error<1e-6),'arm continuation opens');
     for(const ring of shared.continuation.terminalPoints)for(const point of ring)assert.ok(point.clone().project(camera).y<-1.10,'knife exposes an arm end');
     const free=gun.userData.rig.left.getWorldPosition(new THREE.Vector3());
     assert.ok(free.distanceTo(freeHand)<.13,'free hand swings with blade instead of guarding body');
     const axis=shared.knifeForearm.elbowPoint.clone().sub(shared.knifeForearm.wristPoint);
     assert.ok(axis.y<-.09&&axis.z>.18&&axis.x>.10,'forearm must lead back and down toward right shoulder');
     if(frame%12===0){
      knifeGripShape(shared.model,gun.userData.rig.pivot).forEach((point,i)=>assert.ok(point.distanceTo(gripShape[i])<1e-6,'knife slips inside the closed hand during '+attack));
      // The free fingers now breathe gently with simulation time. Compare
      // their exact skin against an independent ready hand at the same time;
      // the unchanged right fist still has the strict pivot-space test above.
      const sameTimeHand=authoredShape(idleArms.model,true);
      authoredShape(shared.model,true).forEach((point,i)=>assert.ok(point.distanceTo(sameTimeHand[i])<1e-5,'knife attack distorts the same-time glove or finger mesh'));
      for(const [name,helper] of [['Object_8',shared.knifeForearm],['Object_12',shared.knifeSupportForearm]] as const){
       const mesh=shared.model.getObjectByName(name) as THREE.SkinnedMesh,index=mesh.geometry.index!;
       mesh.skeleton.update();const points=Array.from({length:mesh.geometry.attributes.position.count},(_,i)=>mesh.getVertexPosition(i,new THREE.Vector3()).applyMatrix4(mesh.matrixWorld));
       const line=new THREE.Line3(helper.sectionCenters[0],helper.elbowPoint);
       for(let i=0;i<index.count;i+=3){
        const [a,b,c]=[0,1,2].map(j=>points[index.getX(i+j)]),center=a.clone().add(b).add(c).multiplyScalar(1/3);
        const outward=b.clone().sub(a).cross(c.clone().sub(a)).negate().normalize();
        assert.ok(outward.dot(center.clone().sub(line.closestPointToPoint(center,true,new THREE.Vector3())))>.001,name+' folds inward during '+attack);
       }
      }
     }
    }
    const readyVertices=vertices(idleArms.model);
    vertices(shared.model).forEach((point,i)=>assert.ok(point.distanceTo(readyVertices[i])<1e-6,'knife fails to return to its same-time ready pose'));
   }
   camera.aspect=16/9;camera.updateProjectionMatrix();
   scene.remove(idleArms.group,idleKnife);
   const m4=createViewWeapon('m4');scene.add(m4);player.weapon='m4';player.shotTime=-10;
   updateViewWeapon(m4,player,12,0);shared.update(m4);
   authoredShape(shared.model).forEach((point,i)=>assert.ok(point.distanceTo(referenceShape[i])<1e-5,'switching from knife fails to restore firearm skin/fingers'));
   for(const [mesh,original] of originalMaterials)assert.equal(mesh.material,original,'switching from knife must restore the original firearm materials');
   scene.remove(m4);
  }
  vertices(untouched.model).forEach((point,i)=>assert.ok(point.distanceTo(untouchedVertices[i])<1e-8,'shared source skeleton mutated'));
  scene.remove(gun);
 }
 console.log('CS16 maximum palm contact error (m)',maximumError);
});
