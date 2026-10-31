import {isHandgun,type WeaponKind} from '../game/types';

export interface FirstPersonMotionFrame {
 x:number;y:number;z:number;yaw:number;pitch:number;speed:number;moving:boolean;
 crouched?:boolean;airborne?:boolean;aiming?:boolean;weapon?:WeaponKind;
 actorId?:number;spawnTime?:number;time?:number;
 lookDX?:number;lookDY?:number;cameraKick?:number;
}
const damp=(from:number,to:number,rate:number,dt:number)=>to+(from-to)*Math.exp(-rate*dt);
const clamp=(v:number,min:number,max:number)=>Math.max(min,Math.min(max,v));
const TAU=Math.PI*2;

/** One locomotion layer shared by every view weapon and both runtimes.
 * Camera pose stays exact; the hands absorb a small, smooth walking rhythm. */
export class FirstPersonMotion {
 readonly offset={x:0,y:0,z:0,pitch:0,yaw:0,roll:0};
 private last:FirstPersonMotionFrame|null=null;
 private speed=0;private travelSpeed=0;private phase=0;private breathTime=0;
 private stability=1;private swayX=0;private swayY=0;
 update(frame:FirstPersonMotionFrame,dt:number,reducedMotion=false):void {
  const delta=clamp(dt,0,.1),previous=this.last;
  const distance=previous?Math.hypot(frame.x-previous.x,frame.z-previous.z):0;
  const reset=!previous||distance>2||previous.actorId!==frame.actorId||previous.spawnTime!==frame.spawnTime||
   (frame.time!==undefined&&previous.time!==undefined&&frame.time<previous.time);
  if(reset){this.speed=this.travelSpeed=this.phase=this.swayX=this.swayY=0;this.breathTime=0;}
  // Use actual travel, so pushing into a wall or a spectator teleport cannot
  // generate full-speed steps. Smooth measured velocity across render ticks.
  // The simulation advances at 60 Hz while rendering can run at 120/144 Hz.
  // Hold its last velocity between ticks instead of alternating zero/double
  // speed on those extra render frames.
  const sampleDelta=previous&&frame.time!==undefined&&previous.time!==undefined?frame.time-previous.time:delta;
  if(!frame.moving||frame.airborne||reset)this.travelSpeed=0;
  else if(sampleDelta>0)this.travelSpeed=clamp(distance/sampleDelta,0,12);
  const travel=this.travelSpeed;
  const oldSpeed=this.speed;this.speed=damp(this.speed,travel,travel>this.speed?8:12,delta);
  const running=clamp((this.speed-3.9)/1.7,0,1);
  this.phase=(this.phase+(oldSpeed+this.speed)*.5*delta/(2.96+running*.35)*TAU)%TAU;
  this.breathTime+=delta;
  const targetStability=(frame.aiming?.18:1)*(frame.crouched?.50:1);
  this.stability=reset?targetStability:damp(this.stability,targetStability,12,delta);
  const hold=frame.weapon!==undefined&&isHandgun(frame.weapon)?.55:frame.weapon==='knife'?.85:1;
  const intensity=reducedMotion?0:clamp(this.speed/3.9,0,1)*this.stability*hold;
  const breath=reducedMotion?0:Math.sin(this.breathTime*1.7)*.0008*this.stability;
  const x=Math.sin(this.phase)*.0046*intensity*(1+running*.65);
  // A smooth 2.6 Hz step at full speed, with no sharp rectified wave or
  // high-frequency secondary bounce. Full walking peak is only 4 mm.
  const y=Math.sin(this.phase*2)*.004*intensity*(1+running*.4)+breath;
  // CS-style viewmodel travel: the hands move toward/away from the shoulder
  // with each footfall, with a small alternating roll. The world lens stays still.
  const step=Math.sin(this.phase*2+.65),z=step*.017*intensity*(1+running*.7);
  const gaitPitch=-step*.007*intensity,gaitRoll=Math.sin(this.phase)*.006*intensity*(1+running*.6);
  this.swayX=damp(this.swayX,reducedMotion?0:clamp(-(frame.lookDY??0)*.12,-.045,.045),9,delta);
  this.swayY=damp(this.swayY,reducedMotion?0:clamp(-(frame.lookDX??0)*.12,-.055,.055),9,delta);
  const kick=frame.cameraKick??0;
  Object.assign(this.offset,{x,y:y+kick*.035,z,pitch:-this.swayX-kick+gaitPitch,yaw:this.swayY,roll:kick*.08+this.swayY*.18+gaitRoll});
  this.last={...frame};
 }
 diagnostics(){return {bobTime:+this.phase.toFixed(3),speed:+this.speed.toFixed(3),sway:[+this.swayX.toFixed(4),+this.swayY.toFixed(4)],weaponMotion:{...this.offset}};}
}
