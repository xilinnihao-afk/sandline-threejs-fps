import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {GameAudio} from '../src/render/audio';

const assets=['sniper-shot-v4','sniper-hit-v2','grenade-explosion-v2','bomb-explosion-v3',
  'rifle-shot','shot-tail','weapon-mech','reload-bolt','shell-1','shell-2','impact',
  'grenade-distant','hurt-body-v1','body-hit-1-v1','body-hit-2-v1','body-hit-3-v1','hit',
  'step-1','step-2','step-3','step-4','step-snow-1-v1','step-snow-2-v1','step-snow-3-v1','step-snow-4-v1'];

function fixture(){
  const listeners:Record<string,()=>void>={};
  (globalThis as any).document={hidden:false,addEventListener:(name:string,fn:()=>void)=>listeners[name]=fn};
  (globalThis as any).window={addEventListener:()=>{}};
  const param=()=>({value:1,cancelScheduledValues(){},setTargetAtTime(v:number){this.value=v;},setValueAtTime(v:number){this.value=v;}});
  const node=()=>({connect(){return this;},disconnect(){},gain:param(),frequency:param(),playbackRate:param(),pan:param(),
    onended:null as null|(()=>void),start(){},stopped:false,stop(){this.stopped=true;}});
  const audio=new GameAudio() as any;
  audio.ctx={state:'running',currentTime:1,createBufferSource:node,createGain:node,createBiquadFilter:node,createStereoPanner:node,
    suspend(){this.state='suspended';return Promise.resolve();}};
  audio.groups={sfx:node(),ui:node(),voice:node(),ambience:node(),music:node()};
  for(const id of assets)audio.buffers.set(id,{duration:1});
  audio.setScene('combat');
  return {audio,listeners};
}
function source(audio:any,id:string):any {return [...audio.live].find((s:any)=>s.asset===id);}

test('snow footsteps alternate variants, keep their compression tail and retain cover/crouch attenuation',()=>{
 const {audio}=fixture();
 for(let i=0;i<4;i++){audio.ctx.currentTime=1+i*.42;audio.play({type:'step',actorId:0,stepSurface:'snow'});assert.ok(source(audio,`step-snow-${i+1}-v1`));}
 assert.equal(audio.assetCounts['step-1'],undefined);
 const snow=source(audio,'step-snow-4-v1');assert.ok(snow.stepEndsAt-audio.ctx.currentTime>.3);
 const {audio:ground}=fixture();ground.play({type:'step',actorId:0,stepSurface:'ground'});assert.ok(source(ground,'step-1'));assert.equal(source(ground,'step-snow-1-v1'),undefined);
 const {audio:near}=fixture();near.play({type:'step',actorId:1,stepSurface:'snow'},3);
 const {audio:covered}=fixture();covered.play({type:'step',actorId:1,stepSurface:'snow',crouched:true,occluded:true},3);
 assert.ok(source(covered,'step-snow-2-v1').stepStrength<source(near,'step-snow-2-v1').stepStrength*.08);
 assert.equal(source(covered,'step-snow-2-v1').nodes[1].frequency.value,900);
 near.setScene('paused');assert.equal(near.live.size,0);
});

test('AWP v4 strengthens body and outdoor decay relative to v3 without raising the peak ceiling',()=>{
 const read=(id:string)=>{const b=readFileSync(`public/assets/audio/${id}.wav`);return Float32Array.from({length:(b.length-44)/2},(_,i)=>b.readInt16LE(44+2*i)/32768);};
 const rms=(a:Float32Array)=>Math.sqrt(a.reduce((s,x)=>s+x*x,0)/a.length);
 const bass=(a:Float32Array)=>{let y=0;return Float32Array.from(a,x=>y+=(1-Math.exp(-2*Math.PI*220/32000))*(x-y));};
 const before=read('sniper-shot-v3'),after=read('sniper-shot-v4');
 assert(rms(after.slice(0,6400))>rms(before.slice(0,6400))*1.05);
 assert(rms(bass(after).slice(0,16000))>rms(bass(before).slice(0,16000))*1.15);
 assert(rms(after.slice(32000,89600))>rms(before.slice(32000,89600))*2);
 assert(after.every(x=>Math.abs(x)<=.78));assert.equal(after[0],0);assert.equal(after.at(-1),0);
});

