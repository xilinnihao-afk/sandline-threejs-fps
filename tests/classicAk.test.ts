import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {loadCPU} from './loadCharacterFixture';
import {prepareClassicAkAssets,createClassicAkView,updateClassicAkView,CLASSIC_AK_HORIZONTAL_FOV,CLASSIC_AK_OFFSET} from '../src/render/classicAk';
import {createViewWeapon,createHeldWeapon,updateViewWeapon} from '../src/render/weapons';
import {Simulation,WEAPONS} from '../src/game/simulation';

const initialized=(async()=>{
 const gun=await loadCPU('public/assets/runtime/cs16-ak47.glb');
 const arms=await loadCPU('public/assets/runtime/cs16-arms-rigged.glb');
 prepareClassicAkAssets(gun.scene,arms.scene);
})();
function flush(root:THREE.Group){root.updateMatrixWorld(true);root.traverse(o=>{if(o instanceof THREE.SkinnedMesh)o.skeleton.update();});}
function points(mesh:THREE.Mesh){return Array.from({length:mesh.geometry.attributes.position.count},(_,i)=>mesh.getVertexPosition(i,new THREE.Vector3()).applyMatrix4(mesh.matrixWorld));}
function meshPoints(root:THREE.Object3D){const result:THREE.Vector3[]=[];root.traverse(o=>{if(o instanceof THREE.Mesh)result.push(...points(o));});return result;}
function nearestSkinContact(root:THREE.Group,target:THREE.Object3D){
 const hand=['Object_11','Object_13'].flatMap(name=>points(root.getObjectByName(name) as THREE.Mesh));
 let nearest=Infinity;const closest=new THREE.Vector3();
 target.traverse(o=>{if(!(o instanceof THREE.Mesh))return;const positions=points(o),index=o.geometry.index!;
  for(let i=0;i<index.count;i+=3){const triangle=new THREE.Triangle(positions[index.getX(i)],positions[index.getX(i+1)],positions[index.getX(i+2)]);
   for(const p of hand)nearest=Math.min(nearest,triangle.closestPointToPoint(p,closest).distanceTo(p));
  }
 });return nearest;
}

test('classic first-person view preserves source geometry, embedded textures and independent hand skins',async()=>{
 await initialized;
 let bytes=0;
 for(const file of ['cs16-ak47.glb','cs16-arms-rigged.glb']){
  const b=fs.readFileSync('public/assets/runtime/'+file);bytes+=b.length;
  const json=JSON.parse(b.subarray(20,20+b.readUInt32LE(12)).toString());
  assert.ok(json.images.length>=3);assert.ok(json.images.every((image:any)=>Number.isInteger(image.bufferView)&&!image.uri));
 }
 assert.ok(bytes<500_000);
 const a=createViewWeapon('rifle'),b=createViewWeapon('rifle');
 assert.equal(a.userData.assetSource,'sketchfab-cs16');assert.equal(a.userData.embeddedArms,true);
 let triangles=0,skins=0;
 a.traverse(o=>{if(o instanceof THREE.Mesh){triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;assert.equal(o.visible,true);if(o instanceof THREE.SkinnedMesh){skins++;const twin=b.getObjectByName(o.name) as THREE.SkinnedMesh;assert.notEqual(o.skeleton,twin.skeleton);assert.notEqual(o.skeleton.bones[1],twin.skeleton.bones[1]);}}});
 assert.equal(triangles,1050);assert.equal(skins,6);
 assert.ok(a.getObjectByName('magazine')!.children.length);assert.ok(a.getObjectByName('bolt')!.children.length);
 assert.notEqual(createHeldWeapon('rifle').userData.assetSource,'sketchfab-cs16');
 assert.equal(createViewWeapon('pistol').userData.embeddedArms,undefined);
});

test('reload touches actual magazine/bolt triangles and returns all skinned vertices to the rest pose',async()=>{
 await initialized;const view=createClassicAkView()!,actor=new Simulation(42).state.player;
 actor.shotTime=-10;updateViewWeapon(view,actor,5,0);flush(view);
 const ready=meshPoints(view),twin=createClassicAkView()!;updateViewWeapon(twin,actor,5,0);flush(twin);const untouched=meshPoints(twin);
 for(const p of [.18,.28,.38,.53,.63,.73,.79,.86,.88,.90,.93]){
  actor.guns.rifle.reloadLeft=WEAPONS.rifle.reload*(1-p);updateViewWeapon(view,actor,5,0);flush(view);
  const target=view.getObjectByName(p>=.86?'bolt':'magazine')!;
  assert.ok(nearestSkinContact(view,target)<.007,`support hand lost ${target.name} contact at ${p}`);
 }
 flush(twin);meshPoints(twin).forEach((p,i)=>assert.ok(p.distanceTo(untouched[i])<1e-8,'another view changed its skeleton'));
 actor.guns.rifle.reloadLeft=0;updateViewWeapon(view,actor,5,0);flush(view);
 meshPoints(view).forEach((p,i)=>assert.ok(p.distanceTo(ready[i])<1e-7,'reload did not restore a source vertex'));
});

test('reload trajectory stays finite, continuous and holds a rigid forearm without cumulative drift',async()=>{
 await initialized;const view=createClassicAkView()!,actor=new Simulation(42).state.player;actor.shotTime=-10;
 const arm=view.getObjectByName('Object_12') as THREE.SkinnedMesh;let previous:THREE.Vector3[]|undefined,span=0;
 for(let frame=0;frame<=360;frame++){
  actor.guns.rifle.reloadLeft=WEAPONS.rifle.reload*(1-frame/360);updateClassicAkView(view,actor,5,0);flush(view);
  const current=points(arm),length=current[0].distanceTo(current[20]);span ||= length;
  assert.ok(Math.abs(length-span)<1e-5,'forearm stretched during reload');
  current.forEach((p,i)=>{assert.ok(p.toArray().every(Number.isFinite));if(previous)assert.ok(p.distanceTo(previous[i])<.018,`visible arm jump at frame ${frame}`);});
  previous=current;
 }
});

test('recoil moves the source bolt and horizontal framing is stable across landscape viewports',async()=>{
 await initialized;const view=createClassicAkView()!,actor=new Simulation(42).state.player;
 actor.shotTime=10;actor.guns.rifle.reloadLeft=0;updateClassicAkView(view,actor,10.03,0);
 assert.ok(view.getObjectByName('bolt')!.position.z>.01);
 actor.shotTime=-10;updateClassicAkView(view,actor,11,0);assert.equal(view.getObjectByName('bolt')!.position.z,0);
 view.position.set(CLASSIC_AK_OFFSET.x,CLASSIC_AK_OFFSET.y,CLASSIC_AK_OFFSET.z);flush(view);
 let muzzleX:number|undefined;
 for(const [w,h]of [[1440,900],[844,390],[667,375]]){
  const aspect=w/h,vfov=THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(CLASSIC_AK_HORIZONTAL_FOV)/2)/aspect));
  const camera=new THREE.PerspectiveCamera(vfov,aspect,.02,5);camera.updateMatrixWorld();
  const muzzle=view.getObjectByName('muzzle')!.getWorldPosition(new THREE.Vector3()).project(camera);
  assert.ok(muzzle.x>.12&&muzzle.x<.24,'muzzle must sit just right of the centre');
  if(muzzleX!==undefined)assert.ok(Math.abs(muzzle.x-muzzleX)<1e-8);muzzleX=muzzle.x;
 }
});
