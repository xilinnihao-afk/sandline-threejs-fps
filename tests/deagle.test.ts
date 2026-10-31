import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation,WEAPONS} from '../src/game/simulation';
import {setActiveMap} from '../src/game/map';
import {EMPTY_INPUT,WEAPON_KINDS,type Actor,type GameMode,type WeaponKind} from '../src/game/types';
import {RACE_LADDER,restrictedWeapon} from '../src/game/offlineModes';
import {RESPAWN_DELAY} from '../src/game/deathmatch';

const step=1/60;
function tick(sim:Simulation,seconds:number){for(let i=0;i<Math.ceil(seconds/step);i++)sim.update(step);}
/** A stationary firing range isolates weapon rules from AI navigation/return
 * fire. Shots, damage, armor, money, kills, reloads and respawns stay real. */
function range(mode:GameMode='deathmatch'){
 setActiveMap('desert');const sim=new Simulation(78);if(mode==='bounty')sim.setBotCounts(2,5);sim.start(mode);
 if(mode==='bounty'){sim.state.round=2;sim.resetRound();}
 (sim as unknown as {bot:()=>void}).bot=()=>{};
 return sim;
}
function lane(sim:Simulation,shooter:Actor,target:Actor,head=false){
 for(const other of sim.state.actors)if(other!==shooter&&other!==target){other.x=-15;other.z=18-other.id;}
 Object.assign(shooter,{x:head?3:3.15,z:14,y:0,groundY:0,yaw:0,pitch:head?0:Math.atan2(-.30,3.75),spread:0,crouched:false,moving:false,spawnProtectionUntil:0});
 Object.assign(target,{x:3,z:10,y:0,groundY:0,yaw:Math.PI,crouched:false,spawnProtectionUntil:0});
}
function buyForRange(sim:Simulation,kind:WeaponKind){
 sim.state.player.money=16000;assert.ok(sim.purchase(kind));tick(sim,1.1);return sim.state.player;
}
function shootWall(sim:Simulation){
 const p=sim.state.player;Object.assign(p,{x:0,z:17,yaw:Math.PI,pitch:0,spread:0});
 return sim.fire(p);
}
function shootTarget(sim:Simulation,shooter:Actor,target:Actor,head=false){
 lane(sim,shooter,target,head);assert.ok(sim.fire(shooter));
 return sim.events.filter(event=>event.type==='hit'&&event.targetId===target.id).at(-1);
}

test('Desert Eagle extends the catalog without moving existing keyboard slots or restricted loadouts',()=>{
 assert.deepEqual(WEAPON_KINDS.slice(0,7),['rifle','pistol','smg','shotgun','m4','sniper','knife']);
 assert.equal(WEAPON_KINDS[7],'deagle');assert.equal(WEAPONS.deagle.family,'pistol');
 assert.equal(WEAPONS.deagle.magazine,8);assert.equal(WEAPONS.sniper.magazine,10);
 assert.equal(restrictedWeapon('pistolOnly'),'pistol');assert.equal(restrictedWeapon('knifeOnly'),'knife');
 assert.deepEqual(RACE_LADDER,['rifle','m4','smg','shotgun','sniper','pistol','knife']);
});

test('Desert Eagle fires exactly eight rounds, waits for its cadence, then reloads before a ninth shot',()=>{
 const sim=range(),p=buyForRange(sim,'deagle'),gun=p.guns.deagle;
 for(let shot=0;shot<8;shot++){
  assert.ok(shootWall(sim));assert.equal(gun.ammo,7-shot);
  assert.equal(sim.fire(p),false,'cannot bypass the fire interval');
  tick(sim,WEAPONS.deagle.interval+.02);
 }
 assert.equal(sim.events.filter(e=>e.type==='shot'&&e.weapon==='deagle').length,8);
 assert.equal(shootWall(sim),false);assert.ok(gun.reloadLeft>0);assert.equal(gun.ammo,0);
 const rounds=gun.ammo+gun.reserve;
 tick(sim,WEAPONS.deagle.reload-.1);assert.equal(gun.ammo,0);assert.equal(sim.fire(p),false);
 tick(sim,.12);assert.equal(gun.ammo,8);assert.equal(gun.reserve,32);assert.equal(gun.ammo+gun.reserve,rounds);
 assert.ok(shootWall(sim));assert.equal(gun.ammo,7);
});

