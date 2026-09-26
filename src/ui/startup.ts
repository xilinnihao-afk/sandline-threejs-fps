import { telemetry } from '../analytics/telemetry';
/** Lightweight bootstrap remains available when the game bundle fails. */
export class StartupStatus {
 private root = document.getElementById('startup-status')!;
 private label = document.getElementById('startup-label')!;
 private detail = document.getElementById('startup-detail')!;
 private button = document.getElementById('startup-retry')!;
 private progress = document.getElementById('startup-progress') as HTMLProgressElement;
 private done = false; private failed = false; private started = false; private phase = '游戏程序'; private count = 0;
 private slow?: number;
 constructor() { this.button.addEventListener('click', () => { telemetry.event('load_retry'); location.reload(); }); }
 begin() {
  this.started = true; this.root.dataset.started = 'true'; telemetry.beginLoad(); this.label.textContent = '正在加载游戏程序…';
  this.progress.value = 0;
  window.addEventListener('error', this.onError); window.addEventListener('unhandledrejection', this.onRejection);
  this.slow = window.setTimeout(() => {
   if (!this.done && !this.failed) { this.detail.textContent = '资源仍在加载。首次下载较大，建议使用 Wi-Fi；若长时间无变化，可检查网络后重试。'; this.button.hidden = false; telemetry.event('load_slow'); }
  }, 30000);
 }
 private onError = (event: ErrorEvent) => { if (event.filename.includes('hm.baidu.com') || event.filename.includes('plausible')) return; this.fail('程序运行异常，请重试。', 'runtime'); };
 private onRejection = () => this.fail('资源加载异常，请检查网络后重试。', 'resource');
 stage(name: string) {
  if (this.failed || this.done) return;
  this.phase = name; this.label.textContent = name; this.count++;
  // Completed setup stages, not an invented byte-download percentage.
  this.progress.value = this.count;
  document.getElementById('startup-progress-text')!.textContent = `启动阶段 ${this.count} / 7`;
  telemetry.loadStage(name);
 }
 fail(reason: string, kind = 'resource') {
  if (!this.started || this.done || this.failed) return;
  this.failed = true; this.label.textContent = `${this.phase}未完成`; this.detail.textContent = reason; this.button.hidden = false;
  telemetry.fail(kind); this.cleanup();
 }
 private cleanup() { clearTimeout(this.slow); window.removeEventListener('error', this.onError); window.removeEventListener('unhandledrejection', this.onRejection); }
 finish() {
  if (this.done || this.failed) return;
  this.done = true; this.progress.value = 7; telemetry.ready(); this.cleanup(); this.root.remove();
 }
}
export const startup = new StartupStatus();
