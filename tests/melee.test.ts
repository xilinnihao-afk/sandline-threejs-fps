import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation,MELEE_CONTACT_DELAY,MELEE_REACH,WEAPONS} from '../src/game/simulation';
import {EMPTY_INPUT} from '../src/game/types';
import {MAP_BOXES,setActiveMap} from '../src/game/map';
import {buy} from '../src/game/economy';
import {takePickup} from '../src/game/pickups';
import {RESPAWN_DELAY} from '../src/game/deathmatch';
import {MELEE_ATTACKS} from '../src/game/melee';

function ready(){
 setActiveMap('snow');const sim=new Simulation(91);sim.start();
 // Freeze AI decisions, while all real movement, collision, weapon and damage paths remain active.
 (sim as any).bot=()=>{};
 const p=sim.state.player,target=sim.state.actors[3];
 sim.state.actors.forEach((a,i)=>{a.x=-18+i*3;a.z=17;a.grenades=0;});
 Object.assign(p,{x:0,z:0,yaw:0,pitch:0,weapon:'knife'});
 Object.assign(target,{x:0,z:-1.4});sim.events=[];
 return {sim,p,target};
}

test('knife contact is delayed, deals melee damage, repeats after cooldown, and consumes no rounds',()=>{
 const {sim,p,target}=ready();
 assert.ok(p.inventory.includes('knife'));assert.ok(sim.fire(p));assert.equal(target.health,100);
 assert.equal(sim.events.filter(e=>e.type==='melee').length,1);assert.equal(sim.events.some(e=>e.type==='shot'),false);
 sim.update(MELEE_CONTACT_DELAY-.02);assert.equal(target.health,100);
 sim.update(.021);assert.equal(target.health,60);assert.ok(sim.state.hitMarker>0);
 assert.equal(sim.events.filter(e=>e.type==='hit').length,1);assert.equal(sim.reload(p),false);
 assert.equal(sim.fire(p),false);assert.equal(p.guns.knife.ammo,0);assert.equal(p.guns.knife.reserve,0);
 for(let i=0;i<35;i++)sim.update(1/60,{...EMPTY_INPUT,fire:true});
 assert.equal(sim.events.filter(e=>e.type==='melee').length,2);
 sim.update(.1);assert.equal(target.health,20);assert.equal(p.guns.knife.ammo,0);
 assert.equal(sim.events.some(e=>e.type==='reload'||e.type==='shot'),false);
});

test('knife obeys reach, view direction, height and contact-time target movement',()=>{
 for(const scenario of ['range','behind','above','escaped'] as const){
  const {sim,p,target}=ready();
  if(scenario==='range')target.z=-(MELEE_REACH+.5);
  if(scenario==='behind')target.z=1.2;
  if(scenario==='above')p.pitch=1.2;
  assert.ok(sim.fire(p));
  if(scenario==='escaped')target.x=4;
  sim.update(MELEE_CONTACT_DELAY+.01);assert.equal(target.health,100,scenario);
 }
});

test('knife is stopped by walls and allies without friendly damage',()=>{
 const {sim,p,target}=ready();
 const cover={x:0,z:-.7,w:2,d:.15,h:2,kind:'wall' as const};MAP_BOXES.push(cover);
 try{sim.fire(p);sim.update(.13);assert.equal(target.health,100);}finally{MAP_BOXES.splice(MAP_BOXES.indexOf(cover),1);}
 const ally=sim.state.actors[1];Object.assign(ally,{x:0,z:-.75});target.z=-1.55;
 p.guns.knife.cooldown=0;sim.fire(p);sim.update(.13);
 assert.equal(ally.health,100);assert.equal(target.health,100);
 target.x=5;ally.z=-1.2;p.guns.knife.cooldown=0;sim.fire(p);sim.update(.13);assert.equal(ally.health,100);
});

test('pause freezes pending knife contact; switching, death and restart cancel it',()=>{
 const {sim,p,target}=ready();sim.fire(p);sim.setPaused(true);const time=sim.state.time;
 sim.update(1);assert.equal(sim.state.time,time);assert.equal(target.health,100);assert.equal(sim.fire(p),false);
 sim.setPaused(false);sim.update(.13);assert.equal(target.health,60);
 p.guns.knife.cooldown=0;sim.fire(p);sim.update(.05,{...EMPTY_INPUT,switchWeapon:'pistol'});
 sim.update(.1,{...EMPTY_INPUT,switchWeapon:'knife'});assert.equal(target.health,60);
 p.guns.knife.cooldown=0;sim.fire(p);p.health=0;p.respawnAt=100;sim.update(.13);assert.equal(target.health,60);
 const next=ready();next.sim.fire(next.p);next.sim.start();next.sim.update(.2);assert.equal(next.sim.events.some(e=>e.type==='hit'),false);
});

