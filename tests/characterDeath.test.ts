import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {loadCPU} from './loadCharacterFixture';
import {adaptSoldierAnimations} from '../src/render/riggedSoldier';
import {SOLDIER_MODELS,prepareRosterSoldier} from '../src/render/soldierRoster';
import {CharacterDeathController,characterHitDirection, type DeathRig} from '../src/render/characterDeath';

function fixture(asset:Awaited<ReturnType<typeof adaptSoldierAnimations>>,clip='Idle'){
 const root=new THREE.Group(),pose=new THREE.Group(),model=clone(asset.scene);root.add(pose);pose.add(model);
   const mixer=new THREE.AnimationMixer(model);mixer.clipAction(asset.animations.find(c=>c.name===clip)!).play();mixer.update(.35);
   const bone=(n:string)=>model.getObjectByName('mixamorig'+n)!;
   const joints:THREE.Object3D[]=[];model.traverse(o=>{if(o instanceof THREE.Bone)joints.push(o);});
   const rig:DeathRig={pose,model,joints,hip:bone('Hips'),spine:bone('Spine2'),head:bone('Head'),arms:['Left','Right'].map(s=>({upper:bone(s+'Arm'),lower:bone(s+'ForeArm'),hand:bone(s+'Hand')})),deathBones:{leftThigh:bone('LeftUpLeg'),rightThigh:bone('RightUpLeg'),leftShin:bone('LeftLeg'),rightShin:bone('RightLeg')},footL:bone('LeftFoot'),footR:bone('RightFoot'),toeL:bone('LeftToeBase'),toeR:bone('RightToeBase'),gun:new THREE.Group()};
   pose.add(rig.gun);const death=new CharacterDeathController(root,rig);death.captureAlive();
 return {root,pose,model,mixer,joints,rig,death};
}

for(const definition of SOLDIER_MODELS)test(`${definition.id} falls without bone stretching, ground penetration, pose drift or frame-rate dependence`,async()=>{
 const asset=adaptSoldierAnimations(await loadCPU('public/assets/characters/locomotion.glb'),prepareRosterSoldier(await loadCPU('public/assets/characters/'+definition.file),definition.id));
 for(const front of [-1,1])for(const side of [-1,1]){
  let previous:THREE.Vector3[]|null=null;
  for(const hz of [30,60,120]){
   const {root,pose,model,mixer,joints,rig,death}=fixture(asset);const lengths=joints.map(j=>j.position.length());
   for(let frame=0;frame<hz*1.5;frame++){
    death.update(1/hz,2,side,front,1.4);root.updateMatrixWorld(true);
    joints.forEach((j,i)=>{assert.ok(j.quaternion.toArray().every(Number.isFinite));assert.ok(Math.abs(j.position.length()-lengths[i])<1e-6);});
    for(const joint of [rig.head,rig.hip,rig.footL,rig.footR,...rig.arms.map(a=>a.hand)])assert.ok(joint.getWorldPosition(new THREE.Vector3()).y>=.03);
   }
   model.traverse(o=>{if(o instanceof THREE.SkinnedMesh){o.skeleton.update();o.computeBoundingBox();}});
   const bounds=new THREE.Box3().setFromObject(model,true);console.log('Corpse envelope',side,hz,bounds.min.y,bounds.max.y);
   assert.ok(bounds.min.y>-.01,'mesh below ground');assert.ok(bounds.max.y<.65,'torso remains suspended');
   const points=joints.map(j=>j.getWorldPosition(new THREE.Vector3()));
   if(previous)points.forEach((p,i)=>assert.ok(p.distanceTo(previous![i])<1e-5));previous=points;
   for(let i=0;i<10;i++)death.update(0,2,side);root.updateMatrixWorld(true);
   joints.forEach((j,i)=>assert.ok(j.getWorldPosition(new THREE.Vector3()).distanceTo(points[i])<1e-5));
   assert.ok(root.position.length()===0,'game actor position must not change');
   death.reset();mixer.setTime(.35);pose.position.set(0,0,0);pose.quaternion.identity();death.captureAlive();assert.ok(death.update(1/hz,2,side)<.1,'respawn must reset collapse');
  }
 }
});


