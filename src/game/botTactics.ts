import {blocked,wallDistance,findPath,walkSegmentClear} from './collision';
import {MAP_BOXES,getActiveMap,mapRevision} from './map';
import type {Actor,GameSnapshot} from './types';
export type TacticalPoint={x:number;z:number;y?:number};
type Point=TacticalPoint;
export interface CoverPoint extends TacticalPoint {crouch:boolean;}
/** Ally avoidance follows the firing ray's height across stacked passages. */
export function friendlyBlocksShot(actor:Actor,target:Actor,aimHeight:number,ally:Actor):boolean {
 if(ally===actor||ally.team!==actor.team||ally.health<=0)return false;
 const dx=target.x-actor.x,dz=target.z-actor.z,d=Math.hypot(dx,dz);if(d<.001)return false;
 const ax=ally.x-actor.x,az=ally.z-actor.z,along=(ax*dx+az*dz)/d;
 if(along<=0||along>=d||Math.abs(ax*dz-az*dx)/d>=.5)return false;
 const eye=(actor.y??0)+(actor.crouched?1.08:1.62),height=eye+(aimHeight-eye)*along/d,base=ally.y??0;
 return height>=base-.1&&height<=base+(ally.crouched?1.2:1.8)+.1;
}
/** Generate bounded local queries from the same navigation used by movement.
 * Arena cover corners are cached; BSP maps use authored, height-aware nodes. */
