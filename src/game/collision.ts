import { MAP_BOXES, mapRevision,getActiveMap } from './map';
import type {MapBox} from './types';
export const RADIUS=.32;
export function groundHeight(x:number,z:number,below?:number):number {return getActiveMap().geometry?.ground(x,z,below)??0;}
export function blocked(x:number,z:number,r=RADIUS,boxes=MAP_BOXES,y?:number):boolean {
 if(boxes===MAP_BOXES&&getActiveMap().geometry)return getActiveMap().geometry!.blocked(x,z,y);
 return boxes.some(b=>Math.hypot(Math.max(Math.abs(x-b.x)-b.w/2,0),Math.max(Math.abs(z-b.z)-b.d/2,0))<r);
}
export function moveBody(x:number,z:number,dx:number,dz:number,boxes=MAP_BOXES,y?:number,crouched=false):{x:number;z:number;y?:number} {
 if(boxes===MAP_BOXES&&getActiveMap().geometry)return getActiveMap().geometry!.move(x,z,dx,dz,y,crouched);
 const steps=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.15));
 for(let i=0;i<steps;i++){if(!blocked(x+dx/steps,z,RADIUS,boxes))x+=dx/steps;if(!blocked(x,z+dz/steps,RADIUS,boxes))z+=dz/steps;}
 return {x,z};
}
export function rayBox(ox:number,oy:number,oz:number,dx:number,dy:number,dz:number,minX:number,minY:number,minZ:number,maxX:number,maxY:number,maxZ:number):number {
 let lo=0,hi=Infinity;
 const o=[ox,oy,oz],d=[dx,dy,dz],mn=[minX,minY,minZ],mx=[maxX,maxY,maxZ];
 for(let i=0;i<3;i++){if(Math.abs(d[i])<1e-9){if(o[i]<mn[i]||o[i]>mx[i])return Infinity;}else{let a=(mn[i]-o[i])/d[i],b=(mx[i]-o[i])/d[i];if(a>b)[a,b]=[b,a];lo=Math.max(lo,a);hi=Math.min(hi,b);if(lo>hi)return Infinity;}}
 return hi<0?Infinity:lo;
}
export function wallDistance(ox:number,oy:number,oz:number,dx:number,dy:number,dz:number,boxes:MapBox[]=MAP_BOXES):number {
 if(boxes===MAP_BOXES&&getActiveMap().geometry)return getActiveMap().geometry!.ray(ox,oy,oz,dx,dy,dz);
 let hit=Infinity;for(const b of boxes)hit=Math.min(hit,rayBox(ox,oy,oz,dx,dy,dz,b.x-b.w/2,0,b.z-b.d/2,b.x+b.w/2,b.h,b.z+b.d/2));return hit;
}
export function lineClear(x:number,z:number,tx:number,tz:number,height=1.5):boolean { const n=Math.hypot(tx-x,tz-z);return n<.01||wallDistance(x,height,z,(tx-x)/n,0,(tz-z)/n)>n-.1; }

/** A sight line alone is insufficient for path smoothing: a body has width. */
export function walkSegmentClear(x:number,z:number,tx:number,tz:number,r=.4,y?:number,ty?:number):boolean {
 if(getActiveMap().geometry)return getActiveMap().geometry!.segment(x,z,tx,tz,y,ty);
 const steps=Math.max(1,Math.ceil(Math.hypot(tx-x,tz-z)/.18));
 for(let i=0;i<=steps;i++)if(blocked(x+(tx-x)*i/steps,z+(tz-z)*i/steps,r))return false;
 return true;
}

// A 1 m navigation grid is rebuilt when the selected map changes. Both paths and movement use the same cover proxies.
const MIN=-20, MAX=20, COLS=MAX-MIN+1;
const walkable=new Uint8Array(COLS*COLS);
let navigationRevision=-1;
function ensureNavigation(){if(navigationRevision===mapRevision)return;navigationRevision=mapRevision;
for(let z=MIN;z<=MAX;z++)for(let x=MIN;x<=MAX;x++)walkable[(z-MIN)*COLS+x-MIN]=!blocked(x,z,.48)&&Math.abs(z)<19?1:0;
}
function nearest(x:number,z:number):number {let best=-1,dist=Infinity;for(let i=0;i<walkable.length;i++){if(!walkable[i])continue;const d=(i%COLS+MIN-x)**2+(Math.floor(i/COLS)+MIN-z)**2;if(d<dist){dist=d;best=i;}}return best;}
export function findPath(x:number,z:number,tx:number,tz:number,y?:number,ty?:number):Array<{x:number;z:number;y?:number}> {
 if(getActiveMap().geometry)return getActiveMap().geometry!.path(x,z,tx,tz,y,ty);
 ensureNavigation();
 const start=nearest(x,z),end=nearest(tx,tz);if(start<0||end<0)return [];
 const parent=new Int32Array(walkable.length).fill(-1);const queue=[start];parent[start]=start;
 for(let i=0;i<queue.length&&parent[end]===-1;i++){const cur=queue[i],cx=cur%COLS,cz=Math.floor(cur/COLS);for(const [nx,nz] of [[cx+1,cz],[cx-1,cz],[cx,cz+1],[cx,cz-1]]){if(nx<0||nz<0||nx>=COLS||nz>=COLS)continue;const n=nz*COLS+nx;if(walkable[n]&&parent[n]===-1){parent[n]=cur;queue.push(n);}}}
 if(parent[end]===-1)return [];
 const path=[];for(let at=end;at!==start;at=parent[at])path.push({x:at%COLS+MIN,z:Math.floor(at/COLS)+MIN});path.reverse();return path;
}
