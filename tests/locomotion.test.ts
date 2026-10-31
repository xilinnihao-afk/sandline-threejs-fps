import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceGait,createGait,gaitContactWeight,type GaitState} from '../src/render/locomotion';
const fresh=()=>createGait();
const angle=(a:number,b:number)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
test('distance-driven walk/run transitions agree at 30, 60 and 120 Hz',()=>{
 const states=[30,60,120].map(hz=>{const s=fresh();for(let i=0;i<hz*3;i++)advanceGait(s,0,-(i<hz?1.5:3.6)/hz,0,1/hz,true);return s;});
 for(const s of states){assert.ok(Math.abs(angle(s.phase*Math.PI*2,states[0].phase*Math.PI*2))<1e-8);assert.ok(Math.abs(s.speed-3.6)<.001);}
});
test('backpedaling reverses phase, strafing turns pelvis with bounded twist and hysteresis',()=>{
 const back=fresh();advanceGait(back,0,.1,0,.05,true);assert.equal(back.backward,true);assert.ok(back.phase>.9);
 const side=fresh();for(let i=0;i<120;i++)advanceGait(side,.02,Math.sin(i)*.001,0,1/60,true);
 assert.ok(side.heading<-.9&&side.heading>=-1.25);assert.equal(side.backward,false);
});
test('a stop finishes only a bounded fraction of one step and frozen updates preserve every state',()=>{
 const s=fresh();for(let i=0;i<60;i++)advanceGait(s,0,-.05,0,1/60,true);
 const phase=s.phase;let weights;
 for(let i=0;i<90;i++)weights=advanceGait(s,0,0,0,1/60,false);
 assert.ok(weights!.idle>.999);assert.ok((s.phase-phase+1)%1<.16);
 const settled=s.phase;for(let i=0;i<120;i++)advanceGait(s,0,0,0,1/60,false);
 assert.ok(Math.abs(s.phase-settled)<1e-7,'rest cannot continue cycling the feet');
 const before={...s};advanceGait(s,1,0,2,0,true);assert.deepEqual(s,before);
});
test('pelvis retains its world heading when aim turns, with bounded acceleration lean',()=>{
 const s=fresh();for(let i=0;i<120;i++)advanceGait(s,0,-.025,0,1/60,true);
 let previous=s.bodyYaw!;
 for(let i=1;i<=60;i++){
  const yaw=i/60*Math.PI/2;advanceGait(s,0,-.025,yaw,1/60,true);
  assert.ok(Math.abs(angle(s.bodyYaw!,previous))<=4.8/60+1e-5);
  assert.ok(Math.abs(s.heading)<=1.25);assert.ok(Math.abs(s.leanForward!)<=.065);assert.ok(Math.abs(s.leanSide!)<=.055);
  previous=s.bodyYaw!;
 }
 assert.ok(s.heading<-.8,'hips must not rotate as one rigid assembly with the aiming torso');
 const reset=createGait(.23,-2);assert.equal(reset.bodyYaw,-2);assert.equal(reset.leanForward,0);assert.equal(reset.turnRate,0);
});
test('measured stride controls metres per cycle, and left/right support windows never overlap',()=>{
 for(const run of [0,.5,1])for(let i=0;i<1000;i++)assert.ok(gaitContactWeight(i/1000,-1,run)*gaitContactWeight(i/1000,1,run)<1e-10);
 const a=fresh(),b=fresh();a.speed=b.speed=1.5;
 for(let i=0;i<20;i++){advanceGait(a,0,-.025,0,1/60,true,{walkStride:1.5,runStride:2.5});advanceGait(b,0,-.025,0,1/60,true,{walkStride:2,runStride:3});}
 assert.ok(Math.abs(a.phase/b.phase-4/3)<1e-9);
});
