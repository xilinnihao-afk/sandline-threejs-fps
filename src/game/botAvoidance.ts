import { moveBody } from './collision';
import type { Actor } from './types';
type Point = { x: number; z: number };
export type Avoidance = { side: number; hold: number };

/** Local steering before contact; each walker prefers its own right-hand side.
 * Remember the chosen side so two bots do not mirror each other's oscillation.
 * Map and living-body clearance are checked along the whole movement segment.
 */
export function avoidActors(actor: Actor, desired: Point, actors: Actor[], dt: number, speed: number, state: Avoidance): Point {
  state.hold = Math.max(0, state.hold - dt);
  const length = Math.hypot(desired.x, desired.z);
  if (length < .001) return { x: actor.x, z: actor.z };
  const forward = { x: desired.x / length, z: desired.z / length };
  const peers = actors.filter(p => p.id !== actor.id && p.health > 0 && Math.hypot(p.x-actor.x,p.z-actor.z) < 3);
  const danger = peers.some(p => {
    const dx = p.x-actor.x, dz = p.z-actor.z;
    const along = dx*forward.x+dz*forward.z;
    return along > -.15 && along < 1.9 && Math.abs(dx*forward.z-dz*forward.x) < .85;
  });
  const step = Math.min(length, speed*dt);
  const clear = (point: Point) => peers.every(p => {
    const dx=point.x-actor.x,dz=point.z-actor.z,n=dx*dx+dz*dz;
    const t=n>0?Math.max(0,Math.min(1,((p.x-actor.x)*dx+(p.z-actor.z)*dz)/n)):0;
    const distance=Math.hypot(actor.x+dx*t-p.x,actor.z+dz*t-p.z);
    // Already-overlapping actors may move outward; separation remains the fallback.
    return distance >= Math.min(.68,Math.hypot(actor.x-p.x,actor.z-p.z))-.001;
  });
  if (!danger) {
    const point=moveBody(actor.x,actor.z,forward.x*step,forward.z*step);
    if(clear(point))return point;
  }
  let best: Point={x:actor.x,z:actor.z}, bestScore=-Infinity, chosen=state.side||1;
  for (const angle of [.65,1.05,1.57,-.65,-1.05,-1.57,0,2.2,-2.2,Math.PI]) {
    const c=Math.cos(angle),s=Math.sin(angle),x=forward.x*c-forward.z*s,z=forward.x*s+forward.z*c;
    const point=moveBody(actor.x,actor.z,x*step,z*step);
    if(Math.hypot(point.x-actor.x,point.z-actor.z)<step*.7||!clear(point))continue;
    const horizon=.9, probe=moveBody(actor.x,actor.z,x*horizon,z*horizon);
    const travel=Math.hypot(probe.x-actor.x,probe.z-actor.z);
    if(travel<horizon*.7)continue;
    let clearance=1.5;
    for(const peer of peers){
      const dx=peer.x-actor.x,dz=peer.z-actor.z,t=Math.max(0,Math.min(horizon,dx*x+dz*z));
      clearance=Math.min(clearance,Math.hypot(dx-x*t,dz-z*t));
    }
    const side=Math.sign(angle)||state.side||1;
    const preference=side===(state.hold>0?state.side:1)?.5:0;
    const score=c*1.1+Math.min(1.1,clearance)*2+preference-(clearance<.72?4:0);
    if(score>bestScore){bestScore=score;best=point;chosen=side;}
  }
  if(bestScore>-Infinity){if(state.side!==chosen||state.hold===0)state.hold=.9;state.side=chosen;}
  return best;
}
