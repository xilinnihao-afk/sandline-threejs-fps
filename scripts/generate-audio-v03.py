#!/usr/bin/env python3
"""Build Sandline v0.3 audio from attributed v0.2 sources and original sound design.

Uses only the Python standard library. No API calls or hidden runtime synthesis.
Original recordings: Michel Baradari (CC BY 3.0), SpringySpringo (CC0).
Run: python3 scripts/generate-audio-v03.py --source-dir /private/tmp/sandline-audio-source
Use --download to retrieve the small licensed source packages on a fresh machine.
"""
from __future__ import annotations
import argparse
from array import array
import hashlib
import json
import math
from pathlib import Path
import random
import subprocess
import sys
import tempfile
import wave

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/assets/audio'
RATE = 32000
SOURCES = {
    'shots.7z': 'https://opengameart.org/sites/default/files/shots.7z',
    'explosions.7z': 'https://opengameart.org/sites/default/files/explosions.7z',
    'rifle-reload.wav': 'https://opengameart.org/sites/default/files/assaultriflereload1_0.wav',
    'pistol-reload.wav': 'https://opengameart.org/sites/default/files/gunreload1.wav',
    'shotgun-cock.wav': 'https://opengameart.org/sites/default/files/shotguncock_0.wav',
}
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--download', action='store_true')
parser.add_argument('--source-dir', type=Path, default=Path(tempfile.gettempdir()) / 'sandline-audio-source')
args = parser.parse_args()
cache = args.source_dir
if args.download:
    cache.mkdir(parents=True, exist_ok=True)
    for name, url in SOURCES.items():
        target = cache / name
        subprocess.run(['curl', '--fail', '-L', '--max-time', '90', url, '-o', str(target)], check=True)
        if name.endswith('.7z'):
            subprocess.run(['tar', '-xf', str(target), '-C', str(cache)], check=True)


def read(path):
    with wave.open(str(path), 'rb') as wav:
        assert wav.getsampwidth() == 2, f'Expected PCM16: {path}'
        data = array('h', wav.readframes(wav.getnframes()))
        if sys.byteorder != 'little':
            data.byteswap()
        channels, sample_rate = wav.getnchannels(), wav.getframerate()
    mono = [sum(data[i:i + channels]) / (32768 * channels) for i in range(0, len(data), channels)]
    return resample(mono, sample_rate / RATE)


def resample(values, speed):
    result = []
    for i in range(round(len(values) / speed)):
        at = min(len(values) - 1, i * speed)
        lo = int(at)
        result.append(values[lo] + (values[min(lo + 1, len(values) - 1)] - values[lo]) * (at - lo))
    return result


def clip(values, start=0, end=None):
    return values[round(start * RATE):round(end * RATE) if end is not None else None]


def lowpass(values, cutoff):
    alpha = 1 - math.exp(-2 * math.pi * cutoff / RATE)
    state, result = 0., []
    for value in values:
        state += alpha * (value - state)
        result.append(state)
    return result


def band(values, low, high):
    upper = lowpass(values, high)
    lower = lowpass(upper, low)
    return [a - b for a, b in zip(upper, lower)]


def mix(*layers, duration=None):
    result = [0.] * (round(duration * RATE) if duration else max(len(v) + round(t * RATE) for v, t, _ in layers))
    for values, t, amplitude in layers:
        offset = round(t * RATE)
        for i, value in enumerate(values[:max(0, len(result) - offset)]):
            result[offset + i] += value * amplitude
    return result


def transient(seed, duration, body=160, decay=.055):
    rng = random.Random(seed)
    noise = [rng.uniform(-1, 1) for _ in range(round(duration * RATE))]
    low, mids = lowpass(noise, body), band(noise, 500, 7000)
    return [(low[i] * 2.7 + mids[i] * .36) * math.exp(-i / RATE / decay) for i in range(len(noise))]


def foley(seed, duration=.22, gravel=True):
    rng = random.Random(seed)
    noise = [rng.uniform(-1, 1) for _ in range(round(duration * RATE))]
    low, grit = lowpass(noise, 330), band(noise, 1400, 5800)
    contacts = [(rng.uniform(.018, duration * .75), rng.uniform(.003, .017), rng.uniform(.15, .42)) for _ in range(9)]
    result = []
    for i, n in enumerate(noise):
        t = i / RATE
        value = (low[i] * 3.4 + grit[i] * .34) * math.exp(-t / .040)
        for at, decay, amplitude in contacts:
            if t >= at:
                value += (grit[i] if gravel else low[i]) * amplitude * math.exp(-(t - at) / decay)
        result.append(value)
    return result


