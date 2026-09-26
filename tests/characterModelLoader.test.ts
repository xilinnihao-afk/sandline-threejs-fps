import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {inspectCharacterGLB, assertAnimatedCharacter, CHARACTER_MODEL_FILES, CharacterLocomotion, prepareCharacterMaterials} from '../src/render/characterModelLoader';

test('downloaded A/B assets accurately reject missing skin and animation instead of breaking live characters',()=>{
 for(const file of Object.values(CHARACTER_MODEL_FILES)){
  const b=fs.readFileSync(new URL(`../public/assets/characters/${file}`,import.meta.url));
  const info=inspectCharacterGLB(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
  assert.equal(info.skins,0);assert.equal(info.skinnedPrimitives,0);assert.deepEqual(info.clips,[]);
  assert.throws(()=>assertAnimatedCharacter(info),/骨骼蒙皮/);
  if(file.startsWith('modern')){assert.equal(info.normalMaterials,0);assert.equal(info.roughnessMaterials,0);}
  else assert.ok(info.normalMaterials>0 && info.roughnessMaterials>0);
 }
});

test('PBR conversion retains maps and authored normals; basic material receives lighting',()=>{
 const scene=new THREE.Group(),geometry=new THREE.BoxGeometry();
 const material=new THREE.MeshStandardMaterial({map:new THREE.Texture(),normalMap:new THREE.Texture(),roughnessMap:new THREE.Texture(),metalnessMap:new THREE.Texture()});
 const mesh=new THREE.Mesh(geometry,material);scene.add(mesh);
 const basic=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({map:new THREE.Texture()}));scene.add(basic);
 const normal=geometry.attributes.normal;prepareCharacterMaterials(scene);
 assert.equal(mesh.geometry.attributes.normal,normal);
 assert.equal(mesh.material.normalMap,material.normalMap);assert.equal(mesh.material.roughnessMap,material.roughnessMap);
 assert.equal(mesh.material.map?.colorSpace,THREE.SRGBColorSpace);assert.equal(mesh.material.normalMap?.colorSpace,THREE.NoColorSpace);
 assert.ok(basic.material instanceof THREE.MeshStandardMaterial);assert.equal(mesh.material.flatShading,false);
});

test('idle/walk crossfade is smooth, stable around stop threshold, and frame-rate independent',()=>{
 for(const hz of [30,60,120]){
  const root=new THREE.Group(),joint=new THREE.Object3D();joint.name='testJoint';root.add(joint);
  const mixer=new THREE.AnimationMixer(root);
  const clip=(name:string,x:number)=>new THREE.AnimationClip(name,1,[new THREE.NumberKeyframeTrack('testJoint.position[x]',[0,1],[x,x])]);
  const idle=mixer.clipAction(clip('Idle',0)),walk=mixer.clipAction(clip('Walk',1));
  const motion=new CharacterLocomotion(mixer,idle,walk);
  motion.update(1/hz,1.5);assert.ok(joint.position.x>0 && joint.position.x<1);
  for(let i=0;i<hz;i++)motion.update(1/hz,1.5);assert.ok(joint.position.x>.999);
  for(let i=0;i<hz;i++)motion.update(1/hz,.1);assert.ok(joint.position.x>.999);
  for(let i=0;i<hz;i++)motion.update(1/hz,0);assert.ok(joint.position.x<.001);
  assert.equal(root.position.length(),0);
 }
});
