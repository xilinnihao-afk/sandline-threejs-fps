import {advanceWeaponSwitch,resetWeaponSwitch} from '../src/game/weaponSwitch';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Simulation} from '../src/game/simulation';
import {EMPTY_INPUT} from '../src/game/types';
import {LOADOUTS} from '../src/game/loadouts';
import {RACE_LADDER,parseMode,defenseWave} from '../src/game/offlineModes';
import {setActiveMap,type MapId} from '../src/game/map';
import {purchaseWindow} from '../src/game/economy';
import {blocked} from '../src/game/collision';
import {botObjective} from '../src/game/botTactics';
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
function tick(sim:Simulation,seconds:number,allBots=false){for(let i=0;i<Math.ceil(seconds*60);i++){sim.update(1/60,EMPTY_INPUT,allBots);sim.events=[];}}
function race(){setActiveMap('desert');const sim=new Simulation(42);sim.start('armsRace');for(const a of sim.state.actors){a.health=0;a.respawnAt=Infinity;}return sim;}
/** Actual hitscan / delayed melee contact; never edits scores or stage counters. */
function kill(sim:Simulation,killerId:number,victimId:number){
 const a=sim.state.actors[killerId],v=sim.state.actors[victimId],before=a.kills;
 Object.assign(a,{x:0,z:16,y:0,groundY:0,yaw:0,pitch:0,health:100,spread:0,crouched:false,spawnProtectionUntil:0});
 Object.assign(v,{x:0,z:14.8,y:0,groundY:0,yaw:Math.PI,pitch:0,health:1,armor:0,crouched:false,spawnProtectionUntil:0});
 a.guns[a.weapon].cooldown=0;a.guns[a.weapon].reloadLeft=0;a.guns[a.weapon].ammo=LOADOUTS[a.weapon].magazine;
 advanceWeaponSwitch(a,1.1);assert.ok(sim.fire(a));if(a.weapon==='knife')tick(sim,.26);
 assert.equal(a.kills,before+1,`kill using ${a.weapon}`);assert.equal(v.health,0);
}

test('mode preference validation and race: all seven stages, same-uniform opponents, final unique winner',()=>{
 for(const value of [null,'invalid','constructor','toString'])assert.equal(parseMode(value),'deathmatch');
 assert.equal(parseMode('armsRace'),'armsRace');assert.equal(parseMode('defense'),'defense');
 const sim=race(),p=sim.state.player;
 assert.equal(p.team,sim.state.actors[1].team);
 for(let stage=0;stage<6;stage++){
  assert.equal(p.weapon,RACE_LADDER[stage]);kill(sim,0,1);assert.equal(p.raceStage,stage);assert.equal(p.raceKills,1);
  kill(sim,0,1);assert.equal(p.raceStage,stage+1);assert.equal(p.raceKills,0);assert.deepEqual(p.inventory,[RACE_LADDER[stage+1]]);
 }
 assert.match(sim.state.race!.alert,/匕首/);kill(sim,0,1);
 assert.equal(sim.state.phase,'matchEnd');assert.equal(sim.state.race!.winnerId,0);assert.equal(sim.state.winner,'blue');assert.equal(p.kills,13);
 assert.equal(sim.fire(p),false);const final=JSON.stringify(sim.state);tick(sim,5);assert.equal(JSON.stringify(sim.state),final);
 sim.start();assert.equal(sim.state.mode,'armsRace');assert.equal(sim.state.player.raceStage,0);assert.equal(sim.state.player.kills,0);
});

test('race: bot final knife victory is a player loss even with a blue uniform',()=>{
 const sim=race();for(let i=0;i<13;i++)kill(sim,1,0);
 assert.equal(sim.state.actors[1].team,'blue');assert.equal(sim.state.race!.winnerId,1);assert.equal(sim.state.winner,'red');
});

