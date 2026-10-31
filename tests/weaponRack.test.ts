import test from 'node:test';import assert from 'node:assert/strict';import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {loadCPU} from './loadCharacterFixture';
import {prepareSmgChargingHandle} from '../src/render/smgChargingHandle';
import {loadImportedWeaponAssets,createViewWeapon,updateViewWeapon} from '../src/render/weapons';
import {prepareClassicAkAssets} from '../src/render/classicAk';
import {ClassicViewArms} from '../src/render/classicViewArms';
import {Simulation} from '../src/game/simulation';import {FIREARM_KINDS} from '../src/game/types';

test('MP5 separation preserves every source triangle, UV and seated transform exactly once',async()=>{
 const {scene}=await loadCPU('public/assets/runtime/smg.glb');scene.updateMatrixWorld(true);
 const body=scene.getObjectByName('Reciever_Mag_&_Barrel_0') as T.Mesh,source=body.geometry,indices=Array.from(source.index!.array),position=Array.from(source.attributes.position.array),uv=Array.from(source.attributes.uv.array);
 const origin=body.matrixWorld.clone();prepareSmgChargingHandle(scene);scene.updateMatrixWorld(true);
 const moving=scene.getObjectByName('mp5-authored-charging-handle') as T.Mesh;assert.ok(moving);assert.equal(moving.geometry.index!.count,340*3);
 const triangles=(ids:number[])=>{const out=[];for(let i=0;i<ids.length;i+=3)out.push(ids.slice(i,i+3).join(','));return out.sort();};
 assert.deepEqual(triangles([...body.geometry.index!.array,...moving.geometry.index!.array]),triangles(indices));
 for(const mesh of [body,moving]){assert.deepEqual(Array.from(mesh.geometry.attributes.position.array),position);assert.deepEqual(Array.from(mesh.geometry.attributes.uv.array),uv);assert.ok(mesh.matrixWorld.elements.every((v,i)=>Math.abs(v-origin.elements[i])<1e-8));}
 assert.deepEqual(Array.from(source.index!.array),indices);prepareSmgChargingHandle(scene);assert.equal(scene.getObjectByName('bolt')!.children.length,1);
 const vertex=new T.Vector3().fromBufferAttribute(moving.geometry.attributes.position,moving.geometry.index!.getX(0)).applyMatrix4(moving.matrixWorld);
 scene.getObjectByName('bolt')!.position.z=.075;scene.updateMatrixWorld(true);
 const pulled=new T.Vector3().fromBufferAttribute(moving.geometry.attributes.position,moving.geometry.index!.getX(0)).applyMatrix4(moving.matrixWorld);
 assert.ok(pulled.sub(vertex).distanceTo(new T.Vector3(0,0,.075))<1e-8);
});

test('all seven view guns move real control geometry, keep palms attached and restore hands without drift',async t=>{
 t.mock.method(GLTFLoader.prototype,'loadAsync',async(url:string)=>loadCPU('public/assets/runtime/'+url.split('/').at(-1)!.split('?')[0]));
 const [gun,sourceArms]=await Promise.all(['cs16-ak47','cs16-arms-rigged'].map(k=>loadCPU('public/assets/runtime/'+k+'.glb')));prepareClassicAkAssets(gun.scene,sourceArms.scene);await loadImportedWeaponAssets();
 const scene=new T.Scene(),arms=new ClassicViewArms(new T.PerspectiveCamera(),scene),actor=new Simulation(42).state.player;actor.shotTime=-10;
 for(const kind of FIREARM_KINDS){
  actor.weapon=kind;const weapon=createViewWeapon(kind),other=createViewWeapon(kind);scene.add(weapon,other);
  const rig=weapon.userData.rig,control=kind==='shotgun'?rig.pump:rig.bolt;let triangles=0;control.traverse((o:T.Object3D)=>{if(o instanceof T.Mesh)triangles+=(o.geometry.index?.count??0)/3;});assert.ok(triangles>0,kind+' animates an empty wrapper');
  const pose=(p:number)=>{actor.weaponSwitch={displayed:kind,phase:p===1?'ready':'rack',depth:0,rackProgress:p,shotTime:-10};updateViewWeapon(weapon,actor,0,0);arms.update(weapon);scene.updateMatrixWorld(true);};
  pose(1);const snapshots=()=>{const out:any[]=[];for(const root of [weapon,arms.model])root.traverse(o=>{if(o instanceof T.Bone)out.push([o.name,...o.quaternion.toArray()]);});return out;};const baseline=snapshots();
  pose(.55);assert.ok(control.position.z>.035);assert.equal(other.userData.rig[kind==='shotgun'?'pump':'bolt'].position.z,0,'shared clone moved');assert.equal(weapon.userData.pose.magazineOffset,0);
  assert.ok(arms.errors.every(v=>v<1e-6));const frozen=snapshots();pose(.55);assert.deepEqual(snapshots(),frozen,'paused pose drifts');
  pose(1);assert.equal(control.position.z,0);assert.deepEqual(snapshots(),baseline,'switch does not restore source hand pose');
  scene.remove(weapon,other);
 }
});
