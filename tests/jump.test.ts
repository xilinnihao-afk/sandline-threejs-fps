import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation,eyeHeight} from '../src/game/simulation';
import {EMPTY_INPUT} from '../src/game/types';
import {advanceJump} from '../src/game/jump';

function ready(){const sim=new Simulation(42);sim.start();sim.state.actors.slice(1).forEach(a=>a.health=0);return sim;}
test('jump follows gravity at 30/60/120 Hz, rejects air jumps, and lands exactly',()=>{
 for(const hz of [30,60,120]){
  const p=ready().state.player;let peak=0,landings=0;
  for(let i=0;i<hz;i++){
   const result=advanceJump(p,1/hz,i===0||i===Math.round(hz*.2));
   if(i===Math.round(hz*.2))assert.equal(result.tookOff,false);
   peak=Math.max(peak,p.y??0);if(result.landed)landings++;
  }
  assert.ok(peak>.74&&peak<.76);assert.equal(p.y,0);assert.equal(p.verticalSpeed,0);assert.equal(landings,1);
 }
});
test('jump moves the eye and bullet origin, pauses, clears on restart, and cannot start dead',()=>{
 const sim=ready(),p=sim.state.player;
 sim.update(1/60,{...EMPTY_INPUT,jump:true});assert.ok(p.y!>0);assert.equal(eyeHeight(p),1.62+p.y!);
 sim.events=[];sim.fire(p);assert.equal(sim.events.find(e=>e.type==='shot')?.y,eyeHeight(p));
 sim.setPaused(true);const y=p.y;sim.update(.2,{...EMPTY_INPUT,jump:true});assert.equal(p.y,y);
 sim.start();assert.equal(sim.state.player.y??0,0);sim.state.player.health=0;
 sim.update(1/60,{...EMPTY_INPUT,jump:true});assert.equal(sim.state.player.y??0,0);
});
test('airborne targets move their hitboxes above a low shot and remain hittable at their actual height',()=>{
 const sim=new Simulation(1);sim.start('elimination');const p=sim.state.player,e=sim.state.actors[3];
 sim.state.actors.filter(a=>a!==p&&a!==e).forEach(a=>a.health=0);
 Object.assign(p,{x:3.12,z:14,yaw:0,pitch:Math.atan2(.3-1.62,4)});Object.assign(e,{x:3,z:10,y:0,yaw:0});
 sim.fire(p);assert.equal(e.health,82);assert.equal(sim.events.find(event=>event.type==='hit')?.hitRegion,'leg');
 e.health=100;e.y=.75;p.guns.rifle.cooldown=0;p.spread=0;p.pitch=Math.atan2(.3-1.62,4);sim.events=[];
 sim.fire(p);assert.equal(e.health,100);assert.equal(sim.events.some(event=>event.type==='hit'),false);
 p.guns.rifle.cooldown=0;p.spread=0;p.x=3.15;p.pitch=Math.atan2(2.08-1.62,4);sim.fire(p);assert.equal(e.health,73);
 assert.equal(sim.events.find(event=>event.type==='hit')?.hitRegion,'chest');
});