def metallic(seed, duration=.48):
    rng = random.Random(seed)
    modes = [(rng.uniform(2100, 6500), rng.uniform(.11, .27), rng.uniform(.018, .052)) for _ in range(8)]
    bounces = [(0., 1.), (.086, .52), (.197, .23), (.298, .11)]
    noise = [rng.uniform(-1, 1) for _ in range(round(duration * RATE))]
    result = []
    for i, n in enumerate(noise):
        t = i / RATE
        value = 0.
        for at, amp in bounces:
            x = t - at
            if x >= 0:
                value += n * .23 * math.exp(-x / .004) * amp
                value += sum(math.sin(2 * math.pi * freq * x) * level * math.exp(-x / decay) for freq, level, decay in modes) * amp
        result.append(value)
    return result


def periodic_noise(seed, seconds, low, high):
    rng = random.Random(seed)
    noise = [rng.uniform(-1, 1) for _ in range(round(seconds * RATE))]
    # Warm-up with a complete identical cycle: filter state is periodic at wrap.
    filtered = band(noise + noise, low, high)[len(noise):]
    return filtered


def normalize(values, peak=.90, rms=None):
    values = list(values)
    mean = sum(values) / len(values)
    values = [v - mean for v in values]
    scale = peak / max(.000001, max(abs(v) for v in values))
    if rms is not None:
        scale = min(scale, rms / max(.000001, math.sqrt(sum(v*v for v in values) / len(values))))
    return [v * scale for v in values]


metadata = []


def write(name, values, origin, peak=.9, loop=False, stereo=False, tail=.035, notes=''):
    channels = values if stereo else [values]
    output_rate = 24000 if loop else RATE
    prepared = []
    for channel in channels:
        data = normalize(channel, peak)
        if loop:
            # Tiny periodic seam correction avoids a click without fading the bed to silence.
            width = round(RATE * .015)
            delta = data[-1] - data[0]
            for i in range(width):
                data[len(data) - width + i] -= delta * (i / (width - 1))
            data[-1] = data[0]
        else:
            for i in range(len(data)):
                data[i] *= max(0., min(1., i / (RATE * .0005), (len(data) - i - 1) / (RATE * tail)))
        if output_rate != RATE:
            data = resample(data, RATE / output_rate)
            if loop:
                data[-1] = data[0]
        prepared.append(data)
    length = min(len(x) for x in prepared)
    interleaved = [prepared[c][i] for i in range(length) for c in range(len(prepared))]
    # A global safety scaling protects loop seam correction from clipping.
    maximum = max(abs(v) for v in interleaved)
    if maximum > .96:
        interleaved = [v * .96 / maximum for v in interleaved]
    raw = array('h', (round(v * 32767) for v in interleaved))
    if sys.byteorder != 'little':
        raw.byteswap()
    path = OUT / (name + '.wav')
    with wave.open(str(path), 'wb') as wav:
        wav.setnchannels(len(prepared)); wav.setsampwidth(2); wav.setframerate(output_rate); wav.writeframes(raw.tobytes())
    rms = math.sqrt(sum(v*v for v in interleaved) / len(interleaved))
    metadata.append({
        'id':name, 'file':path.name, 'source':origin, 'processing':notes,
        'format':f'{"stereo" if stereo else "mono"} PCM16 WAV', 'sampleRate':output_rate,
        'seconds':round(length / output_rate, 4), 'bytes':path.stat().st_size,
        'peak':round(max(abs(v) for v in interleaved), 6), 'rms':round(rms, 6),
        'clippedSamples':sum(abs(v) >= .999 for v in interleaved), 'loop':loop,
        'loopBoundaryDifference':max(abs(x[0] - x[-1]) for x in prepared) if loop else None,
        'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
    })


