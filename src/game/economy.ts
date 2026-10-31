import {setEquippedWeapon} from './weaponSelection';
import {WEAPON_KINDS} from './types';
import type {Actor,GameEvent,WeaponKind,GameSnapshot,GameMode} from './types';
import {ITEM_PRICES,LOADOUTS,type ArsenalItem} from './loadouts';
import {getActiveMap} from './map';
import {restrictedWeapon,PLAYABLE_MODES,BOUNTY_KILL_REWARD} from './offlineModes';

export const STARTING_MONEY=800;
export const KILL_REWARD=300, DEATH_PENALTY=200, MONEY_CAP=16000;
export const BUY_SECONDS=20;
export function purchaseWindow(state:GameSnapshot,actor=state.player,item?:ArsenalItem):{allowed:boolean;reason:string}{
 if(restrictedWeapon(state.mode))return {allowed:false,reason:`${PLAYABLE_MODES[state.mode as 'knifeOnly'|'pistolOnly'].name}固定装备，不能购买`};
 if(state.mode==='armsRace')return {allowed:false,reason:'军备竞赛按击杀升级，不能购买'};
 if(state.mode==='defense')return {allowed:state.phase==='intermission'&&actor.health>0,reason:state.phase==='intermission'?'波间补给 · 购买完成后开始下一波':'击退本波后可以补给'};
 if(actor.health<=0)return {allowed:false,reason:"阵亡后无法购买"};
 if(state.phase!=="playing")return {allowed:false,reason:"当前阶段不能购买"};
 if(state.mode==='bounty'){
  if(state.round===1)return {allowed:false,reason:'首局手枪局 · 赏金留到下回合购买'};
  const spawns=actor.team==='blue'?getActiveMap().blueSpawns:getActiveMap().redSpawns;
  const near=spawns.some(p=>Math.hypot(actor.x-p.x,actor.z-p.z)<7&&Math.abs((actor.y??0)-(p.y??0))<1.5);
  if(!near)return {allowed:false,reason:'请返回己方出生补给区购买'};
  if(item==='he'&&state.time-(actor.spawnedAt??0)>BUY_SECONDS)return {allowed:false,reason:'本回合手雷购买时间已结束'};
  return {allowed:true,reason:'己方补给区可购买 · 手雷限开局 20 秒 · 商店内暂停战斗'};
 }
 if(state.mode==='deathmatch'){
  if(state.time-(actor.spawnedAt??0)>BUY_SECONDS)return {allowed:false,reason:"本次复活的购买时间已结束"};
  const map=getActiveMap(),nearSpawn=map.geometry?[...map.blueSpawns,...map.redSpawns].some(p=>Math.hypot(actor.x-p.x,actor.z-p.z)<7&&Math.abs((actor.y??0)-(p.y??0))<1.5):Math.abs(actor.z)>=14&&Math.abs(actor.z)<map.size.depth/2&&Math.abs(actor.x)<map.size.width/2&&Math.abs(actor.y??0)<1.5;
  if(!nearSpawn)return {allowed:false,reason:"请返回出生区域的补给区购买"};
  return {allowed:true,reason:`购买剩余 ${Math.ceil(BUY_SECONDS-(state.time-(actor.spawnedAt??0)))} 秒（补给区）`};
 }
 if(state.mode==='demolition'||state.mode==='hostageRescue'){
  const elapsed=state.time-(actor.spawnedAt??0),map=getActiveMap(),spawns=actor.faction==='ct'?map.blueSpawns:map.redSpawns;
  if(elapsed>BUY_SECONDS)return {allowed:false,reason:'购买时间已结束'};
  const near=map.geometry?spawns.some(p=>Math.hypot(actor.x-p.x,actor.z-p.z)<7&&Math.abs((actor.y??0)-(p.y??0))<1.5):(actor.team==='blue'?actor.z>=14:actor.z<=-14)&&Math.abs(actor.z)<map.size.depth/2&&Math.abs(actor.x)<map.size.width/2&&Math.abs(actor.y??0)<1.5;
  return {allowed:near,reason:near?`购买剩余 ${Math.ceil(BUY_SECONDS-elapsed)} 秒（出生区域）`:'请返回出生区域购买'};
 }
 if(state.roundTime<105-BUY_SECONDS)return {allowed:false,reason:"购买时间已结束"};
 if(actor.team==="blue"?actor.z<14:actor.z>-14)return {allowed:false,reason:"请返回出生区域购买"};
 return {allowed:true,reason:`购买剩余 ${Math.ceil(state.roundTime-85)} 秒（出生区域）`};
}
export function killEconomy(killer:Actor,victim:Actor,mode:GameMode='deathmatch'):void{
 if(killer!==victim&&killer.team!==victim.team)killer.money=Math.min(MONEY_CAP,killer.money+(mode==='bounty'?BOUNTY_KILL_REWARD:KILL_REWARD));
 if(mode!=='bounty')victim.money=Math.max(0,victim.money-DEATH_PENALTY);
}

