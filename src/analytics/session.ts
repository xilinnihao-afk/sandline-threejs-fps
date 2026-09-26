export type Props = Record<string, string | number | boolean>;
export type Emit = (name: string, props: Props) => void;

/** Monotonic clock; duration events contain deltas, never overlapping totals. */
export class VisitSession {
  stage = 'entry';
  phase = 'entry';
  private visible = true;
  private active = false;
  private last: number;
  private total = 0;
  private pending = 0;
  private loadState: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
  private loadAt = 0;
  constructor(private emit: Emit, private clock = () => performance.now()) { this.last = clock(); }
  event(name: string, props: Props = {}) { this.emit(name, { stage: this.stage, phase: this.phase, ...props }); }
  private accrue() {
    const now = this.clock();
    if (this.visible && this.active) { const delta = Math.max(0, now - this.last); this.total += delta; this.pending += delta; }
    this.last = now;
  }
  setGame(phase: string, paused: boolean) {
    this.accrue();
    const changed = this.phase !== phase || this.active !== (!paused && ['playing', 'prep', 'planted'].includes(phase));
    this.phase = phase;
    this.active = !paused && ['playing', 'prep', 'planted'].includes(phase);
    if (this.loadState === 'ready') this.stage = paused ? 'paused' : phase === 'menu' ? 'menu' : phase === 'matchEnd' ? 'result' : 'playing';
    if (changed) { this.flush(); this.event('game_state', { paused }); }
  }
  beginLoad() { if (this.loadState !== 'idle') return; this.loadState = 'loading'; this.stage = 'loading'; this.phase = 'program'; this.loadAt = this.clock(); this.event('load_start'); }
  loadStage(phase: string) { if (this.loadState !== 'loading') return; this.phase = phase; this.event('load_stage'); }
  ready() { if (this.loadState !== 'loading') return; this.event('load_success', { load_ms: Math.round(this.clock() - this.loadAt) }); this.loadState = 'ready'; this.stage = 'menu'; this.phase = 'menu'; }
  fail(kind: string) { if (this.loadState !== 'loading') return; this.event('load_failure', { kind, load_ms: Math.round(this.clock() - this.loadAt) }); this.loadState = 'failed'; this.stage = 'load_failed'; }
  flush() {
    this.accrue();
    const seconds = Math.floor(this.pending / 1000);
    if (seconds) { this.pending -= seconds * 1000; this.event('play_duration', { seconds, total_seconds: Math.floor(this.total / 1000) }); }
  }
  visibility(visible: boolean) {
    if (this.visible === visible) return;
    this.accrue(); this.visible = visible; this.flush();
    this.event(visible ? 'page_resume' : 'page_background', { total_seconds: Math.floor(this.total / 1000) });
  }
  leave(persisted: boolean) { this.flush(); this.event('page_exit', { persisted, total_seconds: Math.floor(this.total / 1000) }); this.visible = false; }
}
