import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation} from '../src/game/simulation';
import {EMPTY_INPUT,WEAPON_KINDS} from '../src/game/types';
import {setEquippedWeapon} from '../src/game/weaponSelection';
import {advanceWeaponSwitch,resetWeaponSwitch,weaponReady,weaponSwitchPose,weaponSwitchTiming,weaponDisplayActor,weaponRackPose} from '../src/game/weaponSwitch';

const fixture=()=>{const sim=new Simulation(42);sim.start();const p=sim.state.player;p.inventory=[...WEAPON_KINDS];for(const a of sim.state.actors.slice(1))a.player=true;return {sim,p};};
test('every weapon pair keeps the outgoing model until holstered and is ready within 1.05 s at 30/60/120 Hz',()=>{
 for(const hz of [30,60,120])for(const from of WEAPON_KINDS)for(const to of WEAPON_KINDS){
  if(from===to)continue;
  const {p}=fixture();p.weapon=from;setEquippedWeapon(p,to);assert.equal(p.weaponSwitch!.displayed,from);assert.equal(p.weaponSwitch!.depth,0);assert.equal(weaponReady(p),false);
  let elapsed=0;
  while(!weaponReady(p)&&elapsed<1.2){
   const prev=p.weaponSwitch!.displayed;advanceWeaponSwitch(p,1/hz);elapsed+=1/hz;
   if(p.weaponSwitch!.displayed!==prev)assert.ok(elapsed+1e-9>=weaponSwitchTiming(from).holster);
   assert.ok(Object.values(weaponSwitchPose(p.weaponSwitch!.displayed,p.weaponSwitch!.depth)).every(Number.isFinite));
  }
  assert.equal(p.weaponSwitch!.displayed,to);assert.equal(p.weaponSwitch!.depth,0);assert.ok(elapsed<=1.05);
  assert.ok(Math.abs(elapsed-weaponSwitchTiming(from).holster-weaponSwitchTiming(to).draw-weaponSwitchTiming(to).rack)<1/hz+1e-8);
 }
});
test('rapid selection replaces the pending weapon and reversing preserves the current transform',()=>{
 const {p}=fixture();setEquippedWeapon(p,'knife');advanceWeaponSwitch(p,.08);
 const before=weaponSwitchPose('rifle',p.weaponSwitch!.depth);
 setEquippedWeapon(p,'sniper');assert.equal(p.weaponSwitch!.displayed,'rifle');assert.deepEqual(weaponSwitchPose('rifle',p.weaponSwitch!.depth),before);
 setEquippedWeapon(p,'rifle');assert.equal(p.weaponSwitch!.phase,'draw');assert.deepEqual(weaponSwitchPose('rifle',p.weaponSwitch!.depth),before);
 advanceWeaponSwitch(p,.5);assert.ok(weaponReady(p));
 setEquippedWeapon(p,'knife');advanceWeaponSwitch(p,.27);assert.equal(p.weaponSwitch!.displayed,'knife');
 const drawing=weaponSwitchPose('knife',p.weaponSwitch!.depth);setEquippedWeapon(p,'pistol');assert.deepEqual(weaponSwitchPose('knife',p.weaponSwitch!.depth),drawing);
 advanceWeaponSwitch(p,1);assert.ok(weaponReady(p));assert.equal(p.weaponSwitch!.displayed,'pistol');
});
test('switch and fire in one tick cannot shoot an invisible gun; held fire resumes while movement stays available',()=>{
 const {sim,p}=fixture();const x=p.x,z=p.z,ammo=p.guns.pistol.ammo;
 sim.update(1/60,{...EMPTY_INPUT,switchWeapon:'pistol',fire:true,moveX:1});
 assert.equal(p.guns.pistol.ammo,ammo);assert.ok(Math.hypot(p.x-x,p.z-z)>.001);assert.equal(sim.fire(p),false);
 p.guns.pistol.ammo--;assert.equal(sim.reload(p),false);assert.equal(sim.throwGrenade(p),false);
 for(let i=0;i<70;i++)sim.update(1/60,{...EMPTY_INPUT,fire:true});
 assert.ok(weaponReady(p));assert.ok(p.guns.pistol.ammo<ammo-1);assert.ok(sim.events.some(e=>e.type==='shot'&&e.actorId===0));
});
test('pause freezes equip and respawn/restart discard interrupted transitions',()=>{
 const {sim,p}=fixture();sim.update(1/60,{...EMPTY_INPUT,switchWeapon:'knife'});sim.update(.08);const frozen=JSON.stringify(p.weaponSwitch);
 sim.setPaused(true);sim.update(2);assert.equal(JSON.stringify(p.weaponSwitch),frozen);
 sim.setPaused(false);sim.update(.05);assert.notEqual(JSON.stringify(p.weaponSwitch),frozen);
 p.health=0;p.respawnAt=sim.state.time+.01;sim.update(.02);assert.equal(p.health,100);assert.ok(weaponReady(p));
 setEquippedWeapon(p,'sniper');sim.start();assert.ok(weaponReady(sim.state.player));assert.equal(sim.state.player.weapon,'rifle');
});
test('purchases use the same transition; repeated current selection and bot selection add no lock',()=>{
 const {sim,p}=fixture();p.money=16000;assert.ok(sim.purchase('sniper'));assert.equal(p.weaponSwitch!.displayed,'rifle');assert.equal(sim.fire(p),false);
 const before={...p.weaponSwitch};setEquippedWeapon(p,'sniper');assert.deepEqual(p.weaponSwitch,before);
 const bot=sim.state.actors[1];bot.player=false;setEquippedWeapon(bot,'knife');assert.ok(weaponReady(bot));assert.equal(bot.weaponSwitch,undefined);
 resetWeaponSwitch(p);assert.ok(weaponReady(p));
});

