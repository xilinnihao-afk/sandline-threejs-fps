import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation} from '../src/game/simulation';
import {blocked} from '../src/game/collision';
import {botObjective} from '../src/game/botTactics';

test('kills settle money once, with floor and cap, and persist only across rounds',()=>{
 const sim=new Simulation();sim.start('demolition');const p=sim.state.player,e=sim.state.actors[3];
 (sim as any).damage(p,e,1000);assert.equal(p.money,1100);assert.equal(e.money,600);
 (sim as any).damage(p,e,1000);assert.equal(p.money,1100);
 p.money=15900;const next=sim.state.actors[4];next.money=50;
 (sim as any).damage(p,next,1000);assert.equal(p.money,16000);assert.equal(next.money,0);
 (sim as any).damage(p,p,1000);assert.equal(p.money,15800);
 sim.state.round=2;sim.resetRound();assert.equal(sim.state.player.money,15800);
 sim.start('demolition');assert.equal(sim.state.player.money,800);
});

test('grenades have a carry limit, round purchase limit and reset',()=>{
 const sim=new Simulation();sim.start('demolition');const p=sim.state.player;p.money=5000;
 assert.equal(sim.purchase('he'),true);assert.equal(p.grenades,2);assert.equal(p.money,4700);
 assert.equal(sim.purchase('he'),false);assert.equal(sim.throwGrenade(p),true);
 assert.equal(sim.purchase('he'),true);assert.equal(p.money,4400);
 sim.throwGrenade(p);assert.equal(sim.purchase('he'),false);
 sim.state.round=2;sim.resetRound();assert.equal(sim.state.player.grenadePurchases,0);
 assert.equal(sim.purchase('he'),true);
});

test('purchases require money, living player, spawn, buy time and active round',()=>{
 const sim=new Simulation();sim.start('demolition');const p=sim.state.player;
 p.money=299;assert.equal(sim.purchase('he'),false);p.money=800;
 p.z=0;assert.equal(sim.purchase('he'),false);p.z=18;
 sim.state.time=20.01;assert.equal(sim.purchase('he'),false);sim.state.time=0;
 p.health=0;assert.equal(sim.purchase('he'),false);p.health=100;
 sim.state.phase='roundEnd';assert.equal(sim.purchase('he'),false);
});

test('menu rosters support 1v1 through 10v10 with valid spawns and stable ids',()=>{
 const sim=new Simulation();
 for(const [allies,enemies] of [[0,1],[4,5],[7,8],[9,10]]){
  assert.equal(sim.setBotCounts(allies,enemies),true);
  const actors=sim.state.actors;assert.equal(actors.length,allies+enemies+1);
  actors.forEach((a,i)=>{assert.equal(a.id,i);assert.equal(blocked(a.x,a.z,.4),false);
   actors.slice(i+1).forEach(b=>assert.ok(Math.hypot(a.x-b.x,a.z-b.z)>.8));});
 }
 const roster=sim.state.actors;
 for(const [a,e] of [[-1,2],[10,2],[1,0],[1,11],[1.5,2],[NaN,2],[2,Infinity]])assert.equal(sim.setBotCounts(a,e),false);
 assert.equal(sim.state.actors,roster);
 sim.start('demolition');assert.equal(sim.setBotCounts(0,1),false);assert.equal(sim.state.actors.length,20);
 assert.equal(sim.state.actors.filter(a=>a.hasBomb).length,1);
 sim.start('demolition');assert.equal(sim.state.actors.length,20);
});

test('T escorts use distinct positions around their living bomb carrier',()=>{
 const sim=new Simulation();sim.setBotCounts(4,5);sim.start('demolition');const s=sim.state;
 const carrier=s.actors.find(a=>a.hasBomb)!;
 const escorts=s.actors.filter(a=>a.team===carrier.team&&a!==carrier);
 const points=escorts.map(a=>botObjective(a,s).point);
 assert.equal(new Set(points.map(p=>`${p.x},${p.z}`)).size,4);
 carrier.x+=2;assert.equal(botObjective(escorts[0],s).point.x,points[0].x+2);
});
