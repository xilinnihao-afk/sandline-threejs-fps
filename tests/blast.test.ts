import test from 'node:test';
import assert from 'node:assert/strict';
import {blastFalloff,sampleBlast} from '../src/game/blast';
import type {MapBox} from '../src/game/types';
import {Simulation} from '../src/game/simulation';
test('blast falls off smoothly and stops outside radius',()=>{
 let previous=Infinity;for(let d=0;d<=10;d+=.05){const n=blastFalloff(d);assert.ok(n<=previous+1e-8&&n>=0);previous=n;}
 assert.ok(blastFalloff(1)>140);assert.equal(blastFalloff(8),0);assert.ok(blastFalloff(7.99)<.01);
});
test('full cover blocks damage, partial cover reduces it and crouching helps behind low cover',()=>{
 const origin={x:0,y:1,z:0},target={x:0,z:4,crouched:false};
 const wall:MapBox={x:0,z:3,w:3,d:.3,h:3,kind:'wall'};
 const open=sampleBlast(origin,target,[]);assert.equal(open.exposure,1);
 assert.equal(sampleBlast(origin,target,[wall]).damage,0);
 const low={...wall,h:1.12};const partial=sampleBlast(origin,target,[low]);
 assert.ok(partial.damage>0&&partial.damage<open.damage);
 assert.ok(sampleBlast(origin,{...target,crouched:true},[low]).damage<partial.damage);
});
test('detonation damages enemies and owner once, preserves friendly-fire rules',()=>{
 const sim=new Simulation(42);sim.start();const s=sim.state;
 for(const a of s.actors){a.x=3;a.z=14+a.id*.7;a.armor=0;a.guns[a.weapon].cooldown=10;}
 s.grenades=[{id:1,ownerId:0,x:3,y:.08,z:14,vx:0,vy:0,vz:0,fuse:0,bounces:0}];
 sim.update(1/60);assert.ok(s.player.health<100);assert.equal(s.actors[1].health,100);assert.ok(s.actors[3].health<100);
 assert.equal(s.grenades.length,0);assert.equal(sim.events.filter(e=>e.type==='explosion').length,1);
});
