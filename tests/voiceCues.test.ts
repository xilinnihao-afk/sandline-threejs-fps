import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation} from '../src/game/simulation';
import {voiceCues,VoiceQueue,type VoiceCue} from '../src/render/voiceCues';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const cue=(id:VoiceCue['id'],priority=20,ttl=3):VoiceCue=>({id,priority,ttl,key:id,cooldown:5});
test('defuse and victory are ordered once; six economy rewards do not speak',()=>{
 const sim=new Simulation(1);sim.start();sim.state.phase='roundEnd';sim.state.winner='blue';
 const cues=voiceCues([{type:'defuseComplete'},...sim.state.actors.map(a=>({type:'roundReward' as const,actorId:a.id})),{type:'round'}],sim.state);
 assert.deepEqual(cues.map(c=>c.id),['defused','round-win']);const queue=new VoiceQueue();queue.enqueue(cues,0);queue.enqueue(cues,.01);
 assert.equal(queue.queued,2);assert.equal(queue.next(0)?.id,'defused');queue.complete();assert.equal(queue.next(2)?.id,'round-win');
});
test('outcomes follow player team, and match end uses its own announcement',()=>{
 const sim=new Simulation(1);sim.start();sim.state.phase='matchEnd';sim.state.winner='red';
 assert.equal(voiceCues([{type:'round'}],sim.state)[0].id,'match-loss');sim.state.player.team='red';assert.equal(voiceCues([{type:'round'}],sim.state)[0].id,'match-win');
});
test('only nearby friendly grenade throws and friendly defuse starts speak',()=>{
 const sim=new Simulation(1);sim.start();const s=sim.state;s.actors[1].x=s.player.x;s.actors[1].z=s.player.z;
 assert.deepEqual(voiceCues([{type:'grenadeThrow',actorId:3},{type:'defuseStart',actorId:3},{type:'grenadeThrow',actorId:1}],s).map(c=>c.id),['grenade']);s.actors[1].x=100;assert.equal(voiceCues([{type:'grenadeThrow',actorId:1}],s).length,0);
});
test('important outcomes interrupt chatter, queued chatter expires, and reset clears all',()=>{
 const q=new VoiceQueue();q.enqueue([cue('grenade')],0);q.next(0);assert.equal(q.enqueue([cue('match-win',90)],.1),true);assert.equal(q.next(.1)?.id,'match-win');q.complete();
 q.enqueue([cue('defusing',40,1)],1);assert.equal(q.next(3),null);q.enqueue([cue('defused',100)],4);q.reset();assert.equal(q.next(4),null);assert.equal(q.current,null);
});
test('assets still loading wait within their TTL rather than losing an immediate start event',()=>{
 const q=new VoiceQueue();q.enqueue([cue('round-start',30,2)],0);assert.equal(q.next(.1,()=>false),null);assert.equal(q.next(1,()=>true)?.id,'round-start');
 q.reset();q.enqueue([cue('grenade',20,1)],0);assert.equal(q.next(2,()=>true),null);
});
test('all voice assets are non-clipping PCM with recorded provenance and matching checksums',()=>{
 const base='public/assets/audio/voice/';const manifest=JSON.parse(readFileSync(base+'manifest.json','utf8'));
 assert.equal(manifest.length,10);
 for(const item of manifest){const file=readFileSync(base+item.file);assert.equal(file.toString('ascii',0,4),'RIFF');assert.equal(file.toString('ascii',8,12),'WAVE');assert.equal(createHash('sha256').update(file).digest('hex'),item.sha256);assert.ok(item.duration>.3&&item.duration<5);assert.ok(item.peak<.9&&item.rms>.03);}
});
