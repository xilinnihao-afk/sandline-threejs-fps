import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulation,WEAPONS} from '../src/game/simulation.ts';
import {WEAPON_KINDS,EMPTY_INPUT,type Grenade} from '../src/game/types.ts';
import {buy} from '../src/game/economy';
import {advanceGrenade} from '../src/game/grenades.ts';
const ready=()=>{const sim=new Simulation(71);sim.start();sim.state.phase='playing';sim.state.actors.forEach(a=>{a.guns[a.weapon].cooldown=999;a.grenades=0;});return sim;};

test('available weapons consume one round per discharge and respect cooldown and reserve',()=>{
 for(const kind of WEAPON_KINDS){const sim=ready(),p=sim.state.player;p.weapon=kind;p.guns[kind].cooldown=0;
  assert.ok(sim.fire(p));assert.equal(p.guns[kind].ammo,WEAPONS[kind].magazine-1);assert.equal(sim.fire(p),false);
  assert.equal(sim.events.filter(e=>e.type==='shot').length,1,'one discharge emits one sound');assert.ok(sim.reload(p));assert.equal(sim.fire(p),false);
  const total=p.guns[kind].ammo+p.guns[kind].reserve;sim.state.actors.forEach(a=>a.guns[a.weapon].cooldown=999);
  for(let i=0;i<Math.ceil((WEAPONS[kind].reload+.1)*60);i++)sim.update(1/60);
  assert.equal(p.guns[kind].ammo,WEAPONS[kind].magazine);assert.equal(p.guns[kind].ammo+p.guns[kind].reserve,total);
 }
});
test('shot events expose sampled tracer and typed impact feedback',()=>{
 const sim=ready(),p=sim.state.player;p.x=0;p.z=12;p.yaw=0;p.pitch=0;p.weapon='rifle';p.guns.rifle.cooldown=0;
 sim.fire(p);const shot=sim.events.find(e=>e.type==='shot');assert.ok(shot);assert.equal(typeof shot!.tracer,'boolean');assert.equal(shot!.pelletCount,1);
 const impact=sim.events.find(e=>e.type==='impact');if(impact)assert.ok(['wall','crate','metal'].includes(impact.surface!));
});
test('only AK and pistol can be selected or purchased; bots reset with AK',()=>{
 assert.deepEqual(WEAPON_KINDS,['rifle','pistol']);
 const sim=ready(),p=sim.state.player;p.money=16000;
 assert.ok(sim.state.actors.every(a=>a.weapon==='rifle'));
 for(const kind of ['smg','shotgun'] as const){
  sim.update(1/60,{...EMPTY_INPUT,switchWeapon:kind});assert.equal(p.weapon,'rifle');
  const money=p.money;assert.equal(buy(p,kind),false);assert.equal(p.money,money);
  p.weapon=kind;p.guns[kind].cooldown=0;assert.equal(sim.fire(p),false);p.weapon='rifle';
 }
 sim.update(1/60,{...EMPTY_INPUT,switchWeapon:'pistol'});assert.equal(p.weapon,'pistol');
 sim.update(1/60,{...EMPTY_INPUT,switchWeapon:'rifle'});assert.equal(p.weapon,'rifle');
});
test('one grenade per round, throwing locks fire briefly, restart clears projectiles',()=>{
 const sim=ready(),p=sim.state.player;p.grenades=1;p.guns.rifle.cooldown=0;assert.ok(sim.throwGrenade(p));assert.equal(p.grenades,0);assert.equal(sim.throwGrenade(p),false);assert.equal(sim.fire(p),false);assert.equal(sim.state.grenades.length,1);
 const before=JSON.stringify(sim.state.grenades);sim.setPaused(true);sim.update(.5,{...EMPTY_INPUT,grenade:true});assert.equal(JSON.stringify(sim.state.grenades),before);
 sim.start();assert.equal(sim.state.grenades.length,0);assert.equal(sim.state.player.grenades,1);
});
test('grenades bounce off cover and ground without tunnelling',()=>{
 const g:Grenade={id:1,ownerId:0,x:0,y:1,z:8,vx:0,vy:0,vz:-20,fuse:2,bounces:0};advanceGrenade(g,.1);
 assert.ok(g.z>6.38);assert.ok(g.vz>0);assert.ok(g.bounces>0);
 for(let i=0;i<180;i++)advanceGrenade(g,1/60);assert.ok(g.y>=.079);assert.ok(Math.abs(g.z)<19.5);
});
test('explosions damage exposed enemies, cover protects and teammates take no damage',()=>{
 const sim=ready(),p=sim.state.player,covered=sim.state.actors[3],exposed=sim.state.actors[4],ally=sim.state.actors[1];
 p.x=0;p.z=12;covered.x=0;covered.z=7;exposed.x=3;exposed.z=3.3;ally.x=3;ally.z=2.5;
 sim.state.grenades=[{id:1,ownerId:0,x:0,y:.1,z:3.3,vx:0,vy:0,vz:0,fuse:0,bounces:0}];sim.update(1/60);
 assert.equal(covered.health,100);assert.equal(ally.health,100);assert.ok(exposed.health<100);assert.equal(sim.state.grenades.length,0);assert.equal(sim.events.filter(e=>e.type==='explosion').length,1);
});
test('own grenade can kill the player without awarding a self kill',()=>{
 const sim=ready(),p=sim.state.player;p.x=3;p.z=13;sim.state.grenades=[{id:1,ownerId:0,x:p.x,y:.2,z:p.z,vx:0,vy:0,vz:0,fuse:0,bounces:0}];sim.update(1/60);
 assert.equal(p.health,0);assert.equal(sim.state.totalDeaths,1);assert.equal(sim.state.totalKills,0);assert.equal(p.kills,0);
});
