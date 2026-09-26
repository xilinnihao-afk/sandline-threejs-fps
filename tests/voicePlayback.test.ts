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
 audio.groups={voice:node(),ambience:node(),music:node()};
 for(const id of VOICE_IDS)audio.buffers.set(`voice/${id}`,{duration:1});
 audio.setScene('combat');const sim=new Simulation(1);sim.start();
 return {audio,state:sim.state,listeners};
}
test('voice ducks only ambience/music and restores them on completion',()=>{
 const {audio,state}=fixture();audio.announce([{type:'grenadeThrow',actorId:0}],state);
 assert.equal(audio.voiceQueue.current.id,'grenade');assert.equal(audio.groups.ambience.gain.value,.4);assert.equal(audio.groups.music.gain.value,.275);
 audio.voiceSource.source.onended();assert.equal(audio.voiceQueue.current,null);assert.equal(audio.groups.ambience.gain.value,.8);assert.equal(audio.groups.music.gain.value,.55);
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
