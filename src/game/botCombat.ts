import type {Actor,GameMode,WeaponKind} from './types';
import type {TacticalPoint} from './botTactics';

export type SquadRole='solo'|'support'|'assault'|'flank';
export type CombatAction='engage'|'support'|'advance'|'flank'|'cover'|'search';
export interface SquadMember {actor:Actor;seeing:boolean;}
export interface SquadOrder {role:SquadRole;side:number;covered:boolean;supportId:number|null;}
export const preferredRange=(weapon:WeaponKind)=>({knife:1.2,shotgun:5,smg:8,pistol:9,deagle:12,rifle:13,m4:14,sniper:23})[weapon];

/** Squad knowledge consists only of allies' state and an observed contact.
 * A human only supplies covering fire when actually shooting. A reloading,
 * wounded or disengaged teammate is never counted as an active fire base. */
export function squadOrder(actor:Actor,members:SquadMember[],contact:TacticalPoint,now:number,mode:GameMode,allBots=false):SquadOrder {
 const solo:SquadOrder={role:'solo',side:actor.id%2?1:-1,covered:false,supportId:null};
 if(mode==='armsRace')return solo;
 const nearby=members.filter(({actor:a})=>a.team===actor.team&&a.health>0&&Math.abs((a.y??0)-(actor.y??0))<4&&Math.hypot(a.x-contact.x,a.z-contact.z)<32&&Math.hypot(a.x-actor.x,a.z-actor.z)<18);
 if(nearby.length<2)return solo;
 const ready=nearby.filter(({actor:a,seeing})=>seeing&&a.health>=40&&a.weapon!=='knife'&&a.guns[a.weapon].reloadLeft===0&&a.guns[a.weapon].ammo>=3&&(allBots||!a.player||now-a.shotTime<.65));
 // Stable ID ordering avoids frame-to-frame distance ties; snipers provide overwatch.
 ready.sort((p,q)=>(q.actor.weapon==='sniper'?1:0)-(p.actor.weapon==='sniper'?1:0)||p.actor.id-q.actor.id);
 const anchor=ready[0]?.actor;
 if(!anchor)return solo;
 if(anchor.id===actor.id)return {role:'support',side:solo.side,covered:false,supportId:anchor.id};
 const movers=nearby.filter(m=>m.actor.id!==anchor.id&&(allBots||!m.actor.player)).sort((p,q)=>p.actor.id-q.actor.id);
 const slot=movers.findIndex(m=>m.actor.id===actor.id);
 return {role:slot%3===0?'assault':'flank',side:slot%2?1:-1,covered:true,supportId:anchor.id};
}

export interface CombatContext {
 visible:boolean;health:number;reloading:boolean;pressure:number;range:number;idealRange:number;
 role:SquadRole;covered:boolean;opportunity:boolean;urgent:boolean;exposedFor:number;
}
/** Small utility selector inside the existing priority-based controller.
 * Call at a bounded cadence and commit movement, rather than changing every tick. */
export function chooseCombatAction(c:CombatContext):CombatAction {
 if(c.reloading)return 'cover';
 if(c.urgent)return 'advance';
 const scores:Array<[CombatAction,number]>=[
  ['engage',c.visible?40:0],
  ['search',c.visible?0:45],
  ['cover',(c.health<40?55:0)+c.pressure*55+(c.exposedFor>4?12:0)],
  ['support',c.visible&&c.role==='support'?65:0],
  ['advance',(c.range>c.idealRange+2?52:0)+(c.covered&&c.role==='assault'?20:0)+(c.opportunity&&c.role!=='support'?50:0)-(c.health<40?35:0)],
  ['flank',(c.role==='flank'&&c.covered?72:0)+(c.exposedFor>3?10:0)-(c.health<40?25:0)],
 ];
 return scores.sort((a,b)=>b[1]-a[1])[0][0];
}
