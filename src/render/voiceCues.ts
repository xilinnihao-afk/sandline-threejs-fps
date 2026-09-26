import type { GameEvent, GameSnapshot } from '../game/types';
export const VOICE_IDS = ['grenade','planted','defusing','defused','round-start','round-win','round-loss','round-draw','match-win','match-loss'] as const;
export type VoiceId = typeof VOICE_IDS[number];
export type VoiceCue = { id: VoiceId; priority: number; key: string; cooldown: number; ttl: number };
export function voiceCues(events: GameEvent[], state: GameSnapshot): VoiceCue[] {
 const cues: VoiceCue[]=[];
 const add=(id:VoiceId,priority:number,cooldown=5,ttl=3)=>cues.push({id,priority,key:`${id}:${state.round}`,cooldown,ttl});
 for(const event of events){
  const actor=state.actors.find(a=>a.id===event.actorId);
  if(event.type==='grenadeThrow'&&actor?.team===state.player.team&&Math.hypot(actor.x-state.player.x,actor.z-state.player.z)<18)add('grenade',20,4,1.4);
  if(event.type==='plantComplete')add('planted',60,10,4);
  if(event.type==='defuseStart'&&actor?.team===state.player.team)add('defusing',40,8,2);
  if(event.type==='defuseComplete')add('defused',100,30,8);
  if(event.type==='round'){
   if(state.phase==='matchEnd')add(state.winner===state.player.team?'match-win':'match-loss',90,30,10);
   else if(state.phase==='roundEnd')add(state.winner==='draw'?'round-draw':state.winner===state.player.team?'round-win':'round-loss',90,30,7);
   else if(state.phase==='playing'||state.phase==='prep')add('round-start',30,30,2);
  }
 }
 return cues.sort((a,b)=>b.priority-a.priority);
}

/** Bounded queue, event-key cooldowns and TTL keep late or repeated chatter out. */
export class VoiceQueue {
 current:VoiceCue|null=null;
 private pending:Array<VoiceCue & {expires:number}>=[];
 private last=new Map<string,number>();
 enqueue(cues:VoiceCue[],now:number):boolean {
  let interrupted=false;
  for(const cue of cues){
   if(now-(this.last.get(cue.key)??-Infinity)<cue.cooldown)continue;
   this.last.set(cue.key,now);
   if(this.last.size>64)this.last.delete(this.last.keys().next().value!);
   if(cue.priority>=80){
    this.pending=this.pending.filter(item=>item.priority>=80);
    if(this.current&&this.current.priority<80){this.current=null;interrupted=true;}
   }
   this.pending.push({...cue,expires:now+cue.ttl});
  }
  this.pending.sort((a,b)=>b.priority-a.priority);this.pending=this.pending.slice(0,3);
  return interrupted;
 }
 next(now:number,ready:(cue:VoiceCue)=>boolean=()=>true):VoiceCue|null {
  if(this.current)return null;
  this.pending=this.pending.filter(item=>item.expires>now);
  if(this.pending[0]&&!ready(this.pending[0]))return null;
  this.current=this.pending.shift()??null;return this.current;
 }
 complete(){this.current=null;}
 reset(){this.current=null;this.pending=[];this.last.clear();}
 get queued(){return this.pending.length;}
}
