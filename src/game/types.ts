export type Team = 'blue' | 'red';
export type WeaponKind = 'rifle' | 'pistol' | 'smg' | 'shotgun';
export type ImpactSurface = 'wall' | 'crate' | 'metal' | 'ground' | 'character';
// 全部入口共用当前开放的枪械列表。旧模型类型仅留作内部兼容。
export const WEAPON_KINDS:WeaponKind[] = ['rifle','pistol'];
export type Phase = 'menu' | 'prep' | 'playing' | 'planted' | 'roundEnd' | 'matchEnd';
export type Faction = 'ct' | 't';
export type BombStatus = 'carried' | 'dropped' | 'planted' | 'defused' | 'exploded';
export interface ObjectiveSite { id:'A'|'B'; x:number; z:number; radius:number; }
export interface BombState { status:BombStatus; carrierId:number|null; x:number; z:number; site:'A'|'B'|null; timer:number; progress:number; defuserId:number|null; }
export interface PlayerInput { moveX:number; moveZ:number; lookDX:number; lookDY:number; fire:boolean; reload:boolean; switchWeapon:WeaponKind|null; grenade:boolean; crouch:boolean; pause:boolean; interact:boolean; }
export const EMPTY_INPUT:PlayerInput = {moveX:0,moveZ:0,lookDX:0,lookDY:0,fire:false,reload:false,switchWeapon:null,grenade:false,crouch:false,pause:false,interact:false};
export interface Gun { ammo:number; reserve:number; reloadLeft:number; cooldown:number; }
export interface Actor { id:number; name:string; team:Team; faction:Faction; player:boolean; x:number; z:number; yaw:number; pitch:number; health:number; armor:number; money:number; crouched:boolean; moving:boolean; weapon:WeaponKind; guns:Record<WeaponKind,Gun>; grenades:number; throwTime:number; kills:number; deaths:number; shotTime:number; hurtTime:number; spread:number; hasBomb:boolean; defuseKit:boolean; }
export interface Grenade { id:number; ownerId:number; x:number; y:number; z:number; vx:number; vy:number; vz:number; fuse:number; bounces:number; }
export interface Settings { sensitivity:number; volume:number; aimAssist:boolean; quality:'low'|'high'; }
export const DEFAULT_SETTINGS:Settings={sensitivity:1,volume:.6,aimAssist:true,quality:'low'};
export interface FeedEntry { killer:string; victim:string; team:Team; headshot:boolean; at:number; }
export interface GameSnapshot { phase:Phase; paused:boolean; time:number; round:number; roundTime:number; blueScore:number; redScore:number; winner:Team|'draw'|null; actors:Actor[]; grenades:Grenade[]; player:Actor; spectating:Actor|null; settings:Settings; feed:FeedEntry[]; hitMarker:number; damageAngle:number; totalKills:number; totalDeaths:number; mode:'elimination'|'demolition'; bomb:BombState; sites:ObjectiveSite[]; }
export interface GameEvent { crouched?:boolean; occluded?:boolean; type:'shot'|'hit'|'kill'|'reload'|'round'|'step'|'grenadeThrow'|'explosion'|'impact'|'bombPickup'|'bombDrop'|'plantStart'|'plantComplete'|'defuseStart'|'defuseComplete'|'bombTick'|'bombExplode'|'buy'|'roundReward'; actorId?:number; targetId?:number; x?:number; y?:number; z?:number; endX?:number; endY?:number; endZ?:number; ejectX?:number; ejectY?:number; ejectZ?:number; normalX?:number; normalY?:number; normalZ?:number; headshot?:boolean; weapon?:WeaponKind; surface?:ImpactSurface; shells?:number; pelletCount?:number; tracer?:boolean; item?:string; amount?:number; site?:'A'|'B'; }
export interface MapBox { x:number; z:number; w:number; d:number; h:number; kind:'wall'|'crate'|'container'; }
