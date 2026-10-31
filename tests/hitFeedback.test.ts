import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Simulation} from '../src/game/simulation';
import {CombatEffects} from '../src/render/effects';

test('bullet damage carries the actual ray impact point to the hit effect',()=>{
 const sim=new Simulation(5);sim.start();const p=sim.state.player,e=sim.state.actors[3];
 p.x=3;p.z=14;p.yaw=0;p.pitch=0;e.x=3;e.z=10;
 sim.state.actors.filter(a=>a!==p&&a!==e).forEach(a=>a.health=0);
 sim.events=[];sim.fire(p);const hit=sim.events.find(e=>e.type==='hit')!,shot=sim.events.find(e=>e.type==='shot')!;
 assert.ok(hit);assert.equal(hit.weapon,'rifle');assert.ok(hit.normalZ!<-.99);assert.deepEqual([hit.x,hit.y,hit.z],[shot.endX,shot.endY,shot.endZ]);
 assert.ok(hit.z!>e.z,'impact is on the front surface rather than hidden at actor center');
});

test('blood has an independent direction, bounded pool and finite lifetime; own hit uses camera feedback',()=>{
 const gradient={addColorStop(){}};
 const ctx=new Proxy({createRadialGradient:()=>gradient},{get:(o:any,k)=>o[k]??(()=>{})});
 (globalThis as any).document={createElement:()=>({width:0,height:0,getContext:()=>ctx})};
 const fx=new CombatEffects(),camera=new THREE.PerspectiveCamera();
 fx.emit({type:'melee',actorId:0,weapon:'knife'});
 assert.equal(fx.diagnostics().shotEffects,0);assert.equal(fx.diagnostics().casings,0);assert.equal(fx.diagnostics().particles,0);
 fx.emit({type:'hit',targetId:3,x:3,y:1.2,z:7,normalZ:-1});
 const drops=(fx as any).particles.filter((p:any)=>p.life>0&&p.tone==='blood');
 assert.ok(drops.length>=18);assert.ok(drops.every((p:any)=>p.vz>0));assert.ok(drops.some((p:any)=>Math.abs(p.vx)>.1));
 for(let i=0;i<50;i++)fx.emit({type:'hit',targetId:3,x:3,y:1,z:7,normalZ:-1});
 assert.ok(fx.diagnostics().particles<=240);fx.update(1,[],camera,390);assert.equal(fx.diagnostics().particles,0);
 fx.emit({type:'hit',targetId:0});assert.equal(fx.diagnostics().particles,0);assert.ok(fx.trauma>0);
 fx.reset();assert.equal(fx.trauma,0);
});


test('sniper hits retain shot weapon and source direction after actors move',()=>{
 const sim=new Simulation(5);sim.start();const p=sim.state.player,e=sim.state.actors[3];
 p.x=3;p.z=14;p.yaw=0;p.pitch=0;p.weapon='sniper';p.inventory.push('sniper');e.x=3;e.z=10;
 sim.state.actors.filter(a=>a!==p&&a!==e).forEach(a=>a.health=0);
 sim.events=[];sim.fire(p);const hit=sim.events.find(e=>e.type==='hit')!;
 assert.equal(hit.weapon,'sniper');assert.ok(hit.normalZ!<-.99);
 p.weapon='pistol';p.z=3;e.z=20;
 assert.equal(hit.weapon,'sniper');assert.ok(hit.normalZ!<-.99,'direction is an event snapshot');
});

test('sniper impact has a stronger bounded response and clears on reset',()=>{
 const gradient={addColorStop(){}};const ctx=new Proxy({createRadialGradient:()=>gradient},{get:(o:any,k)=>o[k]??(()=>{})});
 (globalThis as any).document={createElement:()=>({width:0,height:0,getContext:()=>ctx})};
 const fx=new CombatEffects();fx.emit({type:'hit',targetId:0,weapon:'rifle'});const ordinary=fx.trauma;fx.reset();
 fx.emit({type:'hit',targetId:0,weapon:'sniper'});assert.ok(fx.trauma>ordinary&&fx.trauma<=.6);
 fx.reset();assert.equal(fx.trauma,0);
 for(let i=0;i<50;i++)fx.emit({type:'hit',targetId:3,weapon:'sniper',normalZ:-1});
 assert.ok(fx.diagnostics().particles<=240);fx.update(1,[],new THREE.PerspectiveCamera(),390);assert.equal(fx.diagnostics().particles,0);
});


test('grenade hit uses blast origin and cannot inherit the thrower sniper feedback',()=>{
 const sim=new Simulation(5);sim.start();const p=sim.state.player,e=sim.state.actors[3];
 p.x=3;p.z=14;p.weapon='sniper';e.x=3;e.z=10;e.armor=0;
 sim.state.actors.filter(a=>a!==p&&a!==e).forEach(a=>a.health=0);
 sim.state.grenades.push({id:1,ownerId:p.id,x:3,y:.4,z:9,vx:0,vy:0,vz:0,fuse:0,bounces:0});
 sim.events=[];(sim as any).updateGrenades(1/60);const hit=sim.events.find(e=>e.type==='hit'&&e.targetId===3)!;
 assert.ok(hit);assert.equal(hit.weapon,undefined);assert.ok(hit.normalZ!>.99,'impulse must come from grenade in front, not its owner behind');
});
