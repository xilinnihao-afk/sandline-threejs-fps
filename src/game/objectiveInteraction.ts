import type {Actor,GameSnapshot,ObjectiveSite} from './types';
import {wallDistance} from './collision';
export const PLANT_SECONDS=3,BOMB_SECONDS=40,DEFUSE_SECONDS=10,KIT_DEFUSE_SECONDS=5;
export const RESCUE_ROUND_SECONDS=180,DEMOLITION_ROUND_SECONDS=120;
type Point={x:number;y?:number;z:number};
export function objectiveReachable(a:Point,b:Point,radius:number,height=1.5):boolean{
 const dx=b.x-a.x,dz=b.z-a.z,dy=(b.y??0)-(a.y??0),distance=Math.hypot(dx,dz);
 if(distance>radius||Math.abs(dy)>height)return false;
 const n=Math.hypot(dx,dz,dy);return n<.01||wallDistance(a.x,(a.y??0)+.8,a.z,dx/n,dy/n,dz/n)>=n-.05;
}
export function insideBombSite(a:Point,site:ObjectiveSite):boolean{
 const b=site.bounds;
 return b?a.x>=b.minX&&a.x<=b.maxX&&a.z>=b.minZ&&a.z<=b.maxZ&&(a.y??0)>=b.minY-.15&&(a.y??0)<=b.maxY
  :Math.hypot(a.x-site.x,a.z-site.z)<=site.radius&&Math.abs((a.y??0)-(site.y??0))<1.5;
}
export function objectiveInteraction(s:GameSnapshot,a:Actor):{kind:'rescue'|'wait'|'plant'|'defuse';label:string;hint:string;progress:number;targetId?:number}|null{
 if(a.health<=0||s.phase!=='playing'&&s.phase!=='planted')return null;
 if(s.mode==='hostageRescue'&&s.rescue&&a.faction==='ct'){
  const h=s.rescue.hostages.filter(h=>h.status!=='rescued'&&(h.leaderId===null||h.leaderId===a.id)&&objectiveReachable(a,h,2.2))
   .sort((p,q)=>(p.status==='waiting'?0:1)-(q.status==='waiting'?0:1)||Math.hypot(a.x-p.x,a.z-p.z)-Math.hypot(a.x-q.x,a.z-q.z))[0];
  return h?{kind:h.leaderId===a.id?'wait':'rescue',label:h.leaderId===a.id?'等待':'跟随',hint:h.leaderId===a.id?'按 E 让人质等待':'按 E 让人质跟随，护送至救援区',progress:0,targetId:h.id}:null;
 }
 if(s.mode!=='demolition')return null;
 if(a.faction==='t'&&a.hasBomb&&s.bomb.status==='carried'&&s.sites.some(site=>insideBombSite(a,site)))return {kind:'plant',label:'安放',hint:'按住 E 安放 C4 · 保持静止 3 秒',progress:s.bomb.planterId===a.id?s.bomb.plantProgress??0:0};
 if(a.faction==='ct'&&s.bomb.status==='planted'&&objectiveReachable(a,s.bomb,2.4))return {kind:'defuse',label:'拆除',hint:`按住 E 拆弹 · ${a.defuseKit?5:10} 秒`,progress:s.bomb.defuserId===a.id?s.bomb.progress:0};
 return null;
}
