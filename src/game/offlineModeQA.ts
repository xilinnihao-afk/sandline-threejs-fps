import {advanceWeaponSwitch} from './weaponSwitch';
import {Simulation} from './simulation';
import {EMPTY_INPUT} from './types';
import {LOADOUTS} from './loadouts';
import {getActiveMap} from './map';

/** Deterministic range for inspecting the real round banner, carryover and shop.
 * Only positions/return fire are arranged; damage, rewards and transitions are real. */
export function bountyRoundQA(sim:Simulation){
 if(getActiveMap().id!=='bloodstrike')throw new Error('Bloodstrike map required');
 sim.seed(42);sim.start();const s=sim.state,p=s.player,map=getActiveMap(),spawn=map.blueSpawns[0];
 for(const a of s.actors)if(!a.player)for(const gun of Object.values(a.guns))gun.cooldown=Infinity;
 for(const target of s.actors.filter(a=>a.team==='red')){
  for(let frame=0;frame<600&&target.health>0;frame++){
   for(const other of s.actors)if(other!==p&&other!==target&&other.health>0){
    const point=map.redSpawns[other.id%map.redSpawns.length];Object.assign(other,point,{groundY:point.y,verticalSpeed:0});
   }
   Object.assign(p,spawn,{groundY:spawn.y,verticalSpeed:0,yaw:0,pitch:Math.atan2(-.42,2),spread:0});
   Object.assign(target,{x:spawn.x,z:spawn.z-2,y:spawn.y,groundY:spawn.y,verticalSpeed:0,crouched:false});
   sim.update(1/60,{...EMPTY_INPUT,fire:true});
  }
  if(target.health>0)throw new Error('Target did not fall to real hitscan');
 }
 return {test:'bloodstrike-first-round',phase:s.phase,kills:p.kills,money:p.money,score:[s.blueScore,s.redScore],passed:s.phase==='roundEnd'&&s.blueScore===1&&p.money===800+p.kills*600};
}

/** Authored debug-panel scenarios. Real fire/contact and public mode actions
 * drive the transitions; only target positions and HP are arranged for speed. */
export function offlineModeQA(sim:Simulation,scenario:'race-win'|'defense-upgrade'|'defense-win'|'defense-loss'){
 const contact=(victimId:number)=>{
  const p=sim.state.player,v=sim.state.actors[victimId];
  Object.assign(p,{x:0,z:16,y:0,groundY:0,yaw:0,pitch:0,health:100,armor:100,spread:0,spawnProtectionUntil:0});
  Object.assign(v,{x:0,z:14.8,y:0,groundY:0,health:1,armor:0,spawnProtectionUntil:0});
  const gun=p.guns[p.weapon];gun.cooldown=0;gun.reloadLeft=0;gun.ammo=LOADOUTS[p.weapon].magazine;
  advanceWeaponSwitch(p,.6);sim.fire(p);if(p.weapon==='knife')for(let i=0;i<18;i++)sim.update(1/60,EMPTY_INPUT);
 };
 if(scenario==='race-win'){
  sim.start('armsRace');for(const a of sim.state.actors){a.health=0;a.respawnAt=Infinity;}
  for(let i=0;i<13;i++)contact(1);
 }else{
  sim.start('defense');
  if(scenario==='defense-loss'){
   sim.startDefenseWave();sim.state.defense!.health=.01;
   Object.assign(sim.state.actors[3],{...sim.state.defense!.site,x:sim.state.defense!.site.x+.8,health:100});sim.update(1/60,EMPTY_INPUT);
  }else{
   const waves=scenario==='defense-upgrade'?2:8;
   for(let wave=0;wave<waves;wave++){
    if(sim.state.defense!.upgradePending)sim.chooseDefenseUpgrade('reload');
    sim.startDefenseWave();for(const a of sim.state.actors.filter(a=>a.team==='red'&&a.health>0))contact(a.id);sim.update(1/60,EMPTY_INPUT);
   }
  }
 }
}
