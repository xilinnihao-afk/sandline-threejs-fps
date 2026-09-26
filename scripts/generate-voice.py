#!/usr/bin/env python3
"""Generate short English callouts with local macOS synthesis, never a runtime API.
Requires macOS say/afconvert and the named installed voice. Source recordings stay
in artifacts/voice-source; processed PCM files and provenance ship with the game.
"""
from pathlib import Path
import subprocess, wave, math, json, hashlib
from array import array
ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'artifacts/voice-source-en-v1'; OUT=ROOT/'public/assets/audio/voice'
VOICE='Daniel'
RATE_WPM=185
LINES={
 'grenade':'Frag out!',
 'planted':'Bomb planted.',
 'defusing':'Defusing. Cover me.',
 'defused':'Bomb defused.',
 'round-start':"Move out!",
 'round-win':'Round won.',
 'round-loss':'Round lost.',
 'round-draw':'Round over.',
 'match-win':'Mission accomplished.',
 'match-loss':'Mission failed.',
}
SOURCE.mkdir(parents=True,exist_ok=True);OUT.mkdir(parents=True,exist_ok=True)
manifest=[]
for name,text in LINES.items():
 raw=SOURCE/(name+'.wav')
 if not raw.exists():
  subprocess.run(['say','-v',VOICE,'-r',str(RATE_WPM),'-o',str(SOURCE/(name+'.aiff')),text],check=True)
  subprocess.run(['afconvert',str(SOURCE/(name+'.aiff')),str(raw),'-f','WAVE','-d','LEI16@22050'],check=True)
 with wave.open(str(raw),'rb') as w:
  rate=w.getframerate();channels=w.getnchannels();assert w.getsampwidth()==2
  pcm=array('h',w.readframes(w.getnframes()))
 samples=[sum(pcm[i:i+channels])/(32768*channels) for i in range(0,len(pcm),channels)]
 # Trim only leading/trailing silence, retaining consonant and breath margins.
 audible=[i for i,x in enumerate(samples) if abs(x)>.009]
 assert audible
 samples=samples[max(0,audible[0]-int(rate*.045)):min(len(samples),audible[-1]+int(rate*.09))]
 hp_alpha=1/(1+2*math.pi*230/rate);lp_alpha=1-math.exp(-2*math.pi*4300/rate)
 last=hp=lp=0.; processed=[]
 for x in samples:
  hp=hp_alpha*(hp+x-last);last=x;lp+=lp_alpha*(hp-lp)
  processed.append(math.tanh(lp*1.5))
 scale=.82/max(abs(x) for x in processed);fade=int(rate*.008)
 result=array('h',(round(x*scale*min(1,i/fade,(len(processed)-1-i)/fade)*32767) for i,x in enumerate(processed)))
 path=OUT/(name+'.wav')
 with wave.open(str(path),'wb') as w:
  w.setnchannels(1);w.setsampwidth(2);w.setframerate(rate);w.writeframes(result.tobytes())
 manifest.append({'id':name,'text':text,'file':name+'.wav','voice':VOICE,'generator':'macOS say; local synthesis, not ElevenLabs','language':'en-GB','rate_wpm':RATE_WPM,'sample_rate':rate,'duration':round(len(result)/rate,3),'peak':max(abs(x) for x in result)/32768,'rms':round(math.sqrt(sum((x/32768)**2 for x in result)/len(result)),4),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'processing':'230Hz highpass, 4300Hz lowpass, soft saturation, normalized peak 0.82, 8ms edge fades'})
(OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
print(json.dumps({'clips':len(manifest),'bytes':sum(p.stat().st_size for p in OUT.glob('*.wav')),'durations':{m['id']:m['duration'] for m in manifest}},ensure_ascii=False))
