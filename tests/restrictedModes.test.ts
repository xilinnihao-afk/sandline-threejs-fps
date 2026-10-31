import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Simulation,WEAPONS} from '../src/game/simulation';
import {EMPTY_INPUT,WEAPON_KINDS,type WeaponKind} from '../src/game/types';
import {parseMode,restrictedWeapon} from '../src/game/offlineModes';
import {purchaseWindow} from '../src/game/economy';
import {nearestPickup,takePickup} from '../src/game/pickups';
import {setActiveMap} from '../src/game/map';
import {Dust2Collision} from '../src/game/dust2Collision';
import {installDust2Geometry} from '../src/game/dust2';
import {AssaultCollision} from '../src/game/assaultCollision';
import {installAssaultGeometry} from '../src/game/assault';
const assaultBytes=readFileSync('public/assets/maps/assault/cs_assault.bsp');
const assault=new AssaultCollision(assaultBytes.buffer.slice(assaultBytes.byteOffset,assaultBytes.byteOffset+assaultBytes.byteLength));
assault.navigation=JSON.parse(readFileSync('public/assets/maps/assault/navigation.json','utf8'));installAssaultGeometry(assault);


const bytes=readFileSync('public/assets/maps/dust2/de_dust2.bsp');
const geometry=new Dust2Collision(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
geometry.navigation=JSON.parse(readFileSync('public/assets/maps/dust2/navigation.json','utf8'));installDust2Geometry(geometry);
const modes=['knifeOnly','pistolOnly'] as const;
function tick(sim:Simulation,seconds:number){for(let i=0;i<Math.ceil(seconds*60);i++)sim.update(1/60);}
function isolate(sim:Simulation){for(const a of sim.state.actors.slice(1)){a.health=0;a.respawnAt=Infinity;}}
for(const mode of modes){
 const kind=restrictedWeapon(mode)!;
 test(`${mode}: selection, roster/map refresh and restart keep the fixed loadout`,()=>{
  setActiveMap('desert');const sim=new Simulation(42);assert.equal(parseMode(mode),mode);assert.ok(sim.selectMode(mode));
  sim.setBotCounts(4,5);setActiveMap('snow');sim.refreshMap();
  for(const action of [()=>{},()=>sim.start(),()=>sim.start(),()=>sim.menu()]){
   action();assert.equal(sim.state.mode,mode);assert.equal(sim.state.pickups.length,0);assert.equal(sim.state.actors.length,10);
   for(const a of sim.state.actors){assert.equal(a.weapon,kind);assert.deepEqual(a.inventory,[kind]);assert.equal(a.grenades,0);}
  }
  sim.selectMode('deathmatch');sim.start();assert.equal(sim.state.player.weapon,'rifle');assert.ok(sim.state.player.inventory.includes('knife'));assert.equal(sim.state.player.grenades,1);assert.ok(sim.state.pickups.length>0);
  setActiveMap('desert');
 });
 test(`${mode}: input, direct firing, purchases, pickups and grenades cannot bypass restrictions`,()=>{
  setActiveMap('desert');const sim=new Simulation(42);sim.start(mode);isolate(sim);const p=sim.state.player;p.money=16000;
  for(const weapon of WEAPON_KINDS){sim.update(1/60,{...EMPTY_INPUT,switchWeapon:weapon});assert.equal(p.weapon,kind);assert.equal(sim.purchase(weapon),false);}
  for(const item of ['he','armor','defuseKit'] as const)assert.equal(sim.purchase(item),false);
  assert.equal(purchaseWindow(sim.state).allowed,false);
  const pickup={id:99,weapon:'rifle' as const,x:p.x,z:p.z,y:p.y,ammo:30,reserve:90};sim.state.pickups.push(pickup);
  assert.equal(nearestPickup(sim.state),null);assert.equal(takePickup(sim.state,p,pickup,sim.events),false);assert.equal(sim.pickupWeapon(),false);sim.state.pickups=[];
  p.grenades=2;assert.equal(sim.throwGrenade(p),false);assert.equal(sim.state.grenades.length,0);p.grenades=0;
  const forbidden:WeaponKind=kind==='knife'?'pistol':'knife';p.inventory.push(forbidden);p.weapon=forbidden;
  assert.equal(sim.fire(p),false);assert.equal(sim.reload(p),false);
  p.weapon=kind;p.inventory=[kind];tick(sim,21);assert.deepEqual(sim.state.pickups,[]);
 });
 test(`${mode}: actual kill updates team scores, drops nothing, pauses and respawns with only its weapon`,()=>{
  setActiveMap('desert');const sim=new Simulation(42);sim.start(mode);isolate(sim);const s=sim.state,p=s.player,v=s.actors.find(a=>a.team==='red')!;
  Object.assign(p,{x:0,z:16,y:0,groundY:0,yaw:0,pitch:0,spawnProtectionUntil:0});
  Object.assign(v,{x:0,z:14.8,y:0,groundY:0,health:1,spawnProtectionUntil:0});v.guns[kind].cooldown=999;
  assert.ok(sim.fire(p));if(kind==='knife')tick(sim,.2);
  assert.equal(v.health,0);assert.equal(p.kills,1);assert.equal(s.blueScore,1);assert.equal(s.pickups.length,0);
  sim.setPaused(true);const time=s.time;tick(sim,4);assert.equal(s.time,time);assert.equal(v.health,0);
  sim.setPaused(false);tick(sim,3.05);assert.equal(v.health,100);assert.equal(v.weapon,kind);assert.deepEqual(v.inventory,[kind]);assert.equal(v.grenades,0);assert.equal(v.deaths,1);assert.equal(s.phase,'playing');assert.ok(v.spawnProtectionUntil!>s.time);
 });
}
test('pistol-only empty magazines require a timed reload and reserve never forces player or bot to a knife',()=>{
 setActiveMap('desert');const sim=new Simulation(42);sim.start('pistolOnly');isolate(sim);const p=sim.state.player;
 for(let cycle=0;cycle<12;cycle++){
  p.guns.pistol.ammo=0;if(cycle===0)p.guns.pistol.reserve=0;
  assert.equal(sim.fire(p),false);assert.ok(p.guns.pistol.reloadLeft>0);assert.equal(p.guns.pistol.ammo,0);
  tick(sim,WEAPONS.pistol.reload+.05);assert.equal(p.guns.pistol.ammo,WEAPONS.pistol.magazine);assert.equal(p.guns.pistol.reserve,WEAPONS.pistol.reserve);assert.equal(p.weapon,'pistol');
 }
 const bot=sim.state.actors[1];bot.health=100;bot.guns.pistol.ammo=bot.guns.pistol.reserve=0;sim.update(1/60);
 assert.equal(bot.weapon,'pistol');assert.ok(bot.guns.pistol.reloadLeft>0);
});
test('knife-only bot closes the old out-of-range gap and lands stab plus finishing slash',()=>{
 setActiveMap('desert');const sim=new Simulation(42);sim.start('knifeOnly');isolate(sim);const p=sim.state.player,bot=sim.state.actors.find(a=>a.team==='red')!;
 Object.assign(p,{x:0,z:14.15,y:0,groundY:0,health:100,spawnProtectionUntil:0});
 Object.assign(bot,{x:0,z:16,y:0,groundY:0,yaw:0,pitch:0,health:100,spawnProtectionUntil:0});
 const attacks=new Set<string>();let closest=Infinity;
 for(let i=0;i<300&&p.health>0;i++){sim.update(1/60);closest=Math.min(closest,Math.hypot(bot.x-p.x,bot.z-p.z));for(const e of sim.events)if(e.type==='melee'&&e.actorId===bot.id)attacks.add(e.meleeAttack!);sim.events=[];}
 assert.ok(closest<1.5);assert.equal(p.health,0);assert.deepEqual([...attacks].sort(),['slash','stab']);assert.equal(sim.state.redScore,1);
});
for(const map of ['desert','snow','dust2','assault'] as const)for(const mode of modes)test(`${map}/${mode}: sustained bot combat respects weapons, respawns and an empty ground`,()=>{
 try{
  setActiveMap(map);const sim=new Simulation(42);sim.start(mode);const kind=restrictedWeapon(mode)!;let respawns=0,hits=0;
  for(let frame=0;frame<90*60;frame++){
   sim.update(1/60,EMPTY_INPUT,true);
   for(const event of sim.events){if(event.type==='respawn')respawns++;if(event.type==='hit')hits++;if(event.type==='shot'||event.type==='melee')assert.equal(event.weapon,kind);assert.notEqual(event.type,'grenadeThrow');}
   sim.events=[];
   if(frame%60===0){for(const a of sim.state.actors){assert.equal(a.weapon,kind);assert.deepEqual(a.inventory,[kind]);assert.equal(a.grenades,0);}assert.equal(sim.state.pickups.length,0);}
  }
  const s=sim.state;console.log('FIXED_WEAPON_COMBAT',JSON.stringify({map,mode,score:[s.blueScore,s.redScore],respawns,hits}));
  assert.equal(s.phase,'playing');assert.ok(s.roundTime>89);assert.ok(s.blueScore>0&&s.redScore>0,'both teams must fight');assert.ok(respawns>=4&&hits>=10,'sustained fights and respawns');assert.equal(s.pickups.length,0);
 }finally{setActiveMap('desert');}
});
