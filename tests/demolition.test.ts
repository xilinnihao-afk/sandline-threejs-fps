import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulation} from '../src/game/simulation.ts';
import {EMPTY_INPUT} from '../src/game/types.ts';
import {LOADOUTS} from '../src/game/loadouts.ts';

test('round starts directly without a preparation or purchase phase',()=>{
  const sim=new Simulation(9);sim.start();const player=sim.state.player;
  assert.equal(sim.state.phase,'playing');assert.equal(player.money,800);
  assert.equal(sim.purchase('armor'),false);assert.equal(player.armor,0);
});

test('T can plant at A and CT can defuse before the fuse expires',()=>{
  const sim=new Simulation(10);sim.start();
  const t=sim.state.actors[3],ct=sim.state.actors[0];
  sim.state.player=t;t.player=true;ct.player=false;t.x=-10;t.z=-5;sim.state.phase='playing';sim.state.roundTime=80;
  sim.update(1/60,{...EMPTY_INPUT,interact:true});
  assert.equal(sim.state.bomb.status,'planted');assert.equal(sim.state.bomb.site,'A');assert.equal(sim.state.phase,'planted');
  sim.state.player=ct;ct.player=true;t.player=false;ct.x=-10;ct.z=-5;ct.defuseKit=true;
  for(let i=0;i<301;i++)sim.update(1/60,{...EMPTY_INPUT,interact:true});
  assert.equal(sim.state.bomb.status,'defused');
});

test('armor absorbs part of a hit without changing weapon rules',()=>{
  const sim=new Simulation(11);sim.start();sim.state.phase='playing';const p=sim.state.player,e=sim.state.actors[3];p.x=0;p.z=12;p.yaw=0;p.pitch=0;e.x=0;e.z=8;e.health=100;e.armor=100;p.guns.rifle.cooldown=0;
  sim.fire(p);assert.ok(e.health>0&&e.health<100);assert.ok(e.armor<100);assert.equal(LOADOUTS.rifle.magazine,30);
});
