import type {Actor,PlayerInput} from './types';
import {isAirborne} from './jump';

export const WALK_SPEED=3.9,RUN_SPEED=5.6,CROUCH_SPEED=1.65;
/** Sprint is forward travel. Combat inputs always retain priority. */
export function playerMovementSpeed(actor:Actor,input:PlayerInput,dt:number):number {
 const combat=input.aiming||input.fire||input.fireHeld||input.secondaryFire||input.reload||input.grenade||
  actor.guns[actor.weapon].reloadLeft>0;
 const running=!!input.sprint&&input.moveZ>.15&&!actor.crouched&&!actor.climbing&&!combat&&
  actor.health>0&&(!isAirborne(actor)||!!actor.sprinting);
 const target=actor.crouched?CROUCH_SPEED:running?RUN_SPEED:WALK_SPEED;
 // Accelerate into a run; aiming/firing/crouching immediately regain walk control.
 const speed=running?target+((actor.moveSpeed??WALK_SPEED)-target)*Math.exp(-9*Math.max(0,dt)):target;
 actor.sprinting=running;actor.moveSpeed=speed;
 return speed;
}
