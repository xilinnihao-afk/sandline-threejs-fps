import {areEnemies} from './offlineModes';
import type {Actor,PlayerInput,GameMode} from './types';
import {actorBaseY} from './jump';
import {wallDistance} from './collision';

const wrap=(a:number)=>Math.atan2(Math.sin(a),Math.cos(a));
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
type Candidate={actor:Actor;yaw:number;pitch:number;score:number;strength:number};

/** Touch-only view assistance, never a change to bullets or hit volumes.
 * A small angular margin around a visible torso provides friction; attraction
 * requires firing and intentional movement, and yields to pulling away. */
export class AimAssist {
 private targetId:number|null=null;
 reset():void {this.targetId=null;}
 apply(player:Actor,actors:readonly Actor[],input:PlayerInput,dt:number,sensitivity:number,enabled:boolean,mode:GameMode='deathmatch'){
  let yaw=input.lookDX*sensitivity+(input.gyroDX??0),pitch=input.lookDY*sensitivity+(input.gyroDY??0);
  const none=()=>{this.reset();return {yaw,pitch,targetId:null,slowdown:1};};
  if(!enabled||input.inputSource!=='touch'||player.weapon==='knife'||player.health<=0||player.guns[player.weapon].reloadLeft>0)return none();
  const eye=actorBaseY(player)+(player.crouched?1.08:1.62),margin=input.aiming?.032:.065;
  const candidates:Candidate[]=[];
  for(const actor of actors){
   if(!areEnemies(player,actor,mode)||actor.health<=0)continue;
   const dx=actor.x-player.x,dz=actor.z-player.z,distance=Math.hypot(dx,dz);
   if(distance<1||distance>32)continue;
   const targetYaw=Math.atan2(-dx,-dz),dyaw=wrap(targetYaw-player.yaw);
   const base=actorBaseY(actor),lower=base+(actor.crouched?.38:.65),upper=base+(actor.crouched?.98:1.48);
   // The closest visible torso height avoids pulling a well-placed crosshair
   // from one body part to another. No automatic head target is introduced.
   const y=clamp(eye+Math.tan(player.pitch)*distance,lower,upper);
   const targetPitch=Math.atan2(y-eye,distance),dpitch=targetPitch-player.pitch;
   const horizontal=Math.max(0,Math.abs(dyaw)-Math.atan2(.25,distance));
   const score=Math.hypot(horizontal,dpitch)/margin;
   if(score>1)continue;
   const length=Math.hypot(distance,y-eye);
   if(wallDistance(player.x,eye,player.z,dx/length,(y-eye)/length,dz/length)<length-.03)continue;
   candidates.push({actor,yaw:dyaw,pitch:dpitch,score,strength:1-score});
  }
  candidates.sort((a,b)=>a.score-b.score);
  let target=candidates[0];
  const retained=candidates.find(c=>c.actor.id===this.targetId);
  if(retained&&target&&retained.score<=target.score+.20)target=retained;
  if(!target)return none();
  this.targetId=target.actor.id;
  const pullingAway=yaw*target.yaw+pitch*target.pitch< -1e-7;
  // Slow down touch displacement only. Gyroscope micro adjustments keep their
  // own calibrated gain and are not filtered a second time by this system.
  const slowdown=pullingAway?1:1-.38*target.strength;
  yaw=input.lookDX*sensitivity*slowdown+(input.gyroDX??0);
  pitch=input.lookDY*sensitivity*slowdown+(input.gyroDY??0);
  const intentional=Math.abs(yaw)+Math.abs(pitch)+Math.abs(input.moveX)+Math.abs(input.moveZ)>1e-5;
  if(input.fire&&intentional&&!pullingAway&&player.weapon!=='sniper'){
   const step=clamp(dt,0,1/15),gain=(1-Math.exp(-step*1.1))*target.strength;
   const correction=(error:number,limit:number)=>clamp(error*gain,-limit*step,limit*step);
   yaw+=correction(target.yaw,Math.PI/100);
   pitch+=correction(target.pitch,Math.PI/180);
  }
  return {yaw,pitch,targetId:this.targetId,slowdown};
 }
}