OUT.mkdir(parents=True, exist_ok=True)
shots = {name:read(cache / 'shots' / (name + '.wav')) for name in ['rifle','pistol','cg1','shotgun']}
rifle = read(cache / 'rifle-reload.wav')
pistol = read(cache / 'pistol-reload.wav')
pump = read(cache / 'shotgun-cock.wav')
shot_credit = 'Michel Baradari (apollo-music.de), OpenGameArt, CC BY 3.0 + original project sound design'
reload_credit = 'SpringySpringo, OpenGameArt Gun reload sounds, CC0 1.0; airsoft mechanical recordings'
original_credit = 'Original deterministic offline sound design for Sandline; project-owned'

# The licensed report stays the recognisable core; tuned body/transient layers
# improve definition on phone speakers without relying on inaudible sub-bass.
for kind, source, end, pitch, body in [('rifle','rifle',.57,1.02,180),('pistol','pistol',.54,1.04,260),('smg','cg1',.34,1.18,310),('shotgun','shotgun',.61,.94,130)]:
    dry = resample(clip(shots[source],0,end),pitch)
    present = band(dry,120,6500)
    body_layer = transient(300 + body,.20,body,.04 if kind == 'smg' else .065)
    value = mix((dry,0,.73),(present,0,.50),(body_layer,.004,.23))
    value = [math.tanh(v * 1.45) / 1.15 for v in value]
    write(kind+'-shot',value,shot_credit,peak=.90,tail=.065,notes=f'{source}.wav trimmed before source reload; band emphasis; {pitch}x resampling; short original pressure layer; soft saturation')

# Short outdoor masonry reflection, mixed separately from each dry shot.
tail_source = clip(shots['rifle'],.026,.27)
tail = mix((band(tail_source,320,3900),.016,.55),(lowpass(resample(tail_source,.88),2600),.083,.28),(lowpass(resample(tail_source,.74),1800),.167,.12),duration=.60)
write('shot-tail',tail,shot_credit,peak=.58,tail=.16,notes='Three filtered sparse outdoor reflections; event-synchronised, no unrelated gunfire in ambience')
write('weapon-mech',clip(rifle,1.20,1.31),reload_credit,peak=.64,notes='Short action click, layered 14 ms after local shot')

for name, data, note, peak in [
    ('reload-out',clip(rifle,.10,.43),'Magazine extraction',.80),
    ('reload-in',clip(rifle,.96,1.18),'Magazine insertion',.86),
    ('reload-bolt',clip(rifle,1.18,1.50),'Bolt pull and release',.84),
    ('pistol-out',clip(pistol,.04,.36),'Pistol magazine extraction',.78),
    ('pistol-in',clip(pistol,1.22,1.56),'Pistol magazine insertion',.84),
    ('shotgun-pump',clip(pump,.035,.47),'Shotgun pump action',.86),
]:
    value = mix((data,0,.9),(band(data,700,6000),0,.40))
    write(name,value,reload_credit,peak=peak,notes=note+'; added midrange definition')

for i in range(4):
    write(f'step-{i+1}',foley(901+i,.24+i*.01),original_credit,peak=.72,notes='Rubber heel pressure, cloth and irregular sand/gravel contacts')
write('impact',foley(1202,.18),original_credit,peak=.72,notes='Stone chip and short granular debris')
write('hit',mix((foley(992,.13,False),0,.8),(transient(993,.10,300,.020),0,.24)),original_credit,peak=.64,notes='Dry padded impact, distinct from wall contact')
write('kill',mix((foley(440,.09,False),0,.65),(foley(441,.08,False),.065,.40)),original_credit,peak=.62,notes='Two understated material confirmation ticks')
for i in range(2):
    write(f'shell-{i+1}',metallic(791+i),original_credit,peak=.58,notes='Eight inharmonic brass resonances, four decaying bounces')
    rng = random.Random(613+i)
    noise = [rng.uniform(-1,1) for _ in range(round(RATE*.30))]
    value=[]
    for n,x in enumerate(noise):
        t=n/RATE
        sweep=math.sin(2*math.pi*(3300*t-3600*t*t))
        value.append((sweep*.42+x*.10)*math.exp(-t/.063))
    write(f'ricochet-{i+1}',band(value,1600,8000),original_credit,peak=.51,notes='Short down-swept metallic glancing impact; sparse close wall contacts')

