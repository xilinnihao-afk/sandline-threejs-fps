import {VOICE_IDS,VoiceQueue,voiceCues} from './voiceCues';
import type {GameEvent, GameSnapshot, WeaponKind} from '../game/types';
import {WEAPONS} from '../game/simulation';

const SOUND_LIBRARY = [
  'rifle-shot', 'pistol-shot', 'smg-shot', 'shotgun-shot', 'shot-tail', 'weapon-mech',
  'grenade-explosion', 'grenade-distant', 'reload-out', 'reload-in', 'reload-bolt',
  'pistol-out', 'pistol-in', 'shotgun-pump', 'step-1', 'step-2', 'step-3', 'step-4',
  'shell-1', 'shell-2', 'ricochet-1', 'ricochet-2', 'gear-rustle',
  'impact', 'hit', 'kill', 'grenade-throw', 'ui-confirm', 'ui-cancel', 'ui-round',
  'wind', 'city-bed', 'tension-bed', 'menu-score',
  ...VOICE_IDS.map(id=>`voice/${id}` as const),
] as const;
const ASSETS=SOUND_LIBRARY.filter(name=>!['smg-shot','shotgun-shot','shotgun-pump'].includes(name));
type Asset = typeof SOUND_LIBRARY[number];
type Group = 'sfx' | 'ui' | 'ambience' | 'music' | 'voice';
export type AudioScene = 'menu' | 'combat' | 'paused';
type ErrorStage = 'context' | 'resume' | 'fetch' | 'decode' | 'suspend';
type AudioIssue = {stage:ErrorStage; message:string; at:number};
type LiveSource = {source:AudioBufferSourceNode; nodes:AudioNode[]; group:Group; asset:Asset; loop:boolean; startsAt:number};
type PendingEvent = {event:GameEvent; distance:number; pan:number; queuedAt:number};
type LoopSpec = {id:Asset; group:'ambience'|'music'; gain:number; pan:number};
const GROUP_LEVELS = {sfx:1, ui:.65, ambience:.28, music:.18, voice:.8} as const;
const BEDS:Record<Exclude<AudioScene, 'paused'>, LoopSpec[]> = {
  combat:[
    // Keep the combat soundscape sparse so footsteps carry useful information.
    {id:'wind', group:'ambience', gain:.16, pan:0},
  ],
  menu:[
    {id:'wind', group:'ambience', gain:.27, pan:0},
    {id:'city-bed', group:'ambience', gain:.18, pan:-.14},
    {id:'menu-score', group:'music', gain:.48, pan:0},
  ],
};

/** Local samples, scene-aware beds and actual post-master signal diagnostics.
 * Creating/resuming the context always happens before the first await, inside
 * the caller's trusted gesture. Saved zero volume is never changed by unlock. */
export class GameAudio {
  private ctx:AudioContext|null = null;
  private master:GainNode|null = null;
  private groups:Partial<Record<Group, GainNode>> = {};
  private analyser:AnalyserNode|null = null;
  private meterData = new Float32Array(512);
  private buffers = new Map<Asset, AudioBuffer>();
  private live = new Set<LiveSource>();
  private loops = new Map<Asset, LiveSource>();
  private loading:Promise<void>|null = null;
  private errors = new Map<string, AudioIssue>();
  private nextLoadAttemptAt = 0;
  private pending:PendingEvent[] = [];
  private scene:AudioScene = 'menu';
  private hidden = document.hidden;
  private voiceQueue = new VoiceQueue();
  private voiceSource:LiveSource|null = null;
  private played = 0;
  private eventCounts:Record<string, number> = {};
  private assetCounts:Record<string, number> = {};
  private skipped = 0;
  private variants = 0;
  private lastSteps = new Map<number, number>();
  private lastImpact = -Infinity;
  private rms = 0;
  private peak = 0;
  private peakHold = 0;
  private lastSignalAt:number|null = null;
  private auditionUntil = 0;
  private auditionTimer:ReturnType<typeof setTimeout>|null = null;
  private sessionMode = 'unavailable';
  private interruptions = 0;
  private successfulResumes = 0;
  volume = .6;

