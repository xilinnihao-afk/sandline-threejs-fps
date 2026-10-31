import {prepareBountyRound} from './bountyRounds';
import {rayActorHit,hitRegionDamage,actorHitHeight} from './hitRegions';
import type {HitRegion} from './types';
import {playerMovementSpeed,WALK_SPEED} from './playerMovement';
import {objectiveInteraction,objectiveReachable,insideBombSite,PLANT_SECONDS,BOMB_SECONDS,DEFUSE_SECONDS,KIT_DEFUSE_SECONDS,RESCUE_ROUND_SECONDS,DEMOLITION_ROUND_SECONDS} from './objectiveInteraction';
import {modeForMap,restrictedWeapon,isTeamDeathmatch,hasRespawns,hasUnlimitedReserve,allowsPickups,allowsWeapon,areEnemies,RACE_LADDER,RACE_KILLS_PER_STAGE,createDefense,defenseWave,DEFENSE_WAVE_SECONDS,type PlayableMode,type DefenseUpgrade} from './offlineModes';
import {AimAssist} from './aimAssist';
import {DEFAULT_BOT_COUNTS,MAX_TEAM_SIZE,validBotCounts} from './botRoster';
import {advanceJump,actorBaseY,isAirborne} from './jump';
import {setEquippedWeapon} from './weaponSelection';
import {advanceWeaponSwitch,resetWeaponSwitch,weaponReady} from './weaponSwitch';
import {RESPAWN_DELAY,SPAWN_PROTECTION,chooseRespawn} from './deathmatch';
import { BLUE_SPAWNS,RED_SPAWNS,MAP_BOXES,getActiveMap } from './map';
import {findPath,lineClear,walkSegmentClear,moveBody,rayBox,wallDistance} from './collision';
import {DEFAULT_SETTINGS,EMPTY_INPUT,WEAPON_KINDS,type Actor,type GameEvent,type GameSnapshot,type Gun,type PlayerInput,type Settings,type Team,type WeaponKind,type ObjectiveSite,type GameMode} from './types';
import {avoidActors,type Avoidance} from './botAvoidance';
import {advanceBotMotion,turnBot,type BotMotion} from './botMotion';
import {botObjective,findBotCover,findBotAngle,findBotAdvance,patrolPoint,friendlyBlocksShot,tacticalLineClear,findDefenseFireLane,DEFENSE_CHASE_RADIUS,type TacticalPoint,type CoverPoint} from './botTactics';
import {squadOrder,chooseCombatAction,preferredRange,type SquadRole,type CombatAction} from './botCombat';
import {sampleBlast,sampleBombBlast} from './blast';
import {advanceGrenade} from './grenades';
import {LOADOUTS} from './loadouts';
import {MELEE_ATTACKS} from './melee';
import type {MeleeAttack} from './types';
import {createMapPickups,nearestPickup,takePickup,dropWeapon,addGroundWeapon} from './pickups';
import {buy as buyItem,resetEconomy,roundReward,STARTING_MONEY,killEconomy,purchaseWindow} from './economy';
export const WEAPONS=LOADOUTS;
export const MELEE_REACH=MELEE_ATTACKS.slash.range, MELEE_CONTACT_DELAY=MELEE_ATTACKS.slash.contactDelay;
export const OBJECTIVE_SITES:ObjectiveSite[]=[{id:'A',x:-10,z:-5,radius:2.6},{id:'B',x:10,z:-5,radius:2.6}];
interface Brain {senseAt:number;sensedId:number;pressure:number;exposedFor:number;tactic:CombatAction;squadRole:SquadRole;tacticAt:number;coverUntil:number;shelterUntil:number;supportId:number|null;walkTurn?:{point:TacticalPoint;center:TacticalPoint;until:number;guard:boolean}|null;walkTurnAt?:number;smoothAt?:number;motion:BotMotion;attacker:{id:number;x:number;z:number;y?:number;until:number;turnUntil:number}|null;patrolStep:number;patrolPause:number;pace:number;alertness:number;reposition:TacticalPoint|null;moveUntil:number;nextAngle:number;seenAt:number;avoidance:Avoidance;progressAt:{x:number;z:number};stalled:number;target:number;react:number;repath:number;path:Array<{x:number;z:number;y?:number;crouched?:boolean;ladder?:number}>;strafe:number;memory:{x:number;z:number;y?:number;until:number}|null;cover:CoverPoint|null;decision:number;burst:number;rest:number;goal:string;}
export const eyeHeight=(a:Actor)=>actorBaseY(a)+(a.crouched?(getActiveMap().geometry?.crouchEyeHeight??1.08):1.62);
export const MAX_LOOK_PITCH=80*Math.PI/180;
export const direction=(yaw:number,pitch:number)=>({x:-Math.sin(yaw)*Math.cos(pitch),y:Math.sin(pitch),z:-Math.cos(yaw)*Math.cos(pitch)});
const wrap=(v:number)=>Math.atan2(Math.sin(v),Math.cos(v));
function impactSurface(x:number,y:number,z:number): 'wall'|'crate'|'metal' {
 for(const box of MAP_BOXES){
  const inside=x>=box.x-box.w/2-.08&&x<=box.x+box.w/2+.08&&z>=box.z-box.d/2-.08&&z<=box.z+box.d/2+.08;
  if(!inside)continue;
  const face=Math.min(Math.abs(x-(box.x-box.w/2)),Math.abs(x-(box.x+box.w/2)),Math.abs(z-(box.z-box.d/2)),Math.abs(z-(box.z+box.d/2)),Math.abs(y-box.h));
  if(face<.16)return box.kind==='crate'?'crate':box.kind==='container'?'metal':'wall';
 }
 return 'wall';
}
export class Simulation {
 state:GameSnapshot;
 events:GameEvent[]=[];
 private rngState:number;
 private brains:Brain[]=[];
 private footTimer=0;
 private botFootTimers=new Float32Array(MAX_TEAM_SIZE*2);
 private teammateBots=DEFAULT_BOT_COUNTS.teammates;
 private enemyBots=DEFAULT_BOT_COUNTS.enemies;
 private teamReports=new Map<Team,{x:number;z:number;y?:number;until:number;targetId?:number;reportedAt?:number;availableAt?:number}>();
 setBotCounts(teammates:number,enemies:number):boolean{
  if(this.state.phase!=="menu"||!validBotCounts(teammates,enemies))return false;
  this.teammateBots=teammates;this.enemyBots=enemies;this.refreshMap();return true;
 }
 private grenadeId=0;
 private supplyAt=20;
 private pickupInteractHeld=false;
 private preferredMode:PlayableMode='deathmatch';
 private interactionActors=new Set<number>();
 private hostageActors=new Map<number,{actor:Actor;brain:Brain}>();
 private nextPickupId=1000;
 private readonly touchAssist=new AimAssist();
 private meleePending=new Map<number,{at:number;startedAt:number;attack:MeleeAttack}>();
 private queuedStab:{actor:Actor;shotTime:number}|null=null;
  constructor(seed=20260915,settings:Settings={...DEFAULT_SETTINGS}){
  this.rngState=seed>>>0;const actors=this.makeActors();
  this.state={phase:'menu',paused:false,time:0,round:1,roundTime:15,blueScore:0,redScore:0,winner:null,actors,pickups:createMapPickups(),grenades:[],player:actors[0],spectating:null,settings,feed:[],hitMarker:0,damageAngle:0,totalKills:0,totalDeaths:0,mode:modeForMap('deathmatch'),bomb:{status:'carried',carrierId:0,x:0,z:0,site:null,timer:40,progress:0,defuserId:null},sites:[]};
 }
 random(){let t=this.rngState+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;}
 seed(seed:number){this.rngState=seed>>>0;}
 private gun(kind:WeaponKind):Gun {return {ammo:WEAPONS[kind].magazine,reserve:WEAPONS[kind].reserve,cooldown:0,reloadLeft:0};}
 private makeActors(defense=false):Actor[]{const teammates=defense?2:this.teammateBots,enemies=defense?10:this.enemyBots;return Array.from({length:1+teammates+enemies},(_,id)=>{const blueCount=1+teammates,team=id<blueCount?'blue':'red',faction=id<blueCount?'ct':'t',slot=team==='blue'?id:id-blueCount;const p=(team==='blue'?BLUE_SPAWNS:RED_SPAWNS)[slot];const weapon='rifle';const actor={id,name:id===0?'你':`${team==='blue'?'队友':'对手'} ${team==='blue'?slot:slot+1}`,team,faction,player:id===0,x:p.x,z:p.z,y:p.y??0,groundY:p.y??0,yaw:p.yaw??(team==='blue'?0:Math.PI),pitch:0,health:100,armor:0,money:STARTING_MONEY,crouched:false,moving:false,weapon,inventory:['rifle','pistol','knife'],guns:Object.fromEntries(WEAPON_KINDS.map(kind=>[kind,this.gun(kind)])) as Record<WeaponKind,Gun>,grenades:0,throwTime:-10,kills:0,deaths:0,shotTime:-10,hurtTime:-10,spread:0,hasBomb:false,defuseKit:false} as Actor;return actor;});}
 refreshMap(){if(this.state.phase!=='menu')return;this.state.mode=modeForMap(this.preferredMode);this.state.rescue=undefined;this.state.roundReason=undefined;this.state.sites=[];this.state.actors=this.makeActors();this.state.player=this.state.actors[0];this.state.spectating=null;this.state.grenades=[];this.state.pickups=allowsPickups(this.state.mode)?createMapPickups():[];for(const a of this.state.actors)this.equipRestricted(a);this.teamReports.clear();}
 start(mode:GameMode=modeForMap(this.state.mode)){this.supplyAt=20;this.state.mode=mode;this.state.race=undefined;this.state.defense=undefined;this.state.sites=this.state.mode==='demolition'?(getActiveMap().bombSites??OBJECTIVE_SITES):[];this.state.blueScore=0;this.state.redScore=0;this.state.round=1;this.state.totalKills=0;this.state.totalDeaths=0;this.state.feed=[];this.state.time=0;this.events=[];this.resetRound();}
 resetRound(allBots=false){this.queuedStab=null;this.interactionActors.clear();this.hostageActors.clear();this.state.roundReason=undefined;this.touchAssist.reset();this.meleePending.clear();this.pickupInteractHeld=false;this.nextPickupId=1000;this.teamReports.clear();this.footTimer=0;this.botFootTimers.forEach((_,id)=>{this.botFootTimers[id]=.07+id*.063;});const s=this.state;const previous=s.actors;const stats=s.actors.map(a=>({kills:a.kills,deaths:a.deaths,money:a.money}));s.actors=this.makeActors(s.mode==='defense');s.grenades=[];s.pickups=createMapPickups();s.actors.forEach((a,i)=>{if(s.round>1)Object.assign(a,stats[i]);resetEconomy(a,a.money);a.spawnedAt=s.time;a.respawnAt=0;a.spawnProtectionUntil=0;});const carrier=s.actors.find(a=>a.faction==='t');if(carrier&&s.mode==='demolition')carrier.hasBomb=true;s.player=s.actors[0];s.spectating=null;s.phase='playing';s.roundTime=isTeamDeathmatch(s.mode)?0:s.mode==='hostageRescue'?RESCUE_ROUND_SECONDS:s.mode==='demolition'?DEMOLITION_ROUND_SECONDS:105;s.paused=false;s.winner=null;s.hitMarker=0;s.bomb={status:'carried',carrierId:carrier?.id??3,x:0,z:0,site:null,y:0,timer:BOMB_SECONDS,progress:0,defuserId:null,planterId:null,plantProgress:0,plantSite:null};s.rescue=s.mode==='hostageRescue'?{hostages:(getActiveMap().hostageSpawns??[]).map(h=>({...h})),zones:(getActiveMap().rescueZones??[]).map(z=>({...z})),rescued:0,total:getActiveMap().hostageSpawns?.length??0}:undefined;this.brains=s.actors.map(a=>this.newBrain(a));this.events.push({type:'round'});this.setupOfflineMode(previous,allBots);for(const a of s.actors)resetWeaponSwitch(a);}
 private setupOfflineMode(previous:readonly Actor[],allBots=false){
  const s=this.state;
  if(s.mode==='bounty'){
   prepareBountyRound(s,previous,this.events,allBots);
  }else if(restrictedWeapon(s.mode)){
   s.pickups=[];for(const a of s.actors)this.equipRestricted(a);
  }else if(s.mode==='armsRace'){
   s.race={winnerId:null,alert:'',alertUntil:0};s.roundTime=0;s.pickups=[];
   // Reserve unplaced slots so the initial FFA uses both sides of the arena.
   for(const a of s.actors){a.health=0;a.raceStage=0;a.raceKills=0;}
   for(const a of s.actors){const point=chooseRespawn(a,s.actors,s.mode);Object.assign(a,point,{y:point.y??0,groundY:point.y??0,health:100,armor:0,money:0,grenades:0,spawnProtectionUntil:SPAWN_PROTECTION});a.name=a.player?'你':`竞赛者 ${a.id}`;this.equipRaceStage(a);this.brains[a.id]=this.newBrain(a);}
  }else if(s.mode==='defense'){
   s.defense=createDefense();s.pickups=[];
   for(const a of s.actors){a.active=a.team==='blue';if(!a.active)a.health=0;else {a.money=2000;a.armor=50;}}
   this.prepareDefenseIntermission(false);
  }
 }
 private equipRestricted(a:Actor){
  const kind=restrictedWeapon(this.state.mode);if(!kind)return;
  a.inventory=[kind];setEquippedWeapon(a,kind);a.guns[kind]=this.gun(kind);a.grenades=0;a.grenadePurchases=0;
  this.meleePending.delete(a.id);
 }
 private equipRaceStage(a:Actor){
  const kind=RACE_LADDER[a.raceStage??0];a.inventory=[kind];setEquippedWeapon(a,kind);a.guns[kind]=this.gun(kind);a.grenades=0;
  this.meleePending.delete(a.id);
 }
 private raceKill(a:Actor){
  const s=this.state;if(!s.race||s.race.winnerId!==null||a.weapon!==RACE_LADDER[a.raceStage??0])return;
  a.raceKills=(a.raceKills??0)+1;
  if(a.weapon==='knife'){
   s.race.winnerId=a.id;s.phase='matchEnd';s.winner=a.player?'blue':'red';s.actors.forEach(v=>v.moving=false);this.meleePending.clear();this.events.push({type:'round'});return;
  }
  if(a.raceKills>=RACE_KILLS_PER_STAGE){
   a.raceStage=(a.raceStage??0)+1;a.raceKills=0;this.equipRaceStage(a);
   if(a.raceStage===RACE_LADDER.length-1){s.race.alert=`${a.name}已进入匕首决胜`;s.race.alertUntil=s.time+8;}
   this.events.push({type:'weaponPickup',actorId:a.id,weapon:a.weapon});
  }
 }
 private prepareDefenseIntermission(reward:boolean){
  const s=this.state,d=s.defense!;s.phase='intermission';s.paused=false;s.spectating=null;s.grenades=[];s.pickups=[];this.meleePending.clear();this.teamReports.clear();
  d.attackers=0;d.remaining=0;d.upgradePending=reward&&d.completed%2===0&&d.completed<d.total;
  if(reward)d.health=Math.min(d.maxHealth,d.health+12);
  for(const a of s.actors){
   a.moving=false;if(a.team==='red'){a.active=false;a.health=0;continue;}
   const point=BLUE_SPAWNS[a.id];Object.assign(a,point,{y:point.y??0,groundY:point.y??0,verticalSpeed:0,climbing:false,health:100,armor:Math.max(a.armor,50+d.upgrades.armor*15),crouched:false,spread:0,shotTime:-10,hurtTime:-10,grenades:Math.max(1,a.grenades),grenadePurchases:0});
   if(reward)a.money=Math.min(16000,a.money+650);
   for(const kind of WEAPON_KINDS)a.guns[kind]=this.gun(kind);resetWeaponSwitch(a);
   this.brains[a.id]=this.newBrain(a);this.events.push({type:'respawn',actorId:a.id});
  }
 }
 chooseDefenseUpgrade(upgrade:DefenseUpgrade):boolean{
  const s=this.state,d=s.defense;
  if(s.mode!=='defense'||s.phase!=='intermission'||s.paused||!d?.upgradePending||!Object.hasOwn(d.upgrades,upgrade)||d.upgrades[upgrade]>=3)return false;
  d.upgrades[upgrade]++;d.upgradePending=false;
  if(upgrade==='armor')for(const a of s.actors)if(a.team==='blue')a.armor=Math.max(a.armor,50+d.upgrades.armor*15);
  return true;
 }
 startDefenseWave():boolean{
  const s=this.state,d=s.defense;
  if(s.mode!=='defense'||s.phase!=='intermission'||s.paused||!d||d.upgradePending||d.completed>=d.total)return false;
  d.wave=d.completed+1;s.round=d.wave;d.timeLeft=DEFENSE_WAVE_SECONDS;s.roundTime=d.timeLeft;
  const wave=defenseWave(d.wave);d.enemiesTotal=wave.length;d.remaining=wave.length;d.attackers=0;
  const enemies=s.actors.filter(a=>a.team==='red');
  enemies.forEach((a,i)=>{
   a.active=i<wave.length;a.health=a.active?100:0;if(!a.active)return;
   const point=RED_SPAWNS[(i+d.wave-1)%RED_SPAWNS.length],spec=wave[i];
   Object.assign(a,point,{y:point.y??0,groundY:point.y??0,verticalSpeed:0,climbing:false,yaw:point.yaw??Math.PI,pitch:0,armor:spec.armor,grenades:d.wave>=5&&i%4===0?1:0,crouched:false,moving:false,spread:0,shotTime:-10,hurtTime:-10,throwTime:-10,spawnedAt:s.time,spawnProtectionUntil:0});
   a.inventory=[spec.weapon,'pistol','knife'];setEquippedWeapon(a,spec.weapon);for(const kind of WEAPON_KINDS)a.guns[kind]=this.gun(kind);resetWeaponSwitch(a);
   this.brains[a.id]=this.newBrain(a);this.events.push({type:'respawn',actorId:a.id});
  });
  for(const a of s.actors.filter(v=>v.team==='blue')){a.spawnProtectionUntil=s.time+1;this.brains[a.id]=this.newBrain(a);}
  s.phase='playing';s.pickups=[];s.grenades=[];this.events.push({type:'round'});return true;
 }
 private finishDefense(won:boolean,reason:string){
  const s=this.state;s.defense!.reason=reason;s.winner=won?'blue':'red';s.phase='matchEnd';s.actors.forEach(a=>a.moving=false);this.meleePending.clear();this.events.push({type:'round'});
 }
 private updateDefense(dt:number){
  const s=this.state,d=s.defense;if(!d||s.phase!=='playing')return;
  const enemies=s.actors.filter(a=>a.team==='red'&&a.health>0),site=d.site;d.remaining=enemies.length;d.timeLeft=Math.max(0,d.timeLeft-dt);s.roundTime=d.timeLeft;
  d.attackers=enemies.filter(a=>{
   const dx=site.x-a.x,dz=site.z-a.z,distance=Math.hypot(dx,dz),dy=site.y+.9-eyeHeight(a),n=Math.hypot(distance,dy);
   return distance<=site.radius&&Math.abs(actorBaseY(a)-site.y)<1.2&&(n<.01||wallDistance(a.x,eyeHeight(a),a.z,dx/n,dy/n,dz/n)>=n-.05);
  }).length;
  d.health=Math.max(0,d.health-Math.min(3,d.attackers)*3*dt);
  if(d.health<=0){this.finishDefense(false,'据点耐久耗尽');return;}
  if(!s.actors.some(a=>a.team==='blue'&&a.health>0)){this.finishDefense(false,'防守小队全员阵亡');return;}
  if(!enemies.length){d.completed=d.wave;s.blueScore=d.completed;if(d.completed===d.total)this.finishDefense(true,'八波攻势全部击退');else this.prepareDefenseIntermission(true);return;}
  if(d.timeLeft<=0)this.finishDefense(false,'未能在 210 秒内击退本波攻势');
 }
 private newBrain(a:Actor):Brain {
  return {senseAt:0,sensedId:-1,pressure:0,exposedFor:0,tactic:'search',squadRole:'solo',tacticAt:0,coverUntil:0,shelterUntil:0,supportId:null,motion:{speed:0,heading:null},attacker:null,avoidance:{side:a.id%2?1:-1,hold:0},progressAt:{x:a.x,z:a.z},stalled:0,target:-1,react:.5,repath:0,path:[],strafe:a.id%2?1:-1,memory:null,cover:null,decision:0,burst:0,rest:0,goal:'',patrolStep:0,patrolPause:0,pace:2.4+this.random()*.65,alertness:this.random(),reposition:null,moveUntil:0,nextAngle:1.5+this.random()*1.5,seenAt:-10};
 }
 purchase(item:Parameters<typeof buyItem>[1],actor=this.state.player):boolean{return purchaseWindow(this.state,actor,item).allowed&&buyItem(actor,item,this.events);}
 selectMode(mode:PlayableMode){if(this.state.phase!=='menu')return false;this.preferredMode=mode;this.state.mode=modeForMap(mode);this.state.race=undefined;this.state.defense=undefined;this.refreshMap();return true;}
 menu(){this.queuedStab=null;this.state.phase='menu';this.state.paused=false;this.state.race=undefined;this.state.defense=undefined;this.refreshMap();this.events=[];}
 setPaused(paused:boolean){if(paused)this.queuedStab=null;if(this.state.phase!=='menu'&&this.state.phase!=='matchEnd')this.state.paused=paused;}
 reload(a:Actor){if(!weaponReady(a))return false;if(a.weapon==='knife'||!allowsWeapon(this.state.mode,a.weapon))return false;const g=a.guns[a.weapon],w=WEAPONS[a.weapon];if(hasUnlimitedReserve(this.state.mode))g.reserve=w.reserve;if(!a.inventory.includes(a.weapon)||a.health<=0||g.reloadLeft>0||g.ammo===w.magazine||g.reserve<=0)return false;g.reloadLeft=w.reload*(this.state.mode==='defense'&&a.player?1-(this.state.defense?.upgrades.reload??0)*.1:1);this.events.push({type:'reload',actorId:a.id,weapon:a.weapon,shells:a.weapon==='shotgun'?Math.min(g.reserve,w.magazine-g.ammo):undefined});return true;}
 private finishRound(winner:Team|'draw',reason=''){const s=this.state;if(s.phase==='roundEnd'||s.phase==='matchEnd')return;s.roundReason=reason;s.winner=winner;if(winner==='blue')s.blueScore++;if(winner==='red')s.redScore++;s.actors.forEach(a=>{const won=(winner==='blue'&&a.team==='blue')||(winner==='red'&&a.team==='red');if(s.mode!=='bounty'){const amount=roundReward(a,won,Math.max(0,s.round-1));this.events.push({type:'roundReward',actorId:a.id,amount});}a.moving=false;});s.phase=s.blueScore>=3||s.redScore>=3?'matchEnd':'roundEnd';s.roundTime=4;this.events.push({type:'round'});}
 private checkBounty(){
  const s=this.state;if(s.phase!=='playing')return;
  const blue=s.actors.some(a=>a.team==='blue'&&a.health>0),red=s.actors.some(a=>a.team==='red'&&a.health>0);
  if(blue&&red)return;
  this.finishRound(blue?'blue':red?'red':'draw',blue?'红方已被全歼':red?'蓝方已被全歼':'双方同时全灭，本回合平局');
  this.queuedStab=null;this.meleePending.clear();
 }
 private checkRound(){
  const s=this.state,blue=s.actors.filter(a=>a.team==='blue'&&a.health>0),red=s.actors.filter(a=>a.team==='red'&&a.health>0);
  if(s.mode==='hostageRescue'){
   if(s.rescue&&s.rescue.total>0&&s.rescue.rescued===s.rescue.total){this.finishRound('blue','全部人质已安全抵达救援区');return;}
   if(!blue.length){this.finishRound('red','反恐精英全员阵亡，救援失败');return;}
   if(s.roundTime<=0)this.finishRound('red','救援时间耗尽，人质未全部获救');
   return;
  }
  if(s.mode==='demolition'){
   if(s.bomb.status==='exploded'){this.finishRound('red','C4 成功引爆');return;}
   if(s.bomb.status==='defused'){this.finishRound('blue','C4 已成功拆除');return;}
   // Once planted, only the bomb outcome resolves the round, even if T die.
   if(s.bomb.status==='planted')return;
   if(!red.length){this.finishRound('blue','恐怖分子全部被消灭');return;}
   if(!blue.length){this.finishRound('red','反恐精英全部被消灭');return;}
   if(s.roundTime<=0)this.finishRound('blue','时间耗尽，恐怖分子未能安放炸弹');
   return;
  }
  if(!blue.length||!red.length){this.finishRound(blue.length?'blue':red.length?'red':'draw');return;}
  if(s.roundTime<=0){const delta=blue.length-red.length||blue.reduce((n,a)=>n+a.health,0)-red.reduce((n,a)=>n+a.health,0);this.finishRound(delta>0?'blue':delta<0?'red':'draw');}
 }

