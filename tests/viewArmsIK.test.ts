import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {ViewArmsIK,hideLegacyArms} from '../src/render/viewArmsIK';
import {createViewWeapon,updateViewWeapon} from '../src/render/weapons';
import {Simulation,WEAPONS} from '../src/game/simulation';
import {WEAPON_KINDS} from '../src/game/types';

// Use the actual supplied skeleton/skin; omit textures only for CPU-side tests.
async function arms(){
 const b=fs.readFileSync(new URL('../public/assets/player/fps_arms.glb',import.meta.url));
 const len=b.readUInt32LE(12),j=JSON.parse(b.subarray(20,20+len).toString());
 const at=20+len;j.buffers[0].uri='data:application/octet-stream;base64,'+b.subarray(at+8,at+8+b.readUInt32LE(at)).toString('base64');
 j.materials=[{}];delete j.images;delete j.textures;delete j.extensionsUsed;delete j.extensionsRequired;
 (globalThis as any).ProgressEvent ??= class {};
 const gltf=await new GLTFLoader().parseAsync(JSON.stringify(j),'');
 const group=new THREE.Group(),model=gltf.scene;group.add(model);
 const box=new THREE.Box3().setFromObject(model),scale=.60/Math.max(...box.getSize(new THREE.Vector3()).toArray());
 model.scale.multiplyScalar(scale);model.position.addScaledVector(box.getCenter(new THREE.Vector3()),-scale);
 return {gltf,group,model,rightHand:model.getObjectByName('R_wrist_025')!,mixer:new THREE.AnimationMixer(model)};
}

test('real arm skeleton stays on both moving sockets throughout reload, recoil and weapon switches',async()=>{
 const rig=await arms(),scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera();scene.add(camera);camera.add(rig.group);
 const ik=new ViewArmsIK(rig,camera),sim=new Simulation(42);sim.start();const player=sim.state.player;
 const root=new THREE.Group();root.position.set(.25,-.235,-.49);scene.add(root);
 let maximum=0;
 for(const kind of WEAPON_KINDS){
  const gun=createViewWeapon(kind);root.add(gun);hideLegacyArms(gun);player.weapon=kind;
  for(const hand of [gun.userData.rig.left,gun.userData.rig.right,gun.userData.rig.leftForearm,gun.userData.rig.rightForearm])hand.traverse((o:THREE.Object3D)=>{if(o instanceof THREE.Mesh)assert.equal(o.visible,false);});
  for(let i=0;i<=100;i++){
   player.guns[kind].reloadLeft=i===100?0:WEAPONS[kind].reload*(1-i/100);player.shotTime=9.98;player.moving=true;
   updateViewWeapon(gun,player,10+i/60,1/60);root.position.y=-.235+.05*Math.sin(i/10);ik.update(gun);
   maximum=Math.max(maximum,...ik.errors);assert.ok(ik.errors.every(e=>Number.isFinite(e)&&e<1e-5),`${kind} stage ${i}: ${ik.errors}`);
   // Frozen/repeated frames must not accumulate forearm twist or skin drift.
   const bones:THREE.Object3D[]=[];rig.model.traverse(o=>{if(o instanceof THREE.Bone)bones.push(o);});
   const poses=bones.map(b=>b.quaternion.clone());ik.update(gun);
   bones.forEach((bone,j)=>assert.ok(1-Math.abs(bone.quaternion.clone().normalize().dot(poses[j].normalize()))<1e-8,`${kind}: twist drift on ${bone.name}`));
  }
  root.remove(gun);
 }
 console.log('Maximum wrist/socket error (metres):',maximum);
});
