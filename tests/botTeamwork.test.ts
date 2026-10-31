import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Simulation,WEAPONS} from '../src/game/simulation';
import {setActiveMap} from '../src/game/map';
import {squadOrder,chooseCombatAction,preferredRange} from '../src/game/botCombat';
import {findBotCover,concealedAt,tacticalLineClear,findBotAdvance} from '../src/game/botTactics';
import {blocked,findPath} from '../src/game/collision';
import {Dust2Collision} from '../src/game/dust2Collision';
import {installDust2Geometry} from '../src/game/dust2';
import type {Actor} from '../src/game/types';

function setup(map:'desert'|'snow'='snow',teammates=4){
 setActiveMap(map);const sim=new Simulation(77);sim.setBotCounts(teammates,1);sim.start();sim.state.time=10;
 const actors=sim.state.actors;actors[0].health=0;
 actors.slice(1,-1).forEach((a,i)=>Object.assign(a,{x:-2+i*1.25,z:1,yaw:0,grenades:0}));
 const enemy=actors.at(-1)!;Object.assign(enemy,{x:0,z:-10,health:10000,yaw:Math.PI,grenades:0});
 return {sim,s:sim.state,allies:actors.slice(1,-1),enemy};
}
function tick(sim:Simulation,actors:Actor[],seconds:number,hz=60,observe?:()=>void){
 for(let i=0;i<seconds*hz;i++){
  sim.state.time+=1/hz;
  for(const a of actors){a.spread=Math.max(0,a.spread-.09/hz);for(const g of Object.values(a.guns)){
   g.cooldown=Math.max(0,g.cooldown-1/hz);
   if(g.reloadLeft>0){g.reloadLeft=Math.max(0,g.reloadLeft-1/hz);if(g.reloadLeft===0){const n=Math.min(WEAPONS[a.weapon].magazine-g.ammo,g.reserve);g.ammo+=n;g.reserve-=n;}}
  }(sim as any).bot(a,1/hz);}
  observe?.();
 }
}

