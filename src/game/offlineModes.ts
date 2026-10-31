import type {Actor,GameMode,WeaponKind} from './types';
import {getActiveMap,type MapId} from './map';

export const PLAYABLE_MODES = {
 deathmatch:{name:'自由交火',description:'蓝红小队持续交战 · 阵亡 3 秒复活'},
 knifeOnly:{name:'刀战',description:'全员仅用匕首 · 劈砍与刺击 · 阵亡 3 秒复活'},
 pistolOnly:{name:'手枪战',description:'全员仅用 USP · 无限备用弹药，仍需换弹 · 阵亡 3 秒复活'},
 armsRace:{name:'军备竞赛',description:'所有人都是对手 · 每 2 杀升枪 · 最后匕首决胜'},
 defense:{name:'据点守卫',description:'你与 2 名队友坚守 8 波 · 波间补给 · 三选一强化'},
 demolition:{name:'爆破行动',description:'T 安放 C4 并引爆 · CT 歼敌或拆弹 · 先赢 3 回合'},
 hostageRescue:{name:'解救人质',description:'CT 护送 4 名人质至救援区 · T 阻止救援 · 先赢 3 回合'},
 bounty:{name:'自由交火 · 赏金回合',description:'3v3 / 5v5 / 8v8 / 10v10 · 首局手枪 · 赏金跨局买枪 · 全歼赢一局 · 先赢 3 回合'},
} as const;
export type PlayableMode=keyof typeof PLAYABLE_MODES;
export function mapPlayableModes(mapId:MapId=getActiveMap().id):PlayableMode[]{return mapId==='bloodstrike'?['bounty']:mapId==='assault'?['hostageRescue']:mapId==='dust2'?['demolition']:['deathmatch','knifeOnly','pistolOnly','armsRace','defense'];}
export function modeForMap(requested:GameMode,mapId:MapId=getActiveMap().id):GameMode{return mapId==='bloodstrike'?'bounty':mapId==='assault'?'hostageRescue':mapId==='dust2'?'demolition':requested==='bounty'||requested==='demolition'||requested==='hostageRescue'?'deathmatch':requested;}
export const BOUNTY_KILL_REWARD=600;
export const MODE_STORAGE_KEY='sandline-mode-v1';
export function parseMode(value:string|null):PlayableMode{return value&&Object.hasOwn(PLAYABLE_MODES,value)?value as PlayableMode:'deathmatch';}
export function restrictedWeapon(mode:GameMode):'knife'|'pistol'|null{return mode==='knifeOnly'?'knife':mode==='pistolOnly'?'pistol':null;}
export function isTeamDeathmatch(mode:GameMode):boolean{return mode==='deathmatch'||restrictedWeapon(mode)!==null;}
export function hasRespawns(mode:GameMode):boolean{return isTeamDeathmatch(mode)||mode==='armsRace';}
export function hasUnlimitedReserve(mode:GameMode):boolean{return mode==='armsRace'||mode==='pistolOnly';}
export function allowsPickups(mode:GameMode):boolean{return mode!=='bounty'&&mode!=='armsRace'&&!restrictedWeapon(mode);}
export function allowsWeapon(mode:GameMode,kind:WeaponKind):boolean{const only=restrictedWeapon(mode);return !only||kind===only;}
export const RACE_LADDER:readonly WeaponKind[]=['rifle','m4','smg','shotgun','sniper','pistol','knife'];
export const RACE_KILLS_PER_STAGE=2;
export function areEnemies(a:Actor,b:Actor,mode:GameMode='deathmatch'):boolean{return a.id!==b.id&&(mode==='armsRace'||a.team!==b.team);}
export function raceRanking(actors:readonly Actor[]){return [...actors].sort((a,b)=>(b.raceStage??0)-(a.raceStage??0)||(b.raceKills??0)-(a.raceKills??0)||a.deaths-b.deaths||a.id-b.id).map((actor,i)=>({actor,rank:i+1}));}
export const DEFENSE_WAVES=8;
export const DEFENSE_WAVE_SECONDS=210;
export const DEFENSE_UPGRADES={
 reload:{name:'快速装填',description:'你的换弹时间 −10%，最多 −30%'},
 armor:{name:'加固护甲',description:'全队波间护甲 +15，最高 95'},
 heal:{name:'战斗急救',description:'你每次击杀恢复 6 生命，最高 18'},
} as const;
export type DefenseUpgrade=keyof typeof DEFENSE_UPGRADES;
export interface DefenseState {
 wave:number; completed:number; total:number; health:number; maxHealth:number;
 site:{x:number;y:number;z:number;radius:number};
 enemiesTotal:number; remaining:number; attackers:number; timeLeft:number;
 upgradePending:boolean; upgrades:Record<DefenseUpgrade,number>; reason:string;
}
export function createDefense():DefenseState{
 const point=getActiveMap().blueSpawns[0];
 return {wave:0,completed:0,total:DEFENSE_WAVES,health:100,maxHealth:100,site:{x:point.x,y:point.y??0,z:point.z,radius:3},enemiesTotal:0,remaining:0,attackers:0,timeLeft:DEFENSE_WAVE_SECONDS,upgradePending:false,upgrades:{reload:0,armor:0,heal:0},reason:''};
}
export function defenseWave(wave:number):{weapon:WeaponKind;armor:number}[]{
 const count=Math.min(10,3+wave);
 const weapons:WeaponKind[]=wave<=2?['pistol','smg','smg','rifle']:wave<=4?['smg','rifle','shotgun','m4']:wave<=6?['rifle','m4','shotgun','sniper','smg']:['m4','rifle','sniper','shotgun','smg'];
 return Array.from({length:count},(_,i)=>({weapon:weapons[i%weapons.length],armor:wave>=7?40:wave>=4?20:0}));
}