let candidatesRevision=-1,arenaCandidates:TacticalPoint[]=[];
function coverCandidates(actor:Actor,radius=8):TacticalPoint[]{
 const geometry=getActiveMap().geometry;
 if(geometry)return (geometry.navigation?.points??[])
  .filter(p=>Math.hypot(p.x-actor.x,p.z-actor.z)<=radius&&Math.abs(p.y-(actor.y??0))<2.5)
  .sort((p,q)=>Math.hypot(p.x-actor.x,p.z-actor.z)-Math.hypot(q.x-actor.x,q.z-actor.z)).slice(0,64);
 if(candidatesRevision!==mapRevision){
  candidatesRevision=mapRevision;
  arenaCandidates=MAP_BOXES.filter(b=>Math.abs(b.x)<21&&Math.abs(b.z)<19).flatMap(b=>{
   const x0=b.x-b.w/2-.65,x1=b.x+b.w/2+.65,z0=b.z-b.d/2-.65,z1=b.z+b.d/2+.65;
   return [{x:x0,z:b.z},{x:x1,z:b.z},{x:b.x,z:z0},{x:b.x,z:z1},
    {x:x0,z:z0},{x:x0,z:z1},{x:x1,z:z0},{x:x1,z:z1},
    ...[z0,z1].flatMap(z=>[{x:b.x-b.w/2+.5,z},{x:b.x+b.w/2-.5,z}]),
    ...[x0,x1].flatMap(x=>[{x,z:b.z-b.d/2+.5},{x,z:b.z+b.d/2-.5}])];
  });
 }
 return arenaCandidates.filter(p=>Math.hypot(p.x-actor.x,p.z-actor.z)<=radius);
}
export function tacticalLineClear(from:TacticalPoint,to:TacticalPoint,fromHeight=1.62,toHeight=1.35):boolean {
 const dx=to.x-from.x,dz=to.z-from.z,dy=(to.y??0)+toHeight-(from.y??0)-fromHeight,n=Math.hypot(dx,dy,dz);
 return n<.01||wallDistance(from.x,(from.y??0)+fromHeight,from.z,dx/n,dy/n,dz/n)>n-.08;
}
/** Test head and both shoulders, from the actual threat elevation. */
export function concealedAt(point:TacticalPoint,threat:TacticalPoint,crouch=false):boolean {
 const dx=threat.x-point.x,dz=threat.z-point.z,d=Math.hypot(dx,dz)||1;
 const height=crouch?1.15:1.72;
 return [-.24,0,.24].every(offset=>!tacticalLineClear(threat,{...point,x:point.x+dz/d*offset,z:point.z-dx/d*offset},1.62,height));
}
function occupied(actor:Actor,p:TacticalPoint,allies:Actor[],reserved:TacticalPoint[]):boolean {
 return allies.some(a=>a!==actor&&a.team===actor.team&&a.health>0&&Math.abs((a.y??0)-(p.y??0))<1.8&&Math.hypot(a.x-p.x,a.z-p.z)<1.15)
  ||reserved.some(q=>Math.abs((q.y??0)-(p.y??0))<1.8&&Math.hypot(q.x-p.x,q.z-p.z)<1.4);
}
function validPoint(p:TacticalPoint):boolean {
 return (getActiveMap().geometry!==undefined||Math.abs(p.x)<20.5&&Math.abs(p.z)<18.5)&&!blocked(p.x,p.z,.45,undefined,p.y);
}
function reachableChoice<T extends TacticalPoint>(actor:Actor,points:Array<T&{score:number}>,threat:TacticalPoint):T|null {
 let best:T|null=null,bestScore=Infinity;
 for(const p of points.sort((a,b)=>a.score-b.score).slice(0,getActiveMap().geometry?3:5)){
  const direct=walkSegmentClear(actor.x,actor.z,p.x,p.z,.4,actor.y,p.y);
  const path=direct?[p]:findPath(actor.x,actor.z,p.x,p.z,actor.y,p.y),end=path.at(-1);
  if(!end||Math.hypot(end.x-p.x,end.z-p.z)>1||Math.abs((end.y??0)-(p.y??0))>.5)continue;
  let distance=0,previous:TacticalPoint=actor;
  for(const node of path){distance+=Math.hypot(node.x-previous.x,node.z-previous.z,(node.y??0)-(previous.y??0));previous=node;}
  if(distance>Math.hypot(p.x-actor.x,p.z-actor.z)*1.8+2||distance>18)continue;
  // Penalize routes exposing the body mid-way; only shortlisted routes cost rays.
  const middle=direct?{x:(actor.x+p.x)/2,z:(actor.z+p.z)/2,y:((actor.y??0)+(p.y??0))/2}:path[Math.floor(path.length/2)];
  const score=p.score+distance*.35+(tacticalLineClear(threat,middle)?1.8:0);
  if(score<bestScore){bestScore=score;const {score:_,...point}=p;best=point as unknown as T;}
 }
 return best;
}
export function findBotCover(actor:Actor,threat:TacticalPoint,allies:Actor[]=[],reserved:TacticalPoint[]=[]):CoverPoint|null {
 const points:Array<CoverPoint&{score:number}>=[];
 const current={x:actor.x,z:actor.z,y:actor.y};
 // Already safe: keep the firing position and avoid an unnecessary environment query.
 if(Math.hypot(actor.x-threat.x,actor.z-threat.z)>=2.5&&!occupied(actor,current,allies,reserved)&&concealedAt(current,threat,true))return {...current,crouch:!concealedAt(current,threat)};
 for(const p of coverCandidates(actor)){
  if(!validPoint(p)||occupied(actor,p,allies,reserved))continue;
  const range=Math.hypot(threat.x-p.x,threat.z-p.z);if(range<2.5||!concealedAt(p,threat,true))continue;
  const crouch=!concealedAt(p,threat),distance=Math.hypot(p.x-actor.x,p.z-actor.z);
  points.push({...p,crouch,score:distance+Math.max(0,7-range)*.8+(crouch?.7:0)});
 }
 return reachableChoice(actor,points,threat);
}
export function findBotAdvance(actor:Actor,threat:TacticalPoint,side:number,idealRange:number,flank:boolean,allies:Actor[]=[],reserved:TacticalPoint[]=[]):TacticalPoint|null {
 const dx=threat.x-actor.x,dz=threat.z-actor.z,d=Math.hypot(dx,dz)||1;
 const points=[...coverCandidates(actor,7)];
 // Forward and oblique alternatives also allow movement in open lanes.
 for(const travel of [2.5,4.5,6])for(const angle of [0,side*.7,side*1.25,-side*.7,-side*1.25]){
  const vx=dx/d*Math.cos(angle)-dz/d*Math.sin(angle),vz=dz/d*Math.cos(angle)+dx/d*Math.sin(angle);
  const p={x:actor.x+vx*travel,z:actor.z+vz*travel,y:actor.y};
  const geometry=getActiveMap().geometry;
  if(geometry){const ground=geometry.ground(p.x,p.z,(actor.y??0)+2);if(ground===null||Math.abs(ground-(actor.y??0))>2)continue;p.y=ground;}
  points.push(p);
 }
 const candidates=[];
 for(const p of points){
  const distance=Math.hypot(p.x-actor.x,p.z-actor.z),range=Math.hypot(threat.x-p.x,threat.z-p.z);
  const lateral=((p.x-actor.x)*dz-(p.z-actor.z)*dx)/d;
  if(distance<1.5||range<Math.min(3,idealRange*.5)||!validPoint(p)||occupied(actor,p,allies,reserved))continue;
  if(flank&&Math.abs(lateral)<1.5)continue;
  if(!flank&&d>idealRange+2&&range>d-1)continue;
  if(!flank&&d<idealRange-2&&range<d+.8)continue;
  const sight=tacticalLineClear(p,threat),hidden=concealedAt(p,threat,true);
  // A staging point may be hidden; a flank should eventually produce a firing angle.
  if(flank&&!sight)continue;
  const angleBonus=flank?Math.min(4,Math.abs(lateral))*.8:0;
  candidates.push({...p,score:distance*.35+Math.abs(range-idealRange)*.65+(flank&&Math.sign(lateral)!==side?3:0)+(hidden?-1.5:0)+(sight?0:1)-angleBonus});
 }
 return reachableChoice(actor,candidates,threat);
}
/** Change the firing angle using only a personally seen/reported threat position. */
export function findBotAngle(actor:Actor,threat:TacticalPoint,side:number,allies:Actor[]=[],reserved:TacticalPoint[]=[]):TacticalPoint|null {
 return findBotAdvance(actor,threat,side,Math.max(7,Math.min(15,Math.hypot(actor.x-threat.x,actor.z-threat.z))),true,allies,reserved);
}
export function patrolPoint(actor:Actor,step:number):Point{
 const patrol=getActiveMap().patrol;if(patrol?.length)return patrol[((actor.team==='blue'?step:4-step)+actor.id%3+patrol.length*10000)%patrol.length];
 const lanes=getActiveMap().id==='snow'?[-17,0,17]:[-18,3,18];
 const lane=lanes[(actor.id+Math.floor(step/2))%3];
 const depth=[0,-15,0,15][step%4]*(actor.team==='blue'?1:-1);
 return {x:lane,z:depth};
}
export const DEFENSE_CHASE_RADIUS=20;
let defenseRevision=-1;
const defensePatrols=new Map<string,TacticalPoint>();
/** Approach lanes are public map knowledge. Walk a bounded distance along a
 * proven route from the base, rather than guessing a point through a wall. */
