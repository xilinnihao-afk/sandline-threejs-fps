import {WEAPON_KINDS} from './types';
import type {Actor,GameEvent,WeaponKind,GameSnapshot} from './types';
import {ITEM_PRICES,LOADOUTS,type ArsenalItem} from './loadouts';

export const STARTING_MONEY=800;
export const KILL_REWARD=300, DEATH_PENALTY=200, MONEY_CAP=16000;
export const BUY_SECONDS=20;
export function purchaseWindow(state:GameSnapshot,actor=state.player):{allowed:boolean;reason:string}{
 if(actor.health<=0)return {allowed:false,reason:"阵亡后无法购买"};
 if(state.phase!=="playing")return {allowed:false,reason:"当前阶段不能购买"};
 if(state.roundTime<105-BUY_SECONDS)return {allowed:false,reason:"购买时间已结束"};
 if(actor.team==="blue"?actor.z<14:actor.z>-14)return {allowed:false,reason:"请返回出生区域购买"};
 return {allowed:true,reason:`购买剩余 ${Math.ceil(state.roundTime-85)} 秒（出生区域）`};
}
export function killEconomy(killer:Actor,victim:Actor):void{
 if(killer!==victim&&killer.team!==victim.team)killer.money=Math.min(MONEY_CAP,killer.money+KILL_REWARD);
 victim.money=Math.max(0,victim.money-DEATH_PENALTY);
}

export const WIN_REWARD=3250;
export const LOSS_REWARDS=[1400,1900,2400,2900,3400];
export function itemPrice(item:ArsenalItem):number{return item in LOADOUTS ? LOADOUTS[item as WeaponKind].price : ITEM_PRICES[item as Exclude<ArsenalItem,WeaponKind>];}
export function resetEconomy(actor:Actor,money=STARTING_MONEY):void{actor.money=money;actor.armor=0;actor.defuseKit=false;actor.hasBomb=false;actor.grenades=1;actor.grenadePurchases=0;}
export function buy(actor:Actor,item:ArsenalItem,events?:GameEvent[]):boolean{
  if(item==='flash'||item==='smoke')return false;
  if(item in LOADOUTS&&!WEAPON_KINDS.includes(item as WeaponKind))return false;
  const price=itemPrice(item);if(actor.money<price||actor.health<=0)return false;
  if(item==='armor'){if(actor.armor>=100)return false;actor.armor=100;}
  else if(item==='defuseKit'){if(actor.faction!=='ct'||actor.defuseKit)return false;actor.defuseKit=true;}
  else if(item==='he'){if(actor.grenades>=2||(actor.grenadePurchases??0)>=2)return false;actor.grenades++;actor.grenadePurchases=(actor.grenadePurchases??0)+1;}
  else {actor.weapon=item;const gun=actor.guns[item];gun.ammo=LOADOUTS[item].magazine;gun.reserve=LOADOUTS[item].reserve;gun.reloadLeft=0;gun.cooldown=0;}
  actor.money-=price;events?.push({type:'buy',actorId:actor.id,item,amount:price});return true;
}
export function roundReward(actor:Actor,won:boolean,lossStreak:number):number{
  const amount=won?WIN_REWARD:LOSS_REWARDS[Math.max(0,Math.min(LOSS_REWARDS.length-1,lossStreak))];actor.money=Math.min(16000,actor.money+amount);return amount;
}
