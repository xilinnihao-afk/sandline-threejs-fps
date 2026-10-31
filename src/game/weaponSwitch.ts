import type {Actor,WeaponKind,MeleeAttack,GameEvent} from './types';

export interface WeaponSwitch {
 displayed:WeaponKind;
 phase:'holster'|'draw'|'rack'|'ready';
 /** 0 = held, 1 = fully below the screen. Retargeting keeps this continuous. */
 depth:number;
 /** Chambering progress is retained when a switch is interrupted/reversed. */
 rackProgress:number;
 shotTime:number;
 meleeAttack?:MeleeAttack;
}
export const weaponSwitchTiming=(kind:WeaponKind)=>kind==='sniper'
 ?{holster:.20,draw:.28,rack:.54}:kind==='knife'?{holster:.18,draw:.24,rack:0}:{holster:.18,draw:.24,rack:kind==='shotgun'?.42:.46};

export function resetWeaponSwitch(actor:Actor):void {actor.weaponSwitch=undefined;}
export function weaponReady(actor:Actor):boolean {
 return !actor.weaponSwitch||actor.weaponSwitch.phase==='ready'&&actor.weaponSwitch.displayed===actor.weapon;
}
/** Called before changing actor.weapon; bots keep their existing equip rules. */
export function requestWeaponSwitch(actor:Actor,kind:WeaponKind):void {
 if(!actor.player)return;
 const state=actor.weaponSwitch??={displayed:actor.weapon,phase:'ready',depth:0,rackProgress:1,shotTime:actor.shotTime,meleeAttack:actor.meleeAttack};
 if(state.phase==='ready'&&actor.shotTime>=state.shotTime){state.shotTime=actor.shotTime;state.meleeAttack=actor.meleeAttack;}
 state.phase=kind===state.displayed?(state.depth>0?'draw':state.rackProgress<1?'rack':'ready'):'holster';
}

export function advanceWeaponSwitch(actor:Actor,dt:number,events?:GameEvent[]):void {
 const state=actor.weaponSwitch;
 if(!state||actor.health<=0||dt<=0)return;
 // Consume the boundary remainder so 30/60/120 Hz have identical timing.
 if(state.phase==='holster'){
  const duration=weaponSwitchTiming(state.displayed).holster;
  const left=(1-state.depth)*duration;
  if(dt<left){state.depth+=dt/duration;return;}
  dt-=left;state.depth=1;state.displayed=actor.weapon;state.phase='draw';state.rackProgress=state.displayed==='knife'?1:0;state.shotTime=-10;state.meleeAttack=undefined;
 }
 if(state.phase==='draw'){
  const duration=weaponSwitchTiming(state.displayed).draw,left=state.depth*duration;
  if(dt<left-1e-9){state.depth-=dt/duration;return;}
  dt=Math.max(0,dt-left);state.depth=0;state.phase=state.rackProgress<1?'rack':'ready';
 }
 if(state.phase==='rack'){
  const previous=state.rackProgress;
  state.rackProgress=Math.min(1,state.rackProgress+dt/weaponSwitchTiming(state.displayed).rack);
  if(previous<.30&&state.rackProgress>=.30)events?.push({type:'weaponRack',actorId:actor.id,weapon:state.displayed});
  if(state.rackProgress>1-1e-9){state.rackProgress=1;state.phase='ready';}
 }
}

const ease=(a:number,b:number,t:number)=>{const x=Math.max(0,Math.min(1,(t-a)/(b-a)));return x*x*(3-2*x);};
/** Shared switch-only hand/control motion; never changes ammunition. */
export function weaponRackPose(actor:Actor,kind:WeaponKind){
 const state=actor.weaponSwitch,p=state?.rackProgress??1;
 const active=kind!=='knife'&&state?.displayed===kind&&p<1&&p>0;
 const visibility=active?1-ease(0,1,state!.depth):0;
 const reach=ease(0,.28,p)*(1-ease(.76,1,p))*visibility;
 const pull=ease(.30,.55,p)*(1-ease(.61,.76,p))*visibility;
 const turn=ease(.17,.32,p)*(1-ease(.75,.87,p))*visibility;
 return {active:!!active,progress:active?p:0,reach,pull,turn,phase:active?(p<.30?'equip-reach':p<.61?'equip-pull':p<.78?'equip-release':'equip-return'):'ready'};
}

/** Preserve outgoing recoil / knife recovery after its gameplay attack cancels. */
export function weaponDisplayActor(actor:Actor):Actor {
 const state=actor.weaponSwitch;
 if(!state||state.phase==='ready'&&actor.shotTime>=state.shotTime)return actor;
 return {...actor,weapon:state.displayed,shotTime:state.shotTime,meleeAttack:state.meleeAttack};
}

/** Shared, reversible path for holster/draw; all hand contacts follow this root. */
export function weaponSwitchPose(kind:WeaponKind,depth:number){
 const d=Math.max(0,Math.min(1,depth)),e=d*d*(3-2*d);
 const knife=kind==='knife',heavy=kind==='sniper';
 // Small wrist turn first, then lower out of view. Smooth endpoints avoid a snap.
 const wrist=Math.sin(Math.PI*d)*Math.sin(Math.PI*d);
 return {x:(knife?.09:.06)*e,y:-(heavy?.92:.82)*e,z:.12*e,
  pitch:-(knife?.36:.28)*e,yaw:(knife?-.22:.12)*e,
  roll:(knife?-.24:.15)*e+(knife?-.055:.025)*wrist};
}
