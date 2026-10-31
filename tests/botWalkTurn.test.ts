import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation} from '../src/game/simulation';
import {setActiveMap} from '../src/game/map';
import {blocked} from '../src/game/collision';
import {botObjective} from '../src/game/botTactics';

const angle=(a:number,b:number)=>Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)));
for(const map of ['snow','desert'] as const)for(const hz of [30,60,120])test(`${map}: a bomb guard walks its turns within its post at ${hz} Hz`,()=>{
 try{
  setActiveMap(map);const sim=new Simulation(77);sim.start('demolition');const s=sim.state,a=s.actors[3];
  s.time=10;s.actors.forEach(other=>other.health=other===a?100:0);
  s.bomb={...s.bomb,status:'planted',x:map==='snow'?-3:0,z:map==='snow'?2:10,y:0};s.phase='planted';
  const home=botObjective(a,s).point;Object.assign(a,home,{yaw:0});
  let distance=0,stillRotation=0,walkingRotation=0,maxRadius=0,maxStep=0;
  for(let i=0;i<hz*12;i++){
   const {x,z,yaw}=a;s.time+=1/hz;(sim as any).bot(a,1/hz);
   const step=Math.hypot(a.x-x,a.z-z),rotation=angle(a.yaw,yaw);distance+=step;maxStep=Math.max(maxStep,step);
   if(step<.00001)stillRotation+=rotation;else walkingRotation+=rotation;
   maxRadius=Math.max(maxRadius,Math.hypot(a.x-home.x,a.z-home.z));
   assert.equal(blocked(a.x,a.z),false,'local turn crossed cover');
  }
  assert.ok(distance>6,`guard did not patrol: ${distance}`);
  assert.ok(walkingRotation>Math.PI,`guard never turned while walking: ${walkingRotation}`);
  assert.ok(stillRotation<.01,`guard spun with planted feet: ${stillRotation}`);
  assert.ok(maxRadius<2.3,`guard abandoned its post: ${maxRadius}`);
  assert.ok(maxStep<1.5/hz,'turn should stay at walking pace');
  console.log({map,hz,distance,stillRotation,walkingRotation,maxRadius});
 }finally{setActiveMap('desert');}
});
test('a brief patrol pause holds its bearing, then resumes real travel',()=>{
 try{
  setActiveMap('snow');const sim=new Simulation(77);sim.start();const s=sim.state,a=s.actors[1];
  s.actors.forEach(other=>other.health=other===a?100:0);Object.assign(a,{x:0,z:10,yaw:.6});s.time=10;
  const brain=(sim as any).brains[a.id];brain.patrolPause=.7;const start={x:a.x,z:a.z,yaw:a.yaw};
  for(let i=0;i<30;i++){s.time+=1/60;(sim as any).bot(a,1/60);}
  assert.equal(a.x,start.x);assert.equal(a.z,start.z);assert.equal(a.yaw,start.yaw);
  for(let i=0;i<90;i++){s.time+=1/60;(sim as any).bot(a,1/60);}
  assert.ok(Math.hypot(a.x-start.x,a.z-start.z)>1);
 }finally{setActiveMap('desert');}
});
test('local walking yields immediately to the defuse objective',()=>{
 try{
  setActiveMap('snow');const sim=new Simulation(77);sim.start('demolition');const s=sim.state,a=s.actors[1];
  s.actors.forEach(other=>other.health=other===a?100:0);Object.assign(a,{x:0,z:2});s.time=10;
  s.bomb={...s.bomb,status:'planted',x:0,z:2,y:0};s.phase='planted';
  (sim as any).brains[a.id].walkTurn={point:{x:4,z:12,y:0},center:{x:3,z:10,y:0},until:20,guard:true};
  (sim as any).bot(a,1/60);
  assert.equal((sim as any).interactionActors.has(a.id),true);assert.equal(a.moving,false);assert.equal(a.crouched,true);
 }finally{setActiveMap('desert');}
});
test('seeing an enemy interrupts a local walking turn immediately',()=>{
 try{
  setActiveMap('snow');const sim=new Simulation(77);sim.start('demolition');const s=sim.state,a=s.actors[3],enemy=s.actors[1];
  s.actors.forEach(other=>other.health=other===a||other===enemy?100:0);Object.assign(a,{x:0,z:2,yaw:0});Object.assign(enemy,{x:0,z:-6});s.time=10;
  s.bomb={...s.bomb,status:'planted',x:-3,z:2,y:0};s.phase='planted';
  const brain=(sim as any).brains[a.id];brain.walkTurn={point:{x:1,z:3,y:0},center:{x:0,z:2,y:0},until:20,guard:true};
  (sim as any).bot(a,1/60);
  assert.equal(brain.walkTurn,null);assert.equal(brain.sensedId,enemy.id);assert.equal(brain.memory.x,enemy.x);
 }finally{setActiveMap('desert');}
});
