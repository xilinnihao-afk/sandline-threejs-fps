import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation} from '../src/game/simulation';
import {EMPTY_INPUT} from '../src/game/types';
import {setActiveMap} from '../src/game/map';
import {blocked} from '../src/game/collision';
import {killRanking,chooseRespawn,RESPAWN_DELAY} from '../src/game/deathmatch';

test('default mode keeps playing beyond three kills and team wipe; respawn preserves earned progress',()=>{
 const sim=new Simulation(51);sim.start();const s=sim.state,p=s.player,enemy=s.actors[3];
 p.inventory.push('m4');p.weapon='m4';p.kills=8;p.money=2300;
 for(const a of s.actors.filter(a=>a.team==='red'))(sim as any).damage(p,a,1000);
 assert.equal(s.blueScore,3);sim.update(.01);assert.equal(s.phase,'playing');
 (sim as any).damage(enemy,p,1000);const money=p.money,at=p.respawnAt!;
 sim.setPaused(true);sim.update(10);assert.equal(p.health,0);assert.equal(p.respawnAt,at);
 sim.setPaused(false);s.actors.slice(1).forEach(a=>{a.health=0;a.respawnAt=100;});
 for(let i=0;i<Math.ceil(RESPAWN_DELAY*60)+2;i++)sim.update(1/60);
 assert.equal(p.health,100);assert.equal(p.kills,11);assert.equal(p.deaths,1);
 assert.equal(p.money,money);assert.equal(p.weapon,'m4');assert.ok(p.inventory.includes('m4'));
 assert.equal(p.guns.m4.ammo,30);assert.equal(s.spectating,null);assert.equal(s.phase,'playing');
 assert.ok((p.spawnProtectionUntil??0)>s.time);const health=p.health;
 (sim as any).damage(enemy,p,100);assert.equal(p.health,health);
 assert.equal(sim.fire(p),true);assert.equal(p.spawnProtectionUntil,0);
 sim.start();assert.equal(s.blueScore,0);assert.equal(s.player.kills,0);assert.equal(s.player.deaths,0);
});

test('rankings order kills then fewer deaths, share exact ties and never mutate roster order',()=>{
 const sim=new Simulation(),a=sim.state.actors,ids=a.map(a=>a.id);
 Object.assign(a[0],{kills:4,deaths:2});Object.assign(a[1],{kills:8,deaths:5});
 Object.assign(a[2],{kills:8,deaths:3});Object.assign(a[3],{kills:4,deaths:2});
 const rows=killRanking(a);assert.deepEqual(rows.map(r=>r.actor.id),[2,1,0,3,4,5]);
 assert.deepEqual(rows.map(r=>r.rank),[1,2,3,3,5,5]);assert.deepEqual(a.map(a=>a.id),ids);
});

test('respawns avoid occupied points; supplies and dropped guns stay bounded in a long session',()=>{
 try{
  setActiveMap('desert');const sim=new Simulation(82);sim.start();const s=sim.state,p=s.player;
  p.health=0;const spawn=chooseRespawn(p,s.actors);assert.equal(blocked(spawn.x,spawn.z,.48),false);
  assert.ok(s.actors.filter(a=>a.health>0).every(a=>Math.hypot(a.x-spawn.x,a.z-spawn.z)>1.2));
  s.actors.forEach(a=>{a.health=0;a.respawnAt=10000;});s.pickups=[];
  for(let i=0;i<50;i++)s.pickups.push({id:1000+i,weapon:'rifle',x:0,z:0,ammo:1,reserve:0,expiresAt:45});
  sim.update(.1);assert.equal(s.pickups.length,32);
  for(let i=0;i<50;i++)sim.update(1);
  assert.ok(s.pickups.length>0&&s.pickups.length<=14);assert.equal(new Set(s.pickups.map(p=>p.id)).size,s.pickups.length);
  assert.ok(s.pickups.every(p=>p.expiresAt===undefined));assert.equal(s.phase,'playing');
 }finally{setActiveMap('desert');}
});

test('respawn opens a fresh purchase window while session time continues',()=>{
 const sim=new Simulation();sim.start();const p=sim.state.player;
 sim.state.time=150;p.spawnedAt=145;p.z=17;
 assert.equal(sim.purchase('armor'),true);
 p.money=5000;sim.state.time=166;assert.equal(sim.purchase('he'),false);
});

test('both maps sustain three-minute seeded combat, repeated respawns and bounded world state',()=>{
 const metrics=[];
 try{
  for(const map of ['desert','snow'] as const)for(const seed of [7,42,2026]){
   setActiveMap(map);const sim=new Simulation(seed);sim.start();let shots=0,respawns=0,moves=0;
   for(let frame=0;frame<60*180;frame++){
    sim.update(1/60,EMPTY_INPUT,true);
    if(map==='snow')assert.equal(new Set(sim.state.pickups.map(p=>p.weapon)).size,sim.state.pickups.length,`snow/${seed}/${frame}: repeated ground weapon class`);
    for(const e of sim.events){if(e.type==='shot')shots++;if(e.type==='respawn')respawns++;assert.ok(!/^(plant|defuse|bomb)/.test(e.type));}
    sim.events=[];
    if(frame%60===0)for(const a of sim.state.actors){assert.equal(blocked(a.x,a.z,.315),false,`${map}/${seed}/${frame}/${a.id}`);if(a.moving)moves++;}
   }
   const s=sim.state;assert.equal(s.phase,'playing');assert.ok(s.roundTime>179);
   assert.ok(s.blueScore>3&&s.redScore>3,`${map}/${seed}: no sustained two-sided combat ${s.blueScore}:${s.redScore}`);
   assert.ok(shots>80&&respawns>10&&moves>30);assert.ok(s.pickups.length<=46);
   assert.equal(s.actors.reduce((n,a)=>n+a.kills,0),s.blueScore+s.redScore);
   metrics.push({map,seed,shots,respawns,moves,score:[s.blueScore,s.redScore]});
  }
 }finally{setActiveMap('desert');}
 console.log('ENDLESS_COMBAT_METRICS',JSON.stringify(metrics));
});
