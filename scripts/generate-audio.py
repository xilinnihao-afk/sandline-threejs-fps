#!/usr/bin/env python3
"""Build the v0.2 audio bank from licensed samples and deterministic local Foley.

No model/API key or runtime synthesizer is required. Original sources stay in a
temporary build cache; only the trimmed, mixed game assets ship in public/.
Run with --download on another machine to recover the attributed source archive.
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
cache.mkdir(parents=True, exist_ok=True)
if args.download:
    for name, url in SOURCES.items():
        path = cache / name
        subprocess.run(['curl', '--fail', '-L', '--max-time', '90', url, '-o', str(path)], check=True)
        if name.endswith('.7z'):
            subprocess.run(['tar', '-xf', str(path), '-C', str(cache)], check=True)


def read(path):
    with wave.open(str(path), 'rb') as wav:
        assert wav.getsampwidth() == 2, f'Expected PCM16: {path}'
        raw = array('h', wav.readframes(wav.getnframes()))
        if sys.byteorder != 'little':
            raw.byteswap()
        channels, sample_rate = wav.getnchannels(), wav.getframerate()
    values = [sum(raw[i:i + channels]) / (32768 * channels) for i in range(0, len(raw), channels)]
    length = round(len(values) * RATE / sample_rate)
    result = []
    for i in range(length):
        at = i * sample_rate / RATE
        lo = min(len(values) - 1, int(at))
        result.append(values[lo] + (values[min(lo + 1, len(values) - 1)] - values[lo]) * (at - lo))
    return result


def clip(values, start=0, end=None):
    return values[round(start * RATE):round(end * RATE) if end is not None else None]


def speed(values, multiplier):
    result = []
    for i in range(int(len(values) / multiplier)):
        at = i * multiplier
        lo = int(at)
        result.append(values[lo] + (values[min(lo + 1, len(values) - 1)] - values[lo]) * (at - lo))
    return result


def lowpass(values, cutoff):
    alpha = 1 - math.exp(-2 * math.pi * cutoff / RATE)
    state, result = 0., []
    for value in values:
        state += alpha * (value - state)
        result.append(state)
    return result


def mix(*layers):
    # Each layer is (samples, offsetSeconds, amplitude).
    result = [0.] * max(len(v) + round(t * RATE) for v, t, _ in layers)
    for values, t, amplitude in layers:
        offset = round(t * RATE)
        for i, value in enumerate(values):
            result[offset + i] += value * amplitude
    return result


def foley(seed, duration=.24, style='sand'):
    rng = random.Random(seed)
    count = round(duration * RATE)
    noise = [rng.uniform(-1, 1) for _ in range(count)]
    low = lowpass(noise, 750 if style == 'sand' else 2100)
    rumble = lowpass(noise, 150)
    grains = [(rng.uniform(.025, duration * .8), rng.uniform(.004, .012), rng.uniform(.2, .55)) for _ in range(11)]
    result = []
    for i in range(count):
        t = i / RATE
        envelope = min(1, t / .006) * math.exp(-t / (duration * .22))
        # Broadband heel/cloth transient plus irregular granular contacts, not a tone.
        value = (low[i] * .8 + rumble[i] * 2.6 + noise[i] * .09) * envelope
        for at, decay, amplitude in grains:
            if t >= at:
                value += noise[i] * amplitude * math.exp(-(t - at) / decay)
        result.append(value)
    return result


metadata = []


def write(name, values, origin, peak=.87, attack=.0015, tail=.018, loop=False):
    values = list(values)
    mean = sum(values) / max(1, len(values))
    values = [value - mean for value in values]
    for i in range(len(values)):
        gain = 1. if loop else min(1., i / max(1, RATE * attack), (len(values) - i - 1) / max(1, RATE * tail))
        values[i] *= max(0., gain)
    scale = peak / max(.000001, max(abs(v) for v in values))
    values = [max(-.98, min(.98, v * scale)) for v in values]
    pcm = array('h', (round(value * 32767) for value in values))
    if sys.byteorder != 'little':
        pcm.byteswap()
    path = OUT / (name + '.wav')
    with wave.open(str(path), 'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(RATE)
        wav.writeframes(pcm.tobytes())
    rms = math.sqrt(sum(v * v for v in values) / len(values))
    metadata.append({
        'id': name, 'file': path.name, 'source': origin, 'format': 'mono PCM16 WAV', 'sampleRate': RATE,
        'seconds': round(len(values) / RATE, 4), 'bytes': path.stat().st_size,
        'peak': round(max(abs(v) for v in values), 6), 'rms': round(rms, 6),
        'crestDb': round(20 * math.log10(peak / max(.000001, rms)), 2),
        'clippedSamples': sum(abs(v) >= .999 for v in values),
        'loop': loop, 'loopBoundaryDifference': round(abs(values[0] - values[-1]), 6) if loop else None,
        'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
    })


OUT.mkdir(parents=True, exist_ok=True)
shots = {name: read(cache / 'shots' / (name + '.wav')) for name in ['rifle', 'pistol', 'cg1', 'shotgun']}
rifle = read(cache / 'rifle-reload.wav')
pistol = read(cache / 'pistol-reload.wav')
pump = read(cache / 'shotgun-cock.wav')

# Firearm samples have different original transients. Remove source rifle/pump
# reload tails because those now follow actual gameplay reload/pump events.
write('rifle-shot', clip(shots['rifle'], 0, .62), 'Michel Baradari / shots/rifle.wav, CC BY 3.0', tail=.065)
write('pistol-shot', clip(shots['pistol'], 0, .85), 'Michel Baradari / shots/pistol.wav, CC BY 3.0')
write('smg-shot', speed(clip(shots['cg1'], 0, .50), 1.10), 'Michel Baradari / shots/cg1.wav, CC BY 3.0; +10% playback resampling')
write('shotgun-shot', clip(shots['shotgun'], 0, .62), 'Michel Baradari / shots/shotgun.wav, CC BY 3.0', tail=.055)
write('grenade-explosion', read(cache / 'explosions/explode.wav'), 'Michel Baradari / explosions/explode.wav, CC BY 3.0', peak=.93)
write('grenade-distant', lowpass(read(cache / 'explosions/explodemini.wav'), 1700), 'Michel Baradari / explosions/explodemini.wav, CC BY 3.0; lowpass', peak=.9)

# Airsoft mechanical recordings, cut into actual action phases.
write('reload-out', clip(rifle, .10, .43), 'SpringySpringo / assaultriflereload1.wav, CC0; magazine extraction', peak=.70)
write('reload-in', clip(rifle, .96, 1.18), 'SpringySpringo / assaultriflereload1.wav, CC0; magazine insertion', peak=.76)
write('reload-bolt', clip(rifle, 1.18, 1.50), 'SpringySpringo / assaultriflereload1.wav, CC0; bolt action', peak=.78)
write('pistol-out', clip(pistol, .04, .36), 'SpringySpringo / gunreload1.wav, CC0; magazine extraction', peak=.70)
write('pistol-in', clip(pistol, 1.22, 1.56), 'SpringySpringo / gunreload1.wav, CC0; magazine insertion', peak=.76)
write('shotgun-pump', clip(pump, .035, .47), 'SpringySpringo / shotguncock.wav, CC0; pump action', peak=.76)

for i in range(4):
    write(f'step-{i + 1}', foley(901 + i, .23 + i * .017), 'Original deterministic sand/gravel Foley synthesis; project-owned', peak=.58)
write('impact', foley(1102, .16, 'stone'), 'Original deterministic stone/debris impact; project-owned', peak=.65)
write('hit', foley(992, .11, 'cloth'), 'Original deterministic padded impact; project-owned', peak=.60)
write('kill', mix((foley(440, .09, 'cloth'), 0, .65), (foley(441, .08, 'cloth'), .06, .40)), 'Original deterministic confirmation Foley; project-owned', peak=.56)
write('grenade-throw', mix((clip(pump, .03, .14), 0, .45), (foley(889, .30), .12, .35)), 'SpringySpringo CC0 pump recording + original cloth/granular Foley; pin and throw', peak=.62)

# UI uses quieter material clicks; there are no menu sine/square-wave beeps.
tick = clip(rifle, 1.00, 1.08)
write('ui-confirm', mix((tick, 0, .8), (speed(tick, 1.28), .068, .5)), 'SpringySpringo CC0 mechanical recording; two light clicks', peak=.48)
write('ui-cancel', lowpass(speed(tick, .76), 1800), 'SpringySpringo CC0 mechanical recording; filtered slow click', peak=.42)
write('ui-round', mix((tick, 0, .55), (speed(tick, 1.18), .105, .65), (speed(tick, 1.40), .20, .7)), 'SpringySpringo CC0 mechanical recording; three rising clicks', peak=.48)

# Periodic filtered noise creates an eight-second wind loop. Filter an extra
# cycle then discard it to converge filter state; crossfade the wrap itself.
rng = random.Random(554)
period = [rng.uniform(-1, 1) for _ in range(RATE * 8)]
filtered = lowpass(period + period, 950)[len(period):]
soft = lowpass(period + period, 110)[len(period):]
wind = []
for i in range(len(period)):
    phase = 2 * math.pi * i / len(period)
    envelope = .70 + .12 * math.sin(phase) + .08 * math.sin(phase * 3 + .2)
    wind.append((filtered[i] * .3 + soft[i] * .8) * envelope)
# Crossfading the last 0.3s into the first ensures a continuous seam without a gap.
fade = int(RATE * .30)
for i in range(fade):
    alpha = i / (fade - 1)
    wind[len(wind) - fade + i] = wind[len(wind) - fade + i] * (1 - alpha) + wind[i] * alpha
wind = wind[fade:]
wind[-1] = wind[0]
write('wind', wind, 'Original periodic filtered-noise desert wind; project-owned', peak=.32, loop=True)

credits = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>沙线行动 · 音效素材来源</title><style>body{max-width:780px;margin:40px auto;padding:0 24px;background:#132027;color:#dfddd3;font:16px/1.8 system-ui}a{color:#edc282}h1,h2{color:#fff}</style><h1>沙线行动 · 音效素材来源</h1><p>本游戏使用下列获授权的音效，并制作了裁切、单声道转换、32 kHz 重采样、淡入淡出、增益与滤波处理。素材版权归原作者，未使用 Counter-Strike / Valve 游戏文件。</p><h2>枪声与爆炸 · Michel Baradari</h2><p>© Michel Baradari (apollo-music.de)，由 qubodup 上传至 OpenGameArt。<a href="https://creativecommons.org/licenses/by/3.0/">Creative Commons Attribution 3.0 Unported（CC BY 3.0）</a>。</p><ul><li><a href="https://opengameart.org/content/chaingun-pistol-rifle-shotgun-shots">Chaingun, pistol, rifle, shotgun shots</a>：rifle.wav、pistol.wav、cg1.wav、shotgun.wav。</li><li><a href="https://opengameart.org/content/2-high-quality-explosions">2 High Quality Explosions</a>：explode.wav、explodemini.wav。</li></ul><p>改编：枪声去除录音中固定的换弹尾声，冲锋枪播放重采样，远距离爆炸低通滤波。此处署名不意味着原作者认可或支持本项目。</p><h2>换弹机械声 · SpringySpringo</h2><p><a href="https://opengameart.org/content/gun-reload-sounds">Gun reload sounds</a>，使用 airsoft 枪械录制，<a href="https://creativecommons.org/publicdomain/zero/1.0/">CC0 1.0 Universal</a>。原文件 gunreload1.wav、assaultriflereload1.wav、shotguncock.wav。改编为拔出弹匣、插入弹匣、枪机、泵动以及轻量界面确认音。</p><h2>原创补充</h2><p>砂石脚步、碎屑撞击、命中反馈与轻风为本项目离线合成，脚本保存在 scripts/generate-audio.py。无语音、无音乐、无外部音频服务请求。</p><p><a href="../../">返回游戏</a> · <a href="manifest.json">逐文件来源与波形检查</a></p></html>'''
(OUT / 'CREDITS.html').write_text(credits, encoding='utf-8')
manifest = {
    'version': '0.2.0', 'sampleRate': RATE, 'assetCount': len(metadata),
    'totalBytes': sum(x['bytes'] for x in metadata),
    'sourceUrls': SOURCES, 'assets': metadata,
    'qa': {'method': 'PCM waveform inspection, not subjective listening', 'allHaveSignal': all(x['rms'] > .005 for x in metadata), 'noClipping': all(x['clippedSamples'] == 0 for x in metadata)},
}
(OUT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'files': len(metadata), 'bytes': manifest['totalBytes'], 'qa': manifest['qa']}, ensure_ascii=False))