  constructor() {
    document.addEventListener('visibilitychange', () => {
      this.hidden = document.hidden;
      if (this.hidden) this.suspendForBackground();
      else if (this.ctx) void this.resumeIfNeeded();
    });
    window.addEventListener('pagehide', () => { this.hidden = true; this.suspendForBackground(); });
    window.addEventListener('pageshow', () => {
      this.hidden = document.hidden;
      if (!this.hidden && this.ctx) void this.resumeIfNeeded();
    });
  }

  private issue(id:string, stage:ErrorStage, error:unknown):void {
    this.errors.set(id, {stage, message:error instanceof Error ? error.message : String(error), at:Date.now()});
  }

  async unlock():Promise<void> {
    if (!this.ctx) {
      const SafariAudio = (window as Window & {webkitAudioContext?:typeof AudioContext}).webkitAudioContext;
      const Audio = window.AudioContext ?? SafariAudio;
      if (!Audio) { this.issue('context', 'context', '此浏览器未提供 Web Audio'); return; }
      try {
        // Safari 16.4+ supports media playback routing. It improves audible
        // playback on phones; this does not modify master volume or saved mute.
        const session = (navigator as Navigator & {audioSession?:{type:string}}).audioSession;
        if (session) {
          try { session.type = 'playback'; this.sessionMode = session.type; }
          catch { this.sessionMode = 'unsupported-playback'; }
        }
        const ctx = this.ctx = new Audio({latencyHint:'interactive'});
        this.master = ctx.createGain();
        this.master.gain.value = this.volume;
        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = -10;
        compressor.knee.value = 12;
        compressor.ratio.value = 3.5;
        compressor.attack.value = .002;
        compressor.release.value = .19;
        this.analyser = ctx.createAnalyser();
        this.analyser.fftSize = 512;
        this.master.connect(compressor).connect(this.analyser).connect(ctx.destination);
        for (const [name, level] of Object.entries(GROUP_LEVELS) as [Group, number][]) {
          const gain = ctx.createGain(); gain.gain.value = level; gain.connect(this.master); this.groups[name] = gain;
        }
        const silent = ctx.createBufferSource();
        silent.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
        silent.connect(this.master); silent.onended = () => silent.disconnect(); silent.start();
        ctx.onstatechange = () => {
          if (ctx.state === 'running') { this.errors.delete('resume'); this.ensureScene(); }
          else {
            this.interruptions++;
            // Never replay old gunshots/reloads after a call, lock-screen or tab
            // interruption. Only the selected ambience is restored on resume.
            this.stopSources(); this.pending = []; this.rms = this.peak = 0;
          }
        };
        setInterval(() => this.measure(), 60);
        this.errors.delete('context');
      } catch (error) { this.issue('context', 'context', error); return; }
    }
    const resumed = this.requestResume();
    const loaded = this.loadAssets(true);
    await Promise.all([resumed, loaded]);
    this.ensureScene();
  }

  /** Call from a real pointer/key/touch gesture, also safe after pageshow.
   * False means the browser still requires user activation; mute is untouched. */
  async resumeIfNeeded():Promise<boolean> {
    if (!this.ctx) { await this.unlock(); return (this.ctx as AudioContext|null)?.state === 'running'; }
    if (this.hidden) return false;
    const resumed = this.requestResume();
    void this.loadAssets();
    const okay = await resumed;
    if (okay) this.ensureScene();
    return okay;
  }