test('one ready shooter covers distinct assault and flank roles; no FFA teams',()=>{
 try{
  const {allies,enemy,s}=setup(),members=allies.map(actor=>({actor,seeing:true}));
  const orders=allies.map(a=>squadOrder(a,members,enemy,s.time,s.mode));
  assert.equal(orders.filter(o=>o.role==='support').length,1);
  assert.ok(orders.some(o=>o.role==='assault'));assert.ok(orders.some(o=>o.role==='flank'));
  assert.equal(new Set(orders.filter(o=>o.role==='flank').map(o=>o.side)).size,2);
  assert.ok(allies.every(a=>squadOrder(a,members,enemy,s.time,'armsRace').role==='solo'));
 }finally{setActiveMap('desert');}
});
test('covering fire transfers away from reloading/wounded allies and excludes an idle human',()=>{
 try{
  const {allies,enemy,s}=setup(),members=allies.map(actor=>({actor,seeing:true}));
  allies[0].guns.rifle.reloadLeft=1;allies[1].health=20;allies[2].player=true;
  assert.equal(squadOrder(allies[0],members,enemy,s.time,s.mode).supportId,allies[3].id);
  allies[2].shotTime=s.time;
  assert.equal(squadOrder(allies[0],members,enemy,s.time,s.mode).supportId,allies[2].id);
 }finally{setActiveMap('desert');}
});
test('utility priorities distinguish pressure, weapon range, a visible reload and urgent defuse',()=>{
 const c={visible:true,health:100,reloading:false,pressure:0,range:10,idealRange:13,role:'solo' as const,covered:false,opportunity:false,urgent:false,exposedFor:0};
 assert.equal(chooseCombatAction(c),'engage');
 assert.equal(chooseCombatAction({...c,range:25,idealRange:preferredRange('shotgun')}),'advance');
 assert.equal(chooseCombatAction({...c,opportunity:true}),'advance');
 assert.equal(chooseCombatAction({...c,health:25,pressure:.8}),'cover');
 assert.equal(chooseCombatAction({...c,health:25,pressure:1,urgent:true}),'advance');
});
test('squad decisions reach actual movement and covering shots in a shared firefight',()=>{
 try{
  const {sim,allies,enemy}=setup();const starts=allies.map(a=>({x:a.x,z:a.z}));
  tick(sim,allies,1);
  const orders=sim.botDiagnostics().filter(d=>allies.some(a=>a.id===d.id));
  assert.ok(orders.some(d=>d.role==='support'));assert.ok(orders.some(d=>d.role==='flank'));
  const furthest=allies.map((a,i)=>Math.hypot(a.x-starts[i].x,a.z-starts[i].z));
  tick(sim,allies,4,60,()=>allies.forEach((a,i)=>furthest[i]=Math.max(furthest[i],Math.hypot(a.x-starts[i].x,a.z-starts[i].z))));
  const movers=allies.filter((a,i)=>furthest[i]>1.5);
  assert.ok(movers.length>=2,JSON.stringify(sim.botDiagnostics()));
  assert.ok(sim.events.some(e=>e.type==='shot'&&e.actorId===allies[0].id));
  assert.ok(enemy.health<10000);assert.ok(allies.every(a=>!blocked(a.x,a.z)));
 }finally{setActiveMap('desert');}
});
for(const hz of [30,60,120])test(`a shotgun bot closes an open long-range duel at ${hz} Hz`,()=>{
 try{
  const {sim,allies,enemy}=setup('snow',1),a=allies[0];Object.assign(a,{x:0,z:12,weapon:'shotgun',inventory:['shotgun']});enemy.z=-12;
  tick(sim,[a],5,hz);
  assert.ok(Math.hypot(a.x-enemy.x,a.z-enemy.z)<20,JSON.stringify({x:a.x,z:a.z,tactics:sim.botDiagnostics()}));
  assert.equal(blocked(a.x,a.z),false);
 }finally{setActiveMap('desert');}
});
test('safe reload stays in existing cover, while exposed reload seeks a reserved-free shelter',()=>{
 try{
  const {sim,allies,enemy}=setup('desert',2),a=allies[0],b=allies[1];enemy.health=0;b.health=0;
  Object.assign(a,{x:3,z:7});a.guns.rifle.ammo=5;
  (sim as any).brains[a.id].memory={x:0,z:2,until:14};
  tick(sim,[a],.1);assert.ok(a.crouched);assert.ok(a.guns.rifle.reloadLeft>0);assert.equal(a.x,3);assert.equal(a.z,7);
  Object.assign(a,{x:3,z:4});const threat={x:0,z:2},first=findBotCover(a,threat)!;assert.ok(first);
  const second=findBotCover(a,threat,[],[first]);
  assert.ok(!second||Math.hypot(first.x-second.x,first.z-second.z)>=1.4);
 }finally{setActiveMap('desert');}
});
test('a tactical reload waits while a nearby teammate is reloading; empty weapons still reload',()=>{
 try{
  const {sim,allies,enemy}=setup('desert',2),[a,b]=allies;enemy.health=0;
  Object.assign(a,{x:3,z:7});Object.assign(b,{x:3,z:10});a.guns.rifle.ammo=5;b.guns.rifle.reloadLeft=1.5;
  (sim as any).brains[a.id].memory={x:0,z:2,until:14};
  tick(sim,[a],.1);assert.equal(a.guns.rifle.reloadLeft,0);
  a.guns.rifle.ammo=0;tick(sim,[a],.1);assert.ok(a.guns.rifle.reloadLeft>0);
 }finally{setActiveMap('desert');}
});
test('shelter has a finite dwell time and a recovered bot resumes movement',()=>{
 try{
  const {sim,allies,enemy}=setup('desert',1),a=allies[0];enemy.health=0;
  Object.assign(a,{x:3,z:7,health:25});const brain=(sim as any).brains[a.id];brain.memory={x:0,z:2,until:20};
  tick(sim,[a],.3);assert.ok(brain.cover);const position={x:a.x,z:a.z};
  a.health=100;tick(sim,[a],3);
  assert.equal(brain.cover,null);assert.ok(Math.hypot(a.x-position.x,a.z-position.z)>.5);
 }finally{setActiveMap('desert');}
});
test('real nearby shots cause pressure; a wall-blocked shot does not suppress through cover',()=>{
 try{
  const {sim,allies,enemy}=setup('snow',1),a=allies[0];Object.assign(a,{x:.8,z:2});Object.assign(enemy,{x:0,z:-8,yaw:Math.PI,pitch:0});
  assert.equal(sim.fire(enemy),true);assert.ok((sim as any).brains[a.id].pressure>0);assert.equal(a.health,100);
  setActiveMap('desert');Object.assign(a,{x:0,z:7});Object.assign(enemy,{x:0,z:2});
  const brain=(sim as any).brains[a.id];brain.pressure=0;enemy.guns.rifle.cooldown=0;sim.fire(enemy);
  assert.equal(brain.pressure,0);
 }finally{setActiveMap('desert');}
});
test('a teammate report has radio delay and is a snapshot, not a live hidden-target pointer',()=>{
 try{
  const {sim,s,allies,enemy}=setup('desert',2),[observer,receiver]=allies;
  Object.assign(observer,{x:3,z:12,yaw:0});Object.assign(enemy,{x:3,z:8});Object.assign(receiver,{x:-18,z:17,yaw:Math.PI});
  (sim as any).bot(observer,.01);const report={...(sim as any).teamReports.get('blue')};assert.equal(report.targetId,enemy.id);
  (sim as any).bot(receiver,.01);assert.equal((sim as any).brains[receiver.id].memory,null);
  Object.assign(enemy,{x:18,z:-18});s.time+=.25;(sim as any).bot(receiver,.01);
  assert.deepEqual((sim as any).brains[receiver.id].memory,report);
  s.time=report.until+.01;(sim as any).bot(receiver,.01);assert.equal((sim as any).brains[receiver.id].memory,null);
 }finally{setActiveMap('desert');}
});
test('cached perception rechecks walls before updating memory or firing between scans',()=>{
 try{
  const {sim,s,allies,enemy}=setup('desert',1),a=allies[0];
  Object.assign(a,{x:3,z:12,yaw:0});Object.assign(enemy,{x:3,z:8});
  (sim as any).bot(a,.01);const brain=(sim as any).brains[a.id],memory={...brain.memory};
  assert.equal(brain.sensedId,enemy.id);
  Object.assign(enemy,{x:0,z:2});s.time+=.01;sim.events=[];(sim as any).bot(a,.01);
  assert.equal(brain.sensedId,-1);assert.deepEqual(brain.memory,memory);
  assert.equal(sim.events.some(e=>e.type==='shot'),false);
 }finally{setActiveMap('desert');}
});
test('Dust II cover uses reachable original floors and blocks head/shoulder rays',()=>{
 try{
  const bytes=readFileSync('public/assets/maps/dust2/de_dust2.bsp');
  const geometry=new Dust2Collision(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  geometry.navigation=JSON.parse(readFileSync('public/assets/maps/dust2/navigation.json','utf8'));installDust2Geometry(geometry);setActiveMap('dust2');
  const sim=new Simulation();sim.start();const a=sim.state.actors[1];Object.assign(a,{x:11.5824,y:-3.2512,z:-62.3824});
  const threat={x:-3.8608,y:-3.2512,z:-52.6288};assert.ok(tacticalLineClear(a,threat));
  const cover=findBotCover(a,threat);assert.ok(cover);assert.ok(concealedAt(cover,threat,true));
  assert.equal(geometry.blocked(cover.x,cover.z,cover.y),false);
  const path=findPath(a.x,a.z,cover.x,cover.z,a.y,cover.y);assert.ok(path.length);assert.equal(path.at(-1)!.y,cover.y);
  const angle=findBotAdvance(a,threat,1,10,false);if(angle)assert.equal(geometry.blocked(angle.x,angle.z,angle.y),false);
 }finally{setActiveMap('desert');}
});
