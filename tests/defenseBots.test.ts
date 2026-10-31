import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Simulation,WEAPONS} from '../src/game/simulation';
import {setActiveMap,type MapId} from '../src/game/map';
import {botObjective,defenseSitePoint,DEFENSE_CHASE_RADIUS} from '../src/game/botTactics';
import {blocked} from '../src/game/collision';
import {Dust2Collision} from '../src/game/dust2Collision';
import {installDust2Geometry} from '../src/game/dust2';
import type {Actor} from '../src/game/types';

const bytes=readFileSync('public/assets/maps/dust2/de_dust2.bsp');
const geometry=new Dust2Collision(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
geometry.navigation=JSON.parse(readFileSync('public/assets/maps/dust2/navigation.json','utf8'));installDust2Geometry(geometry);
function setup(map:MapId='snow'){
 setActiveMap(map);const sim=new Simulation(77);sim.start('defense');sim.startDefenseWave();sim.state.time=10;
 for(const a of sim.state.actors){a.health=0;a.grenades=0;}
 return sim;
}
function drive(sim:Simulation,actors:Actor[],seconds:number,hz=60,observe?:()=>void){
 for(let frame=0;frame<seconds*hz;frame++){
  sim.state.time+=1/hz;
  for(const a of actors){
   a.spread=Math.max(0,a.spread-.09/hz);
   for(const [kind,gun] of Object.entries(a.guns)){
    gun.cooldown=Math.max(0,gun.cooldown-1/hz);
    if(gun.reloadLeft>0){gun.reloadLeft=Math.max(0,gun.reloadLeft-1/hz);if(!gun.reloadLeft){const count=Math.min(WEAPONS[kind as keyof typeof WEAPONS].magazine-gun.ammo,gun.reserve);gun.ammo+=count;gun.reserve-=count;}}
   }
   (sim as any).bot(a,1/hz,true);
  }
  observe?.();
 }
}

for(const map of ['desert','snow','dust2'] as MapId[])test(`${map}: defenders leave spawn on walkable bounded patrols instead of spinning in place`,()=>{
 try{
  const sim=setup(map),allies=sim.state.actors.slice(1,3);allies.forEach(a=>a.health=100);
  const starts=allies.map(a=>({x:a.x,z:a.z})),furthest=[0,0];
  for(const a of allies){const goal=botObjective(a,sim.state).point;assert.equal(blocked(goal.x,goal.z,.4,undefined,goal.y),false);}
  drive(sim,allies,8,60,()=>allies.forEach((a,i)=>{
   furthest[i]=Math.max(furthest[i],Math.hypot(a.x-starts[i].x,a.z-starts[i].z));
   assert.equal(blocked(a.x,a.z,.3,undefined,a.y),false);
   const site=sim.state.defense!.site;assert.ok(Math.hypot(a.x-site.x,a.z-site.z)<=DEFENSE_CHASE_RADIUS+.5);
  }));
  assert.ok(furthest.every(distance=>distance>3),JSON.stringify({map,furthest}));
  assert.equal(sim.events.some(event=>event.type==='shot'),false,'no blind fire on unseen enemies');
 }finally{setActiveMap('desert');}
});

test('defenders investigate shared sightings and do not track unseen enemy coordinates',()=>{
 try{
  const sim=setup(),a=sim.state.actors[1];Object.assign(a,{health:100,x:0,z:12,yaw:0});
  const first=botObjective(a,sim.state);sim.state.actors.filter(v=>v.team==='red').forEach(v=>Object.assign(v,{x:18,z:-18}));
  assert.deepEqual(botObjective(a,sim.state),first);
  const memory={x:0,z:4,y:0,until:20};(sim as any).teamReports.set('blue',memory);
  const before=Math.hypot(a.x-memory.x,a.z-memory.z);drive(sim,[a],2);
  assert.ok(Math.hypot(a.x-memory.x,a.z-memory.z)<before-1.5);
  assert.equal(sim.events.some(event=>event.type==='shot'),false);
 }finally{setActiveMap('desert');}
});

test('a base alarm interrupts a chase and an overextended defender returns inside the defense radius',()=>{
 try{
  for(const alarm of [true,false]){
   const sim=setup(),a=sim.state.actors[1],site=sim.state.defense!.site;
   Object.assign(a,{health:100,x:0,z:alarm?0:-6,yaw:0});
   (sim as any).brains[a.id].memory={x:0,z:-13,until:30};sim.state.defense!.attackers=alarm?1:0;
   const before=Math.hypot(a.x-site.x,a.z-site.z);drive(sim,[a],3);
   assert.ok(Math.hypot(a.x-site.x,a.z-site.z)<before-3,JSON.stringify({alarm,a:{x:a.x,z:a.z}}));
  }
 }finally{setActiveMap('desert');}
});

test('a continuing base alarm keeps a defender inside the site despite renewed outward reports',()=>{
 try{
  const sim=setup('desert'),a=sim.state.actors[1],site=sim.state.defense!.site;
  Object.assign(a,{health:100,x:5,z:16,yaw:-Math.PI/2});sim.state.defense!.attackers=1;
  const report=()=>{(sim as any).teamReports.set('blue',{x:12,z:16,y:0,until:sim.state.time+3.5});};
  report();let arrived=false,maxAfterArrival=0;
  drive(sim,[a],8,60,()=>{
   report();const distance=Math.hypot(a.x-site.x,a.z-site.z);
   if(distance<site.radius-.35)arrived=true;
   if(arrived)maxAfterArrival=Math.max(maxAfterArrival,distance);
  });
  assert.ok(arrived,'return must enter the objective, not reverse around a 5 m threshold');
  assert.ok(maxAfterArrival<site.radius,`alarm allowed a renewed chase at ${maxAfterArrival} m`);
  assert.ok(Math.hypot(a.x-site.x,a.z-site.z)<site.radius);
 }finally{setActiveMap('desert');}
});

test('defense combat produces covering fire, a committed flank and staggered reloads',()=>{
 try{
  const sim=setup(),allies=sim.state.actors.slice(0,3),enemy=sim.state.actors[3];
  allies.forEach((a,i)=>Object.assign(a,{health:100,x:-2+i*1.25,z:2,yaw:0}));
  Object.assign(enemy,{health:10000,x:0,z:-10});
  const starts=allies.map(a=>({x:a.x,z:a.z})),roles=new Set<string>(),furthest=[0,0,0];
  drive(sim,allies,5,60,()=>{
   sim.botDiagnostics().filter(d=>d.id<3).forEach(d=>roles.add(d.role));
   allies.forEach((a,i)=>furthest[i]=Math.max(furthest[i],Math.hypot(a.x-starts[i].x,a.z-starts[i].z)));
  });
  assert.ok(roles.has('support')&&roles.has('flank'),JSON.stringify([...roles]));
  assert.ok(furthest.filter(distance=>distance>1.5).length>=2);
  assert.ok(sim.events.some(event=>event.type==='shot'&&event.actorId===0));
  enemy.health=0;const [a,b]=allies;Object.assign(a,{x:0,z:10});Object.assign(b,{x:0,z:12});
  a.guns.rifle.ammo=5;b.guns.rifle.reloadLeft=1.5;
  const brain=(sim as any).brains[a.id];brain.cover=null;brain.decision=0;brain.memory={x:0,z:3,until:30};
  drive(sim,[a],.1);assert.equal(a.guns.rifle.reloadLeft,0);
  a.guns.rifle.ammo=0;drive(sim,[a],.1);assert.ok(a.guns.rifle.reloadLeft>0);
 }finally{setActiveMap('desert');}
});

for(const hz of [30,60,120])test(`attackers stop for aimed fire then advance between bursts at ${hz} Hz`,()=>{
 try{
  const sim=setup(),a=sim.state.actors[3],target=sim.state.actors[1];
  Object.assign(a,{health:100,x:0,z:0,yaw:Math.PI,weapon:'rifle',inventory:['rifle','pistol']});
  Object.assign(target,{health:10000,x:0,z:12,yaw:0});
  const start={x:a.x,z:a.z};drive(sim,[a],8,hz);
  assert.ok(sim.events.filter(event=>event.type==='shot'&&event.actorId===a.id).length>=4,'continuous movement must not suppress all long-range shots');
  assert.ok(a.z>start.z+1,'attacker must still make objective progress');
  assert.ok(target.health<10000);
 }finally{setActiveMap('desert');}
});

test('attackers occupy separate stable slots without orbiting the objective centre',()=>{
 try{
  const sim=setup(),site=sim.state.defense!.site,attackers=sim.state.actors.slice(3,7);
  attackers.forEach(a=>{const point=defenseSitePoint(a,sim.state);Object.assign(a,point,{health:100,yaw:0});});
  const starts=attackers.map(a=>({x:a.x,z:a.z}));
  drive(sim,attackers,10);const yaw=attackers.map(a=>a.yaw);drive(sim,attackers,4);
  attackers.forEach((a,i)=>{
   assert.ok(Math.hypot(a.x-starts[i].x,a.z-starts[i].z)<.25);
   assert.ok(Math.abs(Math.atan2(Math.sin(a.yaw-yaw[i]),Math.cos(a.yaw-yaw[i])))<.02);
   assert.ok(Math.hypot(a.x-site.x,a.z-site.z)<site.radius);
  });
 }finally{setActiveMap('desert');}
});

test('an occupying attacker clears a teammate-blocked firing ray without leaving the site',()=>{
 try{
  const sim=setup('desert'),a=sim.state.actors[3],ally=sim.state.actors[4],target=sim.state.actors[1],site=sim.state.defense!.site;
  Object.assign(a,{health:100,x:1,z:16,yaw:Math.PI/2,weapon:'rifle',inventory:['rifle','pistol']});
  Object.assign(ally,{health:100,x:-1,z:16,yaw:Math.PI/2,weapon:'rifle'});
  Object.assign(target,{health:10000,x:-7,z:16,yaw:-Math.PI/2});
  let maximumRadius=0;
  drive(sim,[a],12,60,()=>{maximumRadius=Math.max(maximumRadius,Math.hypot(a.x-site.x,a.z-site.z));});
  assert.ok(sim.events.some(event=>event.type==='shot'&&event.actorId===a.id),'occupation must not deadlock behind an ally');
  assert.ok(target.health<10000);
  assert.ok(Math.hypot(a.x-1,a.z-16)>.45,'the blocked shooter must create a new firing lane');
  assert.ok(maximumRadius<site.radius,`local sidestep left the site: ${maximumRadius}`);
  assert.equal(ally.health,100,'friendly fire remains blocked');
 }finally{setActiveMap('desert');}
});
