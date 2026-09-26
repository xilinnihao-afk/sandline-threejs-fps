import {MAP_BOXES} from './map';
import type {Grenade} from './types';

// Few arcade projectiles, swept in <= 4 cm substeps to keep the 8 cm radius outside cover.
// Collision proxies exactly match the movement/visibility map; this is deliberately not a rigid-body stack.
const radius=.08;
function solid(x:number,y:number,z:number){return y<radius||MAP_BOXES.some(b=>x>b.x-b.w/2-radius&&x<b.x+b.w/2+radius&&z>b.z-b.d/2-radius&&z<b.z+b.d/2+radius&&y<b.h+radius&&y>-radius);}
export function advanceGrenade(g:Grenade,dt:number){
 const steps=Math.max(1,Math.ceil(Math.hypot(g.vx,g.vy,g.vz)*dt/.04)),h=dt/steps;
 for(let i=0;i<steps;i++){
  g.vy-=9.81*h;
  const nx=g.x+g.vx*h;if(solid(nx,g.y,g.z)){g.vx*=-.48;g.bounces++;}else g.x=nx;
  const nz=g.z+g.vz*h;if(solid(g.x,g.y,nz)){g.vz*=-.48;g.bounces++;}else g.z=nz;
  const ny=g.y+g.vy*h;if(solid(g.x,ny,g.z)){if(Math.abs(g.vy)>.3)g.bounces++;g.vy=Math.abs(g.vy)<.5?0:-g.vy*.36;g.vx*=.91;g.vz*=.91;}else g.y=ny;
  if(Math.abs(g.x)>23||Math.abs(g.z)>21){g.x=Math.max(-21.3,Math.min(21.3,g.x));g.z=Math.max(-19.3,Math.min(19.3,g.z));g.vx=0;g.vz=0;}
 }
}
