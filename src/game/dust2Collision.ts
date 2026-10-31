import type {MapGeometry,MapPoint} from './mapGeometry';

// GoldSrc's original inch-sized units, with Z-up rotated into Three.js Y-up.
export const GOLDSRC_SCALE=.0254;
export const DUST_HALF_HEIGHT=36*GOLDSRC_SCALE;
export const DUST_CROUCH_HALF_HEIGHT=18*GOLDSRC_SCALE;
const STEP=18*GOLDSRC_SCALE,EPS=.001;
export type GoldSrcPoint={x:number;y:number;z:number;crouched?:boolean;ladder?:number};
type Vec=GoldSrcPoint;
type Plane=Vec&{d:number};
type Node={plane:number;children:[number,number]};
type Hull={root:number;nodes:Node[];bounds?:{min:Vec;max:Vec}};
type Trace={fraction:number;normal:Vec;startSolid:boolean};
export type DustNavigation={points:Vec[];edges:number[][]};
export class Dust2Collision implements MapGeometry {
 jumpSpeed?:number;
 crouchEyeHeight?:number;
 airDuckLift?:number;
 readonly planes:Plane[]=[];
 readonly pointHulls:Hull[]=[];
 readonly bodyHulls:Hull[]=[];
 readonly crouchHulls:Hull[]=[];
 readonly entities:Record<string,string>[];
 readonly spawns:{blue:Array<Vec&{yaw:number}>;red:Array<Vec&{yaw:number}>};
 readonly bounds:{min:Vec;max:Vec};
 navigation:DustNavigation={points:[],edges:[]};
 constructor(buffer:ArrayBuffer,options:{excludeModels?:number[]}={}){
  const v=new DataView(buffer);
  if(v.getInt32(0,true)!==30)throw new Error('Map requires a GoldSrc BSP v30');
  const lump=(n:number)=>({offset:v.getInt32(4+n*8,true),length:v.getInt32(8+n*8,true)});
  const pos=(o:number):Vec=>({x:v.getFloat32(o,true)*GOLDSRC_SCALE,y:v.getFloat32(o+8,true)*GOLDSRC_SCALE,z:-v.getFloat32(o+4,true)*GOLDSRC_SCALE});
  const l=lump(0),entityText=new TextDecoder().decode(new Uint8Array(buffer,l.offset,l.length));
  this.entities=[...entityText.matchAll(/\{([^}]+)\}/g)].map(m=>Object.fromEntries([...m[1].matchAll(/"([^"]*)"\s*"([^"]*)"/g)].map(p=>[p[1],p[2]])));
  const p=lump(1);for(let o=p.offset;o<p.offset+p.length;o+=20)this.planes.push({x:v.getFloat32(o,true),y:v.getFloat32(o+8,true),z:-v.getFloat32(o+4,true),d:v.getFloat32(o+12,true)*GOLDSRC_SCALE});
  const leaf=lump(10),leaves:number[]=[];for(let o=leaf.offset;o<leaf.offset+leaf.length;o+=28)leaves.push(v.getInt32(o,true));
  const nodes:Node[]=[],n=lump(5);for(let o=n.offset;o<n.offset+n.length;o+=24){const children=[v.getInt16(o+4,true),v.getInt16(o+6,true)].map(c=>c<0?leaves[-c-1]:c) as [number,number];nodes.push({plane:v.getInt32(o,true),children});}
  const clips:Node[]=[],c=lump(9);for(let o=c.offset;o<c.offset+c.length;o+=8)clips.push({plane:v.getInt32(o,true),children:[v.getInt16(o+4,true),v.getInt16(o+6,true)]});
  const models=lump(14),included=new Set([0]);
  for(const e of this.entities)if(e.model?.startsWith('*')&&!e.classname.startsWith('trigger_')&&e.classname!=='func_illusionary'&&e.classname!=='func_buyzone'&&e.classname!=='func_bomb_target')included.add(Number(e.model.slice(1)));
  for(const index of included){if(options.excludeModels?.includes(index))continue;const o=models.offset+index*64;if(o+64>models.offset+models.length)continue;const a=pos(o),b=pos(o+12),bounds=index?{min:{x:a.x,y:a.y,z:b.z},max:{x:b.x,y:b.y,z:a.z}}:undefined;this.pointHulls.push({root:v.getInt32(o+36,true),nodes,bounds});this.bodyHulls.push({root:v.getInt32(o+40,true),nodes:clips,bounds:bounds?{min:{x:bounds.min.x-.42,y:bounds.min.y-.93,z:bounds.min.z-.42},max:{x:bounds.max.x+.42,y:bounds.max.y+.93,z:bounds.max.z+.42}}:undefined});this.crouchHulls.push({root:v.getInt32(o+48,true),nodes:clips,bounds:bounds?{min:{x:bounds.min.x-.42,y:bounds.min.y-.47,z:bounds.min.z-.42},max:{x:bounds.max.x+.42,y:bounds.max.y+.47,z:bounds.max.z+.42}}:undefined});}
  const a=pos(models.offset),b=pos(models.offset+12);
  this.bounds={min:{x:a.x,y:a.y,z:b.z},max:{x:b.x,y:b.y,z:a.z}};
  const spawn=(name:string)=>this.entities.filter(e=>e.classname===name).map(e=>{const [x,y,z]=e.origin.split(/\s+/).map(Number);const p={x:x*GOLDSRC_SCALE,y:z*GOLDSRC_SCALE,z:-y*GOLDSRC_SCALE,yaw:(Number(e.angles?.split(/\s+/)[1]??e.angle??0)-90)*Math.PI/180};p.y=this.ground(p.x,p.z,p.y)??p.y-DUST_HALF_HEIGHT;return p;});
  this.spawns={blue:spawn('info_player_start'),red:spawn('info_player_deathmatch')};
 }
 protected contents(h:Hull,p:Vec):number {const b=h.bounds;if(b&&(p.x<b.min.x||p.x>b.max.x||p.y<b.min.y||p.y>b.max.y||p.z<b.min.z||p.z>b.max.z))return -1;let n=h.root;while(n>=0){const node=h.nodes[n],plane=this.planes[node.plane];n=node.children[p.x*plane.x+p.y*plane.y+p.z*plane.z-plane.d>=0?0:1];}return n;}
 protected traceHull(h:Hull,start:Vec,end:Vec):Trace {
  const result:Trace={fraction:1,normal:{x:0,y:0,z:0},startSolid:this.contents(h,start)===-2};
  if(result.startSolid){result.fraction=0;return result;}
  const visit=(node:number,t0:number,t1:number,a:Vec,b:Vec,normal:Vec):boolean=>{
   if(node<0){if(node!==-2)return true;result.fraction=t0;result.normal=normal;return false;}
   const n=h.nodes[node],p=this.planes[n.plane];
   const da=a.x*p.x+a.y*p.y+a.z*p.z-p.d,db=b.x*p.x+b.y*p.y+b.z*p.z-p.d;
   if(da>=0&&db>=0)return visit(n.children[0],t0,t1,a,b,normal);
   if(da<0&&db<0)return visit(n.children[1],t0,t1,a,b,normal);
   const side=da<0?1:0,f=Math.max(0,Math.min(1,da/(da-db))),tm=t0+(t1-t0)*f;
   const m={x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f,z:a.z+(b.z-a.z)*f};
   if(!visit(n.children[side],t0,tm,a,m,normal))return false;
   return visit(n.children[1-side],tm,t1,m,b,{x:p.x*(side?-1:1),y:p.y*(side?-1:1),z:p.z*(side?-1:1)});
  };
  visit(h.root,0,1,start,end,{x:0,y:0,z:0});return result;
 }
 trace(start:Vec,end:Vec,body:boolean|'crouch'=false):Trace {
  let hit:Trace={fraction:1,normal:{x:0,y:0,z:0},startSolid:false};
  for(const h of body==='crouch'?this.crouchHulls:body?this.bodyHulls:this.pointHulls){const b=h.bounds;if(b&&(Math.max(start.x,end.x)<b.min.x||Math.min(start.x,end.x)>b.max.x||Math.max(start.y,end.y)<b.min.y||Math.min(start.y,end.y)>b.max.y||Math.max(start.z,end.z)<b.min.z||Math.min(start.z,end.z)>b.max.z))continue;const t=this.traceHull(h,start,end);if(t.fraction<hit.fraction)hit=t;}return hit;
 }
 ray(x:number,y:number,z:number,dx:number,dy:number,dz:number):number {const t=this.trace({x,y,z},{x:x+dx*512,y:y+dy*512,z:z+dz*512});return t.fraction<1?t.fraction*512:Infinity;}
 ground(x:number,z:number,below=this.bounds?.max.y??64,crouched=false):number|null {
  const half=crouched?DUST_CROUCH_HALF_HEIGHT:DUST_HALF_HEIGHT;
  const bottom=this.bounds?.min.y??-64,t=this.trace({x,y:below+half+EPS,z},{x,y:bottom-1+half+EPS,z},crouched?'crouch':true);
  return t.fraction<1&&!t.startSolid&&t.normal.y>.65?below+(bottom-1-below)*t.fraction+EPS:null;
 }
 blocked(x:number,z:number,y?:number,crouched=false):boolean {
  const floor=y??this.nearest(x,z)?.y??this.ground(x,z,undefined,crouched);
  if(floor==null)return true;
  return (crouched?this.crouchHulls:this.bodyHulls).some(h=>this.contents(h,{x,y:floor+(crouched?DUST_CROUCH_HALF_HEIGHT:DUST_HALF_HEIGHT)+EPS,z})===-2);
 }
 needsCrouch(x:number,z:number,y:number):boolean {return this.blocked(x,z,y)&&!this.blocked(x,z,y,true);}
 private slide(start:Vec,dx:number,dz:number,crouched=false):Vec {
  let p={...start},delta={x:dx,y:0,z:dz};
  for(let i=0;i<3;i++){
   const length=Math.hypot(delta.x,delta.z);if(length<1e-7)break;
   const hit=this.trace(p,{x:p.x+delta.x,y:p.y,z:p.z+delta.z},crouched?'crouch':true);
   const f=hit.fraction===1?1:Math.max(0,hit.fraction-EPS/length);p={x:p.x+delta.x*f,y:p.y,z:p.z+delta.z*f};
   if(hit.fraction===1)break;
   const remaining=1-f,dot=delta.x*hit.normal.x+delta.z*hit.normal.z;
   delta={x:(delta.x-dot*hit.normal.x)*remaining,y:0,z:(delta.z-dot*hit.normal.z)*remaining};
  }return p;
 }
 move(x:number,z:number,dx:number,dz:number,y?:number,crouched=false):Vec {
  const half=crouched?DUST_CROUCH_HALF_HEIGHT:DUST_HALF_HEIGHT,body=crouched?'crouch':true;
  let feet=y??this.nearest(x,z)?.y??this.ground(x,z,undefined,crouched)??0,p={x,y:feet+half+EPS,z};
  const steps=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.2));
  for(let i=0;i<steps;i++){
   const surface=this.ground(p.x,p.z,p.y-half+.04,crouched),grounded=surface!=null&&Math.abs(p.y-half-EPS-surface)<.003;
   const sx=dx/steps,sz=dz/steps,plain=this.slide(p,sx,sz,crouched),travel=Math.hypot(plain.x-p.x,plain.z-p.z);
   let next=plain;
   if(grounded&&travel<Math.hypot(sx,sz)-.0001){
    const up={x:p.x,y:p.y+STEP,z:p.z};
    if(this.trace(p,up,body).fraction===1){const across=this.slide(up,sx,sz,crouched),down={...across,y:p.y-.04},hit=this.trace(across,down,body);
     if(hit.fraction<1&&hit.normal.y>.65&&Math.hypot(across.x-p.x,across.z-p.z)>travel+.0001)next={x:across.x,y:across.y+(down.y-across.y)*hit.fraction+EPS,z:across.z};
    }
   }
   // Follow modest downward steps; larger drops are handled by gravity.
   const down={...next,y:next.y-STEP-.04},ground=this.trace(next,down,body);
   if(grounded&&ground.fraction<1&&ground.normal.y>.65)next.y=next.y+(down.y-next.y)*ground.fraction+EPS;
   p=next;
  }
  return {x:p.x,y:p.y-half-EPS,z:p.z};
 }
 vertical(x:number,z:number,from:number,to:number,crouched=false):number {
  const half=crouched?DUST_CROUCH_HALF_HEIGHT:DUST_HALF_HEIGHT;
  const a={x,y:from+half+EPS,z},b={x,y:to+half+EPS,z},hit=this.trace(a,b,crouched?'crouch':true);
  return hit.fraction<1?from+(to-from)*hit.fraction+(to<from?EPS:-EPS):to;
 }
 nearest(x:number,z:number,y?:number):Vec|undefined {const i=this.nearestIndex(x,z,y);return this.navigation.points[i];}
 protected nearestIndex(x:number,z:number,y?:number):number {let best=-1,distance=Infinity;this.navigation.points.forEach((p,i)=>{const d=(p.x-x)**2+(p.z-z)**2+(y==null?0:(p.y-y)**2*4);if(d<distance){best=i;distance=d;}});return best;}
 protected connector(x:number,z:number,y:number|undefined,from:boolean):number {
  const candidates=this.navigation.points.map((p,i)=>({i,d:(p.x-x)**2+(p.z-z)**2+(y==null?0:(p.y-y)**2*4)})).sort((a,b)=>a.d-b.d).slice(0,12);
  for(const {i} of candidates){const p=this.navigation.points[i];if(from?this.segment(x,z,p.x,p.z,y,p.y):this.segment(p.x,p.z,x,z,p.y,y))return i;}
  return candidates[0]?.i??-1;
 }
 segment(x:number,z:number,tx:number,tz:number,y?:number,ty?:number):boolean {
  const p=this.move(x,z,tx-x,tz-z,y);
  return Math.hypot(p.x-tx,p.z-tz)<.04&&(ty==null||Math.abs(p.y-ty)<.08);
 }
 path(x:number,z:number,tx:number,tz:number,y?:number,ty?:number):Vec[]{
  const start=this.connector(x,z,y,true),end=this.connector(tx,tz,ty,false);if(start<0||end<0)return [];
  const parent=new Int32Array(this.navigation.points.length).fill(-1),queue=[start];parent[start]=start;
  for(let i=0;i<queue.length&&parent[end]<0;i++)for(const n of this.navigation.edges[queue[i]])if(parent[n]<0){parent[n]=queue[i];queue.push(n);}
  if(parent[end]<0)return [];
  const result:Vec[]=[];for(let i=end;i!==start;i=parent[i])result.push(this.navigation.points[i]);result.push(this.navigation.points[start]);return result.reverse();
 }
 /** Offline grid generation uses the original hulls, including stacked floors. */
 buildNavigation(spacing=32*GOLDSRC_SCALE):DustNavigation {
  const points:Vec[]=[],cells=new Map<string,number[]>(),edges:number[][]=[];
  const minX=Math.ceil(this.bounds.min.x/spacing),maxX=Math.floor(this.bounds.max.x/spacing),minZ=Math.ceil(this.bounds.min.z/spacing),maxZ=Math.floor(this.bounds.max.z/spacing);
  for(let iz=minZ;iz<=maxZ;iz++)for(let ix=minX;ix<=maxX;ix++){
   // Avoid sampling exactly on BSP split planes / step edges (often 16/32 units).
   const x=(ix+.25)*spacing,z=(iz+.25)*spacing,levels:number[]=[];
   // Search hull-one empty space from bottom up, then probe its supporting floor.
   let previous=-Infinity;
   for(let y=this.bounds.min.y;y<this.bounds.max.y;y+=.35){
    if(this.bodyHulls.some(h=>this.contents(h,{x,y:y+DUST_HALF_HEIGHT+EPS,z})===-2))continue;
    const hit=this.trace({x,y:y+DUST_HALF_HEIGHT+EPS,z},{x,y:y+DUST_HALF_HEIGHT-1,z},true);
    if(hit.fraction===1||hit.normal.y<.65)continue;
    const floor=y-(1+EPS)*hit.fraction+EPS;if(Math.abs(floor-previous)<.15)continue;
    previous=floor;levels.push(points.length);points.push({x,y:floor,z});edges.push([]);
   }
   if(levels.length)cells.set(`${ix},${iz}`,levels);
  }
  for(const [key,ids] of cells){const [ix,iz]=key.split(',').map(Number);for(const [dx,dz] of [[1,0],[0,1]]){
   const others=cells.get(`${ix+dx},${iz+dz}`)??[];
   for(const i of ids)for(const j of others){const a=points[i],b=points[j];if(Math.abs(a.y-b.y)>STEP+.15)continue;
    if(this.segment(a.x,a.z,b.x,b.z,a.y,b.y)&&this.segment(b.x,b.z,a.x,a.z,b.y,a.y)){edges[i].push(j);edges[j].push(i);}
   }
  }}
  this.navigation={points,edges};return this.navigation;
 }
}
