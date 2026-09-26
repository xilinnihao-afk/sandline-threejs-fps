import {WEAPON_KINDS} from './types';
import type {Actor,GameEvent,WeaponKind} from './types';
import {ITEM_PRICES,LOADOUTS,type ArsenalItem} from './loadouts';

export const STARTING_MONEY=800;
export const WIN_REWARD=3250;
export const LOSS_REWARDS=[1400,1900,2400,2900,3400];
export function itemPrice(item:ArsenalItem):number{return item in LOADOUTS ? LOADOUTS[item as WeaponKind].price : ITEM_PRICES[item as Exclude<ArsenalItem,WeaponKind>];}
export function resetEconomy(actor:Actor,money=STARTING_MONEY):void{actor.money=money;actor.armor=0;actor.defuseKit=false;actor.hasBomb=false;actor.grenades=1;}
export function buy(actor:Actor,item:ArsenalItem,events?:GameEvent[]):boolean{
  if(item in LOADOUTS&&!WEAPON_KINDS.includes(item as WeaponKind))return false;
  const price=itemPrice(item);if(actor.money<price||actor.health<=0)return false;
  if(item==='armor'){if(actor.armor>=100)return false;actor.armor=100;}
  else if(item==='defuseKit'){if(actor.faction!=='ct'||actor.defuseKit)return false;actor.defuseKit=true;}
  else if(item==='he'||item==='flash'||item==='smoke'){if(actor.grenades>=2)return false;actor.grenades++;}
  else {actor.weapon=item;const gun=actor.guns[item];gun.ammo=LOADOUTS[item].magazine;gun.reserve=LOADOUTS[item].reserve;gun.reloadLeft=0;gun.cooldown=0;}
  actor.money-=price;events?.push({type:'buy',actorId:actor.id,item,amount:price});return true;
}
export function roundReward(actor:Actor,won:boolean,lossStreak:number):number{
  const amount=won?WIN_REWARD:LOSS_REWARDS[Math.max(0,Math.min(LOSS_REWARDS.length-1,lossStreak))];actor.money=Math.min(16000,actor.money+amount);return amount;
}