export function defensePatrolPoint(actor:Actor,state:GameSnapshot,step=0):TacticalPoint {
 const map=getActiveMap(),site=state.defense!.site,lane=(actor.id+Math.floor(step/3))%3;
 const depth=[10,14,7][step%3],key=`${site.x},${site.z},${site.y}:${lane}:${depth}`;
 if(defenseRevision!==mapRevision){defensePatrols.clear();defenseRevision=mapRevision;}
 const cached=defensePatrols.get(key);if(cached)return cached;
 let ingress:TacticalPoint={x:(map.id==='snow'?[-17,0,17]:[-19,3,19])[lane],z:0,y:site.y};
 if(map.geometry){
  const spawn=map.redSpawns[lane],dx=spawn.x-site.x,dz=spawn.z-site.z,n=Math.hypot(dx,dz)||1,side=lane-1;
  const desired={x:site.x+dx/n*18+dz/n*side*12,z:site.z+dz/n*18-dx/n*side*12};
  ingress=[...(map.patrol??map.redSpawns)].sort((a,b)=>Math.hypot(a.x-desired.x,a.z-desired.z)-Math.hypot(b.x-desired.x,b.z-desired.z))[0];
 }
 const route=findPath(site.x,site.z,ingress.x,ingress.z,site.y,ingress.y);
 let previous:TacticalPoint=site,remaining=depth,point:TacticalPoint=site;
 for(const next of route){
  const distance=Math.hypot(next.x-previous.x,next.z-previous.z);
  if(distance>=remaining&&distance>.001){
   const t=remaining/distance;
   const candidate={x:previous.x+(next.x-previous.x)*t,z:previous.z+(next.z-previous.z)*t,y:(previous.y??site.y)+((next.y??site.y)-(previous.y??site.y))*t};
   if(map.geometry)candidate.y=map.geometry.ground(candidate.x,candidate.z,Math.max(previous.y??site.y,next.y??site.y)+2)??candidate.y;
   point=blocked(candidate.x,candidate.z,.4,undefined,candidate.y)?previous:candidate;break;
  }
  remaining-=distance;previous=point=next;
 }
 defensePatrols.set(key,point);return point;
}
/** Separate occupation/recall slots prevent a whole squad chasing one centre. */
export function defenseSitePoint(actor:Actor,state:GameSnapshot):TacticalPoint {
 const site=state.defense!.site,radius=Math.min(1.9,site.radius*.65);
 for(let retry=0;retry<10;retry++){
  const angle=(actor.id%10+retry*.37)*Math.PI*2/10;
  const point={x:site.x+Math.cos(angle)*radius,z:site.z+Math.sin(angle)*radius,y:site.y};
  if(!blocked(point.x,point.z,.4,undefined,site.y)&&walkSegmentClear(site.x,site.z,point.x,point.z,.4,site.y,site.y))return point;
 }
 return site;
}
/** Occupation is stationary unless a teammate blocks the shot. Find a short,
 * walkable sidestep inside the site that clears that actual firing ray. */
