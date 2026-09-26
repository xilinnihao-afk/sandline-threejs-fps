import { BLUE_SPAWNS,RED_SPAWNS,MAP_BOXES } from './map';
import {findPath,lineClear,moveBody,rayBox,wallDistance} from './collision';
import {DEFAULT_SETTINGS,EMPTY_INPUT,WEAPON_KINDS,type Actor,type GameEvent,type GameSnapshot,type Gun,type PlayerInput,type Settings,type Team,type WeaponKind,type ObjectiveSite} from './types';
import {avoidActors,type Avoidance} from './botAvoidance';
import {botObjective,findBotCover} from './botTactics';
import {sampleBlast} from './blast';
import {advanceGrenade} from './grenades';
import {LOADOUTS} from './loadouts';
import {buy as buyItem,resetEconomy,roundReward,STARTING_MONEY} from './economy';
export const WEAPONS={
 rifle:{magazine:30,reserve:90,damage:27,head:84,interval:.115,reload:2.15,spread:.006,pellets:1},
 pistol:{magazine:12,reserve:48,damage:24,head:66,interval:.29,reload:1.45,spread:.004,pellets:1},
 smg:{magazine:30,reserve:120,damage:17,head:48,interval:.075,reload:1.9,spread:.014,pellets:1},
 shotgun:{magazine:8,reserve:32,damage:12,head:22,interval:.88,reload:3.1,spread:.13,pellets:8},
};
export const OBJECTIVE_SITES:ObjectiveSite[]=[{id:'A',x:-10,z:-5,radius:2.6},{id:'B',x:10,z:-5,radius:2.6}];
interface Brain {avoidance:Avoidance;progressAt:{x:number;z:number};stalled:number;target:number;react:number;repath:number;path:Array<{x:number;z:number}>;strafe:number;memory:{x:number;z:number;until:number}|null;cover:{x:number;z:number}|null;decision:number;burst:number;rest:number;goal:string;}
export const eyeHeight=(a:Actor)=>a.crouched?1.08:1.62;
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
 private botFootTimers=new Float32Array(6);
 private grenadeId=0;
  constructor(seed=20260915,settings:Settings={...DEFAULT_SETTINGS}){
  this.rngState=seed>>>0;const actors=this.makeActors();
  this.state={phase:'menu',paused:false,time:0,round:1,roundTime:15,blueScore:0,redScore:0,winner:null,actors,grenades:[],player:actors[0],spectating:null,settings,feed:[],hitMarker:0,damageAngle:0,totalKills:0,totalDeaths:0,mode:'demolition',bomb:{status:'carried',carrierId:0,x:0,z:0,site:null,timer:40,progress:0,defuserId:null},sites:OBJECTIVE_SITES};
 }
 random(){let t=this.rngState+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;}
 seed(seed:number){this.rngState=seed>>>0;}
 private gun(kind:WeaponKind):Gun {return {ammo:WEAPONS[kind].magazine,reserve:WEAPONS[kind].reserve,cooldown:0,reloadLeft:0};}
 private makeActors():Actor[]{return Array.from({length:6},(_,id)=>{const team=id<3?'blue':'red',faction=id<3?'ct':'t';const p=(team==='blue'?BLUE_SPAWNS:RED_SPAWNS)[id%3];const weapon='rifle';const actor={id,name:['你','隼鹰','霜刃','沙狐','蝰蛇','灰狼'][id],team,faction,player:id===0,x:p.x,z:p.z,yaw:team==='blue'?0:Math.PI,pitch:0,health:100,armor:0,money:STARTING_MONEY,crouched:false,moving:false,weapon,guns:{rifle:this.gun('rifle'),pistol:this.gun('pistol'),smg:this.gun('smg'),shotgun:this.gun('shotgun')},grenades:0,throwTime:-10,kills:0,deaths:0,shotTime:-10,hurtTime:-10,spread:0,hasBomb:faction==='t',defuseKit:false} as Actor;return actor;});}
 start(){this.state.blueScore=0;this.state.redScore=0;this.state.round=1;this.state.totalKills=0;this.state.totalDeaths=0;this.state.feed=[];this.state.time=0;this.events=[];this.resetRound();}
 resetRound(){const s=this.state;const stats=s.actors.map(a=>({kills:a.kills,deaths:a.deaths,money:a.money}));s.actors=this.makeActors();s.grenades=[];s.actors.forEach((a,i)=>{if(s.round>1)Object.assign(a,stats[i]);resetEconomy(a,a.money);});const carrier=s.actors.find(a=>a.faction==='t');if(carrier)carrier.hasBomb=true;s.player=s.actors[0];s.spectating=null;s.phase='playing';s.roundTime=105;s.paused=false;s.winner=null;s.hitMarker=0;s.bomb={status:'carried',carrierId:carrier?.id??3,x:0,z:0,site:null,timer:40,progress:0,defuserId:null};this.brains=s.actors.map(a=>({avoidance:{side:1,hold:0},progressAt:{x:a.x,z:a.z},stalled:0,target:-1,react:.5,repath:0,path:[],strafe:1,memory:null,cover:null,decision:0,burst:0,rest:0,goal:''}));this.events.push({type:'round'});}
 purchase(item:Parameters<typeof buyItem>[1],actor=this.state.player):boolean{return this.state.phase==='prep'&&buyItem(actor,item,this.events);}
 menu(){this.state.phase='menu';this.state.paused=false;this.events=[];}
 setPaused(paused:boolean){if(this.state.phase!=='menu'&&this.state.phase!=='matchEnd')this.state.paused=paused;}
 reload(a:Actor){const g=a.guns[a.weapon],w=WEAPONS[a.weapon];if(!WEAPON_KINDS.includes(a.weapon)||a.health<=0||g.reloadLeft>0||g.ammo===w.magazine||g.reserve<=0)return false;g.reloadLeft=w.reload;this.events.push({type:'reload',actorId:a.id,weapon:a.weapon,shells:a.weapon==='shotgun'?Math.min(6,w.magazine-g.ammo):undefined});return true;}
 private finishRound(winner:Team|'draw'){const s=this.state;s.winner=winner;if(winner==='blue')s.blueScore++;if(winner==='red')s.redScore++;s.actors.forEach(a=>{const won=(winner==='blue'&&a.team==='blue')||(winner==='red'&&a.team==='red');const amount=roundReward(a,won,Math.max(0,s.round-1));this.events.push({type:'roundReward',actorId:a.id,amount});a.moving=false;});s.phase=s.blueScore>=3||s.redScore>=3?'matchEnd':'roundEnd';s.roundTime=4;this.events.push({type:'round'});}
 private checkRound(){const s=this.state,blue=s.actors.filter(a=>a.team==='blue'&&a.health>0),red=s.actors.filter(a=>a.team==='red'&&a.health>0);if(s.bomb.status==='exploded'){this.finishRound('red');return;}if(s.bomb.status==='defused'){this.finishRound('blue');return;}
  if(s.bomb.status==='planted'){if(!blue.length)this.finishRound('red');return;}
  if(!blue.length||!red.length){this.finishRound(blue.length?'blue':red.length?'red':'draw');return;}
  if(!red.length){this.finishRound('blue');return;}
  if(s.roundTime<=0){const delta=blue.length-red.length||blue.reduce((n,a)=>n+a.health,0)-red.reduce((n,a)=>n+a.health,0);this.finishRound(delta>0?'blue':delta<0?'red':'draw');}}
 update(dt:number,input:PlayerInput=EMPTY_INPUT,allBots=false){
  const s=this.state;if(input.pause)this.setPaused(!s.paused);if(s.paused||s.phase==='menu'||s.phase==='matchEnd')return;
  s.time+=dt;s.hitMarker=Math.max(0,s.hitMarker-dt);s.feed=s.feed.filter(f=>s.time-f.at<6);s.roundTime-=dt;
  if(s.phase==='roundEnd'){if(s.roundTime<=0){s.round++;this.resetRound();}return;}
  const player=s.player;player.yaw=wrap(player.yaw+input.lookDX*s.settings.sensitivity);player.pitch=Math.max(-1.25,Math.min(1.25,player.pitch+input.lookDY*s.settings.sensitivity));player.crouched=input.crouch;
  this.separateActors();
  for(const a of s.actors){if(a.health<=0){a.moving=false;continue;}a.spread=Math.max(0,a.spread-dt*.09);for(const kind of WEAPON_KINDS){const g=a.guns[kind];g.cooldown=Math.max(0,g.cooldown-dt);if(g.reloadLeft>0){g.reloadLeft=Math.max(0,g.reloadLeft-dt);if(g.reloadLeft===0){const n=Math.min(WEAPONS[kind].magazine-g.ammo,g.reserve);g.ammo+=n;g.reserve-=n;}}}}
  if(player.health>0&&!allBots){
   if(input.switchWeapon&&WEAPON_KINDS.includes(input.switchWeapon)&&player.guns[player.weapon].reloadLeft===0)player.weapon=input.switchWeapon;
   const n=Math.max(1,Math.hypot(input.moveX,input.moveZ)),speed=(player.crouched?1.65:3.9)*dt;
   const dx=(Math.cos(player.yaw)*input.moveX-Math.sin(player.yaw)*input.moveZ)/n*speed,dz=(-Math.sin(player.yaw)*input.moveX-Math.cos(player.yaw)*input.moveZ)/n*speed;
   const pos=moveBody(player.x,player.z,dx,dz);player.moving=Math.hypot(pos.x-player.x,pos.z-player.z)>.001;player.x=pos.x;player.z=pos.z;
   if(input.reload)this.reload(player);
   if(input.grenade)this.throwGrenade(player);
   if(input.interact)this.interact(player);
   if(input.fire){if(s.settings.aimAssist)this.assist(player,dt);this.fire(player);}if(player.moving){this.footTimer-=dt;if(this.footTimer<=0){this.footTimer=player.crouched?.62:.38;this.events.push({type:'step',actorId:0});}}
  }
  for(const a of s.actors)if((!a.player||allBots)&&a.health>0){
   this.bot(a,dt,allBots);
   if(a.moving){this.botFootTimers[a.id]-=dt;if(this.botFootTimers[a.id]<=0){this.botFootTimers[a.id]=a.crouched?.62:.46;this.events.push({type:'step',actorId:a.id});}}
   else this.botFootTimers[a.id]=.12;
  }
  this.separateActors();
  this.updateBomb(dt);this.updateGrenades(dt);
  if(player.health<=0){s.spectating=s.actors.find(a=>a.team==='blue'&&a.health>0)||null;}
  this.checkRound();
 }
 private nearestSite(a:Actor):ObjectiveSite|null{return this.state.sites.find(site=>Math.hypot(a.x-site.x,a.z-site.z)<=site.radius)??null;}
 private interact(a:Actor){const s=this.state;if(s.phase!=='playing'&&s.phase!=='planted')return false;
  if(a.faction==='t'&&a.hasBomb&&s.bomb.status==='carried'){const site=this.nearestSite(a);if(site){a.hasBomb=false;s.bomb.status='planted';s.bomb.carrierId=null;s.bomb.x=site.x;s.bomb.z=site.z;s.bomb.site=site.id;s.bomb.timer=40;s.bomb.progress=0;s.phase='planted';this.events.push({type:'plantComplete',actorId:a.id,x:site.x,z:site.z,site:site.id});return true;}}
  if(a.faction==='ct'&&s.bomb.status==='planted'&&Math.hypot(a.x-s.bomb.x,a.z-s.bomb.z)<=2.4){if(s.bomb.defuserId!==a.id)this.events.push({type:'defuseStart',actorId:a.id,x:a.x,z:a.z});s.bomb.defuserId=a.id;return true;}
  return false;
 }
 private updateBomb(dt:number){const s=this.state;
  if(s.bomb.status==='carried'){const carrier=s.actors.find(a=>a.id===s.bomb.carrierId&&a.health>0);if(carrier){s.bomb.x=carrier.x;s.bomb.z=carrier.z;}else{const dropped=s.actors.find(a=>a.faction==='t'&&a.hasBomb);if(dropped){dropped.hasBomb=false;s.bomb.status='dropped';s.bomb.carrierId=null;s.bomb.x=dropped.x;s.bomb.z=dropped.z;this.events.push({type:'bombDrop',actorId:dropped.id,x:dropped.x,z:dropped.z});}}}
  if(s.bomb.status==='dropped'){const pickup=s.actors.find(a=>a.faction==='t'&&a.health>0&&!a.hasBomb&&Math.hypot(a.x-s.bomb.x,a.z-s.bomb.z)<1.1);if(pickup){pickup.hasBomb=true;s.bomb.status='carried';s.bomb.carrierId=pickup.id;this.events.push({type:'bombPickup',actorId:pickup.id,x:pickup.x,z:pickup.z});}}
  if(s.bomb.status==='planted'){s.bomb.timer=Math.max(0,s.bomb.timer-dt);if(s.bomb.defuserId!==null){const defuser=s.actors[s.bomb.defuserId];if(defuser.health<=0||Math.hypot(defuser.x-s.bomb.x,defuser.z-s.bomb.z)>2.4)s.bomb.defuserId=null;else{s.bomb.progress+=defuser.defuseKit?dt/5:dt/10;if(s.bomb.progress>=1){s.bomb.status='defused';s.bomb.defuserId=null;s.phase='roundEnd';this.events.push({type:'defuseComplete',actorId:defuser.id,site:s.bomb.site??undefined});}}}if(Math.ceil(s.bomb.timer)!==Math.ceil(s.bomb.timer+dt))this.events.push({type:'bombTick',x:s.bomb.x,z:s.bomb.z});if(s.bomb.timer<=0&&s.bomb.status==='planted'){s.bomb.status='exploded';this.events.push({type:'bombExplode',x:s.bomb.x,z:s.bomb.z,site:s.bomb.site??undefined});}}
 }
 private assist(a:Actor,dt:number){let target:Actor|undefined,best=.105;for(const b of this.state.actors){if(b.team===a.team||b.health<=0||!lineClear(a.x,a.z,b.x,b.z,eyeHeight(a)))continue;const desired=Math.atan2(-(b.x-a.x),-(b.z-a.z)),delta=Math.abs(wrap(desired-a.yaw));if(delta<best&&Math.abs(a.pitch)<.16){target=b;best=delta;}}
  if(target)a.yaw+=wrap(Math.atan2(-(target.x-a.x),-(target.z-a.z))-a.yaw)*Math.min(.045,dt*1.8);
 }
  fire(a:Actor){
  const s=this.state,g=a.guns[a.weapon],w=WEAPONS[a.weapon];if(!WEAPON_KINDS.includes(a.weapon)||(s.phase!=='playing'&&s.phase!=='planted')||s.paused||a.health<=0||g.cooldown>0||g.reloadLeft>0)return false;
  if(g.ammo<=0){this.reload(a);return false;}g.ammo--;g.cooldown=w.interval;a.shotTime=s.time;
  const spread=(w.spread+a.spread+(a.moving?.026:0))*(a.crouched?.55:1)*(a.player?1:1.25);
  // CS 1.6 style tracers are readable accents, not a laser beam for every shot.
  const tracer=a.player?this.random()<.62:this.random()<.18;
  for(let pellet=0;pellet<w.pellets;pellet++){
   const dir=direction(a.yaw+(this.random()-.5)*spread,a.pitch+(this.random()-.5)*spread),oy=eyeHeight(a);
   const wall=wallDistance(a.x,oy,a.z,dir.x,dir.y,dir.z);let distance=Math.min(75,wall),victim:Actor|undefined,headshot=false;
   for(const b of s.actors){if(b.id===a.id||b.health<=0)continue;const h=b.crouched?1.2:1.8;const body=rayBox(a.x,oy,a.z,dir.x,dir.y,dir.z,b.x-.28,.08,b.z-.28,b.x+.28,h-.34,b.z+.28);const head=rayBox(a.x,oy,a.z,dir.x,dir.y,dir.z,b.x-.18,h-.34,b.z-.18,b.x+.18,h,b.z+.18);const t=Math.min(body,head);if(t<distance){distance=t;victim=b;headshot=head<body;}}
   const end={x:a.x+dir.x*distance,y:oy+dir.y*distance,z:a.z+dir.z*distance};
   if(pellet===0)this.events.push({type:'shot',actorId:a.id,weapon:a.weapon,x:a.x,y:oy,z:a.z,endX:end.x,endY:end.y,endZ:end.z,pelletCount:w.pellets,tracer});
   if(!victim&&wall<75)this.events.push({type:'impact',actorId:a.id,...end,weapon:a.weapon,surface:impactSurface(end.x,end.y,end.z)});
   if(victim&&victim.team!==a.team){const falloff=a.weapon==='shotgun'?Math.max(.25,1-distance/32):1;this.damage(a,victim,Math.round((headshot?w.head:w.damage)*falloff),headshot);}
  }
  a.spread=Math.min(.09,a.spread+.011);
  if(a.player)a.pitch=Math.min(1.25,a.pitch+(a.weapon==='shotgun'?.035:a.weapon==='smg'?.004:a.weapon==='rifle'?.006:.012));
  return true;
 }
 private damage(a:Actor,victim:Actor,amount:number,headshot=false){
  if(victim.health<=0)return;const s=this.state;const absorbed=Math.min(victim.armor,Math.ceil(amount*.35));victim.armor=Math.max(0,victim.armor-absorbed);victim.health=Math.max(0,victim.health-(amount-absorbed));victim.hurtTime=s.time;
  if(a.player&&a!==victim)s.hitMarker=.14;if(victim.player)s.damageAngle=Math.atan2(a.x-victim.x,a.z-victim.z)+victim.yaw;
  this.events.push({type:'hit',actorId:a.id,targetId:victim.id,headshot,surface:'character'});
  if(victim.health===0){if(a!==victim){a.kills++;if(a.player)s.totalKills++;}victim.deaths++;if(victim.player)s.totalDeaths++;
   s.feed.push({killer:a===victim?'自己的手雷':a.name,victim:victim.name,team:a.team,headshot,at:s.time});this.events.push({type:'kill',actorId:a.id,targetId:victim.id,headshot});}
 }
 throwGrenade(a:Actor){
  const s=this.state;if((s.phase!=='playing'&&s.phase!=='planted')||s.paused||a.health<=0||a.grenades===0||a.guns[a.weapon].reloadLeft>0)return false;
  a.grenades--;a.throwTime=s.time;a.guns[a.weapon].cooldown=Math.max(.55,a.guns[a.weapon].cooldown);
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
    if(blast.damage>0)this.damage(owner,target,blast.damage);}
   s.grenades.splice(i,1);
  }
 }
 private separateActors(){const actors=this.state.actors;for(let pass=0;pass<3;pass++)for(let i=0;i<actors.length;i++)for(let j=i+1;j<actors.length;j++){const a=actors[i],b=actors[j];if(a.health<=0||b.health<=0)continue;let dx=b.x-a.x,dz=b.z-a.z,d=Math.hypot(dx,dz);if(d>=.65)continue;if(d<.001){dx=i%2?1:-1;dz=0;d=1;}const amount=(.65-Math.hypot(b.x-a.x,b.z-a.z))*.51;const pa=moveBody(a.x,a.z,-dx/d*amount,-dz/d*amount),pb=moveBody(b.x,b.z,dx/d*amount,dz/d*amount);a.x=pa.x;a.z=pa.z;b.x=pb.x;b.z=pb.z;}}
 private visibleHeight(a:Actor,target:Actor):number|null {const oy=eyeHeight(a),h=target.crouched?1.2:1.8;for(const ty of [h*.64,h-.12]){const dx=target.x-a.x,dz=target.z-a.z,dy=ty-oy,n=Math.hypot(dx,dy,dz);if(n<.01||wallDistance(a.x,oy,a.z,dx/n,dy/n,dz/n)>n-.15)return ty;}return null;}
 /** 路线缓存：目标改变或路线失效才重算，避免每帧执行寻路。 */
 private botMove(a:Actor,b:Brain,goal:{x:number;z:number},dt:number,speed=2.5){
  const key=`${Math.round(goal.x)},${Math.round(goal.z)}`;
  if(b.repath<=0||b.goal!==key){b.path=findPath(a.x,a.z,goal.x,goal.z);b.goal=key;b.repath=1.1+this.random()*.4;}
  let waypoint=b.path[0];while(waypoint&&Math.hypot(waypoint.x-a.x,waypoint.z-a.z)<.23){b.path.shift();waypoint=b.path[0];}
  a.moving=false;if(!waypoint)return;
  const dx=waypoint.x-a.x,dz=waypoint.z-a.z,d=Math.hypot(dx,dz),step=Math.min(d,dt*speed);
  const p=avoidActors(a,{x:dx,z:dz},this.state.actors,dt,speed,b.avoidance);a.moving=Math.hypot(p.x-a.x,p.z-a.z)>.003;
  if(a.moving){a.x=p.x;a.z=p.z;}
  b.stalled+=dt;
  if(Math.hypot(a.x-b.progressAt.x,a.z-b.progressAt.z)>.45){b.progressAt={x:a.x,z:a.z};b.stalled=0;}
  if(b.stalled>1.2){b.repath=0;b.path=[];b.avoidance.hold=0;b.stalled=0;b.progressAt={x:a.x,z:a.z};}
  if(b.target<0)a.yaw+=wrap(Math.atan2(-dx,-dz)-a.yaw)*Math.min(1,dt*7);
 }
 private bot(a:Actor,dt:number,allBots=false){
  const s=this.state,b=this.brains[a.id];b.repath-=dt;b.decision-=dt;b.rest=Math.max(0,b.rest-dt);a.moving=false;a.crouched=false;
  let visible:Actor|undefined,vd=Infinity,aimHeight=1.1;
  for(const v of s.actors){
   if(v.team===a.team||v.health<=0)continue;
   const d=Math.hypot(v.x-a.x,v.z-a.z),angle=Math.atan2(-(v.x-a.x),-(v.z-a.z));
   // 前方视野约 150 度；近身可察觉。声音只提供粗略位置，不允许隔墙锁定。
   const inView=d<4||Math.abs(wrap(angle-a.yaw))<1.31;
   if(d<32&&inView){const h=this.visibleHeight(a,v);if(h!==null&&(d<vd||v.id===b.target)){visible=v;vd=d;aimHeight=h;}}
   if(!visible&&d<14&&s.time-v.shotTime>=0&&s.time-v.shotTime<.12&&!b.memory){b.memory={x:Math.round(v.x/2)*2,z:Math.round(v.z/2)*2,until:s.time+2};}
  }
  if(visible)b.memory={x:visible.x,z:visible.z,until:s.time+4};
  else if(b.memory&&b.memory.until<s.time)b.memory=null;
  const objective=botObjective(a,s,allBots);
  // 即使最后一名敌人已倒下，也要继续完成拆弹。
  if(objective.role==='defuse'&&Math.hypot(a.x-s.bomb.x,a.z-s.bomb.z)<=2.4){
   this.interact(a);a.crouched=true;return;
  }
  if(objective.role==='plant'&&this.nearestSite(a)){this.interact(a);return;}
  // 只躲避可见、距离较近且即将爆炸的手雷。
  for(const g of s.grenades){
   const dx=a.x-g.x,dz=a.z-g.z,d=Math.hypot(dx,dz),dy=eyeHeight(a)-g.y,n=Math.hypot(d,dy);
   if(d>6||g.fuse>1.25||n<.01||wallDistance(g.x,g.y,g.z,dx/n,dy/n,dz/n)<n-.05)continue;
   const away=d>.1?{x:dx/d,z:dz/d}:{x:Math.cos(a.yaw),z:-Math.sin(a.yaw)};
   this.botMove(a,b,{x:a.x+away.x*5,z:a.z+away.z*5},dt,3.5);return;
  }
  let gun=a.guns[a.weapon];
  if(gun.ammo===0&&visible&&vd<9&&a.weapon==='rifle'&&a.guns.pistol.ammo>0){a.weapon='pistol';gun=a.guns.pistol;}
  else if(!visible&&a.weapon==='pistol'&&a.guns.rifle.ammo>0){a.weapon='rifle';gun=a.guns.rifle;}
  if(gun.ammo===0){if(gun.reserve===0){const other=a.weapon==='rifle'?'pistol':'rifle';if(a.guns[other].ammo>0||a.guns[other].reserve>0)a.weapon=other;gun=a.guns[a.weapon];}this.reload(a);}
  else if(!visible&&gun.ammo<8)this.reload(a);
  const threatened=visible??b.memory;
  if(threatened&&b.decision<=0&&(gun.reloadLeft>0||a.health<35)){
   b.cover=findBotCover(a,threatened);b.decision=1.4;
  }
  if(b.cover&&(gun.reloadLeft>0||a.health<35&&b.decision>0)){
   if(Math.hypot(a.x-b.cover.x,a.z-b.cover.z)>.65)this.botMove(a,b,b.cover,dt,2.8);
   else a.crouched=true;
   if(gun.reloadLeft>0)return;
  }else b.cover=null;
  if(visible){
   if(b.target!==visible.id){b.target=visible.id;b.react=.4+this.random()*.45;b.burst=0;b.rest=0;}
   b.react-=dt;
   const angle=Math.atan2(-(visible.x-a.x),-(visible.z-a.z));a.yaw+=wrap(angle-a.yaw)*Math.min(1,dt*5);
   const targetPitch=Math.atan2(aimHeight-eyeHeight(a),vd);a.pitch+=(targetPitch-a.pitch)*Math.min(1,dt*5);
   const friendlyBlocking=s.actors.some(f=>{if(f===a||f.team!==a.team||f.health<=0)return false;const dx=f.x-a.x,dz=f.z-a.z,along=(dx*(visible!.x-a.x)+dz*(visible!.z-a.z))/vd;return along>0&&along<vd&&Math.abs(dx*(visible!.z-a.z)-dz*(visible!.x-a.x))/vd<.5;});
   if(a.id%2===1&&a.grenades>0&&b.react<-.7&&vd>9&&vd<16&&gun.reloadLeft===0&&Math.abs(wrap(angle-a.yaw))<.12&&!s.actors.some(f=>f.team===a.team&&f!==a&&f.health>0&&Math.hypot(f.x-visible!.x,f.z-visible!.z)<7))this.throwGrenade(a);
   if(!friendlyBlocking&&b.react<=0&&b.rest<=0&&Math.abs(wrap(angle-a.yaw))<.12){
    const saveYaw=a.yaw,savePitch=a.pitch;a.yaw+=(this.random()-.5)*.10;a.pitch+=(this.random()-.5)*.05;
    if(this.fire(a)&&++b.burst>=(vd>12?3:5)){b.burst=0;b.rest=.25+this.random()*.2;}
    a.yaw=saveYaw;a.pitch=savePitch;
   }
   // 队友挡线时主动让开；点射间歇横移，不在开火时无意义地左右抖动。
   if(!b.cover&&(friendlyBlocking||vd<4||gun.reloadLeft>0||b.rest>.12)){
    const p=avoidActors(a,{x:Math.cos(a.yaw)*b.strafe,z:-Math.sin(a.yaw)*b.strafe},s.actors,dt,1.7,b.avoidance);
    a.moving=Math.hypot(p.x-a.x,p.z-a.z)>.005;a.x=p.x;a.z=p.z;if(!a.moving)b.strafe*=-1;
   }
   // 剩余时间紧迫时拆弹手继续接近目标，避免在远处无限对射。
   if(objective.role==='defuse'&&s.bomb.timer<14)this.botMove(a,b,objective.point,dt,3);
  }else{
   b.target=-1;a.pitch*=Math.max(0,1-dt*5);
   const goal=objective.role==='defuse'||objective.role==='plant'||objective.role==='recover'?objective.point:b.memory??objective.point;
   if(objective.role==='guard'&&!b.memory&&Math.hypot(a.x-goal.x,a.z-goal.z)<1){a.yaw=wrap(a.yaw+dt*.45);return;}
   this.botMove(a,b,goal,dt);
   if(!a.moving&&b.memory&&Math.hypot(a.x-b.memory.x,a.z-b.memory.z)<1){b.memory=null;b.repath=0;}
   if(!a.moving)a.yaw=wrap(a.yaw+dt*.55);
  }
 }
}