test('Desert Eagle partial reload conserves ammunition and switching cannot skip the reload',()=>{
 const sim=range(),p=buyForRange(sim,'deagle'),gun=p.guns.deagle;
 for(let shot=0;shot<3;shot++){assert.ok(shootWall(sim));tick(sim,WEAPONS.deagle.interval+.02);}
 assert.equal(gun.ammo,5);assert.equal(gun.reserve,40);assert.ok(sim.reload(p));
 sim.update(step,{...EMPTY_INPUT,switchWeapon:'pistol'});assert.equal(p.weapon,'deagle');
 tick(sim,WEAPONS.deagle.reload+.02);assert.equal(gun.ammo,8);assert.equal(gun.reserve,37);
 sim.update(step,{...EMPTY_INPUT,switchWeapon:'pistol'});assert.equal(p.weapon,'pistol');
 sim.update(step,{...EMPTY_INPUT,switchWeapon:'deagle'});assert.equal(p.weapon,'deagle');
 assert.deepEqual([gun.ammo,gun.reserve],[8,37]);
});

test('real Desert Eagle body hits deal more than twice USP damage and armor reduces both',()=>{
 const results:Record<string,{damage:number;armor:number}>={};
 for(const kind of ['pistol','deagle'] as const)for(const armored of [false,true]){
  const sim=range(),p=buyForRange(sim,kind),target=sim.state.actors.find(a=>a.team==='red')!;
  target.armor=armored?100:0;const hit=shootTarget(sim,p,target);
  assert.ok(hit);assert.equal(hit.weapon,kind);assert.equal(hit.headshot,false);assert.equal(hit.hitRegion,'chest');
  results[`${kind}/${armored}`]={damage:100-target.health,armor:target.armor};
 }
 assert.equal(results['pistol/false'].damage,24);assert.equal(results['deagle/false'].damage,62);
 assert.ok(results['deagle/false'].damage>results['pistol/false'].damage*2.5);
 assert.deepEqual(results['deagle/true'],{damage:40,armor:78});
 assert.deepEqual(results['pistol/true'],{damage:15,armor:91});
 assert.ok(results['deagle/true'].damage>results['pistol/true'].damage*2.5);
});

test('a real Desert Eagle headshot kills a full-health target while a USP headshot does not',()=>{
 for(const kind of ['pistol','deagle'] as const){
  const sim=range(),p=buyForRange(sim,kind),target=sim.state.actors.find(a=>a.team==='red')!;
  const hit=shootTarget(sim,p,target,true);assert.ok(hit);assert.equal(hit.headshot,true);
  assert.equal(target.health,kind==='deagle'?0:34);assert.equal(p.kills,kind==='deagle'?1:0);
 }
 const sim=range(),p=buyForRange(sim,'deagle'),target=sim.state.actors.find(a=>a.team==='red')!;
 target.armor=100;assert.ok(shootTarget(sim,p,target,true));
 assert.equal(target.health,0);assert.equal(target.armor,45,'155 damage spends 55 armor before the lethal 100 health damage');
 assert.equal(p.kills,1);assert.equal(target.deaths,1);
});