# Hand grenade retains the licensed explosion but has an additional chest/body
# transient and delayed grit. No long synthesized tone masks actual gunshots.
explosion = read(cache/'explosions/explode.wav')
boom = mix((explosion,0,.92),(transient(1041,.50,115,.12),0,.52),(foley(1042,.54),.30,.12))
write('grenade-explosion',boom,shot_credit,peak=.94,tail=.14,notes='explode.wav + original pressure transient / debris layer')
write('grenade-distant',band(read(cache/'explosions/explodemini.wav'),65,2100),shot_credit,peak=.88,tail=.18,notes='explodemini.wav, distant low-mid air absorption')
throw_noise = periodic_noise(888,.34,300,3500)
throw = [v*math.sin(math.pi*i/(len(throw_noise)-1))**1.8 for i,v in enumerate(throw_noise)]
write('grenade-throw',mix((clip(pump,.03,.14),0,.56),(throw,.11,.95)),reload_credit+' + original whoosh',peak=.73,notes='Metal pin click followed by hand/cloth air displacement')
write('gear-rustle',foley(1558,.26,False),original_credit,peak=.47,notes='Close cloth movement during reload reach')

tick = clip(rifle,1.00,1.08)
write('ui-confirm',mix((tick,0,.8),(resample(tick,1.28),.068,.5)),reload_credit,peak=.52,notes='Two light mechanical clicks')
write('ui-cancel',lowpass(resample(tick,.76),1800),reload_credit,peak=.46,notes='Lower single material click')
write('ui-round',mix((tick,0,.55),(resample(tick,1.18),.105,.65),(resample(tick,1.4),.20,.7)),reload_credit,peak=.55,notes='Three rising material clicks')

# Each ambience is periodic by construction, has no silence gap, and carries
# useful 250 Hz–3 kHz energy for phone speakers. Beds contain no speech/gunshots.
seconds=16
wind_noise=periodic_noise(554,seconds,220,3300)
wind=[]
for i,v in enumerate(wind_noise):
    p=2*math.pi*i/len(wind_noise)
    wind.append(v*(.77+.15*math.sin(p)+.07*math.sin(p*3+.2)))
write('wind',wind,original_credit,peak=.68,loop=True,notes='16 s periodic midrange desert air through stone passage, audible phone band')

seconds=24
city_noise=periodic_noise(1718,seconds,160,1550)
city_channels=[[],[]]
for i,v in enumerate(city_noise):
    t=i/RATE;p=2*math.pi*t/seconds
    motor=(math.sin(2*math.pi*188*t+.7*math.sin(p))*.05+math.sin(2*math.pi*282*t+.35*math.sin(p*2))*.029)
    traffic= (.43+.24*math.sin(p-.5)+.08*math.sin(p*3))*v
    # Intermittent light pole/wire resonance, spatially slow, no combat cue.
    wire=math.sin(2*math.pi*1468*t)*.004*(.5+.5*math.sin(p*2+.8))**8
    city_channels[0].append(traffic+motor+wire)
    city_channels[1].append(traffic*.86+motor*(.8+.2*math.sin(p))+wire*.42)
write('city-bed',[(a+b)*.5 for a,b in zip(*city_channels)],original_credit,peak=.53,loop=True,notes='24 s distant engine/wire bed, slow modulation, no intelligible voices or false gunfire')

seconds=16
haze=periodic_noise(1992,seconds,85,650)
drone=[]
for i,v in enumerate(haze):
    t=i/RATE;p=2*math.pi*t/seconds
    # Harmonic support remains present on mobile speakers (> 150 Hz).
    drone.append(v*.24+(.026*math.sin(2*math.pi*146.875*t)+.018*math.sin(2*math.pi*220.3125*t)+.011*math.sin(2*math.pi*293.75*t))*(.76+.17*math.sin(p)))
write('tension-bed',drone,original_credit,peak=.36,loop=True,notes='16 s quiet low-mid pressure bed; no melody, gentle periodic filter texture')

# Original sparse D-minor tactical menu motif: organic filtered noise/pluck,
# rather than copyrighted music, voices or a constant combat soundtrack.
seconds=24
menu=[0.] * (RATE*seconds)
notes=[(0,146.875,1.),(3,220.3125,.65),(6,174.625,.8),(9,220.3125,.55),(12,130.8125,.9),(15,196.,.63),(18,146.875,.75),(21,220.3125,.48)]
for at,freq,level in notes:
    for i in range(round(RATE*4.8)):
        t=i/RATE
        env=(1-math.exp(-t/.09))*math.exp(-t/1.35)
        value=(math.sin(2*math.pi*freq*t)+.26*math.sin(2*math.pi*freq*2*t)+.07*math.sin(2*math.pi*freq*3*t))*env*.16*level
        menu[(round(at*RATE)+i)%len(menu)]+=value
