import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Simulation} from '../src/game/simulation.ts';
import {setActiveMap,BLUE_SPAWNS} from '../src/game/map.ts';
import {blocked,findPath,RADIUS} from '../src/game/collision.ts';
import {createMapPickups,nearestPickup,takePickup} from '../src/game/pickups.ts';
import {EMPTY_INPUT,FIREARM_KINDS} from '../src/game/types.ts';
import {Dust2Collision} from '../src/game/dust2Collision';
import {installDust2Geometry} from '../src/game/dust2';
const ready=()=>{setActiveMap('snow');const sim=new Simulation(71);sim.start();sim.state.actors.forEach(a=>a.guns[a.weapon].cooldown=999);return sim;};
test('all seven ground classes are clear and reachable in both maps; snow center stays open',()=>{
 try{for(const map of ['desert','snow'] as const){setActiveMap(map);const pickups=createMapPickups();assert.equal(pickups.length,map==='snow'?7:14);assert.deepEqual(new Set(pickups.map(p=>p.weapon)),new Set(FIREARM_KINDS));
 for(const kind of FIREARM_KINDS)assert.equal(pickups.filter(p=>p.weapon===kind).length,map==='snow'?1:2);
 for(const p of pickups){assert.equal(blocked(p.x,p.z,.5),false);assert.ok(findPath(BLUE_SPAWNS[0].x,BLUE_SPAWNS[0].z,p.x,p.z).length);}}
 // The 6 m center lane leaves the actor radius plus a small margin at each edge.
 setActiveMap('snow');const centerEdge=3-RADIUS-.08;
 for(let z=-18;z<=18;z++)for(const x of [-centerEdge,0,centerEdge])assert.equal(blocked(x,z,RADIUS),false);
 }finally{setActiveMap('desert');}
});
test('E collects and equips the nearest gun, preserving its remaining ammunition',()=>{
 try{const sim=ready(),p=sim.state.player,item=sim.state.pickups.find(g=>g.weapon==='m4'&&g.z>0)!;
 p.x=item.x;p.z=item.z;item.ammo=7;item.reserve=19;sim.update(1/60,{...EMPTY_INPUT,interact:true});
 assert.equal(p.weapon,'m4');assert.ok(p.inventory.includes('m4'));assert.equal(p.guns.m4.ammo,7);assert.equal(p.guns.m4.reserve,19);assert.ok(!sim.state.pickups.includes(item));assert.ok(sim.events.some(e=>e.type==='weaponPickup'&&e.actorId===0));
 sim.resetRound();assert.equal(sim.state.pickups.length,7);assert.deepEqual(sim.state.player.inventory,['rifle','pistol','knife']);
 }finally{setActiveMap('desert');}
});
test('pickup refuses distant, blocked, paused, dead, reloading and stale items',()=>{
 try{const sim=ready(),p=sim.state.player,item=sim.state.pickups[0];p.x=item.x;p.z=item.z;
 sim.state.paused=true;assert.equal(nearestPickup(sim.state),null);sim.state.paused=false;
 p.health=0;assert.equal(nearestPickup(sim.state),null);p.health=100;
 p.guns.rifle.reloadLeft=1;assert.equal(takePickup(sim.state,p,item,sim.events),false);p.guns.rifle.reloadLeft=0;
 assert.equal(takePickup(sim.state,p,{...item},sim.events),false);
 p.x=0;p.z=0;assert.equal(nearestPickup(sim.state),null);
 p.x=2.6;p.z=8.5;sim.state.pickups=[{...item,x:3.5,z:8.5}];
 assert.equal(blocked(p.x,p.z),false,'wall-occlusion check must start from a legal player position');
 assert.equal(nearestPickup(sim.state),null);
 }finally{setActiveMap('desert');}
});
test('duplicate collection conserves ammunition up to carrying limits',()=>{
 try{const sim=ready(),p=sim.state.player,item=sim.state.pickups.find(g=>g.weapon==='rifle'&&g.z>0)!;
 p.x=item.x;p.z=item.z;p.guns.rifle.ammo=5;p.guns.rifle.reserve=7;item.ammo=4;item.reserve=6;
 assert.ok(sim.pickupWeapon());assert.equal(p.guns.rifle.ammo+p.guns.rifle.reserve,22);assert.equal(p.inventory.filter(k=>k==='rifle').length,1);
 sim.state.pickups=[{...item,id:55,ammo:30,reserve:90}];assert.ok(sim.pickupWeapon());assert.equal(p.guns.rifle.ammo,30);assert.equal(p.guns.rifle.reserve,90);
 }finally{setActiveMap('desert');}
});
test('death drops the equipped gun with remaining rounds; restart clears dropped guns',()=>{
 try{const sim=ready(),p=sim.state.player;p.x=3;p.z=13;p.guns.rifle.ammo=9;p.guns.rifle.reserve=17;
 sim.state.pickups=sim.state.pickups.filter(g=>g.weapon!=='rifle');
 sim.state.grenades=[{id:99,ownerId:0,x:p.x,y:.2,z:p.z,vx:0,vy:0,vz:0,fuse:0,bounces:0}];sim.update(1/60);
 assert.equal(p.health,0);const drop=sim.state.pickups.find(g=>g.id>=1000)!;assert.ok(drop);assert.equal(drop.weapon,'rifle');assert.equal(drop.ammo,9);assert.equal(drop.reserve,17);
 sim.start();assert.equal(sim.state.pickups.length,7);assert.ok(sim.state.pickups.every(g=>g.id<1000));
 }finally{setActiveMap('desert');}
});

