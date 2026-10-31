import type {Actor} from './types';
import {getActiveMap} from './map';
import type {MapGeometry} from './mapGeometry';

export const JUMP_SPEED=5.2, JUMP_GRAVITY=18;
export const actorBaseY=(actor:Pick<Actor,'y'>)=>actor.y??0;
export const isAirborne=(actor:Pick<Actor,'y'|'verticalSpeed'|'groundY'>)=>actorBaseY(actor)>(actor.groundY??0)+.015||(actor.verticalSpeed??0)>0;

type DuckJumpState={geometry:MapGeometry;spawnedAt:number|undefined;crouched:boolean;lift:number};
const duckJumps=new WeakMap<Actor,DuckJumpState>();

/** Gameplay owns height; camera, hitboxes and character skin consume it. */
export function advanceJump(actor:Actor,dt:number,pressed=false):{tookOff:boolean;landed:boolean}{
 if(dt<=0)return {tookOff:false,landed:false};
 const geometry=getActiveMap().geometry;
 if(!geometry||!geometry.airDuckLift||actor.health<=0)duckJumps.delete(actor);
 if(geometry){
  if(actor.climbing&&geometry.ladderAt?.(actor.x,actor.z,actorBaseY(actor))&&!pressed){actor.verticalSpeed=0;duckJumps.delete(actor);return {tookOff:false,landed:false};}
  actor.climbing=false;
  const initialY=actorBaseY(actor);let before=initialY,duck=duckJumps.get(actor);
  if(geometry.airDuckLift&&actor.health>0){
   if(!duck||duck.geometry!==geometry||duck.spawnedAt!==actor.spawnedAt){duck={geometry,spawnedAt:actor.spawnedAt,crouched:actor.crouched,lift:0};duckJumps.set(actor,duck);}
  }
  // Query the old hull before changing stance: standing up beneath a ceiling
  // must not turn a valid supporting floor into a start-in-solid probe.
  let floor=geometry.ground(actor.x,actor.z,before+.12,duck?.crouched??actor.crouched)??before-10;
  actor.groundY=floor;
  const airborne=isAirborne(actor),tookOff=pressed&&actor.health>0&&!airborne;
  if(duck&&!airborne)duck.lift=0;
  if(tookOff)actor.verticalSpeed=geometry.jumpSpeed??JUMP_SPEED;
  if(duck){
   if(actor.crouched&&duck.lift===0&&(tookOff||airborne&&!duck.crouched)){
    // Retract the feet by the standing/duck half-height difference. This
    // changes the hull around its centre, not the jump velocity or its arc.
    const tucked=geometry.vertical(actor.x,actor.z,before,before+geometry.airDuckLift!,true);
    duck.lift=Math.max(0,tucked-before);before+=duck.lift;
   }else if(!actor.crouched&&duck.crouched){
    const target=before-duck.lift,extended=geometry.vertical(actor.x,actor.z,before,target,true);
    if(geometry.blocked(actor.x,actor.z,extended,false))actor.crouched=true;
    else{
     before=extended;duck.lift=0;
     // Feet may extend onto a higher crate while the body is still rising.
     // Plant there once; repeated duck/stand cannot add another jump impulse.
     if(extended>target+.001)actor.verticalSpeed=0;
    }
   }
   const changed=duck.crouched!==actor.crouched||before!==initialY;
   duck.crouched=actor.crouched;
   if(changed){floor=geometry.ground(actor.x,actor.z,before+.12,actor.crouched)??floor;actor.groundY=floor;}
  }
  const speed=actor.verticalSpeed??0,target=before+speed*dt-.5*JUMP_GRAVITY*dt*dt;
  const next=geometry.vertical(actor.x,actor.z,before,target,actor.crouched);
  actor.y=Math.max(floor,next);actor.verticalSpeed=actor.y<=floor+.001||Math.abs(next-target)>.0001?0:speed-JUMP_GRAVITY*dt;
  const landed=initialY>floor+.001&&actor.y<=floor+.001;
  if(duck&&actor.y<=floor+.001&&actor.verticalSpeed===0)duck.lift=0;
  return {tookOff,landed};
 }
 const tookOff=pressed&&actor.health>0&&!isAirborne(actor);
 if(tookOff)actor.verticalSpeed=JUMP_SPEED;
 const before=actorBaseY(actor),speed=actor.verticalSpeed??0;
 if(before===0&&speed===0)return {tookOff:false,landed:false};
 actor.y=Math.max(0,before+speed*dt-.5*JUMP_GRAVITY*dt*dt);
 actor.verticalSpeed=actor.y>0?speed-JUMP_GRAVITY*dt:0;
 return {tookOff,landed:before>0&&actor.y===0};
}
