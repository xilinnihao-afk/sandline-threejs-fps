"""Original, seeded short impact Foley synthesis; no speech or borrowed audio."""
import math,random,wave,struct,json
from pathlib import Path
root=Path(__file__).resolve().parents[1];out=root/'public/assets/audio';rate=44100
records=[]
for variant in range(4):
 rng=random.Random(490+variant);hurt=variant==3;duration=.28 if hurt else .19+variant*.012;values=[];low=0;phase=0
 for i in range(int(rate*duration)):
  t=i/rate;n=rng.uniform(-1,1);low+=.19*(n-low)
  # Cloth/skin slap, brief textured secondary impacts, and a damped chest thud.
  attack=min(1,t/.0015);freq=(105 if hurt else 145+variant*12)*math.exp(-t*4)
  phase+=2*math.pi*freq/rate
  thud=math.sin(phase)*math.exp(-t/(.053 if hurt else .032))
  slap=low*math.exp(-t/.025)*1.1
  wet=sum(math.exp(-((t-c)/.006)**2) for c in [.013,.031,.047])*low*.3
  tail=low*.16*math.exp(-t/.07)
  values.append(attack*(thud*.62+slap+wet+tail)*min(1,(duration-t)/.02))
 peak=max(map(abs,values));values=[v/peak*.72 for v in values]
 name='hurt-body-v1' if hurt else f'body-hit-{variant+1}-v1'
 with wave.open(str(out/(name+'.wav')),'wb') as f:
  f.setnchannels(1);f.setsampwidth(2);f.setframerate(rate);f.writeframes(b''.join(struct.pack('<h',round(v*32767)) for v in values))
 records.append({'id':name,'duration':duration,'source':'Original procedural synthesis','peak':.72})
(root/'artifacts/hit-feedback-local/audio-provenance.json').write_text(json.dumps(records,indent=2))
print(json.dumps(records))
