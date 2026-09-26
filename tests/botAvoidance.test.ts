import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/game/simulation';
import { blocked } from '../src/game/collision';
import { avoidActors } from '../src/game/botAvoidance';

for(const hz of [30,60,120])test(`opposing bots pass each other without contact or oscillation at ${hz}Hz`,()=>{
 const sim=new Simulation(12);sim.start();const actors=sim.state.actors;
 actors.forEach(a=>a.health=0);const a=actors[1],b=actors[2];a.health=b.health=100;a.x=b.x=3;a.z=10;b.z=15;
 const states=[{side:1,hold:0},{side:1,hold:0}];let minDistance=Infinity;
 for(let frame=0;frame<hz*8;frame++){
  for(const [actor,goal,state] of [[a,{x:3,z:16},states[0]],[b,{x:3,z:9},states[1]]] as const){
   const p=avoidActors(actor,{x:goal.x-actor.x,z:goal.z-actor.z},actors,1/hz,2.5,state);Object.assign(actor,p);assert.equal(blocked(actor.x,actor.z),false);
  }
  minDistance=Math.min(minDistance,Math.hypot(a.x-b.x,a.z-b.z));
 }
 assert.ok(minDistance>=.66,`contact: ${minDistance}`);assert.ok(a.z>15&&b.z<10,`stuck: ${JSON.stringify([a.x,a.z,b.x,b.z])}`);
});
test('path-following bots pass an oncoming teammate on the actual map',()=>{
 const sim=new Simulation(12);sim.start();const actors=sim.state.actors;actors.forEach(a=>a.health=0);const a=actors[1],b=actors[2];a.health=b.health=100;a.x=b.x=3;a.z=10;b.z=15;
 const brains=(sim as any).brains;
 for(let frame=0;frame<720;frame++){
  for(const [actor,goal] of [[a,{x:3,z:16}],[b,{x:3,z:9}]] as const){brains[actor.id].repath-=1/60;(sim as any).botMove(actor,brains[actor.id],goal,1/60);}
  (sim as any).separateActors();
 }
 assert.ok(a.z>15&&b.z<10,`path deadlock: ${JSON.stringify([a.x,a.z,b.x,b.z])}`);
});
test('moving bot goes around a stationary player without pushing them',()=>{
 const sim=new Simulation(1);sim.start();const actors=sim.state.actors;actors.forEach(a=>a.health=0);const a=actors[1],p=actors[0];a.health=p.health=100;a.x=p.x=3;a.z=10;p.z=12;
 const state={side:1,hold:0};for(let i=0;i<480;i++){Object.assign(a,avoidActors(a,{x:3-a.x,z:16-a.z},actors,1/60,2.5,state));assert.ok(Math.hypot(a.x-p.x,a.z-p.z)>=.66);}
 assert.ok(a.z>15);assert.deepEqual({x:p.x,z:p.z},{x:3,z:12});
});
test('oncoming bots choose the available side near a wall',()=>{
 const sim=new Simulation(12);sim.start();const actors=sim.state.actors;actors.forEach(a=>a.health=0);const a=actors[1],b=actors[2];a.health=b.health=100;a.x=b.x=5.5;a.z=0;b.z=4;
 const states=[{side:1,hold:0},{side:1,hold:0}];
 for(let frame=0;frame<600;frame++)for(const [actor,goal,state] of [[a,{x:5.5,z:5},states[0]],[b,{x:5.5,z:-1},states[1]]] as const){Object.assign(actor,avoidActors(actor,{x:goal.x-actor.x,z:goal.z-actor.z},actors,1/60,2.5,state));assert.equal(blocked(actor.x,actor.z),false);}
 assert.ok(a.z>4.5&&b.z<-.5,`wall deadlock: ${JSON.stringify([a.x,a.z,b.x,b.z])}`);
});
