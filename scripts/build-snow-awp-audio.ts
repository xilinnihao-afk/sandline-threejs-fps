import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {enhanceSniperShot,renderSnowStep} from '../src/render/combatSoundDesign';
const rate=32000,root='public/assets/audio',out='artifacts/snow-awp-audio-20261028';mkdirSync(out,{recursive:true});
function read(name:string){const b=readFileSync(`${root}/${name}.wav`);if(b.readUInt32LE(24)!==rate||b.readUInt16LE(22)!==1)throw Error('Expected mono 32 kHz PCM');return Float32Array.from({length:(b.length-44)/2},(_,i)=>b.readInt16LE(44+i*2)/32768);}
function wav(data:Float32Array){
 const b=Buffer.alloc(44+data.length*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(data.length*2,40);
 for(let i=0;i<data.length;i++)b.writeInt16LE(Math.round(Math.max(-1,Math.min(1,data[i]))*32767),44+i*2);return b;
}
const rms=(data:Float32Array)=>Math.sqrt(data.reduce((s,x)=>s+x*x,0)/Math.max(1,data.length));
function metrics(data:Float32Array){let low=0;const bass=Float32Array.from(data,x=>low+=(1-Math.exp(-2*Math.PI*220/rate))*(x-low));return {duration:data.length/rate,peak:data.reduce((p,x)=>Math.max(p,Math.abs(x)),0),rms:rms(data),attackRms:rms(data.slice(0,rate*.2)),bassRms:rms(bass.slice(0,rate*.5)),tailRms:rms(data.slice(rate,rate*2.8)),lastSecondRms:rms(data.slice(rate*2.2))};}
const manifest=JSON.parse(readFileSync(`${root}/manifest.json`,'utf8')),report:Record<string,unknown>={};
function save(id:string,data:Float32Array,source:string,processing:string){
 const bytes=wav(data);writeFileSync(`${root}/${id}.wav`,bytes);const after=metrics(read(id));report[id]=after;
 manifest.assets=manifest.assets.filter((a:{id:string})=>a.id!==id);
 manifest.assets.push({id,file:id+'.wav',source,processing,format:'mono PCM16 WAV',sampleRate:rate,seconds:after.duration,bytes:bytes.length,peak:after.peak,rms:after.rms,clippedSamples:0,loop:false,sha256:createHash('sha256').update(bytes).digest('hex')});
}
for(let i=0;i<4;i++)save(`step-snow-${i+1}-v1`,renderSnowStep(i,rate),'Original deterministic project-owned snow Foley; no recordings or external generation','Heel pressure, granular snow compression, irregular crust grains and powder release; four independent seeded variants');
save('sniper-shot-v4',enhanceSniperShot(read('sniper-shot-v2'),rate),'Existing sniper-shot-v2.wav; Michel Baradari / OpenGameArt, CC BY 3.0 + original project sound design','Preserved muzzle attack; 300 Hz low-mid body; 183→68 Hz pressure with harmonics; diffuse rumble; five darkening reflections at 0.14/0.33/0.59/0.94/1.37 s; soft saturation; 0.78 peak ceiling; 3.2 s tail');
report.beforeAWP=metrics(read('sniper-shot-v3'));
manifest.assetCount=manifest.assets.length;manifest.totalBytes=manifest.assets.reduce((n:number,a:{bytes:number})=>n+a.bytes,0);
writeFileSync(`${root}/manifest.json`,JSON.stringify(manifest,null,2)+'\n');writeFileSync(`${out}/audio-assets.json`,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