test('sniper uses authored transient/tail without stacked rifle and shotgun voices',()=>{
  const {audio}=fixture();audio.play({type:'shot',weapon:'sniper'},0,.6);
  const shot=source(audio,'sniper-shot-v4');assert.ok(shot);
  assert.equal(source(audio,'rifle-shot'),undefined);assert.equal(source(audio,'shot-tail'),undefined);
  assert.equal(shot.nodes[3].pan.value,.6);
  assert.ok(source(audio,'reload-bolt').startsAt>shot.startsAt);
});

test('sniper body impacts remain audible at useful range, obey cooldown, and retain incoming cue',()=>{
  const {audio}=fixture();audio.play({type:'hit',weapon:'sniper',actorId:0,targetId:3},25,.4);
  assert.ok(source(audio,'sniper-hit-v2'));assert.equal(audio.assetCounts['sniper-hit-v2'],1);
  audio.play({type:'hit',weapon:'sniper',actorId:0,targetId:3},25,.4);
  assert.equal(audio.assetCounts['sniper-hit-v2'],1);
  audio.play({type:'hit',weapon:'sniper',actorId:3,targetId:0},0,-.5);
  assert.ok(source(audio,'hurt-body-v1'));assert.equal(audio.assetCounts['sniper-hit-v2'],2);
  audio.ctx.currentTime=2;audio.play({type:'hit',weapon:'sniper',actorId:4,targetId:5},31,0);
  assert.equal(audio.assetCounts['sniper-hit-v2'],2);
});

test('bomb and grenade blasts differ while sound propagation, occlusion and stereo agree',()=>{
  const {audio}=fixture();audio.play({type:'explosion'},12,.8);
  const grenade=source(audio,'grenade-explosion-v2');assert.ok(grenade);
  assert.ok(Math.abs(grenade.startsAt-(1+12/343))<1e-8);
  const openGain=grenade.nodes[2].gain.value;
  const {audio:covered}=fixture();covered.play({type:'explosion',occluded:true},12,.8);
  const blocked=source(covered,'grenade-explosion-v2');
  assert.ok(blocked.nodes[2].gain.value<openGain*.43);
  assert.equal(blocked.nodes[1].frequency.value,1100);
  audio.play({type:'bombExplode'},12,-.8);const bomb=source(audio,'bomb-explosion-v3');
  assert.ok(bomb);assert.equal(bomb.nodes[3].pan.value,-.8);
  assert.ok(bomb.nodes[2].gain.value>openGain);
});

test('heavy sounds respect source budget and are stopped on pause/background',()=>{
  const {audio,listeners}=fixture();
  for(let i=0;i<35;i++)audio.play({type:i%2?'bombExplode':'explosion'},4,.3);
  assert.ok(audio.live.size<=48);
  const playing=[...audio.live] as any[];audio.setScene('paused');
  assert.equal(audio.live.size,0);assert.ok(playing.every(s=>s.source.stopped));
  audio.setScene('combat');audio.play({type:'shot',weapon:'sniper'},0,0);
  const shot=source(audio,'sniper-shot-v4');(globalThis as any).document.hidden=true;listeners.visibilitychange();
  assert.equal(shot.source.stopped,true);assert.equal(audio.live.size,0);
});

test('new PCM masters have headroom, no clicks at boundaries and a meaningful bass body',()=>{
  for(const name of assets.slice(0,4)){
    const wav=readFileSync(`public/assets/audio/${name}.wav`);
    assert.equal(wav.toString('ascii',0,4),'RIFF');assert.equal(wav.readUInt32LE(24),32000);
    const pcm=Array.from({length:(wav.length-44)/2},(_,i)=>wav.readInt16LE(44+i*2)/32768);
    assert.ok(pcm.every(v=>Number.isFinite(v)&&Math.abs(v)<.83));
    assert.equal(pcm[0],0);assert.equal(pcm.at(-1),0);
    let low=0,bassPower=0,total=0;
    for(const value of pcm.slice(0,6400)){low+=.035*(value-low);bassPower+=low*low;total+=value*value;}
    assert.ok(bassPower/total>.04,`${name}: missing low-frequency body`);
    assert.ok(total/6400>.005,`${name}: empty attack`);
  }
  const bomb=readFileSync('public/assets/audio/bomb-explosion-v3.wav');
  let tailEnergy=0;
  for(let i=44+2*32000;i<bomb.length;i+=2)tailEnergy+=(bomb.readInt16LE(i)/32768)**2;
  assert.ok(tailEnergy/32000>.001,'bomb must have an audible decay beyond its first second');
});


