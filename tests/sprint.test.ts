import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation} from '../src/game/simulation';
import {EMPTY_INPUT,type PlayerInput} from '../src/game/types';
import {setActiveMap} from '../src/game/map';
import {RUN_SPEED,WALK_SPEED,CROUCH_SPEED} from '../src/game/playerMovement';

function fixture(){setActiveMap('desert');const sim=new Simulation(42);sim.start();const p=sim.state.player;sim.state.actors.forEach((a,i)=>{a.player=true;a.x=-15;a.z=18-i;});Object.assign(p,{x:3,z:18,y:0,groundY:0,yaw:0});return {sim,p};}
function travel(input:Partial<PlayerInput>,hz=60){const {sim,p}=fixture();for(let i=0;i<hz;i++)sim.update(1/hz,{...EMPTY_INPUT,moveZ:1,...input});return {sim,p,distance:Math.hypot(p.x-3,p.z-18)};}
test('forward run accelerates beyond walking with the same diagonal speed cap at 30/60/120 Hz',()=>{
 const walk=travel({});assert.ok(Math.abs(walk.distance-WALK_SPEED)<.001);
 for(const hz of [30,60,120]){const run=travel({sprint:true},hz),diagonal=travel({sprint:true,moveX:1},hz);assert.ok(run.distance>walk.distance*1.35);assert.ok(run.distance<RUN_SPEED);assert.ok(Math.abs(diagonal.distance-run.distance)<.001);assert.equal(run.p.sprinting,true);}
});
test('aiming, shooting, reloading, crouching and backward travel retain normal control while run is requested',()=>{
 for(const extra of [{aiming:true},{fire:true},{secondaryFire:true},{reload:true},{grenade:true},{moveZ:-1}]){const run=travel({sprint:true,...extra});assert.equal(run.p.sprinting,false);assert.ok(run.p.moveSpeed!<=WALK_SPEED);}
 const crouch=travel({sprint:true,crouch:true});assert.ok(Math.abs(crouch.distance-CROUCH_SPEED)<.001);assert.equal(crouch.p.sprinting,false);
 const {sim,p}=travel({sprint:true});const ammo=p.guns.rifle.ammo;sim.update(1/60,{...EMPTY_INPUT,moveZ:1,sprint:true,fire:true});assert.equal(p.guns.rifle.ammo,ammo-1);assert.equal(p.sprinting,false);assert.equal(p.moveSpeed,WALK_SPEED);
});
test('run produces faster real footfalls, pause freezes travel, releasing run and respawn clear speed',()=>{
 const walk=travel({}),run=travel({sprint:true});assert.ok(run.sim.events.filter(e=>e.type==='step'&&e.actorId===0).length>walk.sim.events.filter(e=>e.type==='step'&&e.actorId===0).length);
 const {sim,p}=run;sim.setPaused(true);const before=JSON.stringify(p);sim.update(.2,{...EMPTY_INPUT,sprint:true,moveZ:1});assert.equal(JSON.stringify(p),before);
 sim.setPaused(false);sim.update(1/60,EMPTY_INPUT);assert.equal(p.sprinting,false);assert.equal(p.moveSpeed,WALK_SPEED);
 p.health=0;p.respawnAt=sim.state.time+.01;sim.update(1/60);assert.equal(p.health,100);assert.equal(p.sprinting,false);assert.equal(p.moveSpeed,WALK_SPEED);
});
