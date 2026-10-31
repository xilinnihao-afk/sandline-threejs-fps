import {setEquippedWeapon} from './weaponSelection';
import {blocked,wallDistance} from './collision';
import {getActiveMap} from './map';
import {LOADOUTS} from './loadouts';
import {allowsPickups} from './offlineModes';
import type {Actor,GameEvent,GameSnapshot,GroundWeapon,WeaponKind} from './types';

export const PICKUP_RADIUS=1.65;
/** Keep the existing ground instance intact when snow already has this class. */
export function addGroundWeapon(pickups:GroundWeapon[],pickup:GroundWeapon):boolean{
 const uniqueClass=getActiveMap().id==='snow';
 if(pickups.some(existing=>existing.id===pickup.id||uniqueClass&&existing.weapon===pickup.weapon))return false;
 pickups.push(pickup);return true;
}
/** Snow keeps one of each class, alternating the existing two rows. Other
 * maps retain their mirrored weapon rows and original supply quantities. */
export function createMapPickups():GroundWeapon[]{
 const kinds:WeaponKind[]=['smg','shotgun','m4','sniper','rifle','pistol','deagle'];
 const map=getActiveMap();if(map.geometry)return [map.blueSpawns,map.redSpawns].flatMap((spawns,row)=>kinds.map((weapon,i)=>{
  const spawn=spawns[i%spawns.length],p=map.geometry!.move(spawn.x,spawn.z,0,row?1.5:-1.5,spawn.y);
  return {id:row*10+i+1,weapon,...p,ammo:LOADOUTS[weapon].magazine,reserve:LOADOUTS[weapon].reserve};
 }));
 const xs=map.id==='snow'?[-8,-5.5,-3,0,3,6,9]:[-3,0,3,6,12,18,-6];
 return [-1,1].flatMap((side,row)=>kinds.flatMap((weapon,i)=>map.id==='snow'&&row!==(i%2===0?1:0)?[]:[{id:row*10+i+1,weapon,x:xs[i],z:side*15.5,ammo:LOADOUTS[weapon].magazine,reserve:LOADOUTS[weapon].reserve}]))
  .filter(p=>!blocked(p.x,p.z,.5));
}
export function nearestPickup(state:GameSnapshot,actor:Actor=state.player):GroundWeapon|null{
 if(!allowsPickups(state.mode)||actor.health<=0||state.paused||!['playing','planted'].includes(state.phase))return null;
 let result:GroundWeapon|null=null,best=PICKUP_RADIUS;
 for(const pickup of state.pickups){
  const gun=actor.guns[pickup.weapon],spec=LOADOUTS[pickup.weapon];
  // Don't offer a fully stocked duplicate; it would hide another useful nearby weapon.
  if(actor.inventory.includes(pickup.weapon)&&gun.ammo>=spec.magazine&&gun.reserve>=spec.reserve)continue;
  const dx=pickup.x-actor.x,dz=pickup.z-actor.z,d=Math.hypot(dx,dz);
  if(d>best||Math.abs((pickup.y??0)-(actor.y??0))>1.2||d>.001&&wallDistance(actor.x,(pickup.y??0)+.25,actor.z,dx/d,0,dz/d)<d-.04)continue;
  best=d;result=pickup;
 }
 return result;
}
export function takePickup(state:GameSnapshot,actor:Actor,pickup:GroundWeapon,events:GameEvent[]):boolean{
 if(actor.guns[actor.weapon].reloadLeft>0||nearestPickup(state,actor)?.id!==pickup.id)return false;
 const index=state.pickups.findIndex(p=>p===pickup);if(index<0)return false;
 const spec=LOADOUTS[pickup.weapon],gun=actor.guns[pickup.weapon];
 if(!actor.inventory.includes(pickup.weapon)){
  actor.inventory.push(pickup.weapon);gun.ammo=pickup.ammo;gun.reserve=pickup.reserve;
 }else{
  const total=gun.ammo+gun.reserve+pickup.ammo+pickup.reserve;
  gun.ammo=Math.min(spec.magazine,total);gun.reserve=Math.min(spec.reserve,total-gun.ammo);
 }
 gun.reloadLeft=0;gun.cooldown=Math.max(gun.cooldown,.25);setEquippedWeapon(actor,pickup.weapon);
 state.pickups.splice(index,1);
 events.push({type:'weaponPickup',actorId:actor.id,weapon:pickup.weapon,x:pickup.x,z:pickup.z});
 return true;
}
/** A dropped gun keeps remaining rounds; no ammo is created by killing or collecting. */
export function dropWeapon(actor:Actor,id:number):GroundWeapon|null{
 if(actor.weapon==='knife')return null;
 const gun=actor.guns[actor.weapon];
 return gun.ammo+gun.reserve>0?{id,weapon:actor.weapon,x:actor.x,z:actor.z,y:actor.y,ammo:gun.ammo,reserve:gun.reserve}:null;
}