test('v3 AWP and planted bomb add attack density, bass and distant decay with PCM headroom',()=>{
 const pcm=(name:string)=>{const b=readFileSync(`public/assets/audio/${name}.wav`);return Array.from({length:(b.length-44)/2},(_,i)=>b.readInt16LE(44+i*2)/32768);};
 const rms=(a:number[])=>Math.sqrt(a.reduce((sum,v)=>sum+v*v,0)/Math.max(1,a.length));
 const bass=(a:number[])=>{let low=0;return a.map(x=>low+=(1-Math.exp(-2*Math.PI*220/32000))*(x-low));};
 for(const name of ['sniper-shot','bomb-explosion']){
  const old=pcm(name+'-v2'),next=pcm(name+'-v3');
  assert.ok(next.length>old.length*1.3,'room reflections need time to decay');
  assert.ok(Math.max(...next.map(Math.abs).slice(0,64000))<=.78);
  assert.ok(next.every(v=>Math.abs(v)<=.78));
  assert.ok(rms(next.slice(0,6400))>rms(old.slice(0,6400))*1.04,'attack should be denser');
  assert.ok(rms(bass(next).slice(0,16000))>rms(bass(old).slice(0,16000))*1.10,'bass body should gain weight');
  assert.ok(rms(next.slice(32000))>rms(old.slice(32000))*1.4,'audible reflection decay should grow');
  assert.equal(next[0],0);assert.equal(next.at(-1),0);
 }
 const {audio}=fixture();audio.play({type:'shot',weapon:'sniper'});
 assert.ok(source(audio,'sniper-shot-v4').nodes[2].gain.value>1.02);
 audio.play({type:'bombExplode'});
 assert.ok(source(audio,'bomb-explosion-v3').nodes[2].gain.value>1.10);
 const {audio:grenade}=fixture();grenade.play({type:'explosion'});
 assert.equal(source(grenade,'grenade-explosion-v2').nodes[2].gain.value,.97);
 assert.equal(source(grenade,'bomb-explosion-v3'),undefined);
});

test('close-range heavy event layers retain headroom before the master compressor',()=>{
 const buffers=new Map<string,{values:number[];rate:number}>();
 const read=(id:string)=>{
  if(!buffers.has(id)){
   const b=readFileSync(`public/assets/audio/${id}.wav`);
   buffers.set(id,{rate:b.readUInt32LE(24),values:Array.from({length:(b.length-44)/2},(_,i)=>b.readInt16LE(44+i*2)/32768)});
  }
  return buffers.get(id)!;
 };
 for(const type of ['shot','bombExplode'] as const)for(let variant=0;variant<14;variant++){
  const {audio}=fixture();audio.variants=variant;audio.play({type,weapon:'sniper'});
  const mix=new Float64Array(32000*6);
  for(const source of audio.live as Set<any>){
   const pcm=read(source.asset),speed=source.source.playbackRate.value;
   const start=Math.round((source.startsAt-audio.ctx.currentTime)*32000),gain=source.nodes[2].gain.value;
   for(let i=0;i<Math.min(mix.length-start,Math.floor(pcm.values.length*32000/pcm.rate/speed));i++){
    const position=i*pcm.rate/32000*speed,index=Math.floor(position),fraction=position-index;
    mix[start+i]+=(pcm.values[index]*(1-fraction)+pcm.values[Math.min(index+1,pcm.values.length-1)]*fraction)*gain;
   }
  }
  let peak=0;for(const value of mix)peak=Math.max(peak,Math.abs(value));
  // Conservative dry summation: no low-pass attenuation, stereo panning,
  // saved master volume reduction or downstream compressor is applied.
  assert.ok(peak<.99,`${type} variation ${variant} has unsafe summed peak ${peak}`);
 }
});
