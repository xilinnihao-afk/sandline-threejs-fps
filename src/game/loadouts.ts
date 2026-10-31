import type {WeaponKind} from './types';
import {MELEE_ATTACKS} from './melee';

export type ArsenalItem = WeaponKind|'armor'|'defuseKit'|'he'|'ammo'|'flash'|'smoke';
export interface LoadoutSpec {
  id:WeaponKind; name:string; family:'rifle'|'smg'|'shotgun'|'pistol'|'sniper'|'melee'; price:number;
  magazine:number; reserve:number; damage:number; head:number; interval:number; reload:number; spread:number; pellets:number;
}

// GoldSrc-inspired roles with original names and values tuned for a short 3v3 mobile match.
export const LOADOUTS:Record<WeaponKind,LoadoutSpec> = {
  knife:{id:'knife',name:'经典匕首',family:'melee',price:0,magazine:0,reserve:0,damage:MELEE_ATTACKS.slash.damage,head:MELEE_ATTACKS.slash.damage,interval:MELEE_ATTACKS.slash.interval,reload:0,spread:0,pellets:0},
  rifle:{id:'rifle',name:'AK-47 沙砾',family:'rifle',price:2700,magazine:30,reserve:90,damage:27,head:84,interval:.115,reload:2.15,spread:.006,pellets:1},
  pistol:{id:'pistol',name:'USP 哨兵',family:'pistol',price:200,magazine:12,reserve:48,damage:24,head:66,interval:.29,reload:1.45,spread:.004,pellets:1},
  deagle:{id:'deagle',name:'沙漠之鹰 .50AE',family:'pistol',price:1200,magazine:8,reserve:40,damage:62,head:155,interval:.42,reload:1.9,spread:.006,pellets:1},
  m4:{id:'m4',name:'M4 卡宾步枪',family:'rifle',price:3100,magazine:30,reserve:90,damage:25,head:80,interval:.095,reload:2.3,spread:.0045,pellets:1},
  sniper:{id:'sniper',name:'AWP 狙击步枪',family:'sniper',price:4750,magazine:10,reserve:25,damage:125,head:200,interval:1.25,reload:3.1,spread:.0015,pellets:1},
  smg:{id:'smg',name:'MP5 砂蜂',family:'smg',price:1500,magazine:30,reserve:120,damage:17,head:48,interval:.075,reload:1.9,spread:.014,pellets:1},
  shotgun:{id:'shotgun',name:'Nova 泵动',family:'shotgun',price:1050,magazine:8,reserve:32,damage:12,head:22,interval:.88,reload:3.1,spread:.13,pellets:8},
};

export const EXTRA_LOADOUTS = [
  {id:'scout',name:'Scout 轻骑',price:2750,role:'sniper'},
  {id:'glock',name:'Glock 砂针',price:200,role:'pistol'},
  {id:'p250',name:'P250 边角',price:300,role:'pistol'},
] as const;

export const ITEM_PRICES:Record<Exclude<ArsenalItem,WeaponKind>,number> = {armor:650,defuseKit:400,he:300,ammo:200,flash:200,smoke:300};
