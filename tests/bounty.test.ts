import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Simulation} from '../src/game/simulation';
import {Dust2Collision} from '../src/game/dust2Collision';
import {installBloodstrikeGeometry} from '../src/game/bloodstrike';
import {MAPS,setActiveMap} from '../src/game/map';
import {BOUNTY_KILL_REWARD,mapPlayableModes,modeForMap,hasRespawns,allowsPickups} from '../src/game/offlineModes';
import {killEconomy,purchaseWindow,STARTING_MONEY,MONEY_CAP} from '../src/game/economy';
import {LOADOUTS} from '../src/game/loadouts';
import {advanceJump} from '../src/game/jump';
import {EMPTY_INPUT,type Actor} from '../src/game/types';

const bytes=readFileSync('public/assets/maps/bloodstrike/cs_bloodstrike.bsp');
const geometry=new Dust2Collision(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
geometry.navigation=JSON.parse(readFileSync('public/assets/maps/bloodstrike/navigation.json','utf8'));
installBloodstrikeGeometry(geometry);
const spawn=MAPS.bloodstrike.blueSpawns[0];
const step=1/60;

function bounty(seed=42,size=3){setActiveMap('bloodstrike');const sim=new Simulation(seed);sim.setBotCounts(size-1,size);sim.start();return sim;}
function tick(sim:Simulation,seconds:number){for(let i=0;i<Math.ceil(seconds/step);i++)sim.update(step);}
/** Deterministic firing-range fixture: retain all enemies and their full health,
 * but suppress return fire while testing player damage, money and progression. */
function suppressReturnFire(sim:Simulation){(sim as unknown as {bot:()=>void}).bot=()=>{};}
function placeLane(sim:Simulation,shooter:Actor,target:Actor){
 for(const other of sim.state.actors)if(other!==shooter&&other!==target&&other.health>0){
  const p=MAPS.bloodstrike.redSpawns[other.id%10];Object.assign(other,p,{groundY:p.y,verticalSpeed:0});
 }
 Object.assign(shooter,spawn,{groundY:spawn.y,verticalSpeed:0,yaw:0,pitch:Math.atan2(-.42,2),spread:0,crouched:false,moving:false,spawnProtectionUntil:0});
 Object.assign(target,{x:spawn.x,z:spawn.z-2,y:spawn.y,groundY:spawn.y,verticalSpeed:0,crouched:false,spawnProtectionUntil:0});
 assert.equal(geometry.blocked(target.x,target.z,target.y),false);
}
/** Hold the normal player fire input through cooldowns/reloads. No damage,
 * health, kill counts, funds or outcome state is fabricated by this helper. */
function shootEnemy(sim:Simulation,target:Actor){
 const p=sim.state.player,before=p.kills,deaths=target.deaths;assert.equal(target.health,100);
 for(let frame=0;frame<10*60&&target.health>0;frame++){
  placeLane(sim,p,target);sim.update(step,{...EMPTY_INPUT,fire:true});
 }
 assert.equal(target.health,0,`enemy ${target.id} killed through hitscan`);
 assert.equal(p.kills,before+1);assert.equal(target.deaths,deaths+1);
}

test('Bloodstrike navigation connects every original spawn and patrol point at its negative floor height',()=>{
 try{
  setActiveMap('bloodstrike');const {points,edges}=geometry.navigation;
  assert.equal(geometry.spawns.blue.length,10);assert.equal(geometry.spawns.red.length,10);
  assert.equal(points.length,edges.length);assert.ok(points.length>1000);
  const visited=new Set([0]),queue=[0];
  for(let i=0;i<queue.length;i++)for(const next of edges[queue[i]]){assert.ok(next>=0&&next<points.length);if(!visited.has(next)){visited.add(next);queue.push(next);}}
  assert.equal(visited.size,points.length,'no isolated navigation component');
  for(const start of [...MAPS.bloodstrike.blueSpawns,...MAPS.bloodstrike.redSpawns]){
   assert.ok(start.y!<0);assert.equal(geometry.blocked(start.x,start.z,start.y),false);
   assert.ok(Math.abs(geometry.ground(start.x,start.z,start.y!+.1)!-start.y!)<.002);
   for(const end of MAPS.bloodstrike.patrol!){
    const path=geometry.path(start.x,start.z,end.x,end.z,start.y,end.y);assert.ok(path.length>0);
    let p={x:start.x,y:start.y!,z:start.z};
    for(const next of [...path,end]){const moved=geometry.move(p.x,p.z,next.x-p.x,next.z-p.z,p.y);
     assert.ok(Math.hypot(moved.x-next.x,moved.z-next.z)<.05,`spawn-to-patrol connector ${JSON.stringify({p,next,moved})}`);
     assert.ok(Math.abs(moved.y-next.y!)<.08);assert.equal(geometry.blocked(moved.x,moved.z,moved.y),false);p=moved;
    }
   }
  }
  const sim=bounty(),p=sim.state.player,base=p.y!;let peak=base;
  for(let frame=0;frame<120;frame++){advanceJump(p,step,frame===0);peak=Math.max(peak,p.y!);assert.equal(geometry.blocked(p.x,p.z,p.y),false);}
  assert.ok(peak>base+.7);assert.ok(Math.abs(p.y!-base)<.015,'jump lands on the actual negative BSP floor');
 }finally{setActiveMap('desert');}
});

const enemies=(sim:Simulation)=>sim.state.actors.filter(a=>a.team==='red');
function winRound(sim:Simulation){for(const a of enemies(sim))if(a.health>0)shootEnemy(sim,a);}
function nextRound(sim:Simulation){assert.equal(sim.state.phase,'roundEnd');tick(sim,4.05);assert.equal(sim.state.phase,'playing');}

test('all four team presets, mode/map changes and restart preserve the requested roster',()=>{
 try{
  for(const size of [3,5,8,10]){
   const sim=bounty(42,size);assert.equal(sim.state.actors.length,size*2);
   assert.equal(sim.state.actors.filter(a=>a.team==='blue').length,size);
   assert.equal(enemies(sim).length,size);assert.equal(sim.setBotCounts(0,1),false);
   sim.start();assert.equal(sim.state.actors.length,size*2);
  }
  setActiveMap('desert');const sim=new Simulation(42);sim.setBotCounts(4,5);sim.selectMode('knifeOnly');
  setActiveMap('bloodstrike');sim.refreshMap();assert.equal(sim.state.mode,'bounty');
  assert.deepEqual(mapPlayableModes(),['bounty']);assert.equal(modeForMap('defense'),'bounty');
  assert.equal(sim.state.actors.length,10);sim.start();assert.equal(sim.state.player.weapon,'pistol');sim.menu();
  setActiveMap('snow');sim.refreshMap();assert.equal(sim.state.mode,'knifeOnly');assert.equal(sim.state.actors.length,10);
  assert.equal(modeForMap('bounty'),'deathmatch');
 }finally{setActiveMap('desert');}
});

test('every actor starts on equal pistols with no free pickups; a real kill pays exactly once and is saved for round two',()=>{
 try{
  const sim=bounty(42,10),s=sim.state,p=s.player;suppressReturnFire(sim);
  for(const a of s.actors){assert.equal(a.money,STARTING_MONEY);assert.deepEqual(a.inventory,['pistol','knife']);assert.equal(a.weapon,'pistol');assert.equal(a.grenades,0);assert.equal(a.armor,0);}
  assert.equal(hasRespawns(s.mode),false);assert.equal(allowsPickups(s.mode),false);assert.deepEqual(s.pickups,[]);
  const victim=enemies(sim)[0];shootEnemy(sim,victim);assert.equal(p.money,1400);assert.equal(victim.money,800);
  assert.equal(sim.purchase('deagle'),false);assert.equal(sim.purchase('he'),false);assert.equal(p.money,1400);
  assert.equal(purchaseWindow(s).allowed,false);assert.equal(sim.pickupWeapon(),false);
  tick(sim,110);assert.equal(s.phase,'playing');assert.equal(s.winner,null);assert.equal(victim.health,0);
  assert.ok(s.roundTime>105);assert.equal(p.money,1400);assert.deepEqual(s.pickups,[]);
  assert.equal(sim.events.some(e=>e.type==='respawn'),false);
 }finally{setActiveMap('desert');}
});

test('actual team eliminations advance rounds, retain bounty and kit, and reach a first-to-three match result',()=>{
 try{
  const sim=bounty(),s=sim.state;suppressReturnFire(sim);winRound(sim);
  assert.equal(s.phase,'roundEnd');assert.equal(s.winner,'blue');assert.equal(s.blueScore,1);assert.equal(s.player.money,2600);
  assert.equal(sim.events.some(e=>e.type==='roundReward'),false);assert.equal(sim.purchase('smg'),false);
  nextRound(sim);assert.equal(s.round,2);assert.equal(s.player.money,2600);assert.equal(s.player.kills,3);
  assert.ok(sim.purchase('smg'));assert.equal(s.player.money,1100);assert.equal(s.player.weapon,'smg');
  assert.equal(sim.purchase('rifle'),false);tick(sim,1);winRound(sim);
  assert.equal(s.blueScore,2);assert.equal(s.player.money,2900);const ammo=s.player.guns.smg.ammo+s.player.guns.smg.reserve;
  nextRound(sim);assert.equal(s.round,3);assert.equal(s.player.money,2900);assert.equal(s.player.weapon,'smg');
  assert.ok(s.player.inventory.includes('smg'));assert.equal(s.player.guns.smg.ammo+s.player.guns.smg.reserve,ammo);
  assert.ok(sim.purchase('rifle'));assert.equal(s.player.money,200);tick(sim,1);winRound(sim);
  assert.equal(s.phase,'matchEnd');assert.equal(s.blueScore,3);assert.equal(s.redScore,0);assert.equal(s.totalKills,9);
  assert.equal(s.player.money,200+3*BOUNTY_KILL_REWARD);const final=JSON.stringify(s);tick(sim,8);assert.equal(JSON.stringify(s),final);
  sim.start();assert.equal(s.round,1);assert.equal(s.player.money,800);assert.equal(s.player.kills,0);assert.equal(s.totalKills,0);
  assert.equal(s.blueScore,0);assert.equal(s.redScore,0);assert.equal(s.time,0);assert.deepEqual(s.player.inventory,['pistol','knife']);
 }finally{setActiveMap('desert');}
});

test('player death spectates living teammates; losing a team round preserves money but clears the dead player kit',()=>{
 try{
  const sim=bounty(),s=sim.state;suppressReturnFire(sim);winRound(sim);nextRound(sim);
  const p=s.player,killer=enemies(sim)[0];assert.ok(sim.purchase('smg'));tick(sim,1);const balance=p.money;
  for(const target of s.actors.filter(a=>a.team==='blue')){
   for(let frame=0;frame<600&&target.health>0;frame++){placeLane(sim,killer,target);sim.fire(killer);sim.update(step);}assert.equal(target.health,0);
   sim.update(step);
   if(target.player){assert.equal(s.phase,'playing');assert.ok(s.spectating);assert.equal(s.spectating.team,'blue');assert.equal(sim.purchase('pistol'),false);tick(sim,4);assert.equal(p.health,0);}
  }
  assert.equal(s.phase,'roundEnd');assert.equal(s.winner,'red');assert.equal(s.redScore,1);assert.equal(p.money,balance);
  nextRound(sim);assert.equal(s.player.health,100);assert.equal(s.player.money,balance);assert.equal(s.player.deaths,1);
  assert.deepEqual(s.player.inventory,['pistol','knife']);assert.equal(s.spectating,null);
  assert.ok(s.actors.filter(a=>!a.player).some(a=>a.weapon==='smg'),'enemy killer spends earned bounty next round');
  assert.ok(s.actors.every(a=>a.money>=0&&a.money<=MONEY_CAP));
 }finally{setActiveMap('desert');}
});

test('round-two shop requires own spawn and correct BSP floor; guns stay available, grenades expire at 20 seconds; pause freezes combat',()=>{
 try{
  const sim=bounty(),s=sim.state;suppressReturnFire(sim);winRound(sim);nextRound(sim);const p=s.player;
  for(const team of ['blue','red'] as const){
   const a=s.actors.find(a=>a.team===team)!,spawns=team==='blue'?MAPS.bloodstrike.blueSpawns:MAPS.bloodstrike.redSpawns;
   for(const point of spawns){Object.assign(a,point);assert.ok(purchaseWindow(s,a).allowed);a.y=point.y!+3;assert.equal(purchaseWindow(s,a).allowed,false);}
   Object.assign(a,spawns[0]);
   Object.assign(a,team==='blue'?MAPS.bloodstrike.redSpawns[0]:MAPS.bloodstrike.blueSpawns[0]);assert.equal(purchaseWindow(s,a).allowed,false);
   Object.assign(a,spawns[0]);
  }
  tick(sim,21);assert.ok(purchaseWindow(s).allowed);assert.equal(sim.purchase('he'),false);assert.ok(sim.purchase('smg'));
  sim.setPaused(true);const frozen=JSON.stringify(s);tick(sim,3);assert.equal(JSON.stringify(s),frozen);assert.equal(sim.fire(p),false);
  p.guns.smg.reserve=0;assert.ok(sim.purchase('ammo'));assert.equal(p.guns.smg.reserve,LOADOUTS.smg.reserve);
  sim.setPaused(false);sim.update(step);assert.ok(s.roundTime>21);
  Object.assign(p,MAPS.bloodstrike.patrol![0]);assert.equal(purchaseWindow(s).allowed,false);assert.equal(sim.purchase('pistol'),false);
 }finally{setActiveMap('desert');}
});

test('friendly fire and self kills pay no bounty; money cap and death preservation apply to both teams',()=>{
 try{
  const sim=bounty(),s=sim.state,[enemy,friend]=enemies(sim);suppressReturnFire(sim);
  placeLane(sim,enemy,friend);assert.ok(sim.fire(enemy));assert.equal(friend.health,100);assert.equal(enemy.money,800);
  killEconomy(enemy,friend,'bounty');assert.equal(enemy.money,800);assert.equal(friend.money,800);
  killEconomy(enemy,enemy,'bounty');assert.equal(enemy.money,800);
  enemy.money=15950;killEconomy(enemy,s.player,'bounty');assert.equal(enemy.money,16000);assert.equal(s.player.money,800);
 }finally{setActiveMap('desert');}
});

test('a real simultaneous last-pair grenade kill produces a draw and carries balances into the next round',()=>{
 try{
  const sim=bounty(),s=sim.state;suppressReturnFire(sim);winRound(sim);nextRound(sim);const p=s.player;
  for(const a of s.actors)if(a!==p)a.health=0;const last=enemies(sim)[0];last.health=10;p.health=10;
  placeLane(sim,p,last);assert.ok(sim.purchase('he'));const before=p.money;assert.ok(sim.throwGrenade(p));
  Object.assign(s.grenades[0],{x:p.x,z:p.z-1,y:p.y!+.5,vx:0,vy:0,vz:0,fuse:step/2});
  sim.update(step);assert.equal(p.health,0);assert.equal(last.health,0);assert.equal(s.phase,'roundEnd');assert.equal(s.winner,'draw');
  assert.equal(s.blueScore,1);assert.equal(s.redScore,0);assert.equal(p.money,before+600);nextRound(sim);
  assert.equal(s.round,3);assert.equal(s.player.money,before+600);assert.deepEqual(s.player.inventory,['pistol','knife']);
 }finally{setActiveMap('desert');}
});

for(const size of [3,5,8,10])test(`Bloodstrike ${size}v${size} bots play full rounds with real kills and paid upgrades`,()=>{
 try{
  const sim=bounty(42,size);let shots=0,hits=0,kills=0,respawns=0,buys=0,moved=false;const rounds=new Set<number>();
  const starts=sim.state.actors.map(a=>({x:a.x,z:a.z}));
  for(let frame=0;frame<600*60&&sim.state.phase!=='matchEnd';frame++){
   sim.update(step,EMPTY_INPUT,true);rounds.add(sim.state.round);
   for(const event of sim.events){if(event.type==='shot')shots++;if(event.type==='hit')hits++;if(event.type==='kill')kills++;if(event.type==='respawn')respawns++;if(event.type==='buy')buys++;}sim.events=[];
   if(frame%60===0)for(const a of sim.state.actors)if(a.health>0){
    assert.ok([a.x,a.y,a.z,a.health,a.money].every(Number.isFinite));assert.ok(a.money>=0&&a.money<=16000);
    assert.equal(geometry.blocked(a.x,a.z,a.y),false,`bot ${a.id} remains outside BSP solids`);
    if(Math.hypot(a.x-starts[a.id].x,a.z-starts[a.id].z)>5)moved=true;
   }
  }
  const metrics={size,seconds:sim.state.time,rounds:[...rounds],phase:sim.state.phase,winner:sim.state.winner,score:[sim.state.blueScore,sim.state.redScore],shots,hits,kills,respawns,buys,moved};
  console.log('BLOODSTRIKE_BOT_METRICS',JSON.stringify(metrics));assert.ok(moved);assert.ok(shots>0&&hits>0&&kills>0&&buys>0);
  assert.equal(respawns,0);assert.equal(sim.state.phase,'matchEnd');assert.ok(rounds.size>=3);assert.equal(Math.max(sim.state.blueScore,sim.state.redScore),3);
 }finally{setActiveMap('desert');}
});
