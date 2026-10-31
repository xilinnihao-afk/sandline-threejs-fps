import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {Simulation} from '../src/game/simulation.ts';
import {EMPTY_INPUT} from '../src/game/types.ts';
import {LOADOUTS} from '../src/game/loadouts.ts';
import {setActiveMap} from '../src/game/map.ts';

beforeEach(()=>setActiveMap('desert'));

test('round starts directly without preparation and allows spawn purchases',()=>{
  const sim=new Simulation(9);sim.start('demolition');const player=sim.state.player;
  assert.equal(sim.state.phase,'playing');assert.equal(player.money,800);
  assert.equal(sim.purchase('armor'),true);assert.equal(player.armor,100);assert.equal(player.money,150);
});

test('T can plant at A and CT can defuse before the fuse expires',()=>{
  const sim=new Simulation(10);sim.start('demolition');
  const t=sim.state.actors[3],ct=sim.state.actors[0];
  // Isolate the objective controls from combat while keeping both teams alive.
  for(const actor of sim.state.actors)actor.player=true;
  sim.state.player=t;t.x=-10;t.z=-7.2;sim.state.roundTime=80;
  for(let i=0;i<179;i++)sim.update(1/60,{...EMPTY_INPUT,interact:true});
  assert.equal(sim.state.bomb.status,'carried');assert.ok(sim.state.bomb.plantProgress!>.99);
  sim.update(1/60,{...EMPTY_INPUT,interact:true});
  assert.equal(sim.state.bomb.status,'planted');assert.equal(sim.state.bomb.site,'A');assert.equal(sim.state.phase,'planted');
  sim.state.player=ct;ct.x=-10;ct.z=-8.2;ct.defuseKit=true;
  for(let i=0;i<299;i++)sim.update(1/60,{...EMPTY_INPUT,interact:true});
  assert.equal(sim.state.bomb.status,'planted');
  sim.update(1/60,{...EMPTY_INPUT,interact:true});
  assert.equal(sim.state.bomb.status,'defused');
  assert.equal(sim.state.winner,'blue');assert.match(sim.state.roundReason!,/拆除/);
});

test('armor absorbs part of a hit without changing weapon rules',()=>{
  const sim=new Simulation(11);sim.start('demolition');sim.state.phase='playing';const p=sim.state.player,e=sim.state.actors[3];p.x=0;p.z=12;p.yaw=0;p.pitch=0;e.x=0;e.z=8;e.health=100;e.armor=100;p.guns.rifle.cooldown=0;
  sim.fire(p);assert.ok(e.health>0&&e.health<100);assert.ok(e.armor<100);assert.equal(LOADOUTS.rifle.magazine,30);
});
