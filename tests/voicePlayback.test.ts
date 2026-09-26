import test from 'node:test';
import assert from 'node:assert/strict';
import {GameAudio} from '../src/render/audio';
import {Simulation} from '../src/game/simulation';
import {VOICE_IDS} from '../src/render/voiceCues';
function fixture(){
 const listeners:Record<string,()=>void>={};
 (globalThis as any).document={hidden:false,addEventListener:(name:string,fn:()=>void)=>{listeners[name]=fn;}};
 (globalThis as any).window={addEventListener:()=>{}};
 const param=()=>({value:1,cancelScheduledValues(){},setTargetAtTime(v:number){this.value=v;},setValueAtTime(v:number){this.value=v;}});
 const node=()=>({connect(){return this;},disconnect(){},gain:param(),frequency:param(),playbackRate:param(),pan:param(),onended:null as null|(()=>void),start(){},stopped:false,stop(){this.stopped=true;}});
 const audio=new GameAudio() as any;
 audio.ctx={state:'running',currentTime:0,createBufferSource:node,createGain:node,createBiquadFilter:node,createStereoPanner:node,suspend(){this.state='suspended';return Promise.resolve();}};
 audio.groups={voice:node(),ambience:node(),music:node(),sfx:node()};
 for(const id of VOICE_IDS)audio.buffers.set(`voice/${id}`,{duration:1});
 audio.setScene('combat');const sim=new Simulation(1);sim.start();
 return {audio,state:sim.state,listeners};
}
test('voice ducks only ambience/music and restores them on completion',()=>{
 const {audio,state}=fixture();audio.announce([{type:'grenadeThrow',actorId:0}],state);
 assert.equal(audio.voiceQueue.current.id,'grenade');assert.equal(audio.groups.ambience.gain.value,.14);assert.equal(audio.groups.music.gain.value,.09);
 audio.voiceSource.source.onended();assert.equal(audio.voiceQueue.current,null);assert.equal(audio.groups.ambience.gain.value,.28);assert.equal(audio.groups.music.gain.value,.18);
});
test('pause and mute immediately stop speech and discard pending announcements',()=>{
 const {audio,state}=fixture();state.phase='roundEnd';state.winner='blue';audio.announce([{type:'defuseComplete'},{type:'round'}],state);
 const source=audio.voiceSource.source;assert.equal(audio.voiceQueue.queued,1);audio.setScene('paused');assert.equal(source.stopped,true);assert.equal(audio.voiceQueue.queued,0);assert.equal(audio.voiceSource,null);
 audio.setScene('combat');audio.announce([{type:'grenadeThrow',actorId:0}],state);const second=audio.voiceSource.source;audio.setVolume(0);assert.equal(second.stopped,true);audio.announce([{type:'round'}],state);assert.equal(audio.voiceSource,null);
});
test('background discards queued speech without replay on return',()=>{
 const {audio,state,listeners}=fixture();state.phase='roundEnd';state.winner='blue';audio.announce([{type:'defuseComplete'},{type:'round'}],state);
 const source=audio.voiceSource.source;(globalThis as any).document.hidden=true;listeners.visibilitychange();
 assert.equal(source.stopped,true);assert.equal(audio.voiceQueue.queued,0);assert.equal(audio.voiceSource,null);assert.equal(audio.ctx.state,'suspended');
});

test('combat removes menu music and dense beds while footsteps stay above wind',()=>{
 const {audio,state}=fixture();
 for(const id of ['wind','city-bed','tension-bed','menu-score','step-1','step-2','step-3','step-4'])audio.buffers.set(id,{duration:1});
 audio.setScene('menu');const menuMusic=audio.loops.get('menu-score');assert.ok(menuMusic);
 audio.setScene('combat');assert.equal(menuMusic.source.stopped,true);
 assert.deepEqual([...audio.loops.keys()],['wind']);
 audio.play({type:'step',actorId:0},0,.4);
 const step=[...audio.live].find((s:any)=>s.asset.startsWith('step-')) as any;
 assert.ok(step);assert.ok(step.nodes[2].gain.value>audio.loops.get('wind').nodes[2].gain.value*3);
 const stepLevel=step.nodes[2].gain.value;
 audio.announce([{type:'grenadeThrow',actorId:0}],state);
 assert.equal(audio.groups.sfx.gain.value,1);assert.equal(step.nodes[2].gain.value,stepLevel);
 audio.voiceSource.source.onended();
 assert.equal(audio.groups.ambience.gain.value,.28);assert.equal(audio.groups.music.gain.value,.18);
});
