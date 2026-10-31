import * as THREE from 'three';
import {MELEE_ATTACKS} from '../game/melee';
import type {MeleeAttack} from '../game/types';

interface Key {time:number;position:THREE.Vector3;angles:THREE.Vector3}
const key=(time:number,p:number[],r:number[]):Key=>({time,position:new THREE.Vector3(...p),angles:new THREE.Vector3(...r)});
// Keep the classic blade nearly upright while the wrist closes around its grip.
const ready=key(0,[0,0,0],[-.10,.15,-.035]);
const timelines:Record<MeleeAttack,Key[]>={
 // Raise from the right, cut across the sight line, follow through down-left,
 // then return below the cutting path. Contact is inside the moving stroke.
 slash:[ready,key(.03,[.035,.015,.025],[.06,-.20,-.12]),
  key(MELEE_ATTACKS.slash.contactDelay,[-.20,.025,-.13],[.30,-.15,1.0]),
  key(.22,[-.29,-.055,-.08],[.45,.15,1.45]),
  key(.38,[-.12,-.10,.035],[-.15,.20,1.0]),
  {...ready,time:MELEE_ATTACKS.slash.interval-.025}],
 // Cock the wrist before extending; keep the blade oblique enough to read
 // its forward travel, without sending a straight forearm tube into the sight.
 stab:[ready,key(.07,[.025,-.025,.04],[-.35,-.08,.10]),
  key(MELEE_ATTACKS.stab.contactDelay,[-.10,-.035,-.23],[-.78,-.10,.38]),
  key(.28,[-.11,-.035,-.24],[-.78,-.10,.38]),
  key(.54,[-.025,-.035,.025],[-.50,.10,.18]),
  {...ready,time:MELEE_ATTACKS.stab.interval-.025}],
};
const angles=new THREE.Vector3(),euler=new THREE.Euler();

// Time-aware Hermite tangents preserve velocity through contact/follow-through.
// Extrema have zero tangent, preventing overshoot at the wrist's limits.
function tangent(keys:Key[],index:number,field:'position'|'angles',axis:'x'|'y'|'z'){
 if(index===0||index===keys.length-1)return 0;
 const a=keys[index-1],b=keys[index],c=keys[index+1];
 const before=(b[field][axis]-a[field][axis])/(b.time-a.time),after=(c[field][axis]-b[field][axis])/(c.time-b.time);
 if(before*after<=0)return 0;
 return Math.sign(before)*Math.min(Math.abs((c[field][axis]-a[field][axis])/(c.time-a.time)),3*Math.abs(before),3*Math.abs(after));
}
function interpolate(keys:Key[],index:number,field:'position'|'angles',t:number,out:THREE.Vector3){
 const a=keys[index],b=keys[index+1],dt=b.time-a.time,t2=t*t,t3=t2*t;
 for(const axis of ['x','y','z'] as const)out[axis]=(2*t3-3*t2+1)*a[field][axis]+(t3-2*t2+t)*dt*tangent(keys,index,field,axis)+(-2*t3+3*t2)*b[field][axis]+(t3-t2)*dt*tangent(keys,index+1,field,axis);
}

/** Authored angles stay within one unwrapped XYZ chart (no gimbal crossing).
 * Convert the continuous angular path to a quaternion once per sample. Both
 * position and angular velocity are continuous at impact; elapsed simulation
 * time owns the animation, including pause and exact ready-pose recovery. */
export function sampleKnifeMotion(attack:MeleeAttack,age:number,position:THREE.Vector3,rotation:THREE.Quaternion):void{
 const keys=timelines[attack];
 if(age<=0||age>=keys.at(-1)!.time){position.copy(ready.position);rotation.setFromEuler(euler.set(ready.angles.x,ready.angles.y,ready.angles.z));return;}
 const index=keys.findIndex(k=>k.time>=age)-1,t=(age-keys[index].time)/(keys[index+1].time-keys[index].time);
 interpolate(keys,index,'position',t,position);interpolate(keys,index,'angles',t,angles);
 rotation.setFromEuler(euler.set(angles.x,angles.y,angles.z));
}

// Rotate the closed fist around the handle: fingers face the camera, while
// the glove back and wrist lead outward toward the right forearm.
export const KNIFE_ACTION_GRIP_ROTATION=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),.25);
export const KNIFE_VIEW_GRIP_ROTATION=new THREE.Quaternion().setFromEuler(new THREE.Euler(.357513,1.027843,-.287095));
// Straighten the ready wrist and blade as one rigid assembly. The local hand
// contact stays calibrated to the handle, and attacks retain their own path.
export const KNIFE_VIEW_READY_ADJUSTMENT=new THREE.Quaternion().setFromEuler(new THREE.Euler(-.035,.045,0))
 .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(ready.angles.x,ready.angles.y,ready.angles.z)).invert());
