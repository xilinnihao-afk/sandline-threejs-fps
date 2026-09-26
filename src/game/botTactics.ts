import {blocked,wallDistance} from './collision';
import {MAP_BOXES} from './map';
import type {Actor,GameSnapshot} from './types';
type Point={x:number;z:number};
/** 从现有碰撞盒周边挑选遮挡位，只在战术决策时调用，不逐帧搜索。 */
export function findBotCover(actor:Actor,threat:Point):Point|null{
 let best:Point|null=null,score=Infinity;
 for(const box of MAP_BOXES){
  for(const [x,z] of [[box.x-box.w/2-.65,box.z],[box.x+box.w/2+.65,box.z],[box.x,box.z-box.d/2-.65],[box.x,box.z+box.d/2+.65]]){
   const distance=Math.hypot(x-actor.x,z-actor.z);if(distance>7||distance<.35||blocked(x,z,.4)||Math.abs(x)>21||Math.abs(z)>19)continue;
   const dx=threat.x-x,dz=threat.z-z,d=Math.hypot(dx,dz);
   if(d<.01||wallDistance(x,1.05,z,dx/d,0,dz/d)>=d-.1)continue;
   const value=distance+Math.max(0,3-d)*2;if(value<score){score=value;best={x,z};}
  }
 }
 return best;
}
/** 拆弹手只有一个；其他 CT 保护拆弹位置，T 守点，不依赖敌人的隐藏坐标。 */
export function botObjective(actor:Actor,state:GameSnapshot,includePlayer=false):{point:Point;role:'defuse'|'guard'|'plant'|'recover'|'patrol'}{
 const bomb=state.bomb,allies=state.actors.filter(a=>a.team===actor.team&&a.health>0);
 if(bomb.status==='planted'){
  if(actor.faction==='ct'){
   const candidates=allies.filter(a=>includePlayer||!a.player||a.id===bomb.defuserId);
   const defuser=candidates.find(a=>a.id===bomb.defuserId)??candidates.sort((a,b)=>
    (Math.hypot(a.x-bomb.x,a.z-bomb.z)-(a.defuseKit?3:0))-(Math.hypot(b.x-bomb.x,b.z-bomb.z)-(b.defuseKit?3:0))||a.id-b.id)[0];
   if(defuser?.id===actor.id)return {point:bomb,role:'defuse'};
  }
  // 炸弹位置由规则公开；警戒点分散，避免所有人挤到炸弹上。
  return {point:{x:bomb.x+(actor.id%2?3:-3),z:bomb.z+(actor.faction==='ct'?3:-3)},role:'guard'};
 }
 if(actor.faction==='t'){
  if(bomb.status==='dropped')return {point:bomb,role:'recover'};
  const site=state.sites[state.round%2];
  if(actor.hasBomb)return {point:site,role:'plant'};
  return {point:{x:site.x+(actor.id%2?3:-3),z:site.z-3},role:'guard'};
 }
 // 按队员与回合分配路线；时间推进后轮换，而非读取墙后敌人坐标。
 const lane=[-17,3,17][(actor.id+state.round+Math.floor(state.time/12))%3];
 return {point:{x:lane,z:state.time%24<12?0:-11},role:'patrol'};
}
