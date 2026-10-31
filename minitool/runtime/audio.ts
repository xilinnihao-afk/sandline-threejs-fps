import type {GameEvent,GameSnapshot,WeaponKind} from '../../src/game/types';
import {LOADOUTS} from '../../src/game/loadouts';
import {BANK_SAMPLE_RATE,LOOP_IDS,renderSound,SOUND_IDS,type SoundId} from './soundBank';
export type AudioScene='menu'|'combat'|'paused';
type Voice={source:AudioBufferSourceNode;amp:GainNode;nodes:AudioNode[];id:SoundId;gain:number;priority:number;start:number;end:number;step:boolean;loop:boolean};
type Mix={delay?:number;cutoff?:number;priority?:number;step?:boolean;rate?:number};
const MAX_VOICES=24,MAX_RELEASES=4,MAX_STEPS=3;
/** Contact remains legible nearby; crouching and walls still reduce information. */
export function stepMix(distance:number,crouched=false,occluded=false,local=false){
 const d=Math.max(0,distance),fade=Math.max(0,Math.min(1,(28-d)/6));
 return {gain:(local?.30:.34)/(1+d*.085)*fade*(crouched?.40:1)*(occluded?.38:1),cutoff:occluded?850:Math.max(1400,4200-d*100)};
}
/** Offline synthesis with reusable buffers; no media decoding or resource requests. */
export class GameAudio {
 volume=.6;
 private ctx:AudioContext|null=null;private master:GainNode|null=null;private analyser:AnalyserNode|null=null;private meterData=new Float32Array(256);
 private bank=new Map<SoundId,AudioBuffer>();private scene:AudioScene='menu';private hidden=document.hidden;private voices=new Set<Voice>();
 private releasing=new Set<Voice>();private shotSequence=0;
 private played=0;private skipped=0;private dropped=0;private events:Record<string,number>={};private sounds:Record<string,number>={};private error='';private auditionUntil=0;
 private lastSteps=new Map<number,number>();private stepSequence=new Map<number,number>();private peakOutput=0;
 private sessionOwned=false;private previousSession='auto';private primer:AudioBufferSourceNode|null=null;
 constructor(){
  const hide=()=>{this.hidden=true;this.stop();this.playbackSession(false);if(this.ctx&&this.ctx.state!=='closed')void this.ctx.suspend().catch(()=>{});};
  document.addEventListener('visibilitychange',()=>{this.hidden=document.hidden;if(this.hidden)hide();});window.addEventListener('pagehide',hide);window.addEventListener('pageshow',()=>{this.hidden=document.hidden;});
  // Resume and the silent primer must remain in the trusted iOS gesture stack.
  const gesture=(event:Event)=>{if(event.isTrusted===false||document.hidden||this.volume===0||this.ctx?.state==='running')return;void this.unlock();};
  for(const type of ['pointerup','touchend','click','keydown'])document.addEventListener(type,gesture,{capture:true,passive:true});
 }
 private playbackSession(active:boolean):void{try{const session=(navigator as Navigator & {audioSession?:{type:string}}).audioSession;if(!session)return;if(active){if(!this.sessionOwned)this.previousSession=session.type;session.type='playback';this.sessionOwned=true;}else if(this.sessionOwned){if(session.type==='playback')session.type=this.previousSession||'auto';this.sessionOwned=false;}}catch{}}
 private contextType(){return window.AudioContext||(window as Window & {webkitAudioContext?:typeof AudioContext}).webkitAudioContext;}
 async unlock():Promise<void>{
  try{
   if(document.hidden||this.volume===0)return;
   this.playbackSession(true);
   if(!this.ctx||this.ctx.state==='closed'){
    const Context=this.contextType();if(!Context){this.error='当前环境不支持声音';this.playbackSession(false);return;}
    this.ctx=new Context();this.bank.clear();this.analyser=null;const created=this.ctx;
    created.onstatechange=()=>{if(created!==this.ctx)return;if((created.state as string)==='interrupted'||created.state==='closed'){this.stop();this.playbackSession(false);}};
    this.master=created.createGain();this.master.gain.value=this.volume;
    const compressor=created.createDynamicsCompressor();compressor.threshold.value=-12;compressor.knee.value=8;compressor.ratio.value=5;compressor.attack.value=.003;compressor.release.value=.16;
    this.master.connect(compressor);
    if(typeof created.createAnalyser==='function'){this.analyser=created.createAnalyser();this.analyser.fftSize=256;compressor.connect(this.analyser);this.analyser.connect(created.destination);}else compressor.connect(created.destination);
   }
   const ctx=this.ctx,resumed=ctx.state!=='running'?ctx.resume():Promise.resolve();
   if(this.primer){try{this.primer.stop();this.primer.disconnect();}catch{}}
   const source=ctx.createBufferSource();source.buffer=ctx.createBuffer(1,1,ctx.sampleRate);source.connect(ctx.destination);source.onended=()=>{source.disconnect();if(this.primer===source)this.primer=null;};this.primer=source;source.start(0);
   await resumed;if(ctx!==this.ctx)return;this.hidden=document.hidden;
   if(this.hidden||this.volume===0){this.stop();this.playbackSession(false);if(this.hidden)void ctx.suspend().catch(()=>{});return;}
   this.error=ctx.state==='running'?'':'请轻触“试听音效”重新开启声音';
   // Synthesis follows activation; each recipe is built only once for this context.
   if(ctx.state==='running'){for(const id of SOUND_IDS)this.buffer(id);this.syncLoop();}
  }catch(error){this.error=error instanceof Error?error.message:'声音启动失败';this.playbackSession(false);}
 }
 async resumeIfNeeded():Promise<boolean>{await this.unlock();return this.ready();}
 setVolume(value:number):void{
  this.volume=Number.isFinite(value)?Math.max(0,Math.min(1,value)):.6;if(this.master)this.master.gain.value=this.volume;
  if(!this.volume){this.stop();this.playbackSession(false);}else if(this.ready()){this.playbackSession(true);this.syncLoop();}
 }
 setScene(scene:AudioScene):void{if(this.scene!==scene){this.scene=scene;this.stop();}this.syncLoop();}
 setActive(active:boolean):void{this.setScene(active?'combat':'paused');}
 stop():void{this.auditionUntil=0;for(const voice of [...this.voices,...this.releasing])this.end(voice);this.lastSteps.clear();this.stepSequence.clear();}
 private end(voice:Voice,fade=false):void{
  const owned=this.voices.delete(voice);const releasing=this.releasing.delete(voice);if(!owned&&!releasing)return;
  const now=this.ctx?.currentTime??0;
  if(fade&&voice.start<=now&&voice.end>now+.012){
   // Replacing a playing buffer at an arbitrary sample creates a click. Allow a
   // brief release, with a bounded reserve so dense fights never grow the pool.
   if(this.releasing.size>=MAX_RELEASES)this.end(this.releasing.values().next().value!);
   this.releasing.add(voice);voice.end=now+.012;
   voice.amp.gain.cancelScheduledValues(now);voice.amp.gain.setValueAtTime(voice.gain,now);voice.amp.gain.linearRampToValueAtTime(0,voice.end);
   try{voice.source.stop(voice.end);}catch{}
  }else{try{voice.source.stop();}catch{}for(const node of voice.nodes)try{node.disconnect();}catch{}}
 }
 private ready():boolean{return !!this.ctx&&this.ctx.state==='running'&&!this.hidden&&!document.hidden&&this.volume>0;}
 private buffer(id:SoundId):AudioBuffer{
  let buffer=this.bank.get(id);if(!buffer){const data=renderSound(id);buffer=this.ctx!.createBuffer(1,data.length,BANK_SAMPLE_RATE);buffer.getChannelData(0).set(data);this.bank.set(id,buffer);}return buffer;
 }
 private syncLoop():void{
  if(!this.ready()||this.scene==='paused'||this.auditionUntil>this.ctx!.currentTime)return;
  const id=this.scene==='menu'?'menu':'wind';if(!Array.from(this.voices).some(v=>v.id===id&&v.loop))this.sound(id,this.scene==='menu'?.11:.022,0,{priority:-1});
 }
 private sound(id:SoundId,gain:number,pan=0,mix:Mix={}):void{
  if(!this.ready()||gain<.002)return;
  const ctx=this.ctx!,now=ctx.currentTime,delay=mix.delay??0,priority=mix.priority??2,loop=LOOP_IDS.has(id),step=!!mix.step;
  for(const v of Array.from(this.releasing))if(v.end<=now)this.end(v);
  for(const v of Array.from(this.voices))if(!v.loop&&v.end<now)this.end(v);
  if(step){const steps=Array.from(this.voices).filter(v=>v.step&&v.end>now).sort((a,b)=>a.gain-b.gain);if(steps.length>=MAX_STEPS){if(steps[0].gain>gain){this.dropped++;return;}this.end(steps[0],true);}}
  if(this.voices.size>=MAX_VOICES){
   // Future reload/debris voices yield before currently audible cues and footsteps.
   const rank=(v:Voice)=>v.priority-(v.start>now+.08?3:0);
   const candidate=Array.from(this.voices).filter(v=>!v.loop&&!v.step).sort((a,b)=>rank(a)-rank(b)||a.gain-b.gain)[0];
   if(!candidate||rank(candidate)>priority-(delay>.08?3:0)){this.dropped++;return;}this.end(candidate,true);
  }
  const buffer=this.buffer(id),source=ctx.createBufferSource(),amp=ctx.createGain(),start=now+delay,rate=mix.rate??1;
  source.buffer=buffer;source.loop=loop;if(source.playbackRate)source.playbackRate.value=rate;const nodes:AudioNode[]=[source,amp];let tail:AudioNode=source;
  if(mix.cutoff&&mix.cutoff<11000){const filter=ctx.createBiquadFilter();filter.type='lowpass';filter.frequency.value=mix.cutoff;filter.Q.value=.65;tail.connect(filter);tail=filter;nodes.push(filter);}
  tail.connect(amp);tail=amp;amp.gain.setValueAtTime(loop?0:gain,start);if(loop)amp.gain.linearRampToValueAtTime(gain,start+.3);
  if(typeof ctx.createStereoPanner==='function'){const stereo=ctx.createStereoPanner();stereo.pan.value=Math.max(-1,Math.min(1,pan));tail.connect(stereo);tail=stereo;nodes.push(stereo);}
  tail.connect(this.master!);
  const duration=buffer.getChannelData(0).length/BANK_SAMPLE_RATE/rate,voice:Voice={source,amp,nodes,id,gain,priority,start,end:loop?Infinity:start+duration,step,loop};this.voices.add(voice);
  source.onended=()=>{this.voices.delete(voice);this.releasing.delete(voice);for(const node of nodes)node.disconnect();};source.start(start);
  this.played++;this.sounds[id]=(this.sounds[id]??0)+1;
 }
 private shot(weapon:WeaponKind,gain:number,pan:number,delay=0,occluded=false):void{
  if(weapon==='knife'){this.sound('slash',.32*gain,pan,{delay,priority:4});return;}
  const cutoff=occluded?1000:Math.max(2200,6500*gain),rate=[1,.986,1.012,.994][this.shotSequence++%4];
  this.sound(weapon,(weapon==='sniper'?.78:weapon==='shotgun'?.70:.62)*gain,pan,{delay,cutoff,priority:4,rate});
  this.sound('mechanism',.065*gain,pan,{delay:delay+.035,cutoff:Math.min(cutoff,3500),priority:1});
  if(weapon!=='sniper')this.sound('tail',.07*gain,pan,{delay:delay+.06,cutoff,priority:0});
  if(gain>.30)this.sound('shell',.035*gain,pan,{delay:delay+.18,cutoff:occluded?850:4200,priority:0});
  if(weapon==='sniper'||weapon==='shotgun')this.sound(weapon==='sniper'?'bolt':'pump',.21*gain,pan,{delay:delay+(weapon==='sniper'?.44:.34),cutoff,priority:2});
 }
 private reload(kind:WeaponKind,gain:number,pan:number,shells=1):void{
  if(kind==='knife')return;const duration=LOADOUTS[kind].reload;
  this.sound('gear',.13*gain,pan,{priority:1});
  if(kind==='shotgun'){
   const count=Math.max(1,Math.min(8,Math.floor(shells)));for(let i=0;i<count;i++)this.sound('magIn',.20*gain,pan,{delay:duration*(.18+.55*i/count),priority:2});
   this.sound('pump',.26*gain,pan,{delay:duration*.88,priority:3});
  }else{
   this.sound('magOut',.24*gain,pan,{delay:duration*.2,priority:2});this.sound('magIn',.30*gain,pan,{delay:duration*.70,priority:3});
   this.sound('mechanism',.13*gain,pan,{delay:duration*.76,priority:1});this.sound('bolt',.25*gain,pan,{delay:duration*.84,priority:3});
  }
 }
 play(event:GameEvent,distance=0,pan=0):void{
  if(!this.ready()){this.skipped++;return;}if(this.scene!=='combat'&&event.type!=='round')return;
  const kind=event.weapon??'rifle',gain=1/(1+Math.max(0,distance)*.065)*(event.occluded?.48:1),local=event.actorId===0;
  this.events[event.type]=(this.events[event.type]??0)+1;
  switch(event.type){
   case 'shot':this.shot(kind,gain,pan,0,event.occluded);break;
   case 'melee':this.sound(event.meleeAttack==='stab'?'stab':'slash',.34*gain,pan,{priority:4});break;
   case 'explosion':case 'bombExplode':this.sound(event.type==='bombExplode'?'bomb':'grenade',.83*gain,pan,{cutoff:event.occluded?600:10000,priority:5});break;
   case 'reload':this.reload(kind,gain,pan,event.shells);break;
   case 'step':{
    const now=this.ctx!.currentTime,id=event.actorId??-1;if(now-(this.lastSteps.get(id)??-Infinity)<.18)break;
    const mix=stepMix(distance,event.crouched,event.occluded,local);if(mix.gain<.002)break;
    this.lastSteps.set(id,now);const sequence=this.stepSequence.get(id)??0;this.stepSequence.set(id,sequence+1);
    const snow=event.stepSurface==='snow',variants=snow?(['snow1','snow2','snow3','snow4'] as const):(['step1','step2','step3','step4'] as const);
    this.sound(variants[(sequence+Math.abs(id))%4],mix.gain,pan,{cutoff:snow&&!event.occluded?Math.min(4600,mix.cutoff+500):mix.cutoff,priority:4,step:true,rate:(event.crouched?.91:1)*[1,.975,1.018,.99][sequence%4]});break;
   }
   case 'hit':this.sound(event.targetId===0?'hurt':'body',(event.targetId===0?.45:.28)*gain,pan,{priority:4});if(local)this.sound('hit',event.headshot?.18:.12,0,{priority:4});break;
   case 'impact':this.sound(event.surface==='metal'?'metal':event.surface==='crate'?'wood':event.surface==='character'?'body':'wall',.11*gain,pan,{cutoff:event.occluded?900:3800,priority:1});break;
   case 'kill':if(local)this.sound('kill',.19,0,{priority:5});break;
   case 'round':this.sound('round',.23,0,{priority:5});break;
   case 'bombTick':this.sound('tick',.24*gain,pan,{priority:4});break;
   case 'grenadeThrow':this.sound('pin',.22*gain,pan,{priority:3});break;
   case 'plantStart':case 'defuseStart':this.sound('gear',.22*gain,pan,{priority:3});this.sound('tick',.14*gain,pan,{delay:.2,priority:3});break;
   case 'plantComplete':case 'defuseComplete':case 'hostageRescued':this.sound('objective',.24,0,{priority:5});break;
   case 'hostageFollow':case 'hostageWait':case 'bombPickup':case 'bombDrop':this.sound('gear',.20*gain,pan,{priority:3});if(local)this.ui(event.type==='hostageWait'?'cancel':'confirm');break;
   case 'weaponPickup':this.sound('mechanism',.24*gain,pan,{priority:3});break;
   case 'buy':case 'roundReward':case 'respawn':if(local)this.ui('confirm');break;
  }
 }
 /** Spoken announcements are represented by existing HUD messages and event cues. */
 announce(_events:GameEvent[],_state:GameSnapshot):void{}
 ui(kind:'confirm'|'cancel'|'pause'):void{this.sound(kind==='confirm'?'confirm':'cancel',.19,0,{priority:5});}
 async test(profile:'all'|'snow-awp'='all'):Promise<void>{
  this.stop();const old=this.ctx;this.ctx=null;this.primer=null;if(old&&old.state!=='closed')void old.close().catch(()=>{});if(this.volume===0)this.setVolume(.6);
  await this.unlock();if(!this.ready())return;this.stop();this.auditionUntil=this.ctx!.currentTime+7;
  if(profile==='snow-awp'){
   for(let i=0;i<4;i++)this.sound((['snow1','snow2','snow3','snow4'] as const)[i],.30,i%2?.13:-.13,{delay:.1+i*.42,priority:4});
   this.shot('sniper',1,0,2.1);return;
  }
  for(let i=0;i<4;i++)this.sound((['step1','step2','step3','step4'] as const)[i],i<2?.34:.17,i%2? .65:-.65,{delay:.1+i*.38,cutoff:i<2?4200:2200,priority:4});
  this.sound('pistol',.55,0,{delay:1.8,priority:5});this.sound('rifle',.55,0,{delay:2.45,priority:5});this.sound('sniper',.65,0,{delay:3.1,priority:5});
  this.sound('magOut',.25,0,{delay:4.2,priority:4});this.sound('magIn',.30,0,{delay:4.6,priority:4});this.sound('bolt',.26,0,{delay:4.95,priority:4});this.sound('grenade',.60,0,{delay:5.55,priority:5});
 }
 status(){const muted=this.volume===0;let code='ready',label='声音播放已启动',detail='已开启脚步、分枪械音效与环境声；无声时可点“试听音效”重建声音。';
  if(!this.contextType()){code='unsupported';label='当前环境不支持声音';detail='可继续进行游戏。';}
  else if(muted){code='muted';label='声音已静音';detail='调整音量即可恢复。';}
  else if(!this.ctx){code='locked';label='轻触开启声音';detail='点击后开启战斗音效。';}
  else if(this.ctx.state!=='running'){code='interrupted';label='轻触恢复声音';detail=this.error||'从后台返回后，轻触页面恢复声音。';}
  else if(this.auditionUntil>this.ctx.currentTime){code='testing';label='正在试听音效';detail='左右脚步 → 手枪 / 步枪 / AWP → 换弹 → 爆炸';}
  else if(this.scene==='paused'){code='paused';label='声音已就绪';detail='战斗音效随游戏暂停。';}
  return {code,label,detail,needsGesture:code==='locked'||code==='interrupted',muted};
 }
 diagnostics(){
  let rms=0,peak=0;if(this.analyser&&typeof this.analyser.getFloatTimeDomainData==='function'){this.analyser.getFloatTimeDomainData(this.meterData);for(const value of this.meterData){rms+=value*value;peak=Math.max(peak,Math.abs(value));}rms=Math.sqrt(rms/this.meterData.length);this.peakOutput=Math.max(peak,this.peakOutput);}
  return {state:this.ctx?.state??'locked',supported:!!this.contextType(),ready:!!this.ctx,loading:false,scene:this.scene,hidden:this.hidden,activeSources:this.voices.size+this.releasing.size,releasingSources:this.releasing.size,stepVoices:Array.from(this.voices).filter(v=>v.step).length,loops:Array.from(this.voices).filter(v=>v.loop).map(v=>v.id),played:this.played,skipped:this.skipped,dropped:this.dropped,playedEvents:{...this.events},playedSounds:{...this.sounds},bankBuffers:this.bank.size,bankBytes:Array.from(this.bank.values()).reduce((n,b)=>n+b.getChannelData(0).byteLength,0),output:{rms,peak,peakObserved:this.peakOutput},volume:this.volume,procedural:true,voice:false,music:true,status:this.status(),errors:this.error?[this.error]:[]};
 }
}