test('knife stays with the player through death and respawn and never becomes a ground pickup',()=>{
 const {sim,p}=ready();sim.state.grenades=[{id:99,ownerId:0,x:p.x,y:.1,z:p.z,vx:0,vy:0,vz:0,fuse:0,bounces:0}];
 sim.update(.01);assert.equal(p.health,0);assert.equal(sim.state.pickups.some(item=>item.weapon==='knife'),false);
 sim.update(RESPAWN_DELAY+.01);assert.equal(p.health,100);assert.equal(p.weapon,'knife');assert.ok(p.inventory.includes('knife'));
 assert.equal(p.guns.knife.cooldown,0);assert.equal(p.guns.knife.ammo,0);
});

test('unarmed AI equips a knife, uses it only at close range and otherwise searches for ammunition',()=>{
 const sim=new Simulation(11);setActiveMap('snow');sim.start();const p=sim.state.player,bot=sim.state.actors[3];
 sim.state.actors.forEach((a,i)=>{a.x=-18+i*3;a.z=17;a.grenades=0;});
 Object.assign(p,{x:0,z:0});Object.assign(bot,{x:0,z:-7,yaw:Math.PI});
 for(const gun of Object.values(bot.guns)){gun.ammo=0;gun.reserve=0;}
 sim.events=[];sim.update(.02);assert.equal(bot.weapon,'knife');assert.equal(sim.events.some(e=>e.actorId===bot.id&&(e.type==='shot'||e.type==='melee')),false);
 Object.assign(bot,{x:0,z:-1.3,yaw:Math.PI});sim.update(.02);
 assert.ok(sim.events.some(e=>e.actorId===bot.id&&e.type==='melee'));
 const health=p.health;sim.update(MELEE_CONTACT_DELAY+.01);assert.equal(p.health,health-WEAPONS.knife.damage);
});


test('switches and pickups do not transfer gun recoil/muzzle timestamps into knife swings or back',()=>{
 const {sim,p,target}=ready();p.weapon='rifle';p.shotTime=sim.state.time;
 sim.update(.01,{...EMPTY_INPUT,switchWeapon:'knife'});assert.equal(p.shotTime,-10);
 sim.fire(p);const slash=p.shotTime;
 sim.update(.01,{...EMPTY_INPUT,switchWeapon:'knife'});assert.equal(p.shotTime,slash,'selecting the same weapon preserves its active pose');
 sim.update(.01,{...EMPTY_INPUT,switchWeapon:'pistol'});assert.equal(p.shotTime,-10);
 p.weapon='knife';p.shotTime=sim.state.time;
 const item={id:5000,weapon:'m4' as const,x:p.x,z:p.z,ammo:30,reserve:90};sim.state.pickups=[item];
 assert.ok(takePickup(sim.state,p,item,sim.events));assert.equal(p.shotTime,-10);
 p.weapon='knife';p.shotTime=sim.state.time;p.money=16000;assert.ok(buy(p,'rifle'));assert.equal(p.shotTime,-10);
 sim.update(.2);assert.equal(target.health,100);
});

test('AI changing to a firearm or to its knife clears the old attack pose',()=>{
 setActiveMap('snow');const sim=new Simulation(71);sim.start();const p=sim.state.player,bot=sim.state.actors[3];
 sim.state.actors.forEach((a,i)=>{a.x=-18+i*3;a.z=17;a.grenades=0;});
 Object.assign(p,{x:0,z:0});Object.assign(bot,{x:0,z:-7,yaw:Math.PI,shotTime:sim.state.time});
 bot.guns.rifle.ammo=0;sim.update(.01);assert.equal(bot.weapon,'pistol');assert.equal(bot.shotTime,-10);
 bot.shotTime=sim.state.time;for(const gun of Object.values(bot.guns)){gun.ammo=0;gun.reserve=0;}
 sim.update(.01);assert.equal(bot.weapon,'knife');assert.equal(bot.shotTime,-10);
});


test('throwing a grenade interrupts the knife windup instead of landing an invisible slash',()=>{
 const {sim,p,target}=ready();p.grenades=1;sim.fire(p);sim.update(.04);
 assert.ok(sim.throwGrenade(p));assert.equal(p.shotTime,-10);
 sim.update(.1);assert.equal(target.health,100);assert.equal(sim.events.some(e=>e.type==='hit'),false);
});


