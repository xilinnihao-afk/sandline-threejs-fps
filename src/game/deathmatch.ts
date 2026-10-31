import {areEnemies} from './offlineModes';
import {BLUE_SPAWNS,RED_SPAWNS,getActiveMap} from './map';
import {blocked,lineClear,wallDistance} from './collision';
import type {Actor,GameMode} from './types';
import type {MapPoint} from './mapGeometry';

export const RESPAWN_DELAY=3;
export const SPAWN_PROTECTION=1.5;
/** Stable across rendering, team rosters and the full board. Tied K/D share a rank. */
export function killRanking(actors:Actor[]){
 const sorted=[...actors].sort((a,b)=>b.kills-a.kills||a.deaths-b.deaths||a.id-b.id);
 let rank=1;
 return sorted.map((actor,i)=>{if(i&& (actor.kills!==sorted[i-1].kills||actor.deaths!==sorted[i-1].deaths))rank=i+1;return {actor,rank};});
}

/** Choose sheltered, unoccupied spawn positions; never respawn into a wall/body. */
export function chooseRespawn(actor:Actor,actors:Actor[],mode:GameMode='deathmatch'){
 const own=actor.team==='blue'?BLUE_SPAWNS:RED_SPAWNS;
 const candidates:MapPoint[]=[...own,...BLUE_SPAWNS,...RED_SPAWNS,
  ...(getActiveMap().geometry?[]:[-18,-14,-3,3,14,18].flatMap(x=>[-18,18].map(z=>({x,z}))))];
 let best=own[actor.id%own.length],bestScore=-Infinity;
 for(const p of candidates){
  if(blocked(p.x,p.z,.48,undefined,p.y))continue;
  if(actors.some(other=>other!==actor&&other.health>0&&Math.abs((other.y??0)-(p.y??0))<1.8&&Math.hypot(other.x-p.x,other.z-p.z)<.8))continue;
  let score=own.includes(p)?2:0;
  for(const other of actors){
   if(other===actor||other.health<=0)continue;
   const d=Math.hypot(other.x-p.x,other.z-p.z);
   if(d<1.25&&Math.abs((other.y??0)-(p.y??0))<1.8)score-=1000;
   if(areEnemies(actor,other,mode)){
    const eye=(p.y??0)+1.62,dy=(other.y??0)+(other.crouched?1.08:1.62)-eye,length=Math.hypot(d,dy);
    const visible=getActiveMap().geometry?(length<.01||wallDistance(p.x,eye,p.z,(other.x-p.x)/length,dy/length,(other.z-p.z)/length)>length-.1):lineClear(p.x,p.z,other.x,other.z,1.5);
    score+=Math.min(d,25)*.3-(visible?22:0)-Math.max(0,9-d)*7;
   }
  }
  if(score>bestScore){bestScore=score;best=p;}
 }
 return {...best};
}
