import {loadCPU} from './loadCharacterFixture';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {adaptSoldierAnimations} from '../src/render/riggedSoldier';


test('new soldier retargets real idle/walk/run without scaling bones or moving actor root',async()=>{
 const donor=await loadCPU('public/assets/characters/soldier.gltf');
 const target=await loadCPU('public/assets/characters/soldier_fully_rigged_character.glb');
 const result=adaptSoldierAnimations(donor,target);
 assert.deepEqual(result.animations.map(c=>c.name),['Idle','Walk','Run']);
 assert.ok(result.scene.getObjectByName('mixamorigLeftHandIndex1'));
 const character=clone(result.scene),other=clone(result.scene);
 assert.notEqual(character.getObjectByName('mixamorigHips'),other.getObjectByName('mixamorigHips'));
 const mixer=new THREE.AnimationMixer(character),rootPosition=character.position.clone();
 const joints:THREE.Bone[]=[];character.traverse(o=>{if(o instanceof THREE.Bone)joints.push(o);});
 const lengths=joints.map(b=>b.position.length());
 let min=Infinity,max=-Infinity;
 for(const clip of result.animations){
  mixer.stopAllAction();mixer.clipAction(clip).reset().play();
  for(const progress of [0,.25,.5,.75,.99]){
   mixer.setTime(clip.duration*progress);character.updateMatrixWorld(true);
   character.traverse(o=>{if(o instanceof THREE.SkinnedMesh){o.skeleton.update();o.computeBoundingBox();}});
   const box=new THREE.Box3().setFromObject(character),size=box.getSize(new THREE.Vector3());
   assert.ok(size.y>1.2&&size.y<2.2,`${clip.name}: height ${size.y}`);
   assert.ok(size.x<2.2&&size.z<2.2,`${clip.name}: skin escaped bounds`);
   min=Math.min(min,box.min.y);max=Math.max(max,box.max.y);
   for(let i=0;i<joints.length;i++){
    assert.ok(joints[i].quaternion.toArray().every(Number.isFinite));
    if(joints[i].name!=='mixamorigHips')assert.ok(Math.abs(joints[i].position.length()-lengths[i])<1e-6,'bone length changed');
   }
   assert.ok(character.position.equals(rootPosition));
  }
 }
 console.log('Retargeted soldier vertical envelope (m)',{min,max});
 assert.ok(min>-.2&&max<2.2);
});