test('bounty income from a real USP kill buys Desert Eagle; failed purchases and rebuy obey money and ammo rules',()=>{
 const sim=range('bounty'),p=sim.state.player,first=sim.state.actors.find(a=>a.team==='red')!;
 assert.equal(p.money,800);assert.equal(sim.purchase('deagle'),false);assert.equal(p.money,800);
 assert.equal(p.inventory.includes('deagle'),false);
 while(first.health>0){shootTarget(sim,p,first);tick(sim,WEAPONS.pistol.interval+.02);}
 assert.equal(p.kills,1);assert.equal(p.money,1400);assert.ok(sim.purchase('deagle'));tick(sim,1.1);
 assert.equal(p.money,200);assert.equal(p.weapon,'deagle');assert.deepEqual([p.guns.deagle.ammo,p.guns.deagle.reserve],[8,40]);
 const before=JSON.stringify(p);assert.equal(sim.purchase('deagle'),false);assert.equal(JSON.stringify(p),before);
 for(const target of sim.state.actors.filter(a=>a.team==='red').slice(1,3)){
  for(let shot=0;shot<2;shot++){shootTarget(sim,p,target);tick(sim,WEAPONS.deagle.interval+.02);}
  assert.equal(target.health,0);
 }
 assert.equal(p.kills,3);assert.equal(p.money,1400);assert.equal(p.guns.deagle.ammo,4);
 assert.ok(sim.reload(p));tick(sim,WEAPONS.deagle.reload+.02);assert.equal(p.guns.deagle.reserve,36);
 assert.ok(sim.purchase('deagle'));assert.equal(p.money,200);assert.deepEqual([p.guns.deagle.ammo,p.guns.deagle.reserve],[8,40]);
 assert.equal(p.inventory.filter(k=>k==='deagle').length,1);
 sim.update(step,{...EMPTY_INPUT,switchWeapon:'pistol'});assert.equal(p.weapon,'pistol');
 sim.update(step,{...EMPTY_INPUT,switchWeapon:'deagle'});assert.equal(p.weapon,'deagle');
 assert.equal(sim.state.totalKills,3);assert.equal(sim.state.phase,'playing');
});

test('defense permits Desert Eagle between waves and refuses purchases during combat',()=>{
 const sim=range('defense'),p=sim.state.player;assert.equal(sim.state.phase,'intermission');
 assert.equal(p.money,2000);assert.ok(sim.purchase('deagle'));assert.equal(p.money,800);assert.equal(p.weapon,'deagle');
 assert.ok(sim.startDefenseWave());const before=JSON.stringify(p);
 assert.equal(sim.purchase('pistol'),false);assert.equal(JSON.stringify(p),before);
});

test('AWP buying, ten actual shots, timed reload and rebuy use the ten-round magazine',()=>{
 const sim=range('bounty'),p=buyForRange(sim,'sniper'),gun=p.guns.sniper;
 assert.deepEqual([gun.ammo,gun.reserve],[10,25]);
 for(let shot=0;shot<10;shot++){assert.ok(shootWall(sim));tick(sim,WEAPONS.sniper.interval+.02);assert.equal(gun.ammo,9-shot);}
 assert.equal(shootWall(sim),false);assert.equal(sim.events.filter(e=>e.type==='shot'&&e.weapon==='sniper').length,10);
 assert.ok(gun.reloadLeft>0);tick(sim,WEAPONS.sniper.reload+.02);
 assert.deepEqual([gun.ammo,gun.reserve],[10,15]);assert.ok(shootWall(sim));
 assert.ok(sim.purchase('sniper'));assert.deepEqual([gun.ammo,gun.reserve],[10,25]);
 assert.equal(p.inventory.filter(k=>k==='sniper').length,1);
});

test('an actual death and timed respawn restore owned AWP and Desert Eagle magazines to ten and eight',()=>{
 const sim=range(),p=buyForRange(sim,'sniper');assert.ok(sim.purchase('deagle'));tick(sim,1.1);
 assert.ok(shootWall(sim));tick(sim,WEAPONS.deagle.interval+.02);
 sim.update(step,{...EMPTY_INPUT,switchWeapon:'sniper'});tick(sim,1.1);assert.ok(shootWall(sim));
 const enemy=sim.state.actors.find(a=>a.team==='red')!;
 while(p.health>0){shootTarget(sim,enemy,p,true);tick(sim,WEAPONS[enemy.weapon].interval+.02);}
 assert.equal(p.deaths,1);assert.equal(p.health,0);assert.equal(p.guns.sniper.ammo,9);assert.equal(p.guns.deagle.ammo,7);
 tick(sim,RESPAWN_DELAY+.05);assert.equal(p.health,100);assert.equal(p.weapon,'sniper');
 assert.deepEqual([p.guns.sniper.ammo,p.guns.sniper.reserve],[10,25]);
 assert.deepEqual([p.guns.deagle.ammo,p.guns.deagle.reserve],[8,40]);
 assert.ok(p.inventory.includes('deagle'));assert.ok(p.inventory.includes('sniper'));
 assert.equal(sim.events.filter(event=>event.type==='respawn'&&event.actorId===p.id).length,1);
});