test('race: death preserves stage and partial kills, pause freezes respawn, arsenal cannot bypass ladder',()=>{
 const sim=race();for(let i=0;i<3;i++)kill(sim,0,1);const p=sim.state.player;
 assert.equal(p.raceStage,1);assert.equal(p.raceKills,1);kill(sim,1,0);
 sim.state.actors[1].health=0;sim.state.actors[1].respawnAt=Infinity;
 sim.setPaused(true);const at=sim.state.time;tick(sim,4);assert.equal(sim.state.time,at);assert.equal(p.health,0);
 sim.setPaused(false);tick(sim,3.1);assert.equal(p.health,100);assert.equal(p.weapon,'m4');assert.equal(p.raceKills,1);
 assert.equal(sim.purchase('sniper'),false);assert.equal(sim.throwGrenade(p),false);assert.equal(sim.pickupWeapon(),false);assert.deepEqual(sim.state.pickups,[]);
 sim.update(1/60,{...EMPTY_INPUT,switchWeapon:'knife'});assert.equal(p.weapon,'m4');assert.equal(p.grenades,0);
 p.guns.m4.ammo=0;p.guns.m4.reserve=1;assert.ok(sim.reload(p));tick(sim,2.4);assert.equal(p.guns.m4.reserve,LOADOUTS.m4.reserve);
});

test('defense: eight waves, one upgrade per interval, supply, health/armor/reload perks, victory and restart',()=>{
 setActiveMap('desert');const sim=new Simulation(42);sim.setBotCounts(9,10);sim.start('defense');
 const s=sim.state,d=s.defense!,p=s.player;
 assert.equal(s.actors.length,13);assert.equal(s.phase,'intermission');assert.equal(s.actors.filter(a=>a.health>0).length,3);
 assert.equal(p.money,2000);assert.equal(p.armor,50);assert.ok(sim.purchase('shotgun'));assert.equal(p.weapon,'shotgun');
 assert.equal(sim.startDefenseWave(),true);assert.equal(sim.purchase('pistol'),false);assert.equal(purchaseWindow(s).allowed,false);
 for(let wave=1;wave<=8;wave++){
  assert.equal(d.wave,wave);assert.equal(d.remaining,Math.min(10,3+wave));
  const enemies=s.actors.filter(a=>a.team==='red'&&a.health>0);
  assert.ok(enemies.every(a=>a.health===100));
  // Isolate each target's contact to test scoring and wave-state transitions.
  p.weapon='rifle';resetWeaponSwitch(p);for(const enemy of enemies)kill(sim,0,enemy.id);
  p.health=40;d.health=72;sim.update(1/60);
  assert.equal(d.completed,wave);assert.equal(d.remaining,0);
  if(wave===8)break;
  assert.equal(s.phase,'intermission');assert.equal(p.health,100);assert.equal(d.health,84);assert.equal(s.grenades.length,0);assert.equal(s.pickups.length,0);
  const now=s.time;tick(sim,10);assert.equal(s.time,now);
  if(wave%2===0){
   assert.equal(d.upgradePending,true);assert.equal(sim.startDefenseWave(),false);
   const upgrade=wave===2?'reload':wave===4?'armor':'heal';
   assert.equal(sim.chooseDefenseUpgrade(upgrade),true);assert.equal(sim.chooseDefenseUpgrade(upgrade),false);
   if(upgrade==='armor')assert.ok(s.actors.filter(a=>a.team==='blue').every(a=>a.armor>=65));
  }else assert.equal(d.upgradePending,false);
  assert.ok(sim.startDefenseWave());
  if(wave===2){p.guns.rifle.ammo=1;assert.ok(sim.reload(p));assert.equal(p.guns.rifle.reloadLeft,LOADOUTS.rifle.reload*.9);p.guns.rifle.reloadLeft=0;}
 }
 assert.equal(s.phase,'matchEnd');assert.equal(s.winner,'blue');assert.equal(d.completed,8);
 sim.start();assert.equal(sim.state.phase,'intermission');assert.deepEqual(sim.state.defense!.upgrades,{reload:0,armor:0,heal:0});assert.equal(sim.state.defense!.completed,0);
 sim.menu();assert.equal(sim.state.actors.length,20);sim.selectMode('deathmatch');sim.start();assert.equal(sim.state.mode,'deathmatch');assert.equal(sim.state.defense,undefined);
});

test('defense: kill healing applies to the player once, dead teammates return only after wave completion',()=>{
 setActiveMap('desert');const sim=new Simulation(6);sim.start('defense');sim.state.defense!.upgrades.heal=2;sim.startDefenseWave();
 const s=sim.state,p=s.player,v=s.actors[3];
 Object.assign(p,{x:0,z:16,health:40,yaw:0,pitch:0,spread:0});Object.assign(v,{x:0,z:14.8,health:1,armor:0,spawnProtectionUntil:0});
 sim.fire(p);assert.equal(p.health,52);s.actors[1].health=0;tick(sim,3.1);assert.equal(s.actors[1].health,0);
});

