import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {loadCPU} from './loadCharacterFixture';
import {adaptSoldierAnimations} from '../src/render/riggedSoldier';
import {SOLDIER_MODELS,prepareRosterSoldier} from '../src/render/soldierRoster';
import {Simulation} from '../src/game/simulation';
import {loadImportedWeaponAssets} from '../src/render/weapons';
(globalThis as any).document={createElement:()=>({width:64,height:64,getContext:()=>({createRadialGradient:()=>({addColorStop(){}}),fillRect(){},fillText(){}})})};
const {createCharacter,updateCharacter,solveCharacterFootIK}=await import('../src/render/characters');
const donor=await loadCPU('public/assets/characters/locomotion.glb');
const original=GLTFLoader.prototype.loadAsync;GLTFLoader.prototype.loadAsync=async(url:string)=>loadCPU('public'+new URL(url,'http://local').pathname);
try{await loadImportedWeaponAssets();}finally{GLTFLoader.prototype.loadAsync=original;}
const point=(o:THREE.Object3D)=>o.getWorldPosition(new THREE.Vector3());
const reports:any[]=[];
for(const definition of SOLDIER_MODELS)for(const hz of ['gign','terrorist3'].includes(definition.id)?[30,60,120]:[60])test(`${definition.id} ${hz} Hz: shoe and body surfaces stay above ground during crouch, curves, side/back steps and planted turns`,async()=>{
 const asset=adaptSoldierAnimations(donor,prepareRosterSoldier(await loadCPU('public/assets/characters/'+definition.file),definition.id));
 const root=createCharacter(definition.id.startsWith('terrorist')?'red':'blue',0,asset),r=root.userData.rig;
 const actor=new Simulation(42).state.actors[1];Object.assign(actor,{x:0,z:0,y:0,groundY:0,yaw:0,pitch:0,moving:false,health:100,crouched:false,weapon:'rifle',shotTime:-100,hurtTime:-100,throwTime:-100});
 let time=0,frame=0,ground=(x:number,z:number)=>0;
 const controller={groundHeight:(x:number,_y:number,z:number)=>ground(x,z)} as any;
 const phases:any={};let name='idle',standingHead=0,crouchHead=0,turnSteps=0,maxGripError=0,maxCrouchFootStep=0;
 let previousFeet:THREE.Vector3[]|null=null,previousWeights=[0,0],previousAnchors=[new THREE.Vector3(),new THREE.Vector3()],previousSteps=[false,false],plantSlip=[0,0];
 const step=(vx=0,vz=0)=>{
  const dt=1/hz;time+=dt;frame++;actor.x+=vx*dt;actor.z+=vz*dt;actor.y=actor.groundY=ground(actor.x,actor.z);actor.moving=Math.hypot(vx,vz)>.025;
  updateCharacter(root,actor,time,dt);solveCharacterFootIK(root,controller,dt);root.updateMatrixWorld(true);
  assert.deepEqual(root.position.toArray(),[actor.x,actor.y,actor.z]);assert.equal(root.rotation.y,actor.yaw);
  const p=phases[name]??={minBodyGap:Infinity,maxSupportSlip:0,maxPlantSlip:0,sumSupportSlip:0,supportFrames:0,maxSoleGap:0,steps:0};
  const feet=r.legs.map((leg:any)=>point(leg.foot));
  r.legs.forEach((leg:any,i:number)=>{
   if(leg.stepping&&!previousSteps[i]){p.steps++;if(name==='turn')turnSteps++;}previousSteps[i]=leg.stepping;
   const planted=leg.weight>.99&&previousFeet&&previousWeights[i]>.99&&leg.anchor.distanceTo(previousAnchors[i])<1e-8;
   if(leg.weight>.99)p.maxSoleGap=Math.max(p.maxSoleGap,leg.gap);
   if(planted&&previousFeet){const slide=Math.hypot(feet[i].x-previousFeet[i].x,feet[i].z-previousFeet[i].z);plantSlip[i]+=slide;if(slide>p.maxSupportSlip){p.maxSupportSlip=slide;p.slipPeak={time,side:i,weight:leg.weight,previousWeight:previousWeights[i],groundDrop:r.groundDrop,crouch:r.crouch,feet:feet[i].toArray(),previousFoot:previousFeet[i].toArray(),target:leg.target.toArray(),upper:point(leg.upper).toArray(),length:point(leg.upper).distanceTo(point(leg.lower))+point(leg.lower).distanceTo(feet[i])};}p.maxPlantSlip=Math.max(p.maxPlantSlip,plantSlip[i]);p.sumSupportSlip+=slide;p.supportFrames++;}else plantSlip[i]=0;
   if(previousFeet&&name==='crouch-transition')maxCrouchFootStep=Math.max(maxCrouchFootStep,feet[i].distanceTo(previousFeet[i]));previousWeights[i]=leg.weight;previousAnchors[i].copy(leg.anchor);
  });previousFeet=feet;
  const grips=r.gun.userData.grips;r.arms.forEach((arm:any,i:number)=>maxGripError=Math.max(maxGripError,point(arm.hand).distanceTo(point(i===0?grips.left:grips.right))));
  r.joints.forEach((bone:THREE.Object3D)=>assert.ok(bone.quaternion.toArray().every(Number.isFinite)));
  if(frame%6===0||name==='crouch-transition')r.model.traverse((o:THREE.Object3D)=>{if(o instanceof THREE.SkinnedMesh){const v=new THREE.Vector3();for(let i=0;i<o.geometry.attributes.position.count;i++){o.getVertexPosition(i,v).applyMatrix4(o.matrixWorld);const gap=v.y-ground(v.x,v.z);if(gap<p.minBodyGap){p.minBodyGap=gap;p.lowest={mesh:o.name,index:i,position:v.toArray(),bones:[0,1,2,3].map(j=>[o.skeleton.bones[o.geometry.attributes.skinIndex.getComponent(i,j)]?.name,o.geometry.attributes.skinWeight.getComponent(i,j)]),source:[0,1,2].map(j=>o.geometry.attributes.position.getComponent(i,j))};}}}});
 };
 for(let i=0;i<.5*hz;i++)step();standingHead=point(r.head).y;
 actor.crouched=true;name='crouch-transition';for(let i=0;i<1.5*hz;i++)step();crouchHead=point(r.head).y;
 name='crouch-forward';for(let i=0;i<2*hz;i++)step(0,-1.05);
 name='crouch-side';for(let i=0;i<2*hz;i++)step(1.05,0);
 actor.crouched=false;name='stand-transition';for(let i=0;i<1.5*hz;i++)step();
 name='turn';const turnStart=actor.yaw;for(let i=0;i<3*hz;i++){actor.yaw=turnStart+Math.PI*i/(3*hz-1);step();}
 name='curve';for(let i=0;i<5*hz;i++){const angle=i/hz*1.35/1.4;actor.yaw=angle;step(-Math.sin(angle)*1.35,-Math.cos(angle)*1.35);}
 name='side';actor.yaw=0;for(let i=0;i<2*hz;i++)step(1.35,0);
 name='backward';for(let i=0;i<2*hz;i++)step(0,1.35);
 name='stop';for(let i=0;i<1.5*hz;i++)step();
 name='slope-crouch';ground=(x,z)=>.12*x+.17*z;actor.crouched=true;for(let i=0;i<3*hz;i++){actor.yaw=.4;step(-.4,-.9);}
 const report={model:definition.id,hz,standingHead,crouchHead,crouchDrop:standingHead-crouchHead,maxGripError,maxCrouchFootStep,turnSteps,supportSamples:r.legs.map((leg:any)=>leg.points.length),phases};reports.push(report);console.log(JSON.stringify(report));
 fs.mkdirSync('artifacts/bot-grounding-20261028',{recursive:true});fs.writeFileSync('artifacts/bot-grounding-20261028/grounding-verification.json',JSON.stringify(reports,null,2)+'\n');
 // The slope phase deliberately changes the ground height discontinuously
 // while entering crouch. Allow its two-frame reach recovery 6 mm/frame, but
 // keep every full planted interval below 12 mm total across all scenarios.
 for(const [label,p] of Object.entries(phases) as [string,any][]){assert.ok(p.minBodyGap>-.004,`${label}: body skin penetrated by ${-p.minBodyGap}m`);assert.ok(p.maxSupportSlip<(label==='slope-crouch'?.006:.004),`${label}: support foot slid ${p.maxSupportSlip}m/frame`);assert.ok(p.maxPlantSlip<.012,`${label}: planted foot accumulated ${p.maxPlantSlip}m slide`);}
 assert.ok(standingHead-crouchHead>.3&&standingHead-crouchHead<.55);assert.ok(maxCrouchFootStep<.04);assert.ok(turnSteps>=2,'large aim turn must visibly replant feet');assert.ok(maxGripError<.004,'crouching pulled a hand off the gun');
 for(const label of ['curve','side','backward','crouch-forward','crouch-side'])assert.ok(phases[label].supportFrames>15,`${label} lacked actual support evidence`);
});