export const WIN_REWARD=3250;
export const LOSS_REWARDS=[1400,1900,2400,2900,3400];
export function itemPrice(item:ArsenalItem):number{return item in LOADOUTS ? LOADOUTS[item as WeaponKind].price : ITEM_PRICES[item as Exclude<ArsenalItem,WeaponKind>];}
export function resetEconomy(actor:Actor,money=STARTING_MONEY):void{actor.money=money;actor.armor=0;actor.defuseKit=false;actor.hasBomb=false;actor.grenades=1;actor.grenadePurchases=0;}
/** Shared by the shop and transaction path, including full-stock rejection. */
export function itemAvailability(actor:Actor,item:ArsenalItem):{allowed:boolean;reason:string}{
  if(item==='knife'||item==='flash'||item==='smoke'||!Number.isFinite(itemPrice(item)))return {allowed:false,reason:'当前不出售'};
  if(actor.health<=0)return {allowed:false,reason:'阵亡后无法购买'};
  if(item==='ammo'&&!actor.inventory.some(kind=>kind!=='knife'&&actor.guns[kind].reserve<LOADOUTS[kind].reserve))return {allowed:false,reason:'备用弹药已满'};
  if(item==='armor'&&actor.armor>=100)return {allowed:false,reason:'护甲已满'};
  if(item==='defuseKit'&&(actor.faction!=='ct'||actor.defuseKit))return {allowed:false,reason:actor.defuseKit?'已携带拆弹器':'仅反恐精英可购买'};
  if(item==='he'&&(actor.grenades>=2||(actor.grenadePurchases??0)>=2))return {allowed:false,reason:actor.grenades>=2?'手雷携带已满':'本条生命购买已达上限'};
  if(actor.money<itemPrice(item))return {allowed:false,reason:`还差 $${itemPrice(item)-actor.money}`};
  return {allowed:true,reason:item==='ammo'?'补满所有已持枪械备用弹药':item in LOADOUTS?(actor.inventory.includes(item as WeaponKind)?'重新装备并补满弹药':'购买并装备'):'点击购买'};
}
export function buy(actor:Actor,item:ArsenalItem,events?:GameEvent[]):boolean{
  if(!itemAvailability(actor,item).allowed)return false;
  if(item==='knife'||item==='flash'||item==='smoke')return false;
  if(item in LOADOUTS&&!WEAPON_KINDS.includes(item as WeaponKind))return false;
  const price=itemPrice(item);if(actor.money<price||actor.health<=0)return false;
  if(item==='ammo'){for(const kind of actor.inventory)if(kind!=='knife')actor.guns[kind].reserve=LOADOUTS[kind].reserve;}
  else if(item==='armor'){if(actor.armor>=100)return false;actor.armor=100;}
  else if(item==='defuseKit'){if(actor.faction!=='ct'||actor.defuseKit)return false;actor.defuseKit=true;}
  else if(item==='he'){if(actor.grenades>=2||(actor.grenadePurchases??0)>=2)return false;actor.grenades++;actor.grenadePurchases=(actor.grenadePurchases??0)+1;}
  else {if(!actor.inventory.includes(item))actor.inventory.push(item);setEquippedWeapon(actor,item);const gun=actor.guns[item];gun.ammo=LOADOUTS[item].magazine;gun.reserve=LOADOUTS[item].reserve;gun.reloadLeft=0;gun.cooldown=0;}
  actor.money-=price;events?.push({type:'buy',actorId:actor.id,item,amount:price});return true;
}
export function roundReward(actor:Actor,won:boolean,lossStreak:number):number{
  const amount=won?WIN_REWARD:LOSS_REWARDS[Math.max(0,Math.min(LOSS_REWARDS.length-1,lossStreak))];actor.money=Math.min(16000,actor.money+amount);return amount;
}
