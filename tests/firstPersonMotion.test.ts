import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {FirstPersonMotion,type FirstPersonMotionFrame} from '../src/render/firstPersonMotion';
import {FirstPersonController as WebController} from '../src/render/firstPersonController';
import {FirstPersonController as MiniController} from '../minitool/runtime/firstPersonController';
const frame=(patch:Partial<FirstPersonMotionFrame>={}):FirstPersonMotionFrame=>({x:0,y:1.65,z:0,yaw:0,pitch:0,speed:3.9,moving:true,weapon:'rifle',actorId:0,spawnTime:0,time:0,...patch});
function travel(hz:number,patch:Partial<FirstPersonMotionFrame>={}){
 const motion=new FirstPersonMotion(),samples:number[]=[];motion.update(frame(patch),0);
 for(let i=1;i<=hz*8;i++){motion.update(frame({...patch,z:-3.9*i/hz,time:i/hz}),1/hz);if(i>hz*2)samples.push(motion.offset.y);}
 return {motion,samples,rms:Math.sqrt(samples.reduce((n,v)=>n+v*v,0)/samples.length),range:Math.max(...samples)-Math.min(...samples)};
}
test('rifle walking is quieter than the former overlapping 3.7/7.3 Hz bounce and has no sharp second harmonic',()=>{
 const current=travel(120);let oldPower=0;const n=120*6;
 for(let i=1;i<=n;i++){const t=i/120,old=(Math.sin(t*23)*.014+Math.sin(t*46)*.004)*.975+Math.sin(t*11)*.009;oldPower+=old*old;}
 assert(current.rms<Math.sqrt(oldPower/n)*.3);assert(current.range<.0097);
 let crossings=0;for(let i=1;i<current.samples.length;i++)if(current.samples[i-1]<=0&&current.samples[i]>0)crossings++;
 assert(crossings>=14&&crossings<=17,'walking cycle must stay near 2.6 steps per second');
});
test('walking is frame-rate independent at 30, 60 and 120 Hz',()=>{
 const traces=[30,60,120].map(hz=>travel(hz));
 for(const trace of traces){assert(Math.abs(trace.rms-traces[1].rms)<.00005);assert(Math.abs(trace.motion.offset.y-traces[1].motion.offset.y)<.00008);}
});
test('aiming and crouching damp travel, stopping settles without a sudden zero, and blocked movement does not bob',()=>{
 assert(travel(60,{aiming:true}).rms<travel(60).rms*.23);assert(travel(60,{crouched:true}).rms<travel(60).rms*.55);
 const {motion}=travel(60);const before={...motion.offset};motion.update(frame({z:-31.2,moving:false,time:8+1/60}),1/60);
 assert(Math.abs(motion.offset.y-before.y)<.0018);
 for(let i=0;i<60;i++)motion.update(frame({z:-31.2,moving:false,time:8+i/60}),1/60);
 assert(Math.abs(motion.offset.x)<1e-6);assert(Math.abs(motion.offset.y)<.00081);
 const blocked=new FirstPersonMotion();for(let i=0;i<120;i++)blocked.update(frame({time:i/60}),1/60);
 assert.equal(blocked.offset.x,0);assert(Math.abs(blocked.offset.y)<.00081);
});
test('60 Hz simulation ticks retain the same walking speed on 120/144 Hz displays',()=>{
 for(const hz of [60,120,144]){
  const motion=new FirstPersonMotion();motion.update(frame(),0);const speeds:number[]=[];
  for(let i=1;i<=hz*4;i++){const t=Math.floor((i/hz)*60+1e-7)/60;motion.update(frame({z:-3.9*t,time:t}),1/hz);if(i>hz*2)speeds.push(motion.diagnostics().speed);}
  assert(Math.min(...speeds)>3.89);assert(Math.max(...speeds)<3.91);
 }
});
test('pause freezes pose; teleport, respawn, replay and airborne travel cannot carry a stale stride',()=>{
 const {motion}=travel(60);const before={...motion.offset};motion.update(frame({z:-31.2,time:8}),0);assert.deepEqual(motion.offset,before);
 motion.update(frame({x:20,z:20,time:9}),1/60);assert.equal(motion.offset.x,0);assert(Math.abs(motion.offset.y)<.0001);
 for(const extra of [{spawnTime:10},{actorId:3},{time:0}]){motion.update(frame({x:20,z:20,time:10,...extra}),1/60);assert.equal(motion.offset.x,0);}
 const air=new FirstPersonMotion();for(let i=0;i<60;i++)air.update(frame({z:-i*.065,y:2,airborne:true,time:i/60}),1/60);assert.equal(air.offset.x,0);
 motion.update(frame({z:-5,lookDX:.2,cameraKick:.1}),1/60,true);assert.equal(motion.offset.x,0);assert.equal(motion.offset.y,.0035000000000000005);
});
test('web and mini-tool share identical motion while preserving the exact gameplay camera pose',async()=>{
 const aCamera=new THREE.PerspectiveCamera(),bCamera=new THREE.PerspectiveCamera(),a=await WebController.create(aCamera,[]),b=await MiniController.create(bCamera,[]);
 try{for(let i=0;i<180;i++){const f=frame({z:-i*.065,time:i/60,yaw:.4,pitch:.15,aiming:i>60,lookDX:i%9===0?.02:0,cameraKick:i===80?.12:0});a.update(f,1/60);b.update(f,1/60);assert.deepEqual(a.weaponMotion,b.weaponMotion);assert.deepEqual(aCamera.position.toArray(),[f.x,f.y,f.z]);assert.equal(aCamera.rotation.y,.4);assert.equal(aCamera.rotation.x,.15);}}finally{a.world.free();}
});

test('classic fore/aft gait is readable without extra vertical bounce and grows smoothly with running',()=>{
 const sample=(speed:number,extra:Partial<FirstPersonMotionFrame>={})=>{const motion=new FirstPersonMotion(),zs:number[]=[];motion.update(frame(extra),0);for(let i=1;i<=240;i++){motion.update(frame({...extra,speed,z:-speed*i/60,time:i/60}),1/60);if(i>60)zs.push(motion.offset.z);}return {motion,range:Math.max(...zs)-Math.min(...zs)};};
 const walk=sample(3.9),run=sample(5.6),aim=sample(3.9,{aiming:true});assert.ok(walk.range>.03&&walk.range<.036);assert.ok(run.range>walk.range*1.55&&run.range<.06);assert.ok(aim.range<walk.range*.22);
 const previous={...walk.motion.offset};walk.motion.update(frame({z:-15.6,time:4}),0);assert.deepEqual(walk.motion.offset,previous);
 for(let i=1;i<90;i++)walk.motion.update(frame({z:-15.6,moving:false,time:4+i/60}),1/60);assert.ok(Math.abs(walk.motion.offset.z)<1e-7);
 walk.motion.update(frame({z:-16,lookDX:0}),1/60,true);assert.equal(walk.motion.offset.z,0);
});
