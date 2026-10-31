import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation} from '../src/game/simulation';
import {setActiveMap} from '../src/game/map';
import {blocked} from '../src/game/collision';
import {advanceBotMotion,type BotMotion} from '../src/game/botMotion';

function duel(){
 const sim=new Simulation(77);sim.start();const s=sim.state,a=s.actors[1],enemy=s.actors[3];
 s.time=10;s.actors.forEach(v=>v.health=v===a||v===enemy?100:0);
 Object.assign(a,{x:0,z:2,yaw:0,grenades:0});Object.assign(enemy,{x:0,z:10,health:10000,grenades:0});
 return {sim,s,a,enemy,brain:(sim as any).brains[a.id]};
}
test('peripheral vision sees a silent side target but cannot see behind the head',()=>{
 try{
  setActiveMap('snow');const {sim,a,enemy,brain}=duel();
  enemy.x=6;enemy.z=2;(sim as any).bot(a,1/60);assert.equal(brain.target,enemy.id);
  const rear=duel();(rear.sim as any).bot(rear.a,1/60);assert.equal(rear.brain.target,-1);
 }finally{setActiveMap('desert');}
});
for(const hz of [30,60,120])test(`a rear hit triggers a bounded turn and return fire at ${hz} Hz`,()=>{
 try{
  setActiveMap('snow');const {sim,s,a,enemy}=duel();
  (sim as any).damage(enemy,a,5);sim.events=[];
  let firstShot=Infinity,maxTurn=0;
  for(let frame=0;frame<hz*2;frame++){
   const yaw=a.yaw;s.time+=1/hz;
   for(const g of Object.values(a.guns))g.cooldown=Math.max(0,g.cooldown-1/hz);
   (sim as any).bot(a,1/hz);
   maxTurn=Math.max(maxTurn,Math.abs(Math.atan2(Math.sin(a.yaw-yaw),Math.cos(a.yaw-yaw))));
   if(sim.events.some(e=>e.type==='shot')){firstShot=frame/hz;break;}
  }
  assert.ok(firstShot>.18&&firstShot<1.8,`reaction time ${firstShot}`);
  assert.ok(maxTurn<=5.5/hz+.00001,`snap turn ${maxTurn}`);
 }finally{setActiveMap('desert');}
});
test('damage memory is a snapshot, expires, and never permits shots through cover',()=>{
 try{
  setActiveMap('desert');const {sim,s,a,enemy,brain}=duel();
  Object.assign(a,{x:3,z:7});Object.assign(enemy,{x:0,z:2});
  assert.equal((sim as any).visibleHeight(a,enemy),null);
  (sim as any).damage(enemy,a,5);const remembered={...brain.attacker};
  Object.assign(enemy,{x:-16,z:-15});sim.events=[];
  (sim as any).bot(a,1/60);
  assert.deepEqual(brain.attacker,remembered);
  assert.equal(sim.events.some(e=>e.type==='shot'),false);
  enemy.health=0;s.time+=5;(sim as any).bot(a,1/60);assert.equal(brain.attacker,null);
 }finally{setActiveMap('desert');}
});
test('explosion direction does not reveal the hidden grenade owner',()=>{
 try{
  setActiveMap('snow');const {sim,a,enemy,brain}=duel();
  (sim as any).damage(enemy,a,5,false,undefined,{x:4,z:2});
  assert.equal(brain.attacker.id,-1);assert.equal(brain.attacker.x,4);assert.equal(brain.attacker.z,2);
 }finally{setActiveMap('desert');}
});
test('walking accelerates, slows on a sharp turn, and brakes near its destination',()=>{
 const motion:BotMotion={speed:0,heading:null};
 const first=advanceBotMotion(motion,0,-10,1/60,2.5);assert.ok(Math.hypot(first.x,first.z)<2.5/60*.15);
 for(let i=0;i<120;i++)advanceBotMotion(motion,0,-10,1/60,2.5);
 assert.ok(motion.speed>2.49);const before=motion.heading!;
 advanceBotMotion(motion,10,0,1/60,2.5);
 assert.ok(motion.speed<2.3);assert.ok(Math.abs(Math.atan2(Math.sin(motion.heading!-before),Math.cos(motion.heading!-before)))<=4.5/60+1e-10);
 for(let i=0;i<30;i++)advanceBotMotion(motion,0,-.2,1/60,2.5);
 assert.ok(motion.speed<1);
});
test('smoothed route stays walkable and reaches its goal at different frame rates',()=>{
 try{
  setActiveMap('snow');const ends=[];
  for(const hz of [30,60,120]){
   const {sim,a,brain}=duel();sim.state.actors.forEach(v=>v.health=v===a?100:0);
   Object.assign(a,{x:0,z:10});
   for(let i=0;i<hz*11;i++){
    sim.state.time+=1/hz;brain.repath-=1/hz;(sim as any).botMove(a,brain,{x:2,z:-10},1/hz);
    assert.equal(blocked(a.x,a.z),false);
   }
   assert.ok(Math.hypot(a.x-2,a.z+10)<.3,`route at ${hz} Hz: ${a.x}, ${a.z}`);ends.push(a.z);
  }
  assert.ok(Math.max(...ends)-Math.min(...ends)<.1);
 }finally{setActiveMap('desert');}
});