export function findDefenseFireLane(actor:Actor,target:Actor,aimHeight:number,state:GameSnapshot,reserved:TacticalPoint[]=[]):TacticalPoint|null {
 const site=state.defense!.site,points:TacticalPoint[]=[];
 for(const distance of [.85,1.4,2])for(let i=0;i<12;i++){
  const angle=i*Math.PI/6;
  points.push({x:actor.x+Math.cos(angle)*distance,z:actor.z+Math.sin(angle)*distance,y:actor.y});
 }
 return points.filter(point=>{
  if(Math.hypot(point.x-site.x,point.z-site.z)>site.radius-.35||occupied(actor,point,state.actors,reserved))return false;
  if(!walkSegmentClear(actor.x,actor.z,point.x,point.z,.4,actor.y,point.y))return false;
  if(!tacticalLineClear(point,target,1.62,aimHeight-(target.y??0)))return false;
  const shooter={...actor,...point};
  return !state.actors.some(ally=>ally.id!==actor.id&&friendlyBlocksShot(shooter,target,aimHeight,ally));
 }).sort((a,b)=>Math.hypot(a.x-actor.x,a.z-actor.z)-Math.hypot(b.x-actor.x,b.z-actor.z))[0]??null;
}
const objectivePoints=new Map<string,Point>();let objectiveRevision=-1;
function objectiveFloor(point:Point):Point{
 const geometry=getActiveMap().geometry;if(!geometry?.navigation)return point;
 if(objectiveRevision!==mapRevision){objectiveRevision=mapRevision;objectivePoints.clear();}
 const key=`${Math.round(point.x*2)},${Math.round(point.z*2)},${Math.round((point.y??0)*2)}`;
 const cached=objectivePoints.get(key);if(cached)return cached;
 let best:Point=point,distance=Infinity;
 for(const p of geometry.navigation.points){
  if('ladder' in p&&p.ladder!==undefined||'crouched' in p&&p.crouched)continue;
  const d=(p.x-point.x)**2+(p.z-point.z)**2+8*(p.y-(point.y??0))**2;
  if(d<distance){distance=d;best=p;}
 }
 if(objectivePoints.size>256)objectivePoints.clear();objectivePoints.set(key,best);return best;
}
/** 拆弹手只有一个；其他 CT 保护拆弹位置，T 守点，不依赖敌人的隐藏坐标。 */
export function botObjective(actor:Actor,state:GameSnapshot,includePlayer=false,patrolStep=0):{point:Point;role:'defuse'|'guard'|'plant'|'recover'|'patrol'|'rescue'|'escort'}{
 if(state.mode==='defense'&&state.defense){
  if(actor.team==='blue')return {point:state.defense.attackers>0?defenseSitePoint(actor,state):defensePatrolPoint(actor,state,patrolStep),role:'patrol'};
  // Arena attackers use three approaches; BSP maps follow their authored navigation.
  const lane=[-18,getActiveMap().id==='snow'?0:3,18][actor.id%3];
  const approach=!getActiveMap().geometry&&actor.z<2;
  return {point:approach?{x:lane,z:3}:defenseSitePoint(actor,state),role:'guard'};
 }
 if(state.mode==='hostageRescue'&&state.rescue){
  const r=state.rescue;
  if(actor.faction==='ct'){
   const waiting=r.hostages.filter(h=>h.status==='waiting');
   if(r.hostages.some(h=>h.leaderId===actor.id&&h.status==='following')){
    const nearby=waiting.filter(h=>Math.abs(h.y-(actor.y??0))<1.5&&Math.hypot(h.x-actor.x,h.z-actor.z)<10).sort((a,b)=>Math.hypot(a.x-actor.x,a.z-actor.z)-Math.hypot(b.x-actor.x,b.z-actor.z))[0];
    return nearby?{point:nearby,role:'rescue'}:{point:r.zones[0]??actor,role:'escort'};
   }
   const rescuers=state.actors.filter(a=>a.faction==='ct'&&a.health>0&&(includePlayer||!a.player)&&!r.hostages.some(h=>h.leaderId===a.id));
   if(waiting.length)return {point:waiting[Math.max(0,rescuers.findIndex(a=>a.id===actor.id))%waiting.length],role:'rescue'};
   return {point:r.zones[0]??actor,role:'guard'};
  }
  const positions=getActiveMap().hostageSpawns??r.hostages;
  return {point:objectiveFloor(positions[actor.id%positions.length]??actor),role:'guard'};
 }
 if(state.mode==='bounty')return {point:patrolPoint(actor,patrolStep),role:'patrol'};
 if(state.mode!=='demolition'){
  const lanes=[-18,0,18],cycle=Math.floor(state.time/10);
  return {point:{x:lanes[(actor.id+state.round+cycle)%3],z:(cycle%2===0?1:-1)*(actor.team==='blue'?-14:14)},role:'patrol'};
 }
 const bomb=state.bomb,allies=state.actors.filter(a=>a.team===actor.team&&a.health>0);
 if(bomb.status==='planted'){
  if(actor.faction==='ct'){
   const candidates=allies.filter(a=>includePlayer||!a.player||a.id===bomb.defuserId);
   const defuser=candidates.find(a=>a.id===bomb.defuserId)??candidates.sort((a,b)=>
    (Math.hypot(a.x-bomb.x,a.z-bomb.z)-(a.defuseKit?3:0))-(Math.hypot(b.x-bomb.x,b.z-bomb.z)-(b.defuseKit?3:0))||a.id-b.id)[0];
   if(defuser?.id===actor.id)return {point:bomb,role:'defuse'};
  }
  // 炸弹位置由规则公开；警戒点分散，避免所有人挤到炸弹上。
  const slot=allies.findIndex(a=>a.id===actor.id),angle=(slot/Math.max(3,allies.length))*Math.PI*2,radius=3+slot%2;
  return {point:objectiveFloor({x:bomb.x+Math.cos(angle)*radius,y:bomb.y,z:bomb.z+Math.sin(angle)*radius}),role:'guard'};
 }
 if(actor.faction==='t'){
  if(bomb.status==='dropped')return {point:bomb,role:'recover'};
  const site=state.sites[state.round%state.sites.length];
  if(actor.hasBomb)return {point:site,role:'plant'};
  const carrier=allies.find(a=>a.hasBomb);
  if(carrier){const slot=allies.filter(a=>a!==carrier).findIndex(a=>a.id===actor.id);return {point:objectiveFloor({x:carrier.x+(slot%2?2.5:-2.5),y:carrier.y,z:carrier.z+2+Math.floor(slot/2)*1.5}),role:'guard'};}
  return {point:site,role:'guard'};
 }
 // 按队员与回合分配路线；时间推进后轮换，而非读取墙后敌人坐标。
 if(getActiveMap().geometry){const site=state.sites[(actor.id+state.round)%state.sites.length];return {point:objectiveFloor({...site,x:site.x+(actor.id%2?1.8:-1.8),z:site.z+2}),role:'guard'};}
 const lane=[-17,3,17][(actor.id+state.round+Math.floor(state.time/12))%3];
 return {point:{x:lane,z:state.time%24<12?0:-11},role:'patrol'};
}