test('secondary fire starts a slower stab with one delayed stronger contact and no slash',()=>{
 const {sim,p,target}=ready(),spec=MELEE_ATTACKS.stab;
 sim.update(.01,{...EMPTY_INPUT,fire:true,secondaryFire:true});
 assert.equal(p.meleeAttack,'stab');assert.equal(p.guns.knife.cooldown,spec.interval);
 assert.equal(sim.events.filter(e=>e.type==='melee').length,1);assert.equal(sim.events.find(e=>e.type==='melee')?.meleeAttack,'stab');
 sim.update(spec.contactDelay-.01);assert.equal(target.health,100);
 sim.update(.011);assert.equal(target.health,25);assert.equal(sim.events.filter(e=>e.type==='hit').length,1);
 sim.update(.4);assert.equal(target.health,25);assert.equal(sim.fire(p,'slash'),false);
 sim.update(.35);assert.equal(sim.fire(p,'slash'),true);assert.equal(p.meleeAttack,'slash');
});

test('slash covers a wider arc while stab requires crosshair alignment and closer reach',()=>{
 for(const attack of ['slash','stab'] as const){
  const {sim,p,target}=ready();Object.assign(target,{x:.55,z:-1.2});
  sim.fire(p,attack);sim.update(MELEE_ATTACKS[attack].contactDelay+.01);
  assert.equal(target.health,attack==='slash'?60:100,attack+' width');
  const far=ready();far.target.z=-1.86;far.sim.fire(far.p,attack);far.sim.update(MELEE_ATTACKS[attack].contactDelay+.01);
  assert.equal(far.target.health,attack==='slash'?60:100,attack+' reach');
 }
});

test('stab stops at cover and allies and cancels on switching, throwing or death',()=>{
 for(const reason of ['wall','ally','switch','throw','death'] as const){
  const {sim,p,target}=ready();const cover={x:0,z:-.7,w:2,d:.15,h:2,kind:'wall' as const};
  if(reason==='wall')MAP_BOXES.push(cover);
  if(reason==='ally')Object.assign(sim.state.actors[1],{x:0,z:-.75});
  try{
   sim.fire(p,'stab');sim.update(.04);
   if(reason==='switch')sim.update(.01,{...EMPTY_INPUT,switchWeapon:'pistol'});
   if(reason==='throw'){p.grenades=1;sim.throwGrenade(p);}
   if(reason==='death'){p.health=0;p.respawnAt=100;}
   sim.update(.25);assert.equal(target.health,100,reason);assert.equal(sim.events.filter(e=>e.type==='hit').length,0,reason);
  }finally{if(reason==='wall')MAP_BOXES.splice(MAP_BOXES.indexOf(cover),1);}
 }
});

test('secondary input does not shoot or alter firearm precision behavior',()=>{
 const {sim,p}=ready();p.weapon='rifle';const before=p.guns.rifle.ammo;
 sim.update(.01,{...EMPTY_INPUT,secondaryFire:true});assert.equal(p.guns.rifle.ammo,before);assert.equal(sim.events.some(e=>e.type==='melee'||e.type==='shot'),false);
});

test('a secondary press during recovery queues exactly one stab ahead of held primary fire',()=>{
 const {sim,p,target}=ready();target.x=10;
 sim.update(.01,{...EMPTY_INPUT,fire:true});assert.equal(p.meleeAttack,'slash');
 sim.update(.08,{...EMPTY_INPUT,fire:true,secondaryFire:true});
 for(let i=0;i<40;i++)sim.update(1/60,{...EMPTY_INPUT,fire:true});
 assert.deepEqual(sim.events.filter(e=>e.type==='melee').map(e=>e.meleeAttack),['slash','stab']);
 assert.equal(p.meleeAttack,'stab');
 for(let i=0;i<65;i++)sim.update(1/60);
 assert.deepEqual(sim.events.filter(e=>e.type==='melee').map(e=>e.meleeAttack),['slash','stab'],'one press cannot repeat after the queued stab');
});

test('queued knife intent is canceled by pause, switching, death, grenade or restart',()=>{
 for(const reason of ['pause','switch','death','grenade','restart'] as const){
  const {sim,p,target}=ready();target.x=10;p.grenades=1;
  sim.update(.01,{...EMPTY_INPUT,fire:true});sim.update(.05,{...EMPTY_INPUT,secondaryFire:true});
  if(reason==='pause'){sim.setPaused(true);sim.update(1);sim.setPaused(false);}
  if(reason==='switch'){sim.update(.01,{...EMPTY_INPUT,switchWeapon:'pistol'});sim.update(.01,{...EMPTY_INPUT,switchWeapon:'knife'});}
  if(reason==='death'){p.health=0;p.respawnAt=100;sim.update(.01);p.health=100;}
  if(reason==='grenade')sim.throwGrenade(p);
  if(reason==='restart')sim.start();
  for(let i=0;i<70;i++)sim.update(1/60);
  assert.equal(sim.events.some(e=>e.type==='melee'&&e.actorId===0&&e.meleeAttack==='stab'),false,reason);
 }
});
