import type {Actor,GameEvent,GameSnapshot,WeaponKind} from './types';
import {LOADOUTS} from './loadouts';
import {buy,purchaseWindow} from './economy';
import {setEquippedWeapon} from './weaponSelection';

/** Everyone starts on equal pistols. Only a survivor's purchased kit carries over. */
export function prepareBountyRound(state:GameSnapshot,previous:readonly Actor[],events:GameEvent[],allBots=false):void {
 state.roundTime=0;state.pickups=[];
 for(const actor of state.actors){
  const survivor=state.round>1?previous.find(a=>a.id===actor.id&&a.health>0):undefined;
  actor.inventory=survivor?[...survivor.inventory]:['pistol','knife'];
  actor.armor=survivor?.armor??0;actor.grenades=survivor?.grenades??0;actor.grenadePurchases=0;
  if(survivor)for(const kind of actor.inventory){
   actor.guns[kind]={...survivor.guns[kind],cooldown:0,reloadLeft:0};
   // Finish loading from the survivor's own reserve, without granting free ammo.
   if(kind!=='knife'){
    const gun=actor.guns[kind],rounds=Math.min(LOADOUTS[kind].magazine-gun.ammo,gun.reserve);
    gun.ammo+=rounds;gun.reserve-=rounds;
   }
  }
  const equipped=[...actor.inventory].filter(k=>k!=='knife').sort((a,b)=>LOADOUTS[b].price-LOADOUTS[a].price)[0]??'pistol';
  setEquippedWeapon(actor,equipped);
  if(state.round>1&&(!actor.player||allBots))buyBotLoadout(state,actor,events);
 }
}

/** Bots spend the same carried balance, through the same shop checks as the player. */
function buyBotLoadout(state:GameSnapshot,actor:Actor,events:GameEvent[]):void {
 const buyAllowed=(kind:Parameters<typeof buy>[1])=>purchaseWindow(state,actor,kind).allowed&&buy(actor,kind,events);
 const choices:WeaponKind[]=actor.id%4===0?['sniper','m4','rifle','smg','deagle','shotgun']:['m4','rifle','smg','deagle','shotgun'];
 const upgrade=choices.find(kind=>LOADOUTS[kind].price<=actor.money&&LOADOUTS[kind].price>LOADOUTS[actor.weapon].price);
 if(upgrade)buyAllowed(upgrade);
 if(actor.guns[actor.weapon].reserve<LOADOUTS[actor.weapon].magazine)buyAllowed('ammo');
 // Keep savings for an upgrade until a primary weapon has been earned.
 if(LOADOUTS[actor.weapon].family!=='pistol'&&actor.armor<50)buyAllowed('armor');
}
