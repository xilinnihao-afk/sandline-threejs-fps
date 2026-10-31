import test from 'node:test';
import assert from 'node:assert/strict';
import {BOMB_BLAST_RADIUS,bombBlastFalloff,sampleBombBlast,sampleBlast} from '../src/game/blast';
import {Simulation} from '../src/game/simulation';
import {EMPTY_INPUT,type MapBox} from '../src/game/types';

test('planted bomb has a separate smooth 24m envelope while grenades keep their 8m range',()=>{
 let previous=Infinity;
 for(let d=0;d<=28;d+=.025){const value=bombBlastFalloff(d);assert.ok(Number.isFinite(value)&&value>=0&&value<=previous+1e-8);previous=value;}
 assert.equal(BOMB_BLAST_RADIUS,24);assert.equal(bombBlastFalloff(24),0);assert.equal(bombBlastFalloff(30),0);
 assert.ok(bombBlastFalloff(23.99)<.001);
 const origin={x:0,y:.12,z:0},target={x:0,z:12,crouched:false};
 assert.equal(sampleBlast(origin,target,[]).damage,0);assert.ok(sampleBombBlast(origin,target,[]).damage>80);
 assert.ok(sampleBombBlast(origin,{...target,z:20},[]).damage>20);
 assert.equal(sampleBombBlast(origin,{...target,z:24},[]).damage,0);
});

test('bomb cover uses five body samples: full wall protects and partial cover attenuates',()=>{
 const origin={x:0,y:.12,z:0},target={x:0,z:12,crouched:false};
 const wall:MapBox={x:0,z:10,w:4,d:.3,h:3,kind:'wall'};
 const open=sampleBombBlast(origin,target,[]),covered=sampleBombBlast(origin,target,[wall]);
 assert.equal(open.exposure,1);assert.equal(covered.damage,0);assert.equal(covered.exposure,0);
 const low={...wall,h:.8},partial=sampleBombBlast(origin,target,[low]);
 assert.ok(partial.damage>0&&partial.damage<open.damage);
 assert.ok(sampleBombBlast(origin,{...target,crouched:true},[low]).damage<partial.damage);
});

test('bomb detonation harms both teams once, keeps round victory and grants no fake kills or repeated rewards',()=>{
 const sim=new Simulation(42);sim.start('demolition');const s=sim.state;
 // Open south lane, away from cover; leave another player safely out of range.
 for(const a of s.actors){a.x=-4+a.id*1.3;a.z=17;a.armor=0;a.guns[a.weapon].cooldown=10;}
 s.actors[2].x=0;s.actors[2].z=-17;
 Object.assign(s.bomb,{status:'planted',x:0,z:17,timer:.001,defuserId:null});s.phase='planted';sim.events=[];
 sim.update(1/60);
 assert.equal(s.player.health,0);assert.equal(s.actors[3].health,0);assert.equal(s.actors[2].health,100);
 assert.equal(s.bomb.status,'exploded');assert.equal(s.phase,'roundEnd');assert.equal(s.winner,'red');assert.equal(s.redScore,1);
 assert.ok(s.actors.every(a=>a.kills===0));assert.equal(s.totalKills,0);assert.ok(s.feed.every(f=>f.killer==='炸弹爆炸'));
 assert.equal(sim.events.filter(e=>e.type==='bombExplode').length,1);
 assert.equal(sim.events.filter(e=>e.type==='roundReward').length,s.actors.length);
 const after=s.actors.map(a=>({health:a.health,money:a.money,deaths:a.deaths}));sim.update(.5);
 assert.deepEqual(s.actors.map(a=>({health:a.health,money:a.money,deaths:a.deaths})),after);
 assert.equal(sim.events.filter(e=>e.type==='bombExplode').length,1);
 assert.equal(sim.events.filter(e=>e.type==='roundReward').length,s.actors.length);
});

test('planting uses the carrier location instead of embedding the blast inside the site building',()=>{
 const sim=new Simulation(42);sim.start('demolition');const s=sim.state,a=s.player;
 // Keep both teams alive so the three-second action can complete without an
 // elimination ending the round; suppress unrelated AI movement and fire.
 for(const other of s.actors){other.player=true;other.hasBomb=false;}
 a.health=100;a.faction='t';a.hasBomb=true;a.x=-10;a.z=-7.2;
 s.bomb.carrierId=a.id;s.bomb.status='carried';
 for(let frame=0;frame<180;frame++)sim.update(1/60,{...EMPTY_INPUT,interact:true});
 assert.equal(s.bomb.status,'planted');assert.equal(s.bomb.x,a.x);assert.equal(s.bomb.z,a.z);
 assert.ok(sampleBombBlast({x:s.bomb.x,y:.12,z:s.bomb.z},{x:-10,z:-8.5,crouched:false}).damage>0);
 const event=sim.events.find(e=>e.type==='plantComplete');assert.equal(event?.z,a.z);
});