test('switching mid-attack preserves visual recovery while canceling gameplay contact',()=>{
 const {p}=fixture();p.weapon='knife';p.shotTime=4;p.meleeAttack='stab';
 setEquippedWeapon(p,'rifle');assert.equal(p.shotTime,-10);
 const visual=weaponDisplayActor(p);assert.equal(visual.weapon,'knife');assert.equal(visual.shotTime,4);assert.equal(visual.meleeAttack,'stab');
 advanceWeaponSwitch(p,.07);setEquippedWeapon(p,'knife');advanceWeaponSwitch(p,.2);
 assert.ok(weaponReady(p));assert.equal(weaponDisplayActor(p).shotTime,4,'reversing continues the old recovery');
 p.shotTime=5;p.meleeAttack='slash';assert.equal(weaponDisplayActor(p),p,'new attacks own their own timing');
 setEquippedWeapon(p,'sniper');advanceWeaponSwitch(p,.2);assert.equal(weaponDisplayActor(p).shotTime,-10,'new weapon cannot inherit a strike');
});

test('rack uses one sound per gun, consumes no ammunition, freezes and reverses without a hand jump',()=>{
 for(const kind of WEAPON_KINDS.filter(k=>k!=='knife')){
  const {p}=fixture();p.weapon='knife';const guns=JSON.stringify(p.guns),events:import('../src/game/types').GameEvent[]=[];
  setEquippedWeapon(p,kind);advanceWeaponSwitch(p,.18+weaponSwitchTiming(kind).draw+weaponSwitchTiming(kind).rack*.56,events);
  assert.equal(p.weaponSwitch!.phase,'rack');const before=weaponRackPose(p,kind);assert.equal(before.pull,1);
  const frozen=JSON.stringify(p.weaponSwitch);advanceWeaponSwitch(p,0,events);assert.equal(JSON.stringify(p.weaponSwitch),frozen);
  setEquippedWeapon(p,'knife');assert.deepEqual(weaponRackPose(p,kind),before);
  advanceWeaponSwitch(p,.04,events);const interrupted=weaponRackPose(p,kind);
  setEquippedWeapon(p,kind);assert.deepEqual(weaponRackPose(p,kind),interrupted);
  advanceWeaponSwitch(p,2,events);assert.ok(weaponReady(p));assert.equal(weaponRackPose(p,kind).reach,0);
  assert.equal(events.filter(e=>e.type==='weaponRack').length,1);assert.equal(JSON.stringify(p.guns),guns);
 }
});
