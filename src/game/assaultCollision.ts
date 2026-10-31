import {Dust2Collision,GOLDSRC_SCALE as SCALE,type DustNavigation,type GoldSrcPoint as Point} from './dust2Collision';

const HALF=36*SCALE,DUCK=18*SCALE,STEP=18*SCALE,EPS=.001;
type Bounds={min:Point;max:Point};
export type AssaultLadder={id:number;bounds:Bounds;x:number;z:number;nx:number;nz:number;bottom:number;top:number};

function source(buffer:ArrayBuffer){
 const v=new DataView(buffer),offset=v.getInt32(4,true),length=v.getInt32(8,true);
 const text=new TextDecoder().decode(new Uint8Array(buffer,offset,length));
 const entities=[...text.matchAll(/\{([^}]+)\}/g)].map(m=>Object.fromEntries([...m[1].matchAll(/"([^"]*)"\s*"([^"]*)"/g)].map(p=>[p[1],p[2]])));
 return {v,entities,models:v.getInt32(4+14*8,true)};
}

/** Assault uses the original standing and duck hulls, including its roof ducts. */
export class AssaultCollision extends Dust2Collision {
 readonly jumpSpeed=6.25;
 readonly botJumpSpeed=this.jumpSpeed;
 readonly ladders:AssaultLadder[]=[];
 readonly excludedModels:number[];
 constructor(buffer:ArrayBuffer){
  const data=source(buffer);
  // Doors are exported in an open state; grates are exported already broken.
  const excluded=data.entities.filter(e=>e.classname==='func_ladder'||e.classname.startsWith('func_door')||e.classname==='func_breakable'&&e.material==='2').map(e=>Number(e.model?.slice(1))).filter(Number.isFinite);
  super(buffer,{excludeModels:excluded});this.excludedModels=excluded;
  for(const p of [...this.spawns.blue,...this.spawns.red])p.y=this.ground(p.x,p.z,p.y+.1)??p.y;
  for(const e of data.entities.filter(e=>e.classname==='func_ladder')){
   const id=Number(e.model.slice(1)),o=data.models+id*64,v=data.v;
   const bounds:Bounds={min:{x:v.getFloat32(o,true)*SCALE,y:v.getFloat32(o+8,true)*SCALE,z:-v.getFloat32(o+16,true)*SCALE},max:{x:v.getFloat32(o+12,true)*SCALE,y:v.getFloat32(o+20,true)*SCALE,z:-v.getFloat32(o+4,true)*SCALE}};
   const alongX=bounds.max.x-bounds.min.x<bounds.max.z-bounds.min.z;
   for(const side of [-1,1]){
    const nx=alongX?side:0,nz=alongX?0:side;
    const x=alongX?(side<0?bounds.min.x:bounds.max.x)+side*(16*SCALE+.025):(bounds.min.x+bounds.max.x)/2;
    const z=alongX?(bounds.min.z+bounds.max.z)/2:(side<0?bounds.min.z:bounds.max.z)+side*(16*SCALE+.025);
    const middle=(bounds.min.y+bounds.max.y)/2;
    if(this.blocked(x,z,middle,true))continue;
    const bottom=this.ground(x,z,bounds.min.y+.5,true)??bounds.min.y;
    this.ladders.push({id,bounds,x,z,nx,nz,bottom,top:bounds.max.y+.04});
   }
  }
 }
 override ground(x:number,z:number,below=this.bounds?.max.y??64,crouched=false):number|null{
  const half=crouched?DUCK:HALF,bottom=this.bounds?.min.y??-64;
  const hit=this.trace({x,y:below+half+EPS,z},{x,y:bottom-1+half+EPS,z},crouched?'crouch':true);
  return hit.fraction<1&&!hit.startSolid&&hit.normal.y>.65?below+(bottom-1-below)*hit.fraction+EPS:null;
 }
 override blocked(x:number,z:number,y?:number,crouched=false):boolean{
  const floor=y??this.nearest(x,z)?.y??this.ground(x,z,undefined,crouched);
  return floor==null||(crouched?this.crouchHulls:this.bodyHulls).some(h=>this.contents(h,{x,y:floor+(crouched?DUCK:HALF)+EPS,z})===-2);
 }
 needsCrouch(x:number,z:number,y:number):boolean{return this.blocked(x,z,y)&&!this.blocked(x,z,y,true);}
 private slideBody(p:Point,dx:number,dz:number,crouched:boolean):Point{
  let delta={x:dx,z:dz};
  for(let i=0;i<3;i++){
   const length=Math.hypot(delta.x,delta.z);if(length<1e-7)break;
   const hit=this.trace(p,{x:p.x+delta.x,y:p.y,z:p.z+delta.z},crouched?'crouch':true);
   const f=hit.fraction===1?1:Math.max(0,hit.fraction-EPS/length);
   p={x:p.x+delta.x*f,y:p.y,z:p.z+delta.z*f};if(hit.fraction===1)break;
   const dot=delta.x*hit.normal.x+delta.z*hit.normal.z;
   delta={x:(delta.x-dot*hit.normal.x)*(1-f),z:(delta.z-dot*hit.normal.z)*(1-f)};
  }return p;
 }
 override move(x:number,z:number,dx:number,dz:number,y?:number,crouched=false):Point{
  const half=crouched?DUCK:HALF,body=crouched?'crouch':true;
  let p={x,y:(y??this.nearest(x,z)?.y??this.ground(x,z,undefined,crouched)??0)+half+EPS,z};
  const steps=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.2));
  for(let i=0;i<steps;i++){
   const surface=this.ground(p.x,p.z,p.y-half+.04,crouched),grounded=surface!=null&&Math.abs(p.y-half-EPS-surface)<.06;
   const sx=dx/steps,sz=dz/steps,plain=this.slideBody(p,sx,sz,crouched),travel=Math.hypot(plain.x-p.x,plain.z-p.z);
   let next=plain;
   if(grounded&&travel<Math.hypot(sx,sz)-.0001){
    const up={...p,y:p.y+STEP};
    if(this.trace(p,up,body).fraction===1){const across=this.slideBody(up,sx,sz,crouched),down={...across,y:p.y-.04},hit=this.trace(across,down,body);
     if(hit.fraction<1&&hit.normal.y>.65&&Math.hypot(across.x-p.x,across.z-p.z)>travel+.0001)next={x:across.x,y:across.y+(down.y-across.y)*hit.fraction+EPS,z:across.z};
    }
   }
   const down={...next,y:next.y-STEP-.04},hit=this.trace(next,down,body);
   if(grounded&&hit.fraction<1&&hit.normal.y>.65)next.y+=(down.y-next.y)*hit.fraction+EPS;
   p=next;
  }return {x:p.x,y:p.y-half-EPS,z:p.z};
 }
 override vertical(x:number,z:number,from:number,to:number,crouched=false):number{
  const half=crouched?DUCK:HALF,hit=this.trace({x,y:from+half+EPS,z},{x,y:to+half+EPS,z},crouched?'crouch':true);
  return hit.fraction<1?from+(to-from)*hit.fraction+(to<from?EPS:-EPS):to;
 }
 override segment(x:number,z:number,tx:number,tz:number,y?:number,ty?:number):boolean{
  // The two source hulls rest a few centimetres apart on sloped roof planes.
  // A standing bot must not become stranded by a duck hull starting in solid.
  for(const crouched of [false,true]){
   const p=this.move(x,z,tx-x,tz-z,y,crouched);
   if(Math.hypot(p.x-tx,p.z-tz)<.04&&(ty==null||Math.abs(p.y-ty)<.08))return true;
  }return false;
 }
 /** Civilian navigation retains only connections traversable with a standing hull. */
 private walkingEdges=new Map<number,number[]>();
 groundSegment(x:number,z:number,tx:number,tz:number,y?:number,ty?:number):boolean {
  const p=this.move(x,z,tx-x,tz-z,y,false);
  if(Math.hypot(p.x-tx,p.z-tz)>=.04)return false;
  if(ty===undefined||Math.abs(p.y-ty)<.08)return true;
  // The loading ramp ends at a 32-unit lip. A short, swept step down is
  // safe for civilians; the mover applies gravity rather than snapping.
  return p.y>ty&&p.y-ty<=.9&&Math.abs(this.vertical(p.x,p.z,p.y,ty,false)-ty)<.015;
 }
 groundPath(x:number,z:number,tx:number,tz:number,y?:number,ty?:number):Point[]{
  const {points,edges}=this.navigation;
  const connect=(x:number,z:number,y:number|undefined,from:boolean)=>{
   const candidates=points.map((p,i)=>({p,i,d:(p.x-x)**2+(p.z-z)**2+4*(p.y-(y??p.y))**2})).filter(({p})=>!p.crouched&&p.ladder===undefined).sort((a,b)=>a.d-b.d).slice(0,24);
   return candidates.find(({p})=>from?this.groundSegment(x,z,p.x,p.z,y,p.y):this.groundSegment(p.x,p.z,x,z,p.y,y))?.i??-1;
  };
  const start=connect(x,z,y,true),end=connect(tx,tz,ty,false);if(start<0||end<0)return [];
  const parent=new Int32Array(points.length).fill(-1),queue=[start];parent[start]=start;
  for(let i=0;i<queue.length&&parent[end]<0;i++){
   const index=queue[i],a=points[index];let neighbors=this.walkingEdges.get(index);
   if(!neighbors){neighbors=edges[index].filter(n=>{const b=points[n];return !b.crouched&&b.ladder===undefined&&this.groundSegment(a.x,a.z,b.x,b.z,a.y,b.y);});this.walkingEdges.set(index,neighbors);}
   for(const n of neighbors)if(parent[n]<0){parent[n]=index;queue.push(n);}
  }
  if(parent[end]<0)return [];
  const result:Point[]=[];for(let i=end;i!==start;i=parent[i])result.push(points[i]);result.push(points[start]);return result.reverse();
 }
 protected override connector(x:number,z:number,y:number|undefined,from:boolean):number{
  const candidates=this.navigation.points.map((p,i)=>({p,i,d:(p.x-x)**2+(p.z-z)**2+(y===undefined?0:4*(p.y-y)**2)})).sort((a,b)=>a.d-b.d).slice(0,24);
  for(const {p,i} of candidates){
   if(from?this.segment(x,z,p.x,p.z,y,p.y):this.segment(p.x,p.z,x,z,p.y,y))return i;
   if(p.ladder!==undefined&&y!==undefined&&Math.abs(p.y-y)<.45&&Math.hypot(p.x-x,p.z-z)<.5&&this.ladderAt(x,z,y))return i;
  }
  return -1;
 }
 private ladder(x:number,z:number,y:number):AssaultLadder|undefined{
  return this.ladders.find(l=>Math.abs(x-l.x)<.53&&Math.abs(z-l.z)<.53&&y>=l.bottom-.15&&y<=l.top+.15);
 }
 ladderAt(x:number,z:number,y:number):boolean{return !!this.ladder(x,z,y);}
 climb(x:number,z:number,y:number,dx:number,dz:number,dt:number,targetY?:number):Point|null{
  const l=this.ladder(x,z,y);if(!l)return null;
  const length=Math.hypot(dx,dz),into=length?-(dx*l.nx+dz*l.nz)/length:0;
  const dir=targetY===undefined?into:Math.sign(targetY-y);
  if(targetY===undefined&&Math.abs(into)<.35&&length>.00001)return null;
  if(dir<0&&y<=l.bottom+.06||dir>0&&y>=l.top-.03)return null;
  let nextY=Math.max(l.bottom,Math.min(l.top,y+dir*2.45*dt));
  if(targetY!==undefined)nextY=dir>0?Math.min(nextY,targetY):Math.max(nextY,targetY);
  // Only sweep up the clear ladder lane. Never teleport across the wall.
  const align=Math.min(1,dt*8),cx=x+(l.x-x)*align,cz=z+(l.z-z)*align;
  const p=this.move(x,z,cx-x,cz-z,y,true),ny=this.vertical(p.x,p.z,y,nextY,true);
  return {...p,y:ny,crouched:this.needsCrouch(p.x,p.z,ny),ladder:l.id};
 }
 override buildNavigation(spacing=32*SCALE):DustNavigation{
  const points:Point[]=[],edges:number[][]=[],cells=new Map<string,number[]>();
  const minX=Math.ceil(this.bounds.min.x/spacing),maxX=Math.floor(this.bounds.max.x/spacing),minZ=Math.ceil(this.bounds.min.z/spacing),maxZ=Math.floor(this.bounds.max.z/spacing);
  for(let iz=minZ;iz<=maxZ;iz++)for(let ix=minX;ix<=maxX;ix++){
   const x=(ix+.25)*spacing,z=(iz+.25)*spacing,levels:number[]=[];let previous=-Infinity;
   for(let y=this.bounds.min.y;y<this.bounds.max.y;y+=.3){
    if(this.blocked(x,z,y,true))continue;
    const floor=this.ground(x,z,y,true);if(floor===null||y-floor>1||Math.abs(floor-previous)<.15)continue;
    previous=floor;levels.push(points.length);points.push({x,y:floor,z,...(this.needsCrouch(x,z,floor)?{crouched:true}:{})});edges.push([]);
   }if(levels.length)cells.set(`${ix},${iz}`,levels);
  }
  const connect=(i:number,j:number)=>{if(!edges[i].includes(j))edges[i].push(j);};
  const canJump=(a:Point,b:Point)=>{
   if(b.y-a.y<=STEP||b.y-a.y>1.04)return false;
   const peak=a.y+1.07;
   if(Math.abs(this.vertical(a.x,a.z,a.y,peak,true)-peak)>.01)return false;
   const p=this.move(a.x,a.z,b.x-a.x,b.z-a.z,peak,true);
   return Math.hypot(p.x-b.x,p.z-b.z)<.04&&Math.abs(this.vertical(p.x,p.z,p.y,b.y,true)-b.y)<.015;
  };
  const canDrop=(a:Point,b:Point)=>{
   if(a.y-b.y<.1||a.y-b.y>15)return false;
   const p=this.move(a.x,a.z,b.x-a.x,b.z-a.z,a.y,true);
   if(Math.hypot(p.x-b.x,p.z-b.z)>.04||p.y<b.y-.08)return false;
   return Math.abs(this.vertical(p.x,p.z,p.y,b.y,true)-b.y)<.015;
  };
  for(const [key,ids] of cells){const [ix,iz]=key.split(',').map(Number);for(const [dx,dz] of [[1,0],[0,1]])for(const i of ids)for(const j of cells.get(`${ix+dx},${iz+dz}`)??[]){
   const a=points[i],b=points[j];
   if(Math.abs(a.y-b.y)<=spacing*1.6&&this.segment(a.x,a.z,b.x,b.z,a.y,b.y)&&this.segment(b.x,b.z,a.x,a.z,b.y,a.y)){connect(i,j);connect(j,i);}
   else{if(canDrop(a,b)||canJump(a,b))connect(i,j);if(canDrop(b,a)||canJump(b,a))connect(j,i);}
  }}
  const groundCount=points.length;
  for(const ladder of this.ladders){
   const ids:number[]=[],count=Math.ceil((ladder.top-ladder.bottom)/.4);
   for(let step=0;step<=count;step++){
    const y=ladder.bottom+(ladder.top-ladder.bottom)*step/count;
    if(this.blocked(ladder.x,ladder.z,y,true))continue;
    const id=points.length;points.push({x:ladder.x,z:ladder.z,y,ladder:ladder.id,crouched:this.needsCrouch(ladder.x,ladder.z,y)});edges.push([]);ids.push(id);
   }
   for(let n=1;n<ids.length;n++){const a=points[ids[n-1]],b=points[ids[n]];if(Math.abs(this.vertical(a.x,a.z,a.y,b.y,true)-b.y)<.01){connect(ids[n-1],ids[n]);connect(ids[n],ids[n-1]);}}
   for(const id of ids){const p=points[id];for(let i=0;i<groundCount;i++){const q=points[i];if(Math.abs(q.y-p.y)>.48||Math.hypot(q.x-p.x,q.z-p.z)>1.35)continue;
    if(this.segment(q.x,q.z,p.x,p.z,q.y,p.y))connect(i,id);
    // Step off near a landing, with gravity following a small downward gap.
    const moved=this.move(p.x,p.z,q.x-p.x,q.z-p.z,p.y,true);
    if(Math.hypot(moved.x-q.x,moved.z-q.z)<.04&&moved.y>=q.y-.08&&moved.y-q.y<.5)connect(id,i);
   }}
  }
  this.navigation={points,edges};return this.navigation;
 }
}
