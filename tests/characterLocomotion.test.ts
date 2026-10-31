import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {loadCPU} from './loadCharacterFixture';
import {adaptSoldierAnimations} from '../src/render/riggedSoldier';
import {SOLDIER_MODELS,prepareRosterSoldier} from '../src/render/soldierRoster';
import {Simulation,WEAPONS} from '../src/game/simulation';
import {FIREARM_KINDS} from '../src/game/types';
import {loadImportedWeaponAssets} from '../src/render/weapons';

// Canvas is only needed for the existing blob shadow/weapon lettering. Geometry,
// clips, skeleton evaluation and IK below use real GLBs and production code.
(globalThis as any).document={createElement:()=>({width:64,height:64,getContext:()=>({createRadialGradient:()=>({addColorStop(){}}),fillRect(){},fillText(){}})})};
const {createCharacter,updateCharacter,measureCharacterGait,registerCharacterHit}=await import('../src/render/characters');
const donor=await loadCPU('public/assets/characters/locomotion.glb');
const originalLoad=GLTFLoader.prototype.loadAsync;
GLTFLoader.prototype.loadAsync=async function(url:string){return loadCPU('public'+new URL(url,'http://local').pathname);};
try{await loadImportedWeaponAssets();}finally{GLTFLoader.prototype.loadAsync=originalLoad;}
const report:any[]=[];
const point=(o:THREE.Object3D)=>o.getWorldPosition(new THREE.Vector3());
for(const definition of SOLDIER_MODELS)test(`${definition.id}: production gait preserves bones, weapon contacts, planted feet and lifecycle`,async()=>{
 const prepared=adaptSoldierAnimations(donor,prepareRosterSoldier(await loadCPU('public/assets/characters/'+definition.file),definition.id));
 const profile=measureCharacterGait(prepared);assert.ok(profile.walkStride>1.45&&profile.walkStride<1.9);assert.ok(profile.runStride>2.2&&profile.runStride<3.4);
 const root=createCharacter(definition.id.startsWith('terrorist')?'red':'blue',0,prepared),rig=root.userData.rig;
 const actor=new Simulation(42).state.actors[1];Object.assign(actor,{x:0,z:0,y:0,groundY:0,yaw:0,pitch:0,moving:false,health:100,crouched:false,weapon:'rifle',shotTime:-100,hurtTime:-100,throwTime:-100});
 updateCharacter(root,actor,0,0);
 const lengths=rig.joints.map((j:THREE.Object3D)=>j.position.length());
 let maxHandError=0,maxContactSlip=0,contacts=0,maxFrameDisplacement=0,maxFrameJoint='';let slipPeak:any=null;
 let previousFeet=[point(rig.footL),point(rig.footR)],previousWeights=[0,0],previousAnchors=rig.legs.map((leg:any)=>leg.anchor.clone());
 let previousJoints=rig.joints.map(point);
 for(let frame=1;frame<=540;frame++){
  const time=frame/60,dt=1/60;
  let vx=0,vz=0;
  if(time<.3){}else if(time<1)vz=-1.65*(time-.3)/.7;else if(time<2.5)vz=-1.65;
  else if(time<3.2)vz=-(1.65+(time-2.5)/.7*1.95);else if(time<4.5)vz=-3.6;
  else if(time<5.1)vz=-3.6*(1-(time-4.5)/.6);
  else if(time>6&&time<8){vx=1.5;actor.yaw=time<7?0:-(time-7)*Math.PI/2;}
  else if(time>=8){actor.yaw=-Math.PI/2;vx=-1.5;}
  actor.x+=vx*dt;actor.z+=vz*dt;actor.moving=Math.hypot(vx,vz)>.025;
  updateCharacter(root,actor,time,dt);root.updateMatrixWorld(true);
  assert.deepEqual(root.position.toArray(),[actor.x,0,actor.z],'visual gait must not alter gameplay translation');
  assert.equal(root.rotation.y,actor.yaw,'aim and gameplay direction must remain identical');
  rig.joints.forEach((j:THREE.Object3D,i:number)=>{assert.ok(j.quaternion.toArray().every(Number.isFinite));if(j!==rig.hip)assert.ok(Math.abs(j.position.length()-lengths[i])<1e-7,'IK must preserve bone length');});
  const grips=rig.gun.userData.grips;
  rig.arms.forEach((arm:any,i:number)=>{maxHandError=Math.max(maxHandError,point(arm.hand).distanceTo(point(i===0?grips.left:grips.right)));});
  const feet=[point(rig.footL),point(rig.footR)];
  feet.forEach((foot,i)=>{const leg=rig.legs[i];if(leg.weight>.999&&previousWeights[i]>.999&&leg.anchor.distanceTo(previousAnchors[i])<1e-8){const slip=Math.hypot(foot.x-previousFeet[i].x,foot.z-previousFeet[i].z);if(slip>maxContactSlip){maxContactSlip=slip;slipPeak={time,side:i,phase:rig.gait.phase,groundDrop:rig.groundDrop,gap:leg.gap,anchor:leg.anchor.toArray(),target:leg.target.toArray(),foot:foot.toArray(),upper:point(leg.upper).toArray(),legLength:point(leg.upper).distanceTo(point(leg.lower))+point(leg.lower).distanceTo(foot)};}contacts++;}previousWeights[i]=leg.weight;previousAnchors[i].copy(leg.anchor);});previousFeet=feet;
  const joints=rig.joints.map(point);if(time>1&&time<5)joints.forEach((p:THREE.Vector3,i:number)=>{const distance=p.distanceTo(previousJoints[i]);if(distance>maxFrameDisplacement){maxFrameDisplacement=distance;maxFrameJoint=rig.joints[i].name+'@'+time.toFixed(3);}});previousJoints=joints;
 }
 console.log(definition.id,{profile,maxHandError,maxContactSlip,contacts,maxFrameDisplacement,maxFrameJoint,slipPeak});
 assert.ok(contacts>20,'must exercise real planted support frames');assert.ok(maxContactSlip<.004,'support foot skates during its planted interval');
 assert.ok(maxHandError<.001,'locomotion must not pull wrists off the rifle');assert.ok(maxFrameDisplacement<.175,'locomotion has a visible joint snap');
 actor.moving=false;for(let i=1;i<=90;i++)updateCharacter(root,actor,9+i/60,1/60);
 const frozen=rig.joints.map(point),gait={...rig.gait};for(let i=0;i<10;i++)updateCharacter(root,actor,10.5,0);
 assert.deepEqual(rig.gait,gait);rig.joints.forEach((j:THREE.Object3D,i:number)=>assert.ok(point(j).distanceTo(frozen[i])<1e-7,'frozen pose drift'));
 registerCharacterHit(root,.4,false,1,1.4);actor.health=0;for(let i=1;i<=72;i++)updateCharacter(root,actor,10.5+i/60,1/60);
 assert.equal(root.userData.animation.clip,'Death');assert.equal(rig.death,1);
 actor.health=100;actor.x=20;actor.z=-20;actor.yaw=.8;actor.moving=false;updateCharacter(root,actor,12,1/60);
 assert.equal(rig.death,0);assert.equal(rig.gait.speed,0);assert.equal(rig.gait.heading,0);assert.equal(rig.gait.leanForward,0);assert.ok(rig.legs.every((leg:any)=>Math.hypot(leg.anchor.x-actor.x,leg.anchor.z-actor.z)<.8),'respawn retained a stale support anchor');assert.equal(root.userData.animation.clip,'Idle');
 const fresh=createCharacter(definition.id.startsWith('terrorist')?'red':'blue',0,prepared);updateCharacter(fresh,actor,12,1/60);
 assert.ok(point(rig.head).distanceTo(point(fresh.userData.rig.head))<1e-6,'respawn must restore the fresh standing pose');
 // Enter and leave actions with a nonzero reach correction. The root offset
 // must fade continuously while the weapon's own action tracks stay in charge.
 let actionTime=12,maximumActionOffsetStep=0,previousGun=rig.gun.position.clone();
 const actionStep=()=>{actionTime+=1/60;updateCharacter(root,actor,actionTime,1/60);maximumActionOffsetStep=Math.max(maximumActionOffsetStep,rig.gun.position.distanceTo(previousGun));previousGun.copy(rig.gun.position);};
 actor.guns.rifle.reloadLeft=WEAPONS.rifle.reload;
 for(let i=0;i<16;i++){actor.guns.rifle.reloadLeft-=1/60;actionStep();}
 actor.guns.rifle.reloadLeft=0;for(let i=0;i<16;i++)actionStep();
 actor.throwTime=actionTime;for(let i=0;i<60;i++)actionStep();
 assert.ok(maximumActionOffsetStep<.035,'reach correction snapped when entering/leaving reload or throw');
 assert.equal(rig.reachEnabled,true);assert.equal(rig.reachAge,.18);
 let maximumOtherWeaponGripError=0;
 for(const weapon of FIREARM_KINDS){
  actor.weapon=weapon;actor.guns[weapon].reloadLeft=0;
  for(let i=0;i<20;i++)actionStep();
  const grips=rig.gun.userData.grips;
  rig.arms.forEach((arm:any,i:number)=>{maximumOtherWeaponGripError=Math.max(maximumOtherWeaponGripError,point(arm.hand).distanceTo(point(i===0?grips.left:grips.right)));});
 }
 assert.ok(maximumOtherWeaponGripError<.005,'reach fitting regressed another shared firearm');
 report.push({model:definition.id,profile,maxHandError,maxContactSlip,contacts,maxFrameDisplacement,maxFrameJoint,slipPeak,maximumActionOffsetStep,maximumOtherWeaponGripError});
 fs.mkdirSync('artifacts/bot-grounding-20261028',{recursive:true});fs.writeFileSync('artifacts/bot-grounding-20261028/character-locomotion-verification.json',JSON.stringify(report,null,2)+'\n');
});