test('defense: base occupation respects height and walls; pause, base failure, squad wipe and timeout',()=>{
 setActiveMap('desert');const sim=new Simulation(42);sim.start('defense');sim.startDefenseWave();const s=sim.state,d=s.defense!,v=s.actors[3];
 s.actors.filter(a=>a.team==='red'&&a!==v).forEach(a=>a.health=0);
 Object.assign(v,{x:d.site.x+.6,z:d.site.z,y:d.site.y,groundY:d.site.y});sim.update(.1);assert.ok(d.health<100);assert.equal(d.attackers,1);
 sim.setPaused(true);const before=d.health;tick(sim,5);assert.equal(d.health,before);sim.setPaused(false);
 Object.assign(v,{x:d.site.x,z:d.site.z,y:6,groundY:6});sim.update(.1);assert.equal(d.health,before);
 d.site={x:0,z:3.3,y:0,radius:5};Object.assign(v,{x:0,z:6.7,y:0,groundY:0,verticalSpeed:0});sim.update(.1);assert.equal(d.health,before);
 d.site={x:0,z:16,y:0,radius:3};Object.assign(v,{x:.6,z:16,y:0,groundY:0});d.health=.01;sim.update(.1);assert.equal(s.phase,'matchEnd');assert.match(d.reason,/耐久/);
 sim.start();sim.startDefenseWave();s.actors.filter(a=>a.team==='blue').forEach(a=>a.health=0);sim.update(.1);assert.match(s.defense!.reason,/全员/);
 sim.start();sim.startDefenseWave();s.defense!.timeLeft=.01;sim.update(.1);assert.match(s.defense!.reason,/210/);
});

for(const map of ['desert','snow','dust2','assault'] as MapId[])test(`${map}: race spawn safety and defense attackers actually reach the objective`,()=>{
 try{
  setActiveMap(map);const sim=new Simulation(42);sim.setBotCounts(9,10);sim.start('armsRace');
  for(const a of sim.state.actors){assert.equal(blocked(a.x,a.z,.4,undefined,a.y),false);for(const b of sim.state.actors.filter(b=>b.id>a.id))assert.ok(Math.hypot(a.x-b.x,a.z-b.z)>.8);}
  sim.start('defense');sim.startDefenseWave();
  for(const a of sim.state.actors.filter(a=>a.team==='red')){const goal=botObjective(a,sim.state).point;assert.equal(blocked(goal.x,goal.z,.4,undefined,goal.y),false,`${map} attacker ${a.id} approach must fit a body`);}
  sim.state.player.health=100000;sim.state.actors[1].health=sim.state.actors[2].health=0;
  let reached=false;for(let frame=0;frame<180*60&&sim.state.phase==='playing';frame++){
   sim.update(1/60);sim.events=[];if(sim.state.defense!.attackers>0)reached=true;
   if(frame%60===0)for(const a of sim.state.actors.filter(a=>a.health>0)){assert.ok([a.x,a.y,a.z,a.health].every(Number.isFinite));assert.equal(map==='assault'?assault.blocked(a.x,a.z,a.y,a.crouched):blocked(a.x,a.z,undefined,undefined,a.y),false);}
  }
  console.log('DEFENSE_AI',JSON.stringify({map,reached,seconds:sim.state.time,health:sim.state.defense!.health,phase:sim.state.phase}));assert.ok(reached,`${map} attackers enter the defended area`);assert.ok(sim.state.defense!.health<100);
 }finally{setActiveMap('desert');}
});

test('autonomous arms race has real upgrades, respawns, knife pursuit and a final winner',()=>{
 setActiveMap('snow');try{
  const sim=new Simulation(42);sim.start('armsRace');let kills=0,respawns=0;
  for(let frame=0;frame<600*60&&sim.state.phase!=='matchEnd';frame++){
   sim.update(1/60,EMPTY_INPUT,true);for(const e of sim.events){if(e.type==='kill')kills++;if(e.type==='respawn')respawns++;}sim.events=[];
  }
  console.log('RACE_AI',JSON.stringify({time:sim.state.time,phase:sim.state.phase,kills,respawns,winner:sim.state.race!.winnerId,stages:sim.state.actors.map(a=>[a.raceStage,a.raceKills])}));
  assert.equal(sim.state.phase,'matchEnd');assert.ok(kills>=13);assert.ok(respawns>0);assert.equal(sim.state.actors[sim.state.race!.winnerId!].weapon,'knife');
 }finally{setActiveMap('desert');}
});
