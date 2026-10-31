import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {AssaultCollision} from '../src/game/assaultCollision';
import {installAssaultGeometry} from '../src/game/assault';
import {MAPS,setActiveMap} from '../src/game/map';
import {Simulation} from '../src/game/simulation';
const bytes=readFileSync('public/assets/maps/assault/cs_assault.bsp');
const geometry=new AssaultCollision(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
geometry.navigation=JSON.parse(readFileSync('public/assets/maps/assault/navigation.json','utf8'));installAssaultGeometry(geometry);
const onMap=(run:()=>void)=>{try{setActiveMap('assault');run();}finally{setActiveMap('desert');}};

test('all four original civilians follow a standing route to CT rescue without entering solid hulls, ladders or vents',()=>onMap(()=>{
 const sim=new Simulation(42);sim.start();const s=sim.state,zone=s.rescue!.zones[0];
 for(const h of s.rescue!.hostages){
  const path=geometry.groundPath(h.x,h.z,zone.x,zone.z,h.y,zone.y);
  assert.ok(path.length>100);assert.ok(path.every(p=>!p.crouched&&p.ladder===undefined));
  h.status='following';h.leaderId=s.player.id;
 }
 // The leader waits at the exit: every metre of each follower route is simulated.
 for(const a of s.actors)a.player=true;
 Object.assign(s.player,{x:zone.x,y:zone.y,z:zone.z,groundY:zone.y,verticalSpeed:0});
 for(let i=0;i<90*60&&s.phase==='playing';i++){
  sim.update(1/60);sim.events=[];
  for(const h of s.rescue!.hostages){assert.equal(h.crouched,false);assert.equal(geometry.blocked(h.x,h.z,h.y),false,`hostage ${h.id} entered solid geometry`);}
 }
 assert.equal(s.rescue!.rescued,4);assert.equal(s.winner,'blue');assert.equal(s.blueScore,1);
 assert.ok(s.rescue!.hostages.every(h=>h.status==='rescued'&&Math.hypot(h.x-zone.x,h.z-zone.z)<=zone.radius));
}));

test('CT bots collect nearby hostages and escort all four from source spawns before the rescue deadline',()=>onMap(()=>{
 const sim=new Simulation(43);sim.start();const s=sim.state;
 // Eliminated defenders isolate the objective decision and production movement.
 for(const a of s.actors)if(a.faction==='t')a.health=0;
 let followed=0;
 for(let i=0;i<180*60+1&&s.phase==='playing';i++){
  sim.update(1/60);followed+=sim.events.filter(e=>e.type==='hostageFollow').length;sim.events=[];
  for(const a of s.actors.filter(a=>a.health>0))assert.equal(geometry.blocked(a.x,a.z,a.y,a.crouched),false);
 }
 assert.equal(followed,4);assert.equal(s.rescue!.rescued,4);assert.equal(s.winner,'blue');assert.ok(s.time<180);
 assert.deepEqual({x:s.player.x,z:s.player.z},{x:MAPS.assault.blueSpawns[0].x,z:MAPS.assault.blueSpawns[0].z});
}));
