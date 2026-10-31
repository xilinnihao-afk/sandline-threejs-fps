import {wallDistance} from './collision';
import {MAP_BOXES} from './map';
import type {MapBox} from './types';

export const BLAST_RADIUS=8;
export const BOMB_BLAST_RADIUS=24;
/** 安放炸弹是独立的环境危险；末端四米平滑归零，墙体仍阻挡冲击。 */
export function bombBlastFalloff(distance:number):number {
 const edge=Math.max(0,Math.min(1,(BOMB_BLAST_RADIUS-distance)/4));
 return 360/(1+(Math.max(0,distance)/7)**2)*edge*edge*(3-2*edge);
}
/** 游戏化冲击/破片伤害：近距离危险，边缘平滑归零；不是现实伤害预测。 */
export function blastFalloff(distance:number):number {
 const edge=Math.max(0,Math.min(1,(BLAST_RADIUS-distance)/2));
 return 165/(1+(Math.max(0,distance)/2.8)**2)*edge*edge*(3-2*edge);
}
/** 多点检测身体暴露，避免单条胸口射线造成全伤/零伤突变。 */
export function sampleBlast(origin:{x:number;y:number;z:number},target:{x:number;y?:number;z:number;crouched:boolean},boxes:MapBox[]=MAP_BOXES){
 return sampleExposure(origin,target,boxes,BLAST_RADIUS,blastFalloff);
}
export function sampleBombBlast(origin:{x:number;y:number;z:number},target:{x:number;y?:number;z:number;crouched:boolean},boxes:MapBox[]=MAP_BOXES){
 return sampleExposure(origin,target,boxes,BOMB_BLAST_RADIUS,bombBlastFalloff);
}
function sampleExposure(origin:{x:number;y:number;z:number},target:{x:number;y?:number;z:number;crouched:boolean},boxes:MapBox[],radius:number,falloff:(distance:number)=>number){
 const height=target.crouched?1.08:1.7;
 const dx=target.x-origin.x,dz=target.z-origin.z,horizontal=Math.hypot(dx,dz);
 const sideX=horizontal>.001?dz/horizontal:1,sideZ=horizontal>.001?-dx/horizontal:0;
 const samples=[[0,.92,.15],[0,.64,.30],[0,.30,.25],[-.23,.64,.15],[.23,.64,.15]];
 let exposure=0,damage=0;
 for(const [side,level,weight] of samples){
  const x=dx+sideX*side,y=(target.y??0)+height*level-origin.y,z=dz+sideZ*side,d=Math.hypot(x,y,z);
  if(d>=radius)continue;
  if(d>.001&&wallDistance(origin.x,origin.y,origin.z,x/d,y/d,z/d,boxes)<d-.015)continue;
  exposure+=weight;damage+=falloff(d)*weight;
 }
 return {damage:Math.round(damage),exposure};
}
