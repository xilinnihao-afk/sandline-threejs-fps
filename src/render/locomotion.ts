const wrap=(angle:number)=>Math.atan2(Math.sin(angle),Math.cos(angle));
const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n));
const smooth=(lo:number,hi:number,n:number)=>{const t=clamp((n-lo)/(hi-lo),0,1);return t*t*(3-2*t);};
export interface GaitProfile {walkStride:number;runStride:number;}
// Fallback for the 1.81 m roster. Characters measure their own support-foot travel.
export const DEFAULT_GAIT_PROFILE:GaitProfile={walkStride:1.58,runStride:3.1};
export interface GaitState {
 speed:number;phase:number;heading:number;backward:boolean;
 travelYaw?:number;bodyYaw?:number;turnRate?:number;velocityX?:number;velocityZ?:number;leanForward?:number;leanSide?:number;
}
export function createGait(phase=0,yaw=0):GaitState{
 return {speed:0,phase,heading:0,backward:false,travelYaw:yaw,bodyYaw:yaw,turnRate:0,velocityX:0,velocityZ:0,leanForward:0,leanSide:0};
}
export function gaitWeights(gait:GaitState){
 const run=smooth(2.2,3.4,gait.speed),weight=smooth(.025,.65,gait.speed);
 return {idle:1-weight,walk:weight*(1-run),run:weight*run};
}
/** Distance drives the authored feet; seconds only filter state and settle the
 * last fraction of a step. World-space pelvis heading survives changes in aim. */
export function advanceGait(gait:GaitState,dx:number,dz:number,yaw:number,dt:number,moving:boolean,profile:GaitProfile=DEFAULT_GAIT_PROFILE){
 if(!(dt>0))return gaitWeights(gait);
 const elapsed=Math.min(dt,.1),distance=Math.hypot(dx,dz);
 const measured=moving?Math.min(5,distance/dt):0,travel=measured>.025;
 // Small analytic substeps make speed-dependent stride blending agree at
 // 30/60/120 Hz; no per-frame spring or frame-count based phase increments.
 const count=Math.ceil(elapsed*120),step=elapsed/count;
 gait.bodyYaw??=wrap(yaw+gait.heading);
 for(let i=0;i<count;i++){
  const speedBefore=gait.speed,decay=travel?14:12;
  const middle=measured+(speedBefore-measured)*Math.exp(-step*decay*.5);
  gait.speed=measured+(speedBefore-measured)*Math.exp(-step*decay);
  const run=smooth(2.2,3.4,middle),weight=smooth(.025,.65,middle);
  const stride=profile.walkStride+(profile.runStride-profile.walkStride)*run;
  let target=yaw;
  if(travel){
   gait.travelYaw=Math.atan2(-dx,-dz);
   let heading=wrap(gait.travelYaw-yaw);
   // Hysteresis keeps noisy near-sideways travel from reversing the cycle.
   if(Math.abs(heading)>Math.PI*.6)gait.backward=true;
   else if(Math.abs(heading)<Math.PI*.4)gait.backward=false;
   if(gait.backward)heading=wrap(heading-Math.PI);
   target=yaw+clamp(heading,-Math.PI*.38,Math.PI*.38);
  }
  // At a real stop let the airborne foot finish a short settling arc while
  // support-foot IK keeps the planted foot still. Never keep cycling at rest.
  const travelDistance=travel?measured*step:(speedBefore-gait.speed)/decay*.65;
  const phaseDistance=travelDistance/(stride*Math.max(.45,weight));
  gait.phase=((gait.phase+(gait.backward?-1:1)*phaseDistance)%1+1)%1;
  const turn=wrap(target-gait.bodyYaw),maxTurn=travel?4.8:3.2;
  const rotation=clamp(turn*(1-Math.exp(-step*(travel?11:7))),-maxTurn*step,maxTurn*step);
  gait.bodyYaw=wrap(gait.bodyYaw+rotation);
  gait.heading=clamp(wrap(gait.bodyYaw-yaw),-1.25,1.25);
  gait.bodyYaw=wrap(yaw+gait.heading);
  gait.turnRate=(gait.turnRate??0)+(rotation/step-(gait.turnRate??0))*(1-Math.exp(-step*10));
  const vx=travel?dx/distance*measured:0,vz=travel?dz/distance*measured:0;
  const oldX=gait.velocityX??0,oldZ=gait.velocityZ??0,filter=1-Math.exp(-step*8);
  gait.velocityX=oldX+(vx-oldX)*filter;gait.velocityZ=oldZ+(vz-oldZ)*filter;
  const ax=(gait.velocityX-oldX)/step,az=(gait.velocityZ-oldZ)/step;
  const forward=-Math.sin(yaw)*ax-Math.cos(yaw)*az,side=Math.cos(yaw)*ax-Math.sin(yaw)*az;
  gait.leanForward=(gait.leanForward??0)+(clamp(forward*.009,-.055,.065)-(gait.leanForward??0))*(1-Math.exp(-step*9));
  gait.leanSide=(gait.leanSide??0)+(clamp(side*.008,-.055,.055)-(gait.leanSide??0))*(1-Math.exp(-step*9));
 }
 return gaitWeights(gait);
}
/** Common phase is left-foot forward at zero. Use the middle of support, not
 * the lifted heel/toe extremes, so a planted foot can release into the swing. */
export function gaitContactWeight(phase:number,side:number,run:number){
 const p=((phase+(side>0?.5:0))%1+1)%1;
 const end=.50-.14*run;
 return smooth(.10,.18,p)*(1-smooth(end-.09,end,p));
}