for(const mode of ['deathmatch','elimination','defense'] as const)test(`snow ${mode}: repeated deaths preserve the first ground gun and never duplicate its class`,()=>{
 try{
  const sim=ready();sim.start(mode);if(mode==='defense')sim.startDefenseWave();
  const s=sim.state,existing=s.pickups.find(p=>p.weapon==='rifle');s.time=2;
  if(existing){existing.ammo=4;existing.reserve=11;}
  const shooter=s.actors[3];
  const first=s.actors[1];first.guns.rifle.ammo=9;first.guns.rifle.reserve=17;
  (sim as any).damage(shooter,first,1000);
  const retained=s.pickups.find(p=>p.weapon==='rifle')!;assert.ok(retained);
  const snapshot={...retained};if(existing)assert.equal(retained,existing);
  else assert.deepEqual([retained.ammo,retained.reserve],[9,17]);
  const second=s.actors[2];second.guns.rifle.ammo=21;second.guns.rifle.reserve=30;
  (sim as any).damage(shooter,second,1000);
  assert.deepEqual(s.pickups.filter(p=>p.weapon==='rifle'),[retained]);
  assert.deepEqual(retained,snapshot,'a later drop must not move/refill/replace the gun the player was approaching');
  assert.equal(new Set(s.pickups.map(p=>p.weapon)).size,s.pickups.length);
 }finally{setActiveMap('desert');}
});

test('snow supply refresh preserves a dropped gun, then refills its class only after collection or expiry',()=>{
 try{
  const sim=ready(),s=sim.state,p=s.player,rifle=s.pickups.find(g=>g.weapon==='rifle')!;
  p.x=rifle.x;p.z=rifle.z;p.guns.rifle.ammo=1;p.guns.rifle.reserve=0;assert.ok(sim.pickupWeapon());
  const victim=s.actors[3];victim.guns.rifle.ammo=7;victim.guns.rifle.reserve=19;
  (sim as any).damage(p,victim,1000);
  const drop=s.pickups.find(g=>g.weapon==='rifle')!,snapshot={...drop};assert.ok(drop.id>=1000);
  s.actors.forEach(a=>{a.health=0;a.respawnAt=10000;});s.time=20;sim.update(.01);
  assert.equal(s.pickups.find(g=>g.weapon==='rifle'),drop);assert.deepEqual(drop,snapshot);assert.equal(s.pickups.length,7);
  Object.assign(p,{health:100,x:drop.x,z:drop.z});p.guns.rifle.ammo=1;p.guns.rifle.reserve=0;assert.ok(sim.pickupWeapon());
  p.health=0;p.respawnAt=10000;s.time=40;sim.update(.02);
  assert.equal(s.pickups.filter(g=>g.weapon==='rifle').length,1);assert.equal(s.pickups.find(g=>g.weapon==='rifle')!.id,rifle.id);
  // A dropped class also returns at the next normal refresh after its lifetime.
  s.pickups=s.pickups.filter(g=>g.weapon!=='rifle');Object.assign(victim,{health:100,spawnProtectionUntil:0});
  (sim as any).damage(p,victim,1000);const expiring=s.pickups.find(g=>g.weapon==='rifle')!;
  victim.respawnAt=10000;s.time=expiring.expiresAt!+.01;sim.update(.01);
  assert.equal(s.pickups.length,7);assert.equal(s.pickups.find(g=>g.weapon==='rifle')!.id,rifle.id);
  assert.equal(new Set(s.pickups.map(g=>g.weapon)).size,7);
 }finally{setActiveMap('desert');}
});

test('snow arms race still has no ground weapons and other maps still allow repeated death drops',()=>{
 try{
  const sim=ready();sim.start('armsRace');sim.state.actors[1].spawnProtectionUntil=0;(sim as any).damage(sim.state.actors[0],sim.state.actors[1],1000);assert.equal(sim.state.actors[1].health,0);assert.equal(sim.state.pickups.length,0);
  const bytes=readFileSync('public/assets/maps/dust2/de_dust2.bsp');
  const geometry=new Dust2Collision(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  geometry.navigation=JSON.parse(readFileSync('public/assets/maps/dust2/navigation.json','utf8'));installDust2Geometry(geometry);
  for(const map of ['desert','dust2'] as const){
   setActiveMap(map);sim.start('deathmatch');assert.equal(sim.state.pickups.length,14);
   (sim as any).damage(sim.state.actors[3],sim.state.actors[1],1000);
   (sim as any).damage(sim.state.actors[3],sim.state.actors[2],1000);
   assert.equal(sim.state.pickups.filter(g=>g.weapon==='rifle').length,4);
  }
 }finally{setActiveMap('desert');}
});
