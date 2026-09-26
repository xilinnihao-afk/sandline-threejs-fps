import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {loadCPU} from './loadCharacterFixture';
import {adaptSoldierAnimations} from '../src/render/riggedSoldier';
import {CharacterDeathController, type DeathRig} from '../src/render/characterDeath';

test('new soldier falls without bone stretching, ground penetration, pose drift or frame-rate dependence',async()=>{
 const asset=adaptSoldierAnimations(await loadCPU('public/assets/characters/soldier.gltf'),await loadCPU('public/assets/characters/soldier_fully_rigged_character.glb'));
 for(const side of [-1,1]){
  let previous:THREE.Vector3[]|null=null;
  for(const hz of [30,60,120]){
   const root=new THREE.Group(),pose=new THREE.Group(),model=clone(asset.scene);root.add(pose);pose.add(model);
   const mixer=new THREE.AnimationMixer(model);mixer.clipAction(asset.animations[0]).play();mixer.update(.35);
   const bone=(n:string)=>model.getObjectByName('mixamorig'+n)!;
   const joints:THREE.Object3D[]=[];model.traverse(o=>{if(o instanceof THREE.Bone)joints.push(o);});
   const rig:DeathRig={pose,model,joints,hip:bone('Hips'),spine:bone('Spine2'),head:bone('Head'),arms:['Left','Right'].map(s=>({upper:bone(s+'Arm'),lower:bone(s+'ForeArm'),hand:bone(s+'Hand')})),deathBones:{leftThigh:bone('LeftUpLeg'),rightThigh:bone('RightUpLeg'),leftShin:bone('LeftLeg'),rightShin:bone('RightLeg')},footL:bone('LeftFoot'),footR:bone('RightFoot'),toeL:bone('LeftToeBase'),toeR:bone('RightToeBase'),gun:new THREE.Group()};
   pose.add(rig.gun);const death=new CharacterDeathController(root,rig);death.captureAlive();const lengths=joints.map(j=>j.position.length());
   for(let frame=0;frame<hz*1.5;frame++){
    death.update(1/hz,2,side);root.updateMatrixWorld(true);
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
