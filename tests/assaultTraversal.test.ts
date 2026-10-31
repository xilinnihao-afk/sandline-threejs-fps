import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {AssaultCollision} from '../src/game/assaultCollision';
import {installAssaultGeometry} from '../src/game/assault';
import {type GoldSrcPoint} from '../src/game/dust2Collision';
import {setActiveMap} from '../src/game/map';
import {Simulation} from '../src/game/simulation';
import {advanceJump} from '../src/game/jump';
import {EMPTY_INPUT,type Actor} from '../src/game/types';

const bytes=readFileSync('public/assets/maps/assault/cs_assault.bsp');
const geometry=new AssaultCollision(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
geometry.navigation=JSON.parse(readFileSync('public/assets/maps/assault/navigation.json','utf8'));
installAssaultGeometry(geometry);
const {points,edges}=geometry.navigation;
const DT=1/60;

type TestBrain={repath:number;path:GoldSrcPoint[]};
type MovementAccess={brains:TestBrain[];botMove:(actor:Actor,brain:TestBrain,goal:GoldSrcPoint,dt:number,speed:number)=>void};

/** Isolate navigation from combat while retaining the production bot mover and gravity. */
function travel(from:GoldSrcPoint,to:GoldSrcPoint,seconds=45){
 const sim=new Simulation(123);sim.start();
 const access=sim as unknown as MovementAccess,actor=sim.state.player,brain=access.brains[actor.id];
 for(const other of sim.state.actors)other.health=0;
 Object.assign(actor,from,{health:100,crouched:!!from.crouched,groundY:from.y,verticalSpeed:0,climbing:from.ladder!==undefined});
 let peak=from.y,climbed=false,jumped=false;
 for(let frame=0;frame<seconds*60;frame++){
  sim.state.time+=DT;brain.repath-=DT;
  actor.crouched=actor.crouched||geometry.needsCrouch(actor.x,actor.z,actor.y!);
  advanceJump(actor,DT);
  actor.crouched=geometry.needsCrouch(actor.x,actor.z,actor.y!);
  access.botMove(actor,brain,to,DT,2.8);
  if(geometry.needsCrouch(actor.x,actor.z,actor.y!))actor.crouched=true;
  peak=Math.max(peak,actor.y!);climbed ||= !!actor.climbing;jumped ||= (actor.verticalSpeed??0)>0;
  assert.equal(geometry.blocked(actor.x,actor.z,actor.y,actor.crouched),false,`solid hull during travel: ${JSON.stringify({from,to,actual:{x:actor.x,y:actor.y,z:actor.z},next:brain.path[0]})}`);
  if(Math.hypot(actor.x-to.x,actor.z-to.z)<.25&&Math.abs(actor.y!-to.y)<.12)return {seconds:frame*DT,peak,climbed,jumped};
 }
 assert.fail(`route timed out after ${seconds}s: ${JSON.stringify({from,to,actual:{x:actor.x,y:actor.y,z:actor.z,crouched:actor.crouched},next:brain.path[0]})}`);
}

function onAssault(run:()=>void){try{setActiveMap('assault');run();}finally{setActiveMap('desert');}}

const lanes=geometry.ladders.map(ladder=>{
 const indices=points.flatMap((p,i)=>p.ladder===ladder.id&&Math.abs(p.x-ladder.x)<.01&&Math.abs(p.z-ladder.z)<.01?[i]:[]);
 const linked=[...new Set(indices.flatMap(i=>edges[i]))].map(i=>points[i]).filter(p=>p.ladder===undefined);
 const nearestAtHeight=(height:number)=>linked.filter(p=>Math.abs(p.y-height)<.01).sort((a,b)=>Math.hypot(a.x-ladder.x,a.z-ladder.z)-Math.hypot(b.x-ladder.x,b.z-ladder.z))[0];
 const low=nearestAtHeight(Math.min(...linked.map(p=>p.y))),high=nearestAtHeight(Math.max(...linked.map(p=>p.y)));
 const complete=indices.length>1&&Math.min(...indices.map(i=>points[i].y))<ladder.bottom+.1&&Math.max(...indices.map(i=>points[i].y))>ladder.top-.1;
 return {ladder,low,high,complete};
}).filter(lane=>lane.complete);

test('Assault retains complete reachable lanes for all eight original ladders',()=>{
 assert.deepEqual([...new Set(lanes.map(l=>l.ladder.id))].sort((a,b)=>a-b),[13,26,28,38,45,65,69,78]);
 for(const {ladder,low,high} of lanes){assert.ok(low&&high,`ladder ${ladder.id} needs ground landings`);assert.ok(high.y-low.y>1,`ladder ${ladder.id} landings must differ in height`);}
});

for(const {ladder,low,high} of lanes)for(const direction of ['up','down'] as const){
 test(`Assault bots climb ladder ${ladder.id} ${direction} and step onto its landing`,()=>onAssault(()=>{
  assert.ok(low&&high,`ladder ${ladder.id} needs landings`);
  const result=travel(direction==='up'?low:high,direction==='up'?high:low);
  if(direction==='up')assert.ok(result.climbed,`ladder ${ladder.id} ascent must use its ladder`);
 }));
}

test('Assault player input climbs, holds and descends every ladder without falling through',()=>onAssault(()=>{
 for(const {ladder} of lanes){
  const sim=new Simulation(77);sim.start();const actor=sim.state.player;
  for(const other of sim.state.actors)if(other!==actor){other.health=0;other.respawnAt=999;}
  const middle=(ladder.bottom+ladder.top)/2;
  Object.assign(actor,{x:ladder.x,z:ladder.z,y:middle,groundY:ladder.bottom,verticalSpeed:0,climbing:true,crouched:geometry.needsCrouch(ladder.x,ladder.z,middle),yaw:Math.atan2(ladder.nx,ladder.nz)});
  for(let i=0;i<18;i++)sim.update(DT,{...EMPTY_INPUT,moveZ:1});
  assert.ok(actor.y!>middle+.6,`ladder ${ladder.id}: forward should climb`);
  assert.equal(geometry.blocked(actor.x,actor.z,actor.y,actor.crouched),false);
  const top=actor.y!;for(let i=0;i<12;i++)sim.update(DT,EMPTY_INPUT);
  assert.ok(Math.abs(actor.y!-top)<.01,`ladder ${ladder.id}: release should hold height`);
  for(let i=0;i<18;i++)sim.update(DT,{...EMPTY_INPUT,moveZ:-1});
  assert.ok(actor.y!<top-.6,`ladder ${ladder.id}: backward should descend`);
  assert.equal(geometry.blocked(actor.x,actor.z,actor.y,actor.crouched),false);
 }
}));

test('Assault spawn connectors reach the actual floor at every retained team slot',()=>{
 for(const spawn of [...geometry.spawns.blue.slice(0,10),...geometry.spawns.red.slice(0,10)]){
  const origin=geometry.spawns.blue[0],path=geometry.path(origin.x,origin.z,spawn.x,spawn.z,origin.y,spawn.y);
  assert.ok(path.length,`no route to spawn ${JSON.stringify(spawn)}`);
  const first=path[0],last=path.at(-1)!;
  assert.ok(geometry.segment(origin.x,origin.z,first.x,first.z,origin.y,first.y));
  assert.ok(Math.hypot(last.x-spawn.x,last.z-spawn.z,last.y-spawn.y)<.6);
  assert.ok(geometry.segment(last.x,last.z,spawn.x,spawn.z,last.y,spawn.y));
 }
});

test('Assault standing bots reconnect to navigation from the pitched warehouse roof',()=>{
 // The original standing and duck hulls produce a 4.8 cm floor offset here.
 const from={x:4.763644653208965,y:11.84963845504473,z:-44.03060094454555},to=geometry.spawns.blue[0];
 assert.equal(geometry.blocked(from.x,from.z,from.y),false);
 const path=geometry.path(from.x,from.z,to.x,to.z,from.y,to.y);
 assert.ok(path.length,'standing-height slope position must have a reachable connector');
 assert.ok(geometry.segment(from.x,from.z,path[0].x,path[0].z,from.y,path[0].y));
});

test('Assault crouch stays engaged inside a vent and releases after leaving it',()=>onAssault(()=>{
 const vent=points.find(p=>p.crouched&&p.ladder===undefined&&Math.abs(p.x-.2032)<.01&&Math.abs(p.z+66.4464)<.01);
 assert.ok(vent,'original roof duct must retain crouch-only navigation');
 assert.equal(geometry.blocked(vent.x,vent.z,vent.y),true);
 assert.equal(geometry.blocked(vent.x,vent.z,vent.y,true),false);
 const sim=new Simulation(42);sim.start();const actor=sim.state.player;
 Object.assign(actor,vent,{crouched:true,groundY:vent.y,verticalSpeed:0});
 sim.update(DT,EMPTY_INPUT);assert.equal(actor.crouched,true);
 const spawn=geometry.spawns.blue[0];Object.assign(actor,spawn,{crouched:true,groundY:spawn.y,verticalSpeed:0});
 sim.update(DT,EMPTY_INPUT);assert.equal(actor.crouched,false);
}));

test('Assault bots execute a proven jump edge onto the CT van',()=>onAssault(()=>{
 const from=points.find(p=>Math.abs(p.x-14.0208)<.01&&Math.abs(p.z+7.112)<.01&&p.y<.01);
 const to=points.find(p=>Math.abs(p.x-13.208)<.01&&Math.abs(p.z+7.112)<.01&&Math.abs(p.y-.6096)<.01);
 assert.ok(from&&to);assert.ok(edges[points.indexOf(from)].includes(points.indexOf(to)));
 assert.equal(geometry.segment(from.x,from.z,to.x,to.z,from.y,to.y),false,'the van ledge must require a jump');
 const result=travel(from,to,10);assert.ok(result.jumped);assert.ok(result.peak>to.y);
}));

const roof={x:-.6096,y:13.0048,z:-55.88};
for(const [name,from,to] of [
 ['CT to warehouse spawn',geometry.spawns.blue[0],geometry.spawns.red[0]],
 ['warehouse spawn to CT',geometry.spawns.red[0],geometry.spawns.blue[0]],
 ['CT to warehouse roof',geometry.spawns.blue[0],roof],
] as const){
 test(`Assault bots physically traverse ${name}`,()=>onAssault(()=>{travel(from,to,120);}));
}