 update(dt:number,input:PlayerInput=EMPTY_INPUT,allBots=false){
  const s=this.state;if(input.pause)this.setPaused(!s.paused);if(s.paused||s.phase==='menu'||s.phase==='matchEnd'||s.phase==='intermission')return;
  s.time+=dt;if(hasRespawns(s.mode))this.updateRespawns();s.hitMarker=Math.max(0,s.hitMarker-dt);s.feed=s.feed.filter(f=>s.time-f.at<10);s.roundTime+=s.phase!=='roundEnd'&&(hasRespawns(s.mode)||s.mode==='bounty')?dt:-dt;
  if(s.phase==='roundEnd'){if(s.roundTime<=0){s.round++;this.resetRound(allBots);}return;}
  this.interactionActors.clear();
  const player=s.player;const assisted=this.touchAssist.apply(player,s.actors,input,dt,s.settings.sensitivity,s.settings.aimAssist&&!allBots,s.mode);player.yaw=wrap(player.yaw+assisted.yaw);player.pitch=Math.max(-MAX_LOOK_PITCH,Math.min(MAX_LOOK_PITCH,player.pitch+assisted.pitch));player.crouched=input.crouch||!!(player.crouched&&getActiveMap().geometry?.needsCrouch?.(player.x,player.z,actorBaseY(player)));
  for(const a of s.actors)if(a!==player||allBots)a.crouched=!!(a.crouched||getActiveMap().geometry?.needsCrouch?.(a.x,a.z,actorBaseY(a)));
  for(const a of s.actors){const jump=advanceJump(a,dt,a===player&&!allBots&&input.jump);if(jump.landed&&a.health>0)this.events.push({type:'step',actorId:a.id,crouched:a.crouched,stepSurface:getActiveMap().id==='snow'?'snow':'ground'});}
  this.separateActors();
  for(const a of s.actors){if(a.health<=0){a.moving=false;a.sprinting=false;a.moveSpeed=WALK_SPEED;continue;}advanceWeaponSwitch(a,dt,this.events);a.spread=Math.max(0,a.spread-dt*.09);for(const kind of WEAPON_KINDS){const g=a.guns[kind];g.cooldown=Math.max(0,g.cooldown-dt);if(g.reloadLeft>0){g.reloadLeft=Math.max(0,g.reloadLeft-dt);if(g.reloadLeft===0){const n=Math.min(WEAPONS[kind].magazine-g.ammo,g.reserve);g.ammo+=n;g.reserve=hasUnlimitedReserve(s.mode)?WEAPONS[kind].reserve:g.reserve-n;}}}}
  if(this.queuedStab&&(this.queuedStab.actor!==player||player.health<=0||player.weapon!=='knife'||player.shotTime!==this.queuedStab.shotTime||input.switchWeapon&&input.switchWeapon!=='knife'||input.grenade))this.queuedStab=null;
  if(player.health>0&&!allBots){
   if(input.switchWeapon&&allowsWeapon(s.mode,input.switchWeapon)&&player.inventory.includes(input.switchWeapon)&&player.guns[player.weapon].reloadLeft===0){if(player.weapon!==input.switchWeapon)this.meleePending.delete(player.id);setEquippedWeapon(player,input.switchWeapon);}
   const n=Math.max(1,Math.hypot(input.moveX,input.moveZ)),speed=playerMovementSpeed(player,input,dt)*dt;
   const dx=(Math.cos(player.yaw)*input.moveX-Math.sin(player.yaw)*input.moveZ)/n*speed,dz=(-Math.sin(player.yaw)*input.moveX-Math.cos(player.yaw)*input.moveZ)/n*speed;
   const climb=!input.jump?getActiveMap().geometry?.climb?.(player.x,player.z,actorBaseY(player),dx,dz,dt):null;
   const pos=climb??moveBody(player.x,player.z,dx,dz,undefined,player.y,player.crouched);player.climbing=!!climb||!!(!input.jump&&player.climbing&&getActiveMap().geometry?.ladderAt?.(pos.x,pos.z,pos.y??actorBaseY(player))&&(getActiveMap().geometry!.ground(pos.x,pos.z,(pos.y??actorBaseY(player))+.04,player.crouched)??-Infinity)<(pos.y??actorBaseY(player))-.015);
   player.moving=Math.hypot(pos.x-player.x,pos.z-player.z,(pos.y??player.y??0)-actorBaseY(player))>.001;player.x=pos.x;player.z=pos.z;if(pos.y!==undefined)player.y=pos.y;
   player.sprinting=!!player.sprinting&&player.moving&&!player.climbing;
   if(climb){player.verticalSpeed=0;player.crouched=player.crouched||!!climb.crouched;}
   if(input.reload)this.reload(player);
   if(input.grenade)this.throwGrenade(player);
   if(input.interact){const objective=objectiveInteraction(s,player);if(objective){if(s.mode!=='hostageRescue'||!this.pickupInteractHeld)this.interact(player);}else if(!this.pickupInteractHeld)this.pickupWeapon(player);}
   // A secondary press during a slash is a deliberate next attack. Retain one
   // intent through recovery instead of dropping it and repeating primary fire.
   if(input.secondaryFire&&player.weapon==='knife'&&!input.grenade)this.queuedStab={actor:player,shotTime:player.shotTime};
   if(this.queuedStab){if(this.fire(player,'stab'))this.queuedStab=null;}
   else if(input.fire){this.fire(player);}if(player.moving&&!isAirborne(player)){this.footTimer-=dt;if(this.footTimer<=0){this.footTimer=player.crouched?.62:.38*WALK_SPEED/(player.moveSpeed??WALK_SPEED);this.events.push({type:'step',actorId:0,crouched:player.crouched,stepSurface:getActiveMap().id==='snow'?'snow':'ground'});}}
  }
  this.pickupInteractHeld=input.interact;
  for(const a of s.actors)if((!a.player||allBots)&&a.health>0&&(s.phase==='playing'||s.phase==='planted')){
   this.bot(a,dt,allBots);
   if(a.moving){this.botFootTimers[a.id]-=dt;if(this.botFootTimers[a.id]<=0){this.botFootTimers[a.id]=a.crouched?.62:.46;this.events.push({type:'step',actorId:a.id,crouched:a.crouched,stepSurface:getActiveMap().id==='snow'?'snow':'ground'});}}
   else this.botFootTimers[a.id]=.07+a.id*.031;
  }
  this.separateActors();
  this.updateMelee();this.updateBomb(dt);this.updateGrenades(dt);this.updateRescue(dt);
  if(player.health<=0){s.spectating=s.mode==='armsRace'?null:s.actors.find(a=>a.team==='blue'&&a.health>0)||null;}
  if(s.mode==='defense')this.updateDefense(dt);
  else if(s.mode==='bounty')this.checkBounty();
  else if(s.mode==='demolition'||s.mode==='hostageRescue'||s.mode==='elimination')this.checkRound();
 }
 private updateRespawns(){
  const s=this.state;
  for(const a of s.actors){
   if(a.health>0)continue;
   if(!a.respawnAt){a.respawnAt=s.time+RESPAWN_DELAY;continue;}
   if(s.time<a.respawnAt)continue;
   const point=chooseRespawn(a,s.actors,s.mode);
   Object.assign(a,point,{health:100,armor:0,y:point.y??0,groundY:point.y??0,verticalSpeed:0,climbing:false,crouched:false,moving:false,sprinting:false,moveSpeed:WALK_SPEED,pitch:0,yaw:point.yaw??(point.z>0?0:Math.PI),grenades:1,grenadePurchases:0,throwTime:-10,shotTime:-10,hurtTime:-10,spread:0,hasBomb:false,defuseKit:false,respawnAt:0,spawnedAt:s.time,spawnProtectionUntil:s.time+SPAWN_PROTECTION});
   for(const kind of WEAPON_KINDS)a.guns[kind]=this.gun(kind);
   if(s.mode==='armsRace'){a.grenades=0;this.equipRaceStage(a);}
   this.equipRestricted(a);resetWeaponSwitch(a);
   this.brains[a.id]=this.newBrain(a);
   if(a.player){s.spectating=null;s.hitMarker=0;this.pickupInteractHeld=false;}
   this.events.push({type:'respawn',actorId:a.id});
  }
  s.pickups=s.pickups.filter(p=>p.expiresAt===undefined||p.expiresAt>s.time);
  const drops=s.pickups.filter(p=>p.expiresAt!==undefined);
  if(drops.length>32){const remove=new Set(drops.slice(0,drops.length-32).map(p=>p.id));s.pickups=s.pickups.filter(p=>!remove.has(p.id));}
  if(s.mode==='deathmatch'&&s.time>=this.supplyAt){
   this.supplyAt=s.time+20;
   for(const p of createMapPickups())addGroundWeapon(s.pickups,p);
  }
 }
 pickupWeapon(actor=this.state.player):boolean{if(!allowsPickups(this.state.mode))return false;const pickup=nearestPickup(this.state,actor);if(!pickup)return false;return takePickup(this.state,actor,pickup,this.events);}
 private nearestSite(a:Actor):ObjectiveSite|null{return this.state.sites.find(site=>insideBombSite(a,site))??null;}
 private interact(a:Actor){
  const s=this.state,interaction=objectiveInteraction(s,a);if(!interaction)return false;
  if(s.mode==='hostageRescue'){
   const h=s.rescue!.hostages.find(h=>h.id===interaction.targetId)!;
   const following=h.leaderId!==a.id;h.leaderId=following?a.id:null;h.status=following?'following':'waiting';h.moving=false;
   this.events.push({type:following?'hostageFollow':'hostageWait',actorId:a.id,targetId:h.id,x:h.x,y:h.y,z:h.z});return true;
  }
  this.interactionActors.add(a.id);return true;
 }
 private updateBomb(dt:number){
  const s=this.state,b=s.bomb;if(s.mode!=='demolition')return;
  if(b.status==='carried'){
   const carrier=s.actors.find(a=>a.id===b.carrierId);
   if(carrier){b.x=carrier.x;b.y=actorBaseY(carrier);b.z=carrier.z;}
   if(!carrier||carrier.health<=0){if(carrier)carrier.hasBomb=false;b.status='dropped';b.carrierId=null;b.plantProgress=0;b.planterId=null;this.events.push({type:'bombDrop',actorId:carrier?.id,x:b.x,y:b.y,z:b.z});}
   else {
    const site=this.nearestSite(carrier),eligible=this.interactionActors.has(carrier.id)&&site&&!carrier.moving&&!isAirborne(carrier)&&s.time-carrier.shotTime>dt*.9;
    if(eligible){
     if(b.planterId!==carrier.id||b.plantSite!==site.id){b.planterId=carrier.id;b.plantSite=site.id;b.plantProgress=0;this.events.push({type:'plantStart',actorId:carrier.id,site:site.id});}
     b.plantProgress=Math.min(1,(b.plantProgress??0)+Math.min(dt,Math.max(0,s.roundTime+dt))/PLANT_SECONDS);
     if(b.plantProgress>=1-1e-8){carrier.hasBomb=false;b.status='planted';b.carrierId=null;b.site=site.id;b.timer=BOMB_SECONDS;b.progress=0;b.defuserId=null;b.planterId=null;b.plantProgress=0;s.phase='planted';this.events.push({type:'plantComplete',actorId:carrier.id,x:b.x,y:b.y,z:b.z,site:site.id});return;}
    }else {b.planterId=null;b.plantProgress=0;b.plantSite=null;}
   }
  }
  if(b.status==='dropped'){
   const pickup=s.actors.find(a=>a.faction==='t'&&a.health>0&&!a.hasBomb&&objectiveReachable(a,b,1.1));
   if(pickup){pickup.hasBomb=true;b.status='carried';b.carrierId=pickup.id;this.events.push({type:'bombPickup',actorId:pickup.id,x:b.x,y:b.y,z:b.z});}
  }
  if(b.status!=='planted')return;
  const candidates=s.actors.filter(a=>a.faction==='ct'&&a.health>0&&this.interactionActors.has(a.id)&&!a.moving&&!isAirborne(a)&&s.time-a.shotTime>dt*.9&&objectiveReachable(a,b,2.4));
  const defuser=candidates.find(a=>a.id===b.defuserId)??candidates[0];
  if(!defuser){b.defuserId=null;b.progress=0;}
  else{
   if(b.defuserId!==defuser.id){b.defuserId=defuser.id;b.progress=0;this.events.push({type:'defuseStart',actorId:defuser.id,x:b.x,y:b.y,z:b.z});}
   const seconds=defuser.defuseKit?KIT_DEFUSE_SECONDS:DEFUSE_SECONDS,remaining=(1-b.progress)*seconds;
   if(remaining<=dt+1e-8&&remaining<b.timer-1e-8){b.progress=1;b.status='defused';b.defuserId=null;this.events.push({type:'defuseComplete',actorId:defuser.id,site:b.site??undefined});return;}
   b.progress=Math.min(1,b.progress+Math.min(dt,b.timer)/seconds);
  }
  const before=b.timer;b.timer=b.timer-dt<=1e-8?0:b.timer-dt;
  if(Math.ceil(b.timer)!==Math.ceil(before))this.events.push({type:'bombTick',x:b.x,y:(b.y??0)+.12,z:b.z});
  if(b.timer<=0){
   b.status='exploded';b.defuserId=null;const origin={x:b.x,y:(b.y??0)+.12,z:b.z};this.events.push({type:'bombExplode',...origin,site:b.site??undefined});
   for(const target of s.actors){if(target.health<=0)continue;const blast=sampleBombBlast(origin,target);if(blast.damage>0)this.damage(target,target,blast.damage,false,undefined,origin,'bomb');}
  }
 }
 private updateRescue(dt:number){
  const s=this.state,rescue=s.rescue,geometry=getActiveMap().geometry;if(s.mode!=='hostageRescue'||!rescue||!geometry)return;
  for(const h of rescue.hostages){
   if(h.status==='rescued')continue;
   let follower=this.hostageActors.get(h.id);
   if(!follower){const actor={...s.player,...h,id:100+h.id,player:false,health:100,groundY:h.y,verticalSpeed:0,climbing:false} as Actor;follower={actor,brain:this.newBrain(actor)};this.hostageActors.set(h.id,follower);}
   const {actor,brain}=follower;Object.assign(actor,{x:h.x,y:h.y,z:h.z,yaw:h.yaw,crouched:h.crouched});actor.moving=false;
   const leader=s.actors.find(a=>a.id===h.leaderId&&a.health>0&&a.faction==='ct');
   if(!leader){h.status='waiting';h.leaderId=null;h.moving=false;continue;}
   actor.crouched=false;advanceJump(actor,dt);brain.repath-=dt;
   if(Math.hypot(actor.x-leader.x,actor.z-leader.z)>1.15||Math.abs(actorBaseY(actor)-actorBaseY(leader))>.6)this.botMove(actor,brain,leader,dt,3.65,true);
   Object.assign(h,{x:actor.x,y:actorBaseY(actor),z:actor.z,yaw:actor.yaw,moving:actor.moving,crouched:actor.crouched});
   const zone=rescue.zones.find(zone=>objectiveReachable(h,zone,zone.radius,1.2));
   if(zone){h.status='rescued';h.leaderId=null;h.moving=false;rescue.rescued++;leader.money=Math.min(16000,leader.money+300);this.events.push({type:'hostageRescued',actorId:leader.id,targetId:h.id,x:h.x,y:h.y,z:h.z});}
  }
 }

