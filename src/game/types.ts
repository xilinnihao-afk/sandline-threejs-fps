import type {DefenseState} from './offlineModes';
import type {WeaponSwitch} from './weaponSwitch';
export type Team = 'blue' | 'red';
export type GameMode = 'deathmatch' | 'knifeOnly' | 'pistolOnly' | 'elimination' | 'demolition' | 'hostageRescue' | 'armsRace' | 'defense' | 'bounty';
export type FirearmKind = 'rifle' | 'pistol' | 'smg' | 'shotgun' | 'm4' | 'sniper' | 'deagle';
export type WeaponKind = FirearmKind | 'knife';
export type MeleeAttack = 'slash' | 'stab';
export type ImpactSurface = 'wall' | 'crate' | 'metal' | 'ground' | 'character';
// One catalog for firing, owned inventory, pickups, rendering and controls.
// Preserve existing number keys: knife remains 7; Desert Eagle is 8.
export const WEAPON_KINDS:WeaponKind[] = ['rifle','pistol','smg','shotgun','m4','sniper','knife','deagle'];
export const FIREARM_KINDS=WEAPON_KINDS.filter((kind):kind is FirearmKind=>kind!=='knife');
export const isHandgun=(kind:WeaponKind):boolean=>kind==='pistol'||kind==='deagle';
export type Phase = 'menu' | 'intermission' | 'prep' | 'playing' | 'planted' | 'roundEnd' | 'matchEnd';
export type Faction = 'ct' | 't';
export type BombStatus = 'carried' | 'dropped' | 'planted' | 'defused' | 'exploded';
export interface ObjectiveSite { id:'A'|'B'; x:number; y?:number; z:number; radius:number; bounds?:{minX:number;maxX:number;minY:number;maxY:number;minZ:number;maxZ:number}; }
export interface BombState { status:BombStatus; carrierId:number|null; x:number; y?:number; z:number; site:'A'|'B'|null; timer:number; progress:number; defuserId:number|null; planterId?:number|null; plantProgress?:number; plantSite?:'A'|'B'|null; }
export interface HostageState {id:number;x:number;y:number;z:number;yaw:number;status:'waiting'|'following'|'rescued';leaderId:number|null;moving:boolean;crouched:boolean;}
export interface RescueZone {id:string;x:number;y:number;z:number;radius:number;}
export interface RescueState {hostages:HostageState[];zones:RescueZone[];rescued:number;total:number;}
export interface PlayerInput { fireHeld?:boolean; sprint?:boolean; inputSource?:'touch'|'mouse'|'gyro'; aiming?:boolean; gyroDX?:number; gyroDY?:number; secondaryFire?:boolean; jump:boolean; moveX:number; moveZ:number; lookDX:number; lookDY:number; fire:boolean; reload:boolean; switchWeapon:WeaponKind|null; grenade:boolean; crouch:boolean; pause:boolean; interact:boolean; }
export const EMPTY_INPUT:PlayerInput = {sprint:false,jump:false,moveX:0,moveZ:0,lookDX:0,lookDY:0,fire:false,reload:false,switchWeapon:null,grenade:false,crouch:false,pause:false,interact:false};
export interface Gun { ammo:number; reserve:number; reloadLeft:number; cooldown:number; }
export interface GroundWeapon { expiresAt?:number; id:number; weapon:WeaponKind; x:number; y?:number; z:number; ammo:number; reserve:number; }
export interface Actor { sprinting?:boolean; moveSpeed?:number; weaponSwitch?:WeaponSwitch; climbing?:boolean; active?:boolean; raceStage?:number; raceKills?:number; meleeAttack?:MeleeAttack; y?:number; groundY?:number; verticalSpeed?:number; respawnAt?:number; spawnedAt?:number; spawnProtectionUntil?:number; id:number; name:string; team:Team; faction:Faction; player:boolean; x:number; z:number; yaw:number; pitch:number; health:number; armor:number; money:number; crouched:boolean; moving:boolean; weapon:WeaponKind; inventory:WeaponKind[]; guns:Record<WeaponKind,Gun>; grenades:number; grenadePurchases?:number; throwTime:number; kills:number; deaths:number; shotTime:number; hurtTime:number; spread:number; hasBomb:boolean; defuseKit:boolean; }
export interface Grenade { id:number; ownerId:number; x:number; y:number; z:number; vx:number; vy:number; vz:number; fuse:number; bounces:number; }
export type GyroMode='off'|'aim'|'always';
export interface Settings { gyroMode:GyroMode; gyroSensitivity:number; fireDrag:boolean; viewScale:number; sensitivity:number; volume:number; aimAssist:boolean; quality:'low'|'high'; }
export const DEFAULT_SETTINGS:Settings={gyroMode:'off',gyroSensitivity:1,fireDrag:true,viewScale:1,sensitivity:1,volume:.6,aimAssist:true,quality:'low'};
export interface FeedEntry { killer:string; victim:string; team:Team; headshot:boolean; at:number; }
export interface GameSnapshot { rescue?:RescueState; roundReason?:string; race?:{winnerId:number|null;alert:string;alertUntil:number}; defense?:DefenseState; phase:Phase; paused:boolean; time:number; round:number; roundTime:number; blueScore:number; redScore:number; winner:Team|'draw'|null; actors:Actor[]; pickups:GroundWeapon[]; grenades:Grenade[]; player:Actor; spectating:Actor|null; settings:Settings; feed:FeedEntry[]; hitMarker:number; damageAngle:number; totalKills:number; totalDeaths:number; mode:GameMode; bomb:BombState; sites:ObjectiveSite[]; }
export type HitRegion = 'head'|'chest'|'abdomen'|'arm'|'leg';
export interface GameEvent { hitRegion?:HitRegion; healthDamage?:number; armorDamage?:number; stepSurface?:'ground'|'snow'; meleeAttack?:MeleeAttack; crouched?:boolean; occluded?:boolean; type:'hostageFollow'|'hostageWait'|'hostageRescued'|'respawn'|'melee'|'shot'|'hit'|'kill'|'reload'|'round'|'step'|'grenadeThrow'|'explosion'|'impact'|'bombPickup'|'bombDrop'|'plantStart'|'plantComplete'|'defuseStart'|'defuseComplete'|'bombTick'|'bombExplode'|'buy'|'roundReward'|'weaponPickup'|'weaponRack'; actorId?:number; targetId?:number; x?:number; y?:number; z?:number; endX?:number; endY?:number; endZ?:number; ejectX?:number; ejectY?:number; ejectZ?:number; normalX?:number; normalY?:number; normalZ?:number; headshot?:boolean; weapon?:WeaponKind; surface?:ImpactSurface; shells?:number; pelletCount?:number; tracer?:boolean; item?:string; amount?:number; site?:'A'|'B'; }
export interface MapBox { x:number; z:number; w:number; d:number; h:number; kind:'wall'|'crate'|'container'; }