menu_noise=periodic_noise(1777,seconds,200,1800)
menu=[v+menu_noise[i]*.14 for i,v in enumerate(menu)]
right=menu[-round(RATE*.083):]+menu[:-round(RATE*.083)]
write('menu-score',[menu,right],original_credit,peak=.58,loop=True,stereo=True,notes='Original 24 s sparse minor-key wooden/metallic pluck motif, unlocked by user gesture, menu only')

manifest={
    'version':'0.3.0','sfxSampleRate':RATE,'ambienceSampleRate':24000,'assetCount':len(metadata),'totalBytes':sum(x['bytes'] for x in metadata),
    'sourceUrls':SOURCES,'assets':metadata,
    'qa':{'method':'PCM waveform and loop seam inspection; not a claim of speaker listening','allHaveSignal':all(x['rms']>.005 for x in metadata),'noClipping':all(x['clippedSamples']==0 for x in metadata),'seamlessLoops':all(x['loopBoundaryDifference']==0 for x in metadata if x['loop'])},
}
(OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
credits='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>沙线行动 · 音效素材来源</title><style>body{max-width:780px;margin:40px auto;padding:0 24px;background:#132027;color:#dfddd3;font:16px/1.8 system-ui}a{color:#edc282}h1,h2{color:#fff}</style><h1>沙线行动 · v0.3 音效素材来源</h1><p>本游戏使用下列获授权素材，加上本项目原创离线声音设计。素材转换为 PCM16 WAV（枪械 32 kHz、环境与音乐 24 kHz），经过裁切、分层、重采样、均衡、淡入淡出与增益处理。未使用 Counter-Strike / Valve 游戏音频文件。</p>
<h2>枪声与爆炸 · Michel Baradari</h2><p>© Michel Baradari (apollo-music.de)，由 qubodup 上传至 OpenGameArt。<a href="https://creativecommons.org/licenses/by/3.0/">Creative Commons Attribution 3.0 Unported（CC BY 3.0）</a>。</p>
<ul><li><a href="https://opengameart.org/content/chaingun-pistol-rifle-shotgun-shots">Chaingun, pistol, rifle, shotgun shots</a>：rifle.wav、pistol.wav、cg1.wav、shotgun.wav。</li>
<li><a href="https://opengameart.org/content/2-high-quality-explosions">2 High Quality Explosions</a>：explode.wav、explodemini.wav。</li>
</ul><p>改编：去除枪声录音中固定的换弹尾声；按武器制作瞬态、频段与音高区分；加入原创压力瞬态；裁切并叠加户外反射尾声；对远处爆炸低通。署名不意味着作者认可或支持本项目。</p>
<h2>换弹与机械声 · SpringySpringo</h2><p><a href="https://opengameart.org/content/gun-reload-sounds">Gun reload sounds</a>，airsoft 枪械机械声录制，<a href="https://creativecommons.org/publicdomain/zero/1.0/">CC0 1.0 Universal</a>。原文件 gunreload1.wav、assaultriflereload1.wav、shotguncock.wav。改编为拔匣、插匣、枪机、泵动、手雷拔销、击发机械层及界面材质点击；加强中高频清晰度。</p>
<h2>原创声音设计与音乐</h2><p>脚步、弹壳、跳弹、衣物、碎屑、命中、砂石风声、远城引擎与电线声、低频气氛层和菜单短乐句均由本项目脚本离线合成；可在 scripts/generate-audio-v03.py 重建。菜单为原创稀疏小调乐句。无语音、无外部生成服务请求；未使用 ElevenLabs 生成内容。</p>
<p><a href="../../">返回游戏</a> · <a href="manifest.json">逐文件来源、哈希与波形指标</a></p>
</html>'''
(OUT/'CREDITS.html').write_text(credits,encoding='utf-8')
print(json.dumps({'files':len(metadata),'bytes':manifest['totalBytes'],'qa':manifest['qa'],'loops':[{k:x[k] for k in ['id','seconds','rms','loopBoundaryDifference']} for x in metadata if x['loop']]},ensure_ascii=False))
