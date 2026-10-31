import {rayBox} from './collision';
import {actorBaseY} from './jump';
import type {Actor,HitRegion} from './types';

type Volume=readonly [HitRegion,number,number,number,number,number,number];
/** Stable gameplay proxies in the actor's facing frame, in metres. Separate
 * legs leave the space between the boots empty. Presentation-only gait/IK
 * never changes damage or makes the collider depend on rendering frame rate. */
const STANDING:readonly Volume[]=[
 ['head',-.18,1.36,-.35,.20,1.70,.10],
 ['chest',-.23,1.02,-.22,.23,1.40,.22],
 ['abdomen',-.22,.76,-.22,.22,1.02,.22],
 ['arm',-.40,1.00,-.25,-.23,1.44,.22],
 ['arm',.23,1.00,-.25,.40,1.44,.22],
 ['arm',-.17,1.12,-.65,.07,1.30,-.22],
 ['leg',-.22,.04,-.19,-.035,.76,.20],
 ['leg',.035,.04,-.19,.22,.76,.20],
];
// Calibrated against all seven rendered roster models (not the standing body
// height minus a guessed drop). Settled crouch head tops measure 1.189–1.226 m;
// a small shared allowance covers idle breathing without a tall phantom head.
const CROUCHED:readonly Volume[]=[
 ['head',-.18,.87,-.37,.20,1.23,.10],
 ['chest',-.23,.59,-.26,.23,.96,.24],
 ['abdomen',-.22,.40,-.20,.22,.59,.24],
 ['arm',-.40,.55,-.29,-.23,.97,.20],
 ['arm',.23,.55,-.29,.40,.97,.20],
 ['arm',-.17,.69,-.65,.07,.85,-.22],
 ['leg',-.23,.04,-.32,-.035,.40,.28],
 ['leg',.035,.04,-.32,.23,.40,.28],
];
export const BODY_DAMAGE_MULTIPLIERS={chest:1,abdomen:1.25,arm:.8,leg:.65} as const;
export const actorHitHeight=(actor:Pick<Actor,'crouched'>)=>actor.crouched?1.23:1.70;

export function hitRegionDamage(weapon:{damage:number;head:number},region:HitRegion,falloff=1):number{
 return Math.round((region==='head'?weapon.head:weapon.damage*BODY_DAMAGE_MULTIPLIERS[region])*falloff);
}

/** Return the first surface reached, not the most valuable overlapping zone.
 * The caller limits this distance against cover and every other live actor. */
export function rayActorHit(actor:Actor,ox:number,oy:number,oz:number,dx:number,dy:number,dz:number):{distance:number;region:HitRegion}|null{
 const c=Math.cos(actor.yaw),s=Math.sin(actor.yaw),x=ox-actor.x,z=oz-actor.z;
 const lx=c*x-s*z,lz=s*x+c*z,ldx=c*dx-s*dz,ldz=s*dx+c*dz;
 const ly=oy-actorBaseY(actor);let distance=Infinity,region:HitRegion='chest';
 for(const [part,minX,minY,minZ,maxX,maxY,maxZ] of actor.crouched?CROUCHED:STANDING){
  const t=rayBox(lx,ly,lz,ldx,dy,ldz,minX,minY,minZ,maxX,maxY,maxZ);
  if(t<distance){distance=t;region=part;}
 }
 return Number.isFinite(distance)?{distance,region}:null;
}