for(const definition of SOLDIER_MODELS)test(`${definition.id}: collapse preserves entry contacts and continuous trajectories at 30/60/120 Hz`,async()=>{
 const asset=adaptSoldierAnimations(await loadCPU('public/assets/characters/locomotion.glb'),prepareRosterSoldier(await loadCPU('public/assets/characters/'+definition.file),definition.id));
 for(const clip of ['Idle','Walk','Run'])for(const front of [-1,1])for(const side of [-1,1]){
  let reference:THREE.Vector3[][]|undefined;
  for(const hz of [30,60,120]){
   const {root,rig,death,joints,model}=fixture(asset,clip);
   // Exported finger end markers have no skin weights and are not visible
   // joints. Measure the skeleton that actually deforms the character.
   const weighted=new Set<THREE.Object3D>();
   model.traverse(o=>{if(o instanceof THREE.SkinnedMesh){
    const indices=o.geometry.getAttribute('skinIndex'),weights=o.geometry.getAttribute('skinWeight');
    for(let i=0;i<indices.count;i++)for(let j=0;j<4;j++)if(weights.getComponent(i,j)>0)weighted.add(o.skeleton.bones[indices.getComponent(i,j)]);
   }});
   const visibleJoints=joints.filter(j=>weighted.has(j));assert.ok(visibleJoints.length>25);
   const positions=()=>{root.updateMatrixWorld(true);return visibleJoints.map(j=>j.getWorldPosition(new THREE.Vector3()));};
   const start=positions();death.update(0,2,side,front,1.4);const entry=positions();
   entry.forEach((p,i)=>assert.ok(p.distanceTo(start[i])<1e-6,`${clip}: entry pose snapped`));
   const hipStart=rig.hip.getWorldPosition(new THREE.Vector3());
   const feet=[rig.footL,rig.footR].map(j=>j.getWorldPosition(new THREE.Vector3()));
   let previous=entry;const samples:THREE.Vector3[][]=[];
   for(let frame=1;frame<=hz*1.5;frame++){
    death.update(1/hz,2,side,front,1.4);const current=positions();
    if(hz===120)current.forEach((p,i)=>assert.ok(p.distanceTo(previous[i])<.095,`${clip}: joint ${visibleJoints[i].name} discontinuity at ${frame/hz}: ${p.distanceTo(previous[i])}`));
    previous=current;
    if(frame===hz/5){
     assert.ok(hipStart.y-rig.hip.getWorldPosition(new THREE.Vector3()).y>.07,'pelvis should sink before the main fall');
     [rig.footL,rig.footR].forEach((foot,i)=>assert.ok(foot.getWorldPosition(new THREE.Vector3()).distanceTo(feet[i])<.04,`${clip}: early foot slide`));
    }
    if(frame%(hz/10)===0)samples.push(current);
   }
   if(reference)samples.forEach((sample,i)=>sample.forEach((p,j)=>assert.ok(p.distanceTo(reference![i][j])<1e-5,`${clip}: frame-rate-dependent transient at sample ${i}`)));
   reference=samples;
  }
 }
});


test('front impact drives the chest backward before collapse and keeps its direction after death',async()=>{
 const asset=adaptSoldierAnimations(await loadCPU('public/assets/characters/locomotion.glb'),prepareRosterSoldier(await loadCPU('public/assets/characters/counter_strike_source_terrorist_1reuploaded.glb'),'terrorist1'));
 for(const yaw of [0,.7,Math.PI,-1.2]){
  const {root,rig,death}=fixture(asset);root.rotation.y=yaw;death.captureAlive();
  const hit=characterHitDirection(yaw,Math.sin(yaw),Math.cos(yaw));assert.ok(hit.front>.999);assert.ok(Math.abs(hit.side)<1e-6);
  const local=(bone:THREE.Object3D)=>root.worldToLocal(bone.getWorldPosition(new THREE.Vector3()));
  const chest=local(rig.spine),feet=[local(rig.footL),local(rig.footR)];
  death.update(.12,2,hit.side,hit.front,1.4);root.updateMatrixWorld(true);
  const chestRecoil=local(rig.spine).z-chest.z;
  assert.ok(chestRecoil>.02&&chestRecoil<.12,'front hit should cause a short, restrained shoulder reaction');
  [rig.footL,rig.footR].forEach((foot,i)=>assert.ok(local(foot).distanceTo(feet[i])<.04,'early feet should support the rearward lean'));
  // A subsequent direction cannot reverse a corpse already falling.
  death.update(1.38,2,0,-1);root.updateMatrixWorld(true);
  assert.ok(local(rig.head).z>local(rig.hip).z+.35,'front hit must settle on the back');
  assert.ok(root.position.length()===0);
  const rear=characterHitDirection(yaw,-Math.sin(yaw),-Math.cos(yaw));assert.ok(rear.front<-.999);
 }
});

test('collapse settles promptly with relaxed arms close to the body',async()=>{
 const donor=await loadCPU('public/assets/characters/locomotion.glb');
 for(const id of ['gign','gsg9','sas','urban','terrorist1','terrorist2','terrorist3'] as const){
  const definition=SOLDIER_MODELS.find(m=>m.id===id)!;
  const asset=adaptSoldierAnimations(donor,prepareRosterSoldier(await loadCPU('public/assets/characters/'+definition.file),id));
  const {root,rig,death}=fixture(asset);
  death.update(.8,2,-1,1,1.4);root.updateMatrixWorld(true);
  assert.ok(rig.hip.getWorldPosition(new THREE.Vector3()).y<.45,`${id}: pelvis should have reached the floor phase`);
  const hip=rig.hip.getWorldPosition(new THREE.Vector3());
  for(const arm of rig.arms)assert.ok(Math.abs(arm.hand.getWorldPosition(new THREE.Vector3()).x-hip.x)<.60,`${id}: arm spreads into a theatrical brace`);
  assert.equal(death.update(.35,2,-1,1,1.4),1,`${id}: final settling should finish within 1.15 seconds`);
 }
});
