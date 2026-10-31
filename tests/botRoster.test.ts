import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseBotCounts,DEFAULT_BOT_COUNTS} from '../src/game/botRoster';
import {Simulation} from '../src/game/simulation';
import {MAPS,setActiveMap,type MapId} from '../src/game/map';
import {Dust2Collision} from '../src/game/dust2Collision';
import {installDust2Geometry} from '../src/game/dust2';
import {blocked} from '../src/game/collision';
import {AssaultCollision} from '../src/game/assaultCollision';
import {installAssaultGeometry} from '../src/game/assault';
import {installBloodstrikeGeometry} from '../src/game/bloodstrike';
import {EMPTY_INPUT} from '../src/game/types';

const bytes=readFileSync('public/assets/maps/dust2/de_dust2.bsp');
const geometry=new Dust2Collision(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
geometry.navigation=JSON.parse(readFileSync('public/assets/maps/dust2/navigation.json','utf8'));
installDust2Geometry(geometry);
const assaultBytes=readFileSync('public/assets/maps/assault/cs_assault.bsp');
const assault=new AssaultCollision(assaultBytes.buffer.slice(assaultBytes.byteOffset,assaultBytes.byteOffset+assaultBytes.byteLength));
assault.navigation=JSON.parse(readFileSync('public/assets/maps/assault/navigation.json','utf8'));
installAssaultGeometry(assault);
const bloodBytes=readFileSync('public/assets/maps/bloodstrike/cs_bloodstrike.bsp');
const blood=new Dust2Collision(bloodBytes.buffer.slice(bloodBytes.byteOffset,bloodBytes.byteOffset+bloodBytes.byteLength));
blood.navigation=JSON.parse(readFileSync('public/assets/maps/bloodstrike/navigation.json','utf8'));
installBloodstrikeGeometry(blood);

test('saved custom rosters restore exactly and damaged settings fall back safely',()=>{
 for(const counts of [{teammates:0,enemies:1},{teammates:9,enemies:10},{teammates:2,enemies:10}]){
  assert.deepEqual(parseBotCounts(JSON.stringify(counts)),counts);
 }
 for(const saved of [null,'','null','[]','false','{broken','{"teammates":"9","enemies":10}','{"teammates":10,"enemies":10}','{"teammates":2}','{"teammates":2,"enemies":0}','{"teammates":2.5,"enemies":3}']){
  assert.deepEqual(parseBotCounts(saved),DEFAULT_BOT_COUNTS);
 }
});

test('10v10 survives map changes, restarts and shrinking back to an asymmetric roster',()=>{
 try{
  setActiveMap('desert');const sim=new Simulation(42);assert.equal(sim.setBotCounts(9,10),true);
  for(const id of Object.keys(MAPS) as MapId[]){
   setActiveMap(id);sim.refreshMap();const actors=sim.state.actors,total=20;
   assert.equal(actors.length,total);assert.equal(actors.filter(a=>a.team==='blue').length,10);
   actors.forEach((a,i)=>{
    assert.equal(a.id,i);assert.ok(Number.isFinite(a.y));
    assert.equal(blocked(a.x,a.z,.4,undefined,a.y),false,`${id} spawn ${i}`);
    for(const b of actors.slice(i+1))assert.ok(Math.hypot(a.x-b.x,a.z-b.z)>.8,`${id} spawns ${i}/${b.id}`);
   });
   sim.start();assert.equal(sim.state.actors.length,total);assert.equal(sim.setBotCounts(0,1),false);
   sim.resetRound();assert.equal(sim.state.actors.length,total);sim.menu();
  }
  setActiveMap('desert');sim.refreshMap();
  assert.equal(sim.setBotCounts(0,10),true);sim.start();assert.equal(sim.state.actors.length,11);
  assert.equal(sim.state.actors.filter(a=>a.team==='blue').length,1);
  sim.menu();assert.equal(sim.setBotCounts(2,3),true);sim.start();assert.equal(sim.state.actors.length,6);
 }finally{setActiveMap('desert');}
});

for(const id of Object.keys(MAPS) as MapId[])test(`${id}: full roster fights, respawns and emits footsteps for all 20 actor ids`,()=>{
 try{
  setActiveMap(id);const sim=new Simulation(42);sim.setBotCounts(9,10);sim.start('deathmatch');
  const footsteps=new Set<number>();let shots=0,hits=0,kills=0,respawns=0;
  const started=performance.now();
  for(let frame=0;frame<60*60;frame++){
   sim.update(1/60,EMPTY_INPUT,true);
   for(const event of sim.events){
    if(event.type==='step')footsteps.add(event.actorId!);
    if(event.type==='shot')shots++;
    if(event.type==='hit')hits++;
    if(event.type==='kill')kills++;
    if(event.type==='respawn')respawns++;
   }
   sim.events=[];
   if(frame%30===0)for(const a of sim.state.actors){
    assert.ok([a.x,a.y,a.z,a.yaw,a.pitch,a.health].every(Number.isFinite),`${id} actor ${a.id} finite`);
    if(a.health>0)assert.equal(id==='assault'?assault.blocked(a.x,a.z,a.y,a.crouched):blocked(a.x,a.z,undefined,undefined,a.y),false,`${id} actor ${a.id} clear`);
   }
  }
  const elapsedMs=performance.now()-started;
  console.log('ROSTER_BOT_METRICS',JSON.stringify({map:id,actors:20,seconds:60,shots,hits,kills,respawns,footstepActors:footsteps.size,elapsedMs,meanStepMs:elapsedMs/3600}));
  assert.equal(footsteps.size,20);assert.ok(shots>20&&hits>10&&kills>0&&respawns>0);
  assert.equal(sim.state.actors.length,20);
 }finally{setActiveMap('desert');}
});
