import type {WeaponKind} from './types';

export type ArsenalItem = WeaponKind|'armor'|'defuseKit'|'he'|'flash'|'smoke';
export interface LoadoutSpec {
  id:WeaponKind; name:string; family:'rifle'|'smg'|'shotgun'|'pistol'|'sniper'; price:number;
  magazine:number; reserve:number; damage:number; head:number; interval:number; reload:number; spread:number; pellets:number;
}

// GoldSrc-inspired roles with original names and values tuned for a short 3v3 mobile match.
export const LOADOUTS:Record<WeaponKind,LoadoutSpec> = {
  rifle:{id:'rifle',name:'AK-47 沙砾',family:'rifle',price:2700,magazine:30,reserve:90,damage:27,head:84,interval:.115,reload:2.15,spread:.006,pellets:1},
  pistol:{id:'pistol',name:'USP 哨兵',family:'pistol',price:200,magazine:12,reserve:48,damage:24,head:66,interval:.29,reload:1.45,spread:.004,pellets:1},
  smg:{id:'smg',name:'MP5 砂蜂',family:'smg',price:1500,magazine:30,reserve:120,damage:17,head:48,interval:.075,reload:1.9,spread:.014,pellets:1},
  shotgun:{id:'shotgun',name:'Nova 泵动',family:'shotgun',price:1050,magazine:8,reserve:32,damage:12,head:22,interval:.88,reload:3.1,spread:.13,pellets:8},
};

export const EXTRA_LOADOUTS = [
  {id:'m4a1',name:'M4A1 砂脊',price:3100,role:'rifle'},
  {id:'awp',name:'AWP 长鸣',price:4750,role:'sniper'},
  {id:'scout',name:'Scout 轻骑',price:2750,role:'sniper'},
  {id:'deagle',name:'沙漠之鹰',price:700,role:'pistol'},
  {id:'glock',name:'Glock 砂针',price:200,role:'pistol'},
  {id:'p250',name:'P250 边角',price:300,role:'pistol'},
] as const;

export const ITEM_PRICES:Record<Exclude<ArsenalItem,WeaponKind>,number> = {armor:650,defuseKit:400,he:300,flash:200,smoke:300};