  fire(a:Actor,attack:MeleeAttack='slash'){
  const s=this.state,g=a.guns[a.weapon],w=WEAPONS[a.weapon];if(!weaponReady(a)||!allowsWeapon(s.mode,a.weapon)||!a.inventory.includes(a.weapon)||(s.phase!=='playing'&&s.phase!=='planted')||s.paused||a.health<=0||g.cooldown>0||g.reloadLeft>0)return false;
  if(a.weapon==='knife'){if(this.meleePending.has(a.id))return false;const spec=MELEE_ATTACKS[attack];a.spawnProtectionUntil=0;g.cooldown=spec.interval;a.shotTime=s.time;a.meleeAttack=attack;this.meleePending.set(a.id,{at:s.time+spec.contactDelay,startedAt:s.time,attack});this.events.push({type:'melee',actorId:a.id,weapon:'knife',meleeAttack:attack,x:a.x,y:eyeHeight(a),z:a.z});return true;}
  if(g.ammo<=0){this.reload(a);return false;}a.spawnProtectionUntil=0;g.ammo--;g.cooldown=w.interval;a.shotTime=s.time;
  const spread=(w.spread+a.spread+(a.moving?.026:0))*(a.crouched?.55:1)*(a.player?1:1.25);
  // CS 1.6 style tracers are readable accents, not a laser beam for every shot.
  const tracer=a.player?this.random()<.62:this.random()<.18;
  const firedWeapon=a.weapon;
  for(let pellet=0;pellet<w.pellets;pellet++){
   if(a.weapon!==firedWeapon||(s.phase as GameSnapshot['phase'])==='matchEnd')break;
   const dir=direction(a.yaw+(this.random()-.5)*spread,a.pitch+(this.random()-.5)*spread),oy=eyeHeight(a);
   const wall=wallDistance(a.x,oy,a.z,dir.x,dir.y,dir.z);let distance=Math.min(75,wall),victim:Actor|undefined,hitRegion:HitRegion='chest';
   for(const b of s.actors){if(b.id===a.id||b.health<=0)continue;const hit=rayActorHit(b,a.x,oy,a.z,dir.x,dir.y,dir.z);if(hit&&hit.distance<distance){distance=hit.distance;victim=b;hitRegion=hit.region;}}
   const end={x:a.x+dir.x*distance,y:oy+dir.y*distance,z:a.z+dir.z*distance};
   if(pellet===0)this.suppressNearShot(a,dir,oy,distance);
   if(pellet===0)this.events.push({type:'shot',actorId:a.id,weapon:a.weapon,x:a.x,y:oy,z:a.z,endX:end.x,endY:end.y,endZ:end.z,pelletCount:w.pellets,tracer});
   if(!victim&&wall<75)this.events.push({type:'impact',actorId:a.id,...end,weapon:a.weapon,surface:impactSurface(end.x,end.y,end.z)});
   if(victim&&areEnemies(a,victim,s.mode)){const falloff=a.weapon==='shotgun'?Math.max(.25,1-distance/32):1;this.damage(a,victim,hitRegionDamage(w,hitRegion,falloff),hitRegion==='head',end,a,'combat',hitRegion);}
  }
  a.spread=Math.min(.09,a.spread+.011);
  if(a.player)a.pitch=Math.min(MAX_LOOK_PITCH,a.pitch+(a.weapon==='shotgun'?.035:a.weapon==='smg'?.004:a.weapon==='rifle'?.006:.012));
  return true;
 }
 /** Near misses only count along the unobstructed, actually travelled shot.
  * Pressure changes tactics, never weapon damage or accuracy. */
 private suppressNearShot(shooter:Actor,dir:{x:number;y:number;z:number},eye:number,distance:number){
  for(const target of this.state.actors){
   if(target.health<=0||!areEnemies(shooter,target,this.state.mode))continue;
   const b=this.brains[target.id];if(!b)continue;
   const dx=target.x-shooter.x,dy=actorBaseY(target)+(target.crouched?.8:1.25)-eye,dz=target.z-shooter.z;
   const along=dx*dir.x+dy*dir.y+dz*dir.z;
   if(along<=.5||along>distance)continue;
   if(Math.hypot(dx-dir.x*along,dy-dir.y*along,dz-dir.z*along)<1.15&&tacticalLineClear(shooter,target,eye-actorBaseY(shooter),target.crouched?.8:1.25))b.pressure=Math.min(1,b.pressure+.24);
  }
 }
 /** Small debug snapshot; the renderer only exposes it behind ?debug. */
 botDiagnostics(){return this.state.actors.filter(a=>a.health>0).map(a=>{
  const b=this.brains[a.id];return {id:a.id,role:b?.squadRole,action:b?.tactic,supportId:b?.supportId,pressure:+(b?.pressure??0).toFixed(2),cover:b?.cover??null,move:b?.reposition??null};
 });}
 /** Resolve one contact per attack, using the current pose and solid occlusion. */
 private updateMelee(){
  const s=this.state;
  for(const [id,pending] of this.meleePending){
   const {at,startedAt,attack}=pending,spec=MELEE_ATTACKS[attack];
   const a=s.actors.find(actor=>actor.id===id);
   if(!a||a.health<=0||a.weapon!=='knife'||a.shotTime!==startedAt){this.meleePending.delete(id);continue;}
   if(s.time+1e-8<at)continue;
   this.meleePending.delete(id);
   const oy=eyeHeight(a);let nearest=spec.range,victim:Actor|undefined,point:{x:number;y:number;z:number}|undefined;
   // Slash sweeps a wider arc; stab stays close to the crosshair. Each ray stops at cover or an ally.
   for(const offset of spec.yawOffsets){
    const d=direction(a.yaw+offset,a.pitch);let distance=Math.min(spec.range,wallDistance(a.x,oy,a.z,d.x,d.y,d.z)),hit:Actor|undefined;
    for(const b of s.actors){if(b===a||b.health<=0)continue;const base=actorBaseY(b),h=(b.crouched?1.2:1.8)+base;
     const t=rayBox(a.x,oy,a.z,d.x,d.y,d.z,b.x-.28,base+.08,b.z-.28,b.x+.28,h,b.z+.28);
     if(t<distance){distance=t;hit=b;}
    }
    if(hit&&distance<nearest){nearest=distance;victim=hit;point={x:a.x+d.x*distance,y:oy+d.y*distance,z:a.z+d.z*distance};}
   }
   if(victim&&areEnemies(a,victim,s.mode))this.damage(a,victim,spec.damage,false,point);
  }
 }
 private damage(a:Actor,victim:Actor,amount:number,headshot=false,point?:{x:number;y:number;z:number},origin:{x:number;z:number}=a,cause:'combat'|'bomb'='combat',hitRegion?:HitRegion){
  if(victim.health<=0||(victim.spawnProtectionUntil??0)>this.state.time)return;const s=this.state,healthBefore=victim.health;const absorbed=Math.min(victim.armor,Math.ceil(amount*.35));victim.armor=Math.max(0,victim.armor-absorbed);victim.health=Math.max(0,victim.health-(amount-absorbed));victim.hurtTime=s.time;
  if(a.player&&a!==victim)s.hitMarker=.14;if(victim.player)s.damageAngle=Math.atan2(origin.x-victim.x,origin.z-victim.z)+victim.yaw;
  // Remember the hit's source once; unseen attackers are never tracked through walls.
  const brain=this.brains[victim.id];
  if(brain&&victim.health>0&&areEnemies(a,victim,s.mode)){
   const x=Math.round(origin.x),z=Math.round(origin.z);
   brain.pressure=Math.max(brain.pressure,.45);brain.senseAt=0;
   brain.attacker={id:origin===a?a.id:-1,x,z,until:s.time+3.5,turnUntil:s.time+1.2};
   brain.memory={x,z,until:s.time+3.5};brain.reposition=null;brain.patrolPause=0;brain.repath=0;
  }
  const impactLength=Math.hypot(victim.x-origin.x,victim.z-origin.z)||1;
  this.events.push({type:'hit',actorId:a.id,targetId:victim.id,hitRegion,healthDamage:healthBefore-victim.health,armorDamage:absorbed,meleeAttack:origin===a&&a.weapon==='knife'?a.meleeAttack:undefined,headshot,surface:'character',weapon:origin===a?a.weapon:undefined,normalX:(victim.x-origin.x)/impactLength,normalZ:(victim.z-origin.z)/impactLength,...point});
  if(victim.health===0){const dropped=allowsPickups(s.mode)?dropWeapon(victim,this.nextPickupId++):null;if(dropped){if(s.mode==='deathmatch')dropped.expiresAt=s.time+45;addGroundWeapon(s.pickups,dropped);}if(cause!=='bomb')killEconomy(a,victim,s.mode);if(a!==victim){a.kills++;if(a.player)s.totalKills++;}victim.deaths++;if(victim.player)s.totalDeaths++;
   if(hasRespawns(s.mode)){victim.respawnAt=s.time+RESPAWN_DELAY;if(isTeamDeathmatch(s.mode)&&areEnemies(a,victim,s.mode)){if(a.team==='blue')s.blueScore++;else s.redScore++;}}
   s.feed.push({killer:cause==='bomb'?'炸弹爆炸':a===victim?'自己的手雷':a.name,victim:victim.name,team:a.team,headshot,at:s.time});this.events.push({type:'kill',actorId:a.id,targetId:victim.id,headshot});
   if(s.mode==='armsRace'&&areEnemies(a,victim,s.mode)&&cause==='combat'&&origin===a)this.raceKill(a);
   if(s.mode==='defense'&&a.player&&areEnemies(a,victim,s.mode)&&a.health>0)a.health=Math.min(100,a.health+(s.defense?.upgrades.heal??0)*6);
  }
 }
 throwGrenade(a:Actor){
  const s=this.state;if(!weaponReady(a)||s.mode==='armsRace'||restrictedWeapon(s.mode)||(s.phase!=='playing'&&s.phase!=='planted')||s.paused||a.health<=0||a.grenades===0||a.guns[a.weapon].reloadLeft>0)return false;
  this.meleePending.delete(a.id);if(a.player)this.queuedStab=null;if(a.weapon==='knife')a.shotTime=-10;
  a.spawnProtectionUntil=0;a.grenades--;a.throwTime=s.time;a.guns[a.weapon].cooldown=Math.max(.55,a.guns[a.weapon].cooldown);
  const d=direction(a.yaw,Math.max(-.55,Math.min(.8,a.pitch+.3)));
  // Start inside the actor but outside cover; substeps collide before advancing into any wall.
  s.grenades.push({id:++this.grenadeId,ownerId:a.id,x:a.x,y:eyeHeight(a)-.08,z:a.z,vx:d.x*10,vy:d.y*10+1.7,vz:d.z*10,fuse:2.15,bounces:0});
  this.events.push({type:'grenadeThrow',actorId:a.id,x:a.x,y:eyeHeight(a),z:a.z});return true;
 }
 private updateGrenades(dt:number){
  const s=this.state;for(let i=s.grenades.length-1;i>=0;i--){const g=s.grenades[i];advanceGrenade(g,dt);g.fuse-=dt;if(g.fuse>0)continue;
   const owner=s.actors[g.ownerId];this.events.push({type:'explosion',actorId:owner.id,x:g.x,y:g.y,z:g.z});
   for(const target of s.actors){if(target.health<=0||(target.team===owner.team&&target!==owner))continue;
    const blast=sampleBlast(g,target);
    if(blast.damage>0)this.damage(owner,target,blast.damage,false,undefined,g);}
   s.grenades.splice(i,1);
  }
 }
 private separateActors(){const actors=this.state.actors;for(let pass=0;pass<3;pass++)for(let i=0;i<actors.length;i++)for(let j=i+1;j<actors.length;j++){const a=actors[i],b=actors[j];if(a.health<=0||b.health<=0||Math.abs(actorBaseY(a)-actorBaseY(b))>1.8)continue;let dx=b.x-a.x,dz=b.z-a.z,d=Math.hypot(dx,dz);if(d>=.65)continue;if(d<.001){dx=i%2?1:-1;dz=0;d=1;}const amount=(.65-Math.hypot(b.x-a.x,b.z-a.z))*.51;const pa=moveBody(a.x,a.z,-dx/d*amount,-dz/d*amount,undefined,a.y,a.crouched),pb=moveBody(b.x,b.z,dx/d*amount,dz/d*amount,undefined,b.y,b.crouched);a.x=pa.x;a.z=pa.z;if(pa.y!==undefined)a.y=pa.y;b.x=pb.x;b.z=pb.z;if(pb.y!==undefined)b.y=pb.y;}}
 private visibleHeight(a:Actor,target:Actor):number|null {const oy=eyeHeight(a),h=actorHitHeight(target);for(const ty of [h*.64+actorBaseY(target),h-.12+actorBaseY(target)]){const dx=target.x-a.x,dz=target.z-a.z,dy=ty-oy,n=Math.hypot(dx,dy,dz);if(n<.01||wallDistance(a.x,oy,a.z,dx/n,dy/n,dz/n)>n-.15)return ty;}return null;}
 /** 路线缓存：目标改变或路线失效才重算，避免每帧执行寻路。 */
 private botMove(a:Actor,b:Brain,goal:{x:number;z:number;y?:number},dt:number,speed=2.5,groundOnly=false){
  const geometry=getActiveMap().geometry;
  groundOnly ||= this.state.mode==='hostageRescue'&&!!this.state.rescue?.hostages.some(h=>h.status==='following'&&h.leaderId===a.id);
  const segment=(x:number,z:number,tx:number,tz:number,r=.4,y?:number,ty?:number)=>groundOnly&&geometry?.groundSegment?geometry.groundSegment(x,z,tx,tz,y,ty):walkSegmentClear(x,z,tx,tz,r,y,ty);
  const path=groundOnly&&geometry?.groundPath?geometry.groundPath.bind(geometry):findPath;
  if(groundOnly){a.crouched=false;a.climbing=false;}
  const key=`${groundOnly?'ground:':''}${Math.round(goal.x)},${Math.round(goal.z)},${Math.round((goal.y??a.y??0)*2)}`;
  if(b.repath<=0||b.goal!==key){
   b.path=segment(a.x,a.z,goal.x,goal.z,.4,a.y,goal.y)?[{...goal}]:path(a.x,a.z,goal.x,goal.z,a.y,goal.y);
   const end=b.path.at(-1);if(end&&segment(end.x,end.z,goal.x,goal.z,.4,end.y,goal.y)&&Math.hypot(end.x-goal.x,end.z-goal.z)>.01)b.path.push({...goal});
   b.goal=key;b.repath=1.1+this.random()*.4;
  }
  // Original BSP sweeps are substantially richer than arena AABBs. Recheck
  // corner shortcuts at 4 Hz; movement itself still collides at every step.
  if(!getActiveMap().geometry||this.state.time>=(b.smoothAt??0)){
   b.smoothAt=this.state.time+.25;
   for(let i=Math.min(b.path.length-1,12);i>0;i--)if(segment(a.x,a.z,b.path[i].x,b.path[i].z,.4,a.y,b.path[i].y)){b.path.splice(0,i);break;}
  }
  // Ladder alignment converges gradually; require precise rung height, while
  // ground landings need a tighter horizontal arrival to clear sloped edges.
  let waypoint=b.path[0];while(waypoint&&Math.hypot(waypoint.x-a.x,waypoint.z-a.z)<(waypoint.ladder!==undefined?.23:getActiveMap().geometry?.climb?.1:.23)&&Math.abs((waypoint.y??a.y??0)-(a.y??0))<(waypoint.ladder!==undefined?.008:.5)){b.path.shift();waypoint=b.path[0];}
  a.moving=false;if(!waypoint){b.motion.speed=0;a.climbing=false;return;}
  a.crouched=!groundOnly&&(a.crouched||!!waypoint.crouched||!!geometry?.needsCrouch?.(a.x,a.z,actorBaseY(a)));
  if(!groundOnly&&waypoint.ladder!==undefined&&Math.hypot(waypoint.x-a.x,waypoint.z-a.z)<.6&&Math.abs((waypoint.y??0)-actorBaseY(a))>.005){
   const climbed=geometry?.climb?.(a.x,a.z,actorBaseY(a),0,0,dt,waypoint.y);
   if(climbed&&Math.hypot(climbed.x-a.x,climbed.z-a.z,(climbed.y??0)-actorBaseY(a))>.00001){a.x=climbed.x;a.z=climbed.z;a.y=climbed.y;a.climbing=true;a.verticalSpeed=0;a.moving=true;b.stalled=0;return;}
  }
  a.climbing=!!(a.climbing&&geometry?.ladderAt?.(a.x,a.z,actorBaseY(a))&&(geometry.ground(a.x,a.z,actorBaseY(a)+.04,a.crouched)??-Infinity)<actorBaseY(a)-.015);
  if(!groundOnly&&geometry?.botJumpSpeed&&waypoint.ladder===undefined&&(waypoint.y??0)-actorBaseY(a)>.5&&Math.hypot(waypoint.x-a.x,waypoint.z-a.z)<1.5&&!isAirborne(a))a.verticalSpeed=geometry.botJumpSpeed;
  const dx=waypoint.x-a.x,dz=waypoint.z-a.z;
  if(!groundOnly&&geometry?.needsCrouch){
   const distance=Math.hypot(dx,dz),probe=Math.min(distance,.7)/(distance||1);
   // A smoothed route can cross a low doorway before its next standing node.
   if(geometry.needsCrouch(a.x+dx*probe,a.z+dz*probe,actorBaseY(a)))a.crouched=true;
  }
  const move=advanceBotMotion(b.motion,dx,dz,dt,a.crouched?Math.min(speed,1.65):speed);
  // A rounded corner must still fit the body. Follow the proven path if it does not.
  const n=Math.hypot(move.x,move.z),probe=n>0?Math.max(n,.65)/n:0;
  const remaining=Math.hypot(dx,dz);
  let desired=n>0?{x:move.x/n*remaining,z:move.z/n*remaining}:{x:0,z:0};
  if(!segment(a.x,a.z,a.x+move.x*probe,a.z+move.z*probe,.32,a.y)){
   b.motion.heading=Math.atan2(dx,dz);desired={x:dx,z:dz};
  }
  const peers=a.id>=100?[...this.state.actors,...[...this.hostageActors.entries()].filter(([id])=>this.state.rescue?.hostages.find(h=>h.id===id)?.status!=='rescued').map(([,h])=>h.actor)]:this.state.actors;
  const p=avoidActors(a,desired,peers,dt,b.motion.speed,b.avoidance),mx=p.x-a.x,mz=p.z-a.z;
  a.moving=Math.hypot(mx,mz)>.00001;
  if(a.moving){a.x=p.x;a.z=p.z;if(p.y!==undefined)a.y=p.y;}
  else b.motion.speed=0;
  b.stalled+=dt;
  if(Math.hypot(a.x-b.progressAt.x,a.z-b.progressAt.z)>.45){b.progressAt={x:a.x,z:a.z};b.stalled=0;}
  if(b.stalled>1.2){b.repath=0;b.path=[];b.avoidance.hold=0;b.stalled=0;b.progressAt={x:a.x,z:a.z};}
  if(a.moving&&b.seenAt<this.state.time-.2&&!(b.attacker&&b.attacker.turnUntil>this.state.time))a.yaw=turnBot(a.yaw,Math.atan2(-mx,-mz),dt);
 }
 /** A guard changes its viewing angle by taking a few real, collision-tested
  * steps. Keep the destination until arrival so avoidance cannot jitter the
  * choice every frame, and stay within the assigned objective's small area. */
 private botWalkTurn(a:Actor,b:Brain,center:TacticalPoint,dt:number,guard:boolean){
  const now=this.state.time;
  if(b.walkTurn&&(now>b.walkTurn.until||Math.hypot(center.x-b.walkTurn.center.x,center.z-b.walkTurn.center.z)>.8||Math.abs((center.y??0)-(b.walkTurn.center.y??0))>.5))b.walkTurn=null;
  if(b.walkTurn&&Math.hypot(a.x-b.walkTurn.point.x,a.z-b.walkTurn.point.z)<.28){
   b.walkTurn=null;b.walkTurnAt=now+.12+(a.id%3)*.08;b.repath=0;
  }
  if(!b.walkTurn&&now>=(b.walkTurnAt??0)){
   b.walkTurnAt=now+.5;
   const side=a.id%2?1:-1,geometry=getActiveMap().geometry;
   candidates:for(const distance of [1.4,.85])for(const offset of [side*.65,side*1.15,0,-side*.65,side*1.9,-side*1.4,Math.PI]){
    const heading=a.yaw+offset,point={x:a.x-Math.sin(heading)*distance,z:a.z-Math.cos(heading)*distance,y:actorBaseY(a)};
    if(Math.hypot(point.x-center.x,point.z-center.z)>2.1)continue;
    if(geometry){const ground=geometry.ground(point.x,point.z,actorBaseY(a)+.45,a.crouched);if(ground===null||Math.abs(ground-actorBaseY(a))>.4)continue;point.y=ground;}
    if(!walkSegmentClear(a.x,a.z,point.x,point.z,.42,a.y,point.y))continue;
    if(this.state.actors.some(peer=>peer!==a&&peer.health>0&&Math.abs(actorBaseY(peer)-point.y)<1.5&&Math.hypot(peer.x-point.x,peer.z-point.z)<.8))continue;
    b.walkTurn={point,center:{...center},until:now+3.5,guard};b.repath=0;break candidates;
   }
  }
  if(b.walkTurn)this.botMove(a,b,b.walkTurn.point,dt,1.35);
 }
 private bot(a:Actor,dt:number,allBots=false){
  this.thinkBot(a,dt,allBots);
  if(getActiveMap().geometry?.needsCrouch?.(a.x,a.z,actorBaseY(a)))a.crouched=true;
  if(!a.moving)this.brains[a.id].motion.speed=0;
 }
 private thinkBot(a:Actor,dt:number,allBots=false){
  const s=this.state,b=this.brains[a.id];b.pressure=Math.max(0,b.pressure-dt*.38);b.repath-=dt;b.decision-=dt;b.rest=Math.max(0,b.rest-dt);b.patrolPause=Math.max(0,b.patrolPause-dt);a.moving=false;
  if(b.attacker&&b.attacker.until<=s.time)b.attacker=null;
  const shared=s.mode==='armsRace'?null:this.teamReports.get(a.team);
  let visible:Actor|undefined,vd=Infinity,aimHeight=1.1,bestThreat=Infinity;
  // Full perception runs at 8–10 Hz with staggered refreshes. Between scans,
  // revalidate the selected target's current LOS before remembering or firing.
  const scan=s.time>=b.senseAt;
  if(scan)b.senseAt=s.time+.1+(a.id%3)*.01;
  const contacts=scan?s.actors:s.actors.filter(v=>v.id===b.sensedId);
  for(const v of contacts){
   if(!areEnemies(a,v,s.mode)||v.health<=0)continue;
   const d=Math.hypot(v.x-a.x,v.z-a.z),angle=Math.atan2(-(v.x-a.x),-(v.z-a.z));
   // 210-degree peripheral vision; nearby awareness still requires an unobstructed ray.
   const inView=d<4||Math.abs(wrap(angle-a.yaw))<Math.PI*7/12;
   const priority=d-(v.id===b.target?6:0)-(v.id===b.attacker?.id?18:0)-(shared&&shared.until>s.time&&(shared.availableAt??0)<=s.time&&v.id===shared.targetId?3:0);
   if(d<38&&inView){const h=this.visibleHeight(a,v);if(h!==null&&priority<bestThreat){visible=v;vd=d;aimHeight=h;bestThreat=priority;}}
   if(!visible&&((d<14&&s.time-v.shotTime>=0&&s.time-v.shotTime<.12)||(d<6&&v.moving&&!v.crouched))&&!b.memory){b.memory={x:Math.round(v.x/2)*2,z:Math.round(v.z/2)*2,y:v.y,until:s.time+2};}
  }
  if(b.attacker&&b.attacker.turnUntil>s.time&&visible?.id!==b.attacker.id){
   const bearing=Math.atan2(-(b.attacker.x-a.x),-(b.attacker.z-a.z));
   if(Math.abs(wrap(bearing-a.yaw))>.25)visible=undefined;
  }
  b.sensedId=visible?.id??-1;
  if(visible){
   b.walkTurn=null;
   b.seenAt=s.time;b.memory={x:visible.x,z:visible.z,y:visible.y,until:s.time+3.5};
   if(s.mode!=='armsRace'&&(!shared||s.time-(shared.reportedAt??-10)>.5))this.teamReports.set(a.team,{x:Math.round(visible.x/2)*2,z:Math.round(visible.z/2)*2,y:visible.y,until:s.time+2.5,targetId:visible.id,reportedAt:s.time,availableAt:s.time+.2});
  }
  else if(b.memory&&b.memory.until<s.time)b.memory=null;
  const report=s.mode==='armsRace'?null:this.teamReports.get(a.team);if(!visible&&!b.memory&&report&&report.until>s.time&&(report.availableAt??0)<=s.time)b.memory={...report};
  a.crouched=!!getActiveMap().geometry?.needsCrouch?.(a.x,a.z,actorBaseY(a));
  let objective=botObjective(a,s,allBots,b.patrolStep);
  const defense=s.mode==='defense'?s.defense:undefined;
  const siteDistance=defense?Math.hypot(a.x-defense.site.x,a.z-defense.site.z):0;
  const baseAlarm=!!defense&&a.team==='blue'&&defense.attackers>0;
  const occupying=!!defense&&a.team==='red'&&siteDistance<defense.site.radius-.35&&Math.abs((a.y??0)-defense.site.y)<1.2;
  const holdingSite=occupying||baseAlarm&&siteDistance<defense!.site.radius-.35&&Math.abs((a.y??0)-defense!.site.y)<1.2;
  const recall=!!defense&&a.team==='blue'&&(siteDistance>DEFENSE_CHASE_RADIUS||baseAlarm&&siteDistance>defense.site.radius-.35);
  // An active alarm owns the objective until it ends, including after arrival.
  // A distance threshold alone alternated recall with an old outward sighting.
  const inDefenseRange=(point:TacticalPoint)=>!defense||a.team!=='blue'||Math.hypot(point.x-defense.site.x,point.z-defense.site.z)<=(baseAlarm?defense.site.radius-.35:DEFENSE_CHASE_RADIUS);
  if(defense&&a.team==='blue'&&!defense.attackers&&!visible&&!b.memory&&Math.hypot(a.x-objective.point.x,a.z-objective.point.z)<1){
   b.patrolStep++;b.repath=0;objective=botObjective(a,s,allBots,b.patrolStep);
  }
  if(s.mode!=='demolition'&&s.mode!=='hostageRescue'&&s.mode!=='defense'){
   let point=patrolPoint(a,b.patrolStep);
   if(Math.hypot(a.x-point.x,a.z-point.z)<1.1&&Math.abs((point.y??a.y??0)-(a.y??0))<.6){b.patrolStep++;b.patrolPause=.25+this.random()*.6;point=patrolPoint(a,b.patrolStep);}
   objective.point=point;
  }
  // 即使最后一名敌人已倒下，也要继续完成拆弹。
  if(objective.role==='defuse'&&objectiveReachable(a,s.bomb,2.4)){
   this.interact(a);a.crouched=true;return;
  }
  if(objective.role==='plant'&&this.nearestSite(a)){this.interact(a);return;}
  if(objective.role==='rescue'&&objectiveInteraction(s,a)?.kind==='rescue'){this.interact(a);return;}
  // 只躲避可见、距离较近且即将爆炸的手雷。
  for(const g of s.grenades){
   const dx=a.x-g.x,dz=a.z-g.z,d=Math.hypot(dx,dz),dy=eyeHeight(a)-g.y,n=Math.hypot(d,dy);
   if(d>6||g.fuse>1.25||n<.01||wallDistance(g.x,g.y,g.z,dx/n,dy/n,dz/n)<n-.05)continue;
   const away=d>.1?{x:dx/d,z:dz/d}:{x:Math.cos(a.yaw),z:-Math.sin(a.yaw)};
   this.botMove(a,b,{x:a.x+away.x*5,z:a.z+away.z*5},dt,3.5);return;
  }
  if(allowsPickups(s.mode)&&!visible&&a.guns[a.weapon].ammo+a.guns[a.weapon].reserve===0){const pickup=nearestPickup(s,a);if(pickup)takePickup(s,a,pickup,this.events);}
  let gun=a.guns[a.weapon];
  if(gun.ammo===0&&visible&&vd<9&&a.weapon!=='pistol'&&a.inventory.includes('pistol')&&a.guns.pistol.ammo>0){setEquippedWeapon(a,'pistol');gun=a.guns.pistol;}
  else if(!visible&&a.weapon==='pistol'){const primary=[...a.inventory].reverse().find(k=>k!=='pistol'&&a.guns[k].ammo>0);if(primary){setEquippedWeapon(a,primary);gun=a.guns[primary];}}
  if(gun.ammo===0){if(gun.reserve===0){const other=a.inventory.find(k=>a.guns[k].ammo>0||a.guns[k].reserve>0);if(other)setEquippedWeapon(a,other);gun=a.guns[a.weapon];}this.reload(a);}
  if(a.inventory.includes('knife')&&!a.inventory.some(k=>k!=='knife'&&a.guns[k].ammo+a.guns[k].reserve>0)){
   setEquippedWeapon(a,'knife');
   if(visible&&vd<MELEE_REACH+1){
    // Keep closing until contact is reliable; the old stop radius could leave
    // a stationary opponent outside every swing. Aim after pursuit movement.
    if(vd>1.15)this.botMove(a,b,visible,dt,3.9);
    const distance=Math.hypot(visible.x-a.x,visible.z-a.z),angle=Math.atan2(-(visible.x-a.x),-(visible.z-a.z));
    a.yaw=turnBot(a.yaw,angle,dt,9);a.pitch=Math.atan2(aimHeight-eyeHeight(a),distance);
    if(distance<MELEE_REACH&&Math.abs(wrap(angle-a.yaw))<.2){
     const attack:MeleeAttack=s.mode==='knifeOnly'&&distance<1.3&&visible.health>MELEE_ATTACKS.slash.damage?'stab':'slash';
     this.fire(a,attack);
    }
    return;
   }
   const nearby=nearestPickup(s,a);
   if(nearby&&takePickup(s,a,nearby,this.events))return;
   const supply=s.pickups.filter(p=>p.ammo+p.reserve>0).sort((p,q)=>Math.hypot(p.x-a.x,p.z-a.z)-Math.hypot(q.x-a.x,q.z-a.z))[0];
   this.botMove(a,b,baseAlarm||recall||['escort','rescue','plant','defuse','recover'].includes(objective.role)?objective.point:visible??b.memory??supply??objective.point,dt,3.9);return;
  }
  const threatened=visible??(baseAlarm?null:b.memory);
  const tacticalAllies=s.mode==='armsRace'?[]:s.actors;
  const urgent=objective.role==='defuse'&&s.bomb.timer<14||objective.role==='escort'||recall;
  const allyReloading=s.mode!=='armsRace'&&!!threatened&&s.actors.some(f=>f!==a&&f.team===a.team&&f.health>0&&Math.hypot(f.x-a.x,f.z-a.z)<12&&Math.abs((f.y??0)-(a.y??0))<2&&f.guns[f.weapon].reloadLeft>0);
  const wantsReload=!visible&&gun.reloadLeft===0&&gun.reserve>0&&gun.ammo<Math.max(2,Math.ceil(WEAPONS[a.weapon].magazine*.28))&&!(gun.ammo>=3&&allyReloading);
  b.exposedFor=visible&&!b.cover?b.exposedFor+dt:Math.max(0,b.exposedFor-dt*2);
  // Reserve positions until arrival/timeout. Only living allies share reservations.
  const reservations=()=>s.mode==='armsRace'?[]:s.actors.filter(f=>f!==a&&f.team===a.team&&f.health>0).flatMap(f=>{
   const brain=this.brains[f.id];return brain?.cover&&brain.coverUntil>s.time?[brain.cover]:brain?.reposition&&brain.moveUntil>s.time?[brain.reposition]:[];
  });
  if(threatened&&s.time>=b.tacticAt){
   const order=squadOrder(a,s.actors.map(f=>({actor:f,seeing:f===a?!!visible:(this.brains[f.id]?.seenAt??-10)>s.time-.35&&Math.hypot((this.brains[f.id]?.memory?.x??Infinity)-threatened.x,(this.brains[f.id]?.memory?.z??Infinity)-threatened.z)<4})),threatened,s.time,s.mode,allBots);
   if(order.role==='support'&&b.squadRole!=='support')b.reposition=null;
   b.squadRole=order.role;b.supportId=order.supportId;
   b.tactic=chooseCombatAction({visible:!!visible,health:a.health,reloading:gun.reloadLeft>0||wantsReload,pressure:b.pressure,range:Math.hypot(a.x-threatened.x,a.z-threatened.z),idealRange:preferredRange(a.weapon),role:order.role,covered:order.covered,opportunity:!!visible&&visible.guns[visible.weapon].reloadLeft>0,urgent,exposedFor:b.exposedFor});
   b.tacticAt=s.time+.55+(a.id%4)*.07;
   if(!holdingSite&&!b.cover&&s.time>=b.nextAngle&&(b.tactic==='advance'||b.tactic==='flank')){
    b.reposition=findBotAdvance(a,threatened,order.side,visible&&visible.guns[visible.weapon].reloadLeft>0&&b.squadRole!=='support'?Math.max(4,vd-4):preferredRange(a.weapon),b.tactic==='flank',tacticalAllies,reservations());
    b.moveUntil=s.time+2.2;b.nextAngle=s.time+2.8;b.exposedFor=0;
   }
  }
  if(threatened&&!urgent&&!b.cover&&b.decision<=0&&(b.tactic==='cover'||gun.reloadLeft>0||wantsReload)){
   b.cover=findBotCover(a,threatened,tacticalAllies,reservations());b.decision=2.2;
   if(b.cover){b.coverUntil=s.time+5;b.shelterUntil=0;b.reposition=null;b.tactic='cover';}
  }
  if(b.cover&&!inDefenseRange(b.cover))b.cover=null;
  if(b.cover&&!urgent&&s.time<b.coverUntil){
   const reached=Math.hypot(a.x-b.cover.x,a.z-b.cover.z)<.45&&Math.abs((a.y??0)-(b.cover.y??0))<.55;
   if(!reached){this.botMove(a,b,b.cover,dt,3.1);return;}
   a.crouched=true;
   if(wantsReload)this.reload(a);
   if(!b.shelterUntil)b.shelterUntil=s.time+.65+(a.id%3)*.15;
   if(gun.reloadLeft>0||s.time<b.shelterUntil)return;
   // Leave shelter on a finite schedule; injury must not cause endless camping.
   b.cover=null;b.decision=3;b.nextAngle=s.time;b.exposedFor=0;b.tacticAt=s.time;
   if(threatened){b.reposition=findBotAngle(a,threatened,b.strafe,tacticalAllies,reservations());b.moveUntil=s.time+2.1;b.nextAngle=s.time+2.7;}
   a.crouched=!!getActiveMap().geometry?.needsCrouch?.(a.x,a.z,actorBaseY(a));
  }else if(b.cover){b.cover=null;b.decision=2;b.tacticAt=s.time;}
  if(wantsReload&&!b.cover)this.reload(a);
  if(!threatened){b.tactic='search';b.squadRole='solo';b.supportId=null;}
  if(visible){
   if(b.target!==visible.id){b.target=visible.id;b.react=(b.attacker?.id===visible.id ? .18 : .28)+b.alertness*.18+this.random()*.08;b.burst=0;b.rest=0;if(!b.reposition)b.nextAngle=Math.min(b.nextAngle,s.time+1.2+this.random()*.8);}
   b.react-=dt;
   const angle=Math.atan2(-(visible.x-a.x),-(visible.z-a.z));a.yaw+=Math.max(-dt*3.7,Math.min(dt*3.7,wrap(angle-a.yaw)*(1-Math.exp(-dt*8))));
   const friendlyBlocking=s.mode!=='armsRace'&&s.actors.some(f=>friendlyBlocksShot(a,visible!,aimHeight,f));
   if(a.id%2===1&&a.grenades>0&&b.react<-.7&&vd>9&&vd<16&&gun.reloadLeft===0&&Math.abs(wrap(angle-a.yaw))<.12&&!s.actors.some(f=>f.team===a.team&&f!==a&&f.health>0&&Math.hypot(f.x-visible!.x,f.z-visible!.z)<7))this.throwGrenade(a);
   // Occupiers and recalled defenders keep the base, while making space for shots.
   if(holdingSite){
    if(b.reposition&&(s.time>=b.moveUntil||Math.hypot(b.reposition.x-defense!.site.x,b.reposition.z-defense!.site.z)>defense!.site.radius-.35))b.reposition=null;
    if(friendlyBlocking&&!b.reposition&&s.time>=b.nextAngle){
     b.reposition=findDefenseFireLane(a,visible,aimHeight,s,reservations());
     b.moveUntil=s.time+1.5;b.nextAngle=s.time+.8;
    }
   }
   // Commit to a position for a short interval. Avoid synchronized left/right twitching.
   else if(s.time>=b.nextAngle&&!b.cover&&(friendlyBlocking||vd<5||b.rest>0&&b.squadRole==='solo'||s.time-a.hurtTime<.6)){
    b.reposition=findBotAngle(a,visible,b.strafe,tacticalAllies,reservations());b.moveUntil=s.time+1.5+this.random()*.7;
    b.nextAngle=s.time+2.5+this.random()*2;b.strafe*=-1;
   }
   if(b.reposition&&!inDefenseRange(b.reposition))b.reposition=null;
   if(urgent)this.botMove(a,b,objective.point,dt,3.2);
   else if(b.reposition&&s.time<b.moveUntil&&Math.hypot(a.x-b.reposition.x,a.z-b.reposition.z)>.45){
    this.botMove(a,b,b.reposition,dt,b.tactic==='advance'?3.1:2.7);
   }else{
    b.reposition=null;
    // Attackers advance between aimed bursts. Forcing continuous movement
    // prevented every long-range shot and overrode the squad's covering roles.
    if(defense&&a.team==='red'&&!occupying&&b.rest>0&&gun.reloadLeft===0)this.botMove(a,b,objective.point,dt,2.9);
   }
   if(!a.moving&&b.squadRole==='support'&&vd>7&&tacticalLineClear(a,visible,1.08,aimHeight-actorBaseY(visible))){
    a.crouched=true;
   }
   const targetPitch=Math.atan2(aimHeight-eyeHeight(a),vd);a.pitch+=(targetPitch-a.pitch)*Math.min(1,dt*7);
   // Plant feet for controlled bursts; only use moving fire at close range.
   const safeShot=tacticalLineClear(a,visible,eyeHeight(a)-actorBaseY(a),aimHeight-actorBaseY(visible))&&(s.mode==='armsRace'||!s.actors.some(f=>friendlyBlocksShot(a,visible!,aimHeight,f)));
   if(safeShot&&(!a.moving||vd<7)&&b.react<=0&&b.rest<=0&&Math.abs(wrap(angle-a.yaw))<.09&&Math.abs(Math.atan2(aimHeight-eyeHeight(a),vd)-a.pitch)<.1){
    const saveYaw=a.yaw,savePitch=a.pitch;
    const aimError=.055+b.alertness*.035;
    a.yaw+=(this.random()-.5)*aimError;a.pitch+=(this.random()-.5)*aimError*.5;
    if(this.fire(a)&&++b.burst>=(vd>15?2:vd>8?3:5)){b.burst=0;b.rest=.3+this.random()*.3;}
    a.yaw=saveYaw;a.pitch=savePitch;
   }

  }else{
   if(s.time-b.seenAt>1)b.target=-1;a.pitch*=Math.max(0,1-dt*5);
   if(b.attacker&&b.attacker.turnUntil>s.time)a.yaw=turnBot(a.yaw,Math.atan2(-(b.attacker.x-a.x),-(b.attacker.z-a.z)),dt,5.5);
   const mission=objective.role==='escort'||objective.role==='rescue'||objective.role==='defuse'||objective.role==='plant'||objective.role==='recover'||recall||baseAlarm||!!defense&&a.team==='red';
   const remembered=b.memory&&inDefenseRange(b.memory)?b.memory:null;
   const goal=mission?objective.point:remembered??objective.point;
   const guardWalk=!defense&&!mission&&objective.role==='guard'&&!b.memory&&Math.hypot(a.x-goal.x,a.z-goal.z)<2.2&&Math.abs(actorBaseY(a)-(goal.y??actorBaseY(a)))<.6;
   if(guardWalk){this.botWalkTurn(a,b,goal,dt,true);return;}
   if(b.walkTurn?.guard||mission||b.memory)b.walkTurn=null;
   if(b.patrolPause>0&&!b.memory)return;
   if(b.walkTurn){this.botWalkTurn(a,b,b.walkTurn.center,dt,false);return;}
   // Search around the last observation instead of waiting forever at its exact point.
   if(b.memory&&s.time-b.seenAt>.7&&s.time>=b.nextAngle&&(!defense||Math.hypot(a.x-b.memory.x,a.z-b.memory.z)<5)){
    b.reposition=findBotAngle(a,b.memory,b.strafe,tacticalAllies,reservations());b.moveUntil=s.time+2;b.nextAngle=s.time+3;
   }
   if(b.reposition&&!inDefenseRange(b.reposition))b.reposition=null;
   // Slow, quiet movement approaching a remembered corner; stand for live combat.
   a.crouched=!!b.memory&&!mission&&Math.hypot(a.x-b.memory.x,a.z-b.memory.z)<7&&s.time-b.seenAt>1&&b.pressure<.25;
   this.botMove(a,b,!mission&&b.reposition&&s.time<b.moveUntil?b.reposition:goal,dt,b.pace);
   if(a.crouched&&b.memory)a.yaw=turnBot(a.yaw,Math.atan2(-(b.memory.x-a.x),-(b.memory.z-a.z)),dt);
   if(!a.moving&&b.memory&&Math.hypot(a.x-b.memory.x,a.z-b.memory.z)<1){b.memory=null;b.repath=0;}
   if(!a.moving&&!(b.attacker&&b.attacker.turnUntil>s.time)){
    if(defense){
     // Hold a meaningful approach bearing, never accumulate an idle spin.
     const watch=remembered??getActiveMap().redSpawns[(a.id+b.patrolStep)%getActiveMap().redSpawns.length];
     a.yaw=turnBot(a.yaw,Math.atan2(-(watch.x-a.x),-(watch.z-a.z)),dt);
    }else if(!mission&&!b.memory)this.botWalkTurn(a,b,{x:a.x,z:a.z,y:a.y},dt,false);
   }
  }
 }
}
