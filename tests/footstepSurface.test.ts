import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation} from '../src/game/simulation';
import {setActiveMap} from '../src/game/map';
import {EMPTY_INPUT,type GameEvent} from '../src/game/types';

test('player and bot footsteps carry the current map surface, including after a map switch',()=>{
 try{for(const id of ['snow','desert','snow'] as const){
  setActiveMap(id);const sim=new Simulation(42);sim.start('deathmatch');const steps:GameEvent[]=[];
  for(let i=0;i<90;i++){sim.update(1/60,{...EMPTY_INPUT,moveX:1});steps.push(...sim.events.filter(e=>e.type==='step'));sim.events=[];}
  assert(steps.some(e=>e.actorId===0));assert(steps.some(e=>e.actorId!==0));
  assert(steps.every(e=>e.stepSurface===(id==='snow'?'snow':'ground')));
 }}finally{setActiveMap('desert');}
});
test('landing on snow emits a snow contact while airborne travel emits no player steps',()=>{
 try{setActiveMap('snow');const sim=new Simulation(8);sim.start('deathmatch');sim.state.actors.slice(1).forEach(a=>a.health=0);let landed=false;
  for(let i=0;i<65;i++){sim.events=[];sim.update(1/60,{...EMPTY_INPUT,jump:i===0});const steps=sim.events.filter(e=>e.type==='step'&&e.actorId===0);
   if((sim.state.player.y??0)>.001)assert.equal(steps.length,0);
   if(steps.length){assert(steps.every(e=>e.stepSurface==='snow'));landed=true;}
  }assert(landed);
 }finally{setActiveMap('desert');}
});