  private requestResume():Promise<boolean> {
    const ctx = this.ctx;
    if (!ctx || this.hidden) return Promise.resolve(false);
    if (ctx.state === 'running') { this.errors.delete('resume'); return Promise.resolve(true); }
    // Call resume now, not from a promise callback: iOS binds this operation to
    // the trusted gesture. A timed-out browser request never stalls the HUD.
    let request:Promise<void>;
    try { request = ctx.resume(); }
    catch (error) { this.issue('resume', 'resume', error); return Promise.resolve(false); }
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        if (ctx.state !== 'running') this.issue('resume', 'resume', '浏览器尚未允许声音播放，请轻触开启声音');
        resolve(ctx.state === 'running');
      }, 1400);
      request.then(() => {
        clearTimeout(timer);
        const okay = ctx.state === 'running';
        if (okay) { this.successfulResumes++; this.errors.delete('resume'); this.ensureScene(); }
        else this.issue('resume', 'resume', `声音上下文仍为 ${ctx.state}`);
        resolve(okay);
      }).catch(error => { clearTimeout(timer); this.issue('resume', 'resume', error); resolve(false); });
    });
  }

  private suspendForBackground():void {
    this.cancelAudition(); this.stopSources(); this.pending = []; this.rms = this.peak = 0;
    if (this.ctx?.state === 'running') {
      void this.ctx.suspend().then(() => this.errors.delete('suspend')).catch(error => this.issue('suspend', 'suspend', error));
    }
  }

  private loadAssets(force=false):Promise<void> {
    if (this.loading) return this.loading;
    if (!this.ctx || this.buffers.size === ASSETS.length || (!force && performance.now() < this.nextLoadAttemptAt)) return Promise.resolve();
    const ctx = this.ctx;
    this.nextLoadAttemptAt = performance.now() + 5000;
    this.loading = Promise.all(ASSETS.filter(id => !this.buffers.has(id)).map(async id => {
      let stage:ErrorStage = 'fetch';
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 14000);
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}assets/audio/${id}.wav`, {signal:controller.signal});
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${id}.wav`);
        const bytes = await response.arrayBuffer();
        clearTimeout(timeout); stage = 'decode';
        // Callback form also works on older WebKit. Fetch and decode failures
        // are identified separately instead of being reported as muted audio.
        const buffer = await new Promise<AudioBuffer>((resolve, reject) => ctx.decodeAudioData(bytes, resolve, reject));
        this.buffers.set(id, buffer); this.errors.delete(id);
      } catch (error) { this.issue(id, stage, error); }
      finally { clearTimeout(timeout); }
    })).then(() => {
      this.loading = null; this.ensureScene();
      const queued = this.pending; this.pending = [];
      for (const item of queued) {
        if (performance.now() - item.queuedAt < 200) this.play(item.event, item.distance, item.pan);
        else this.skipped++;
      }
    });
    return this.loading;
  }

  setVolume(value:number):void {
    if (!Number.isFinite(value)) return;
    this.volume = Math.max(0, Math.min(1, value));
    if (this.master && this.ctx) {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      if (this.volume === 0) this.master.gain.setValueAtTime(0, this.ctx.currentTime);
      else this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, .018);
    }
    if (this.volume === 0) { this.peakHold = 0; this.clearVoice(); }
  }

  /** Repeated calls are cheap, and must not restart a playing loop or audition. */
  setScene(mode:AudioScene):void {
    if (mode !== this.scene) {
      this.cancelAudition(); this.stopSources(); this.pending = []; this.scene = mode;
    }
    this.ensureScene();
  }

  /** Backward-compatible gameplay activation. Use setScene for menu music. */
  setActive(active:boolean):void { this.setScene(active ? 'combat' : 'paused'); }

  stop():void {
    this.scene = 'paused'; this.cancelAudition(); this.pending = []; this.stopSources();
    this.lastSteps.clear(); this.lastImpact = -Infinity;
  }

  private cancelAudition():void {
    if (this.auditionTimer) clearTimeout(this.auditionTimer);
    this.auditionTimer = null; this.auditionUntil = 0;
  }

  private stopSources():void {
    this.clearVoice();
    for (const item of [...this.live]) this.stopSource(item);
    this.loops.clear();
  }

  private stopSource(item:LiveSource):void {
    item.source.onended = null;
    try { item.source.stop(); } catch { /* Source has already ended. */ }
    this.cleanup(item);
  }

  private cleanup(item:LiveSource):void {
    if(this.voiceSource===item){this.voiceSource=null;this.voiceQueue.complete();this.duckVoice(false);}
    this.live.delete(item);
    for (const node of item.nodes) node.disconnect();
    if (this.loops.get(item.asset) === item) this.loops.delete(item.asset);
  }

  private ensureScene():void {
    if (this.hidden || this.ctx?.state !== 'running') return;
    const mode = this.auditionUntil > this.ctx.currentTime ? 'combat' : this.scene;
    if (mode === 'paused') return;
    for (const spec of BEDS[mode]) {
      if (this.loops.has(spec.id) || !this.buffers.has(spec.id)) continue;
      const source = this.sample(spec.id, spec.group, spec.gain, 0, spec.pan, 0, 1, true);
      if (source) this.loops.set(spec.id, source);
    }
  }

  private sample(id:Asset, group:Group, gain:number, distance=0, pan=0, delay=0, speed=1, loop=false):LiveSource|null {
    const ctx = this.ctx, buffer = this.buffers.get(id), destination = this.groups[group];
    if (!ctx || this.hidden || ctx.state !== 'running' || !buffer || !destination) return null;
    const pool = [...this.live].filter(item => item.group === group && !item.loop);
    if (pool.length >= (group === 'sfx' ? 48 : 8)) {
      // Prefer evicting an old casing/tail before a scheduled reload phase.
      this.stopSource(pool.find(item => /^(shell|shot-tail|ricochet)/.test(item.asset)) ?? pool[0]);
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer; source.loop = loop; source.playbackRate.value = speed;
    const level = ctx.createGain(), meters = Math.max(0, distance);
    const amplitude = gain * (group === 'sfx' ? 1 / (1 + Math.pow(meters / 13, 1.4)) : 1);
    if (loop) { level.gain.value = 0; level.gain.setTargetAtTime(amplitude, ctx.currentTime, .14); }
    else level.gain.value = amplitude;
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass';
    filter.frequency.value = group === 'sfx' ? Math.max(1400, 15000 / (1 + meters * .07)) : 15500;
    source.connect(filter).connect(level);
    const nodes:AudioNode[] = [source, filter, level];
    if (ctx.createStereoPanner) {
      const panner = ctx.createStereoPanner(); panner.pan.value = Math.max(-.9, Math.min(.9, pan));
      level.connect(panner).connect(destination); nodes.push(panner);
    } else level.connect(destination);
    const startsAt = ctx.currentTime + Math.max(0, delay);
    const item:LiveSource = {source, nodes, group, asset:id, loop, startsAt};
    this.live.add(item); source.onended = () => this.cleanup(item); source.start(startsAt);
    this.played++; this.assetCounts[id] = (this.assetCounts[id] ?? 0) + 1;
    return item;
  }

  private duckVoice(active:boolean):void {
    if(!this.ctx)return;
    for(const group of ['ambience','music'] as const){
      const base=GROUP_LEVELS[group];
      const gain=this.groups[group]?.gain;if(!gain)continue;
      gain.cancelScheduledValues(this.ctx.currentTime);
      gain.setTargetAtTime(base*(active?.5:1),this.ctx.currentTime,active?.04:.15);
    }
  }

  private clearVoice():void {
    this.voiceQueue.reset();
    if(this.voiceSource)this.stopSource(this.voiceSource);
    this.voiceSource=null;this.duckVoice(false);
  }

  announce(events:GameEvent[],state:GameSnapshot):void {
    if(this.hidden||this.volume===0||this.scene==='paused'||this.auditionUntil>0||this.ctx?.state!=='running')return;
    const cues=voiceCues(events,state);
    if(this.voiceQueue.enqueue(cues,this.ctx.currentTime)&&this.voiceSource)this.stopSource(this.voiceSource);
    this.pumpVoice();
  }

  private pumpVoice():void {
    if(!this.ctx||this.ctx.state!=='running'||this.hidden||this.volume===0||this.scene==='paused'&&this.auditionUntil===0)return;
    if(this.voiceSource)return;
    const cue=this.voiceQueue.current??this.voiceQueue.next(this.ctx.currentTime,cue=>this.buffers.has(`voice/${cue.id}`));
    if(!cue)return;
    const source=this.sample(`voice/${cue.id}`,'voice',.9);
    if(source){this.voiceSource=source;this.duckVoice(true);}
    // Never wait indefinitely for a missing clip or replay it after an interruption.
    else this.voiceQueue.complete();
  }

  private shot(kind:WeaponKind, distance:number, pan:number, variation:number, delay=0):void {
    const gain = kind === 'shotgun' ? .91 : kind === 'smg' ? .65 : kind === 'pistol' ? .77 : .84;
    this.sample(`${kind}-shot`, 'sfx', gain, distance, pan, delay, variation);
    this.sample('shot-tail', 'sfx', kind === 'shotgun' ? .23 : .14, distance * .75, pan * .75, delay + .045, kind === 'shotgun' ? .82 : kind === 'smg' ? 1.22 : variation);
    if (distance < 15) {
      this.sample('weapon-mech', 'sfx', .20, distance, pan, delay + .014, kind === 'smg' ? 1.25 : variation);
      this.sample(this.variants % 2 ? 'shell-1' : 'shell-2', 'sfx', kind === 'shotgun' ? .15 : .20, distance, Math.min(.85, pan + .32), delay + (kind === 'shotgun' ? .50 : .22), kind === 'shotgun' ? .70 : variation);
    }
    if (kind === 'shotgun') this.sample('shotgun-pump', 'sfx', .48, distance, pan, delay + .34, 1.14);
  }

  play(event:GameEvent, distance=0, pan=0):void {
    if (!this.ctx || this.ctx.state !== 'running' || this.hidden) { this.skipped++; return; }
    if (this.auditionUntil > 0 || (this.scene !== 'combat' && event.type !== 'round')) return;
    if (this.loading && !this.buffers.has(event.weapon ? `${event.weapon}-shot` : 'rifle-shot')) {
      if (this.pending.length < 16) this.pending.push({event, distance, pan, queuedAt:performance.now()});
      return;
    }
    this.eventCounts[event.type] = (this.eventCounts[event.type] ?? 0) + 1;
    const kind:WeaponKind = event.weapon ?? 'rifle';
    const variation = 1 + ((this.variants++ % 7) - 3) * .009;
    switch (event.type) {
      case 'shot': this.shot(kind, distance, pan, variation); break;
      case 'explosion': {
        // 距离传播延迟 + 遮挡衰减；复用采样，不增加常驻音源。
        const delay=Math.min(.18,distance/343),cover=event.occluded?.42:1;
        this.sample(distance>20||event.occluded?'grenade-distant':'grenade-explosion','sfx',1.18*cover,distance*.6,pan,delay,variation*.94);
        if(distance<18){
          this.sample('grenade-distant','sfx',.32*cover,distance*.8,-pan*.25,delay+.11,.82);
          this.sample('impact','sfx',.14*cover,distance,pan*.6,delay+.23,.75);
        }
        break;
      }
      case 'grenadeThrow': this.sample('grenade-throw', 'sfx', .63, distance, pan); break;
      case 'reload': {
        const duration = WEAPONS[kind].reload;
        this.sample('gear-rustle', 'sfx', .29, distance, pan, duration * .08);
        if (kind === 'shotgun') {
          const count = Math.max(1, Math.min(6, event.shells ?? 3));
          for (let index = 0; index < count; index++) {
            const time = duration * (.15 + .68 * ((index + .74) / count));
            this.sample('reload-in', 'sfx', .45, distance, pan, time, 1.42 + (index % 2) * .04);
          }
          this.sample('shotgun-pump', 'sfx', .63, distance, pan, duration * .88, .435 / (duration * .11));
        } else {
          this.sample(kind === 'pistol' ? 'pistol-out' : 'reload-out', 'sfx', .61, distance, pan, duration * .20, variation);
          this.sample(kind === 'pistol' ? 'pistol-in' : 'reload-in', 'sfx', .69, distance, pan, duration * .70, kind === 'smg' ? 1.15 : 1);
          this.sample('impact', 'sfx', .16, distance, pan, duration * .76, 1.3);
          this.sample('reload-bolt', 'sfx', .64, distance, pan, duration * .84, .32 / (duration * .14));
        }
        break;
      }
      case 'step': {
        const actor = event.actorId ?? 0;
        if (this.ctx.currentTime - (this.lastSteps.get(actor) ?? -Infinity) > .15) {
          this.lastSteps.set(actor, this.ctx.currentTime);
          this.sample(`step-${1 + (this.variants % 4)}` as Asset, 'sfx', .62, distance, pan, 0, variation);
        }
        break;
      }
      case 'impact':
        if (this.ctx.currentTime - this.lastImpact > .035) {
          this.lastImpact = this.ctx.currentTime;
          this.sample('impact', 'sfx', .33, distance, pan, 0, variation);
          // Sparse glancing hits stay readable and do not whistle every bullet.
          if (distance < 14 && this.variants % 4 === 0) this.sample(this.variants % 8 ? 'ricochet-1' : 'ricochet-2', 'sfx', .26, distance, pan, .018, variation);
        }
        break;
      case 'hit': this.sample('hit', 'ui', .70, 0, 0, 0, event.headshot ? 1.2 : 1); break;
      case 'kill': this.sample('kill', 'ui', .75); break;
      case 'round': this.sample('ui-round', 'ui', .85); break;
      case 'bombTick': this.sample('ui-round', 'ui', .32, distance, pan, 0, 1.3); break;
      case 'bombExplode': this.sample('grenade-explosion', 'sfx', 1.18, distance * .45, pan); break;
      case 'plantComplete': case 'defuseComplete': case 'buy': case 'roundReward': case 'bombPickup': case 'bombDrop': case 'plantStart': case 'defuseStart': this.sample('ui-confirm', 'ui', .38, distance, pan); break;
    }
  }

  /** UI gestures remain audible while gameplay is paused, through saved mute. */
  ui(kind:'confirm'|'cancel'|'pause'):void {
    this.sample(kind === 'confirm' ? 'ui-confirm' : 'ui-cancel', 'ui', .62, 0, 0, 0, kind === 'pause' ? .86 : 1);
  }

  /** 18.5 s bank audition: background first, then each important gameplay layer.
   * Uses the same bus as real combat, and never changes the saved master volume. */
  async test():Promise<void> {
    await this.unlock();
    if (!this.ctx || this.ctx.state !== 'running' || this.hidden) return;
    this.cancelAudition(); this.stopSources(); this.pending = []; this.peakHold = 0;
    this.eventCounts.test = (this.eventCounts.test ?? 0) + 1;
    this.auditionUntil = this.ctx.currentTime + 18.5;
    this.ensureScene();
    this.shot('rifle', 0, -.12, 1, 1.2);
    this.shot('pistol', 0, .12, 1, 2.1);
    for (let i = 0; i < 3; i++) this.shot('rifle', 0, -.08, 1 + i * .009, 2.9 + i * .085);
    this.shot('pistol', 0, .10, 1, 3.8);
    this.sample('reload-out', 'sfx', .61, 0, -.12, 4.8);
    this.sample('reload-in', 'sfx', .69, 0, -.12, 5.55);
    this.sample('reload-bolt', 'sfx', .64, 0, -.12, 5.88);
    this.sample('step-1', 'sfx', .62, 0, -.15, 6.55);
    this.sample('step-3', 'sfx', .62, 0, .15, 6.88);
    this.sample('ricochet-1', 'sfx', .28, 0, .55, 7.20);
    this.sample('grenade-throw', 'sfx', .63, 0, -.12, 7.55);
    this.sample('grenade-explosion', 'sfx', 1.08, 0, .12, 8.25);
    this.sample('hit', 'ui', .70, 0, 0, 9.95);
    this.sample('kill', 'ui', .75, 0, 0, 10.15);
    this.sample('ui-confirm', 'ui', .62, 0, 0, 10.5);
    this.sample('voice/grenade','voice',.9,0,0,11.5);
    this.sample('voice/defused','voice',.9,0,0,13.5);
    this.sample('voice/match-win','voice',.9,0,0,15.5);
    this.auditionTimer = setTimeout(() => {
      this.auditionTimer = null; this.auditionUntil = 0; this.stopSources(); this.ensureScene();
    }, 18550);
  }

  private measure():void {
    if (!this.analyser || this.ctx?.state !== 'running' || this.hidden) { this.rms = this.peak = 0; return; }
    this.pumpVoice();
    this.analyser.getFloatTimeDomainData(this.meterData);
    let square = 0, peak = 0;
    for (const value of this.meterData) { square += value * value; peak = Math.max(peak, Math.abs(value)); }
    this.rms = Math.sqrt(square / this.meterData.length); this.peak = peak; this.peakHold = Math.max(this.peakHold, peak);
    if (peak > .0001) this.lastSignalAt = this.ctx.currentTime;
  }

  /** Concise HUD status; an active Web Audio meter cannot verify hardware mute. */
  status() {
    const state = this.ctx?.state ?? 'locked';
    const supported = !!(window.AudioContext || (window as Window & {webkitAudioContext?:unknown}).webkitAudioContext);
    let code:string, label:string, detail:string;
    if (!supported) { code = 'unsupported'; label = '浏览器不支持声音'; detail = '请使用较新的 Safari 或 Chrome'; }
    else if (this.volume === 0) { code = 'muted'; label = '声音已静音'; detail = '调高游戏音量即可恢复，试听不会改变静音设置'; }
    else if (this.errors.has('context')) { code = 'error'; label = '声音初始化失败'; detail = this.errors.get('context')!.message; }
    else if (!this.ctx) { code = 'locked'; label = '轻触开启声音'; detail = '浏览器需要一次点击来启用音效'; }
    else if (this.hidden) { code = 'paused'; label = '声音已暂停'; detail = '返回游戏后轻触继续'; }
    else if (state !== 'running') { code = 'interrupted'; label = '轻触恢复声音'; detail = this.errors.get('resume')?.message ?? `浏览器声音状态：${state}`; }
    else if (this.loading) { code = 'loading'; label = '正在准备声音'; detail = `已加载 ${this.buffers.size} / ${ASSETS.length} 个声音`; }
    else if ([...this.errors.values()].some(error => error.stage === 'fetch' || error.stage === 'decode')) {
      code = 'error'; label = '部分声音未加载';
      const [id, error] = [...this.errors].find(([,issue]) => issue.stage === 'fetch' || issue.stage === 'decode')!;
      detail = `${id} ${error.stage === 'fetch' ? '下载失败' : '解码失败'}，轻触重试`;
    }
    else if (this.auditionUntil > 0) { code = 'testing'; label = '正在试听声音'; detail = '环境 → 枪声 → 换弹 → 手雷 → 战术语音'; }
    else if (this.scene === 'paused') { code = 'paused'; label = '声音已就绪'; detail = '战斗声音随游戏暂停'; }
    else { code = 'ready'; label = '声音已开启'; detail = this.scene === 'combat' ? '环境、枪械与脚步已就绪' : '菜单音乐与环境声已就绪'; }
    return {code, label, detail, needsGesture:code === 'locked' || code === 'interrupted', muted:this.volume === 0};
  }

  diagnostics() {
    this.measure();
    return {
      state:this.ctx?.state ?? 'locked', supported:!!(window.AudioContext || (window as Window & {webkitAudioContext?:unknown}).webkitAudioContext),
      sampleRate:this.ctx?.sampleRate ?? null, currentTime:this.ctx?.currentTime ?? null,
      loaded:this.buffers.size, total:ASSETS.length, ready:this.buffers.size === ASSETS.length,
      loading:!!this.loading, errors:Object.fromEntries([...this.errors].map(([key, issue]) => [key, `${issue.stage}: ${issue.message}`])), errorDetails:Object.fromEntries(this.errors),
      active:this.scene === 'combat' && !this.hidden, scene:this.scene, hidden:this.hidden,
      activeSources:this.live.size, scheduledSources:[...this.live].filter(item => item.startsAt > (this.ctx?.currentTime ?? 0)).length,
      ambienceLoops:[...this.loops.values()].filter(item => item.group === 'ambience').length,
      musicLoops:[...this.loops.values()].filter(item => item.group === 'music').length, loopAssets:[...this.loops.keys()],
      audition:this.auditionUntil > 0, sessionMode:this.sessionMode, interruptions:this.interruptions, successfulResumes:this.successfulResumes,
      volume:this.volume, groupVolumes:Object.fromEntries(Object.entries(this.groups).map(([id, gain]) => [id, gain?.gain.value])),
      voice:{current:this.voiceQueue.current?.id??null,queued:this.voiceQueue.queued},
      played:this.played, playedEvents:{...this.eventCounts}, playedAssets:{...this.assetCounts}, skipped:this.skipped,
      outputRms:Number(this.rms.toFixed(6)), outputPeak:Number(this.peak.toFixed(6)), peakHold:Number(this.peakHold.toFixed(6)), lastSignalAt:this.lastSignalAt,
      status:this.status(), meter:'post-master/post-compressor Web Audio analyser; software signal, not hardware speaker verification',
    };
  }
}
