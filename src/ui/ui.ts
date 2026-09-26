import {WEAPON_KINDS} from '../game/types';
import type { GameSnapshot, Settings, WeaponKind } from '../game/types';
import './styles.css';

type Callbacks = {
  start: () => void; resume: () => void; restart: () => void; menu: () => void;
  settings: (patch: Partial<Settings>) => void; fullscreen: () => void;
  purchase?: (item: 'rifle'|'pistol'|'armor'|'defuseKit'|'he') => void;
  audioTest?: () => void;
  audioEnable?: () => void;
};

const icons = {
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  expand: '<path d="M9 4H4v5m11-5h5v5M4 15v5h5m6 0h5v-5"/>',
  settings: '<path d="M4 7h16M4 17h16"/><path d="M9 4v6M15 14v6"/>',
  reload: '<path d="M19 8a8 8 0 1 0 1 7M19 3v6h-6"/>',
  switch: '<path d="M3 8h16l-4-4M21 16H5l4 4"/>',
  crouch: '<circle cx="13" cy="5" r="2"/><path d="m11 10 5 3 3-1M11 10l-3 5 6 2-1 4M8 15l-5 5h5"/>',
  fire: '<circle cx="12" cy="12" r="6"/><path d="M12 2v5m0 10v5M2 12h5m10 0h5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  rotate: '<rect x="6" y="3" width="12" height="18" rx="2"/><path d="M2 10V5h3M22 14v5h-3"/>',
  grenade: '<path d="m10 7-1-4h6l1 5M14 3h4l2 4M9 8c-3 2-4 5-3 9 1 4 10 4 12 0 1-4-1-7-4-9z"/><path d="m8 12 8 1M8 16h9"/>',
  sound: '<path d="M4 9h4l5-4v14l-5-4H4zM17 8c3 2 3 6 0 8M20 5c5 4 5 10 0 14"/>',
};
const WEAPON_LABELS: Record<WeaponKind, { name: string; code: string; key: string }> = {
  rifle: { name: 'AK 系突击步枪', code: '7.62 / AR', key: '1' },
  pistol: { name: 'USP 战术手枪', code: '.45 / HG', key: '2' },
  smg: { name: 'MP 系冲锋枪', code: '9×19 / SMG', key: '3' },
  shotgun: { name: 'M-12 泵动霰弹', code: '12 GA / SG', key: '4' },
};
function icon(name: keyof typeof icons): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="square" aria-hidden="true">${icons[name]}</svg>`;
}
function escapeText(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

export class GameUI {
  readonly root: HTMLDivElement;
  private snapshot: GameSnapshot | null = null;
  private settingsOpen = false;
  private refs = new Map<string, HTMLElement>();
  private feedSignature = '';
  private aliveSignature = '';

  constructor(private callbacks: Callbacks) {
    this.root = document.createElement('div');
    this.root.id = 'game-ui';
    this.root.className = 'game-ui is-menu';
    if (new URLSearchParams(location.search).get('touch') === '1') this.root.classList.add('force-touch');
    this.root.innerHTML = `
      <section class="main-menu" aria-label="沙线行动主界面">
          <header class="menu-masthead"><div class="wordmark"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span><span>SANDLINE<span class="wordmark-sub">TACTICAL OPERATIONS</span></span></div><span class="edition">HERO PASS <b>01</b></span></header>
        <div class="menu-content">
          <div class="eyebrow"><span class="live-dot"></span> 单机战术行动 <span class="eyebrow-line"></span> 01 / 01</div>
          <h1>沙线行动<span>SANDLINE</span></h1>
          <p class="menu-description">穿越沙尘，守住阵线。<br>与你的小队，完成下一次突入。</p>
          <div class="mode-strip"><strong>3 <span>VS</span> 3</strong><span>爆破行动</span><span>先胜 3 局</span></div>
          <button class="primary-button start-button" data-action="start"><span>突入战场<small>DEPLOY SQUAD</small></span>${icon('arrow')}</button>
          <div class="menu-secondary"><button class="text-button" data-action="settings">${icon('settings')}行动设置</button><button class="text-button" data-action="handbook">战术手册</button><button class="text-button" data-action="audio-enable" id="menu-audio-button">${icon('sound')}<span id="menu-audio-label">开启声音</span></button><button class="text-button" data-action="fullscreen">${icon('expand')}全屏</button></div>
        </div>
        <div class="community-links"><button class="text-button" data-community="help">操作说明</button><button class="text-button" data-community="feedback">问题反馈</button><button class="text-button" data-community="share">分享游戏</button></div>
        <div class="scene-caption"><span>作战区域 / 01</span><strong>沙漠仓储区</strong><small>DUST DEPOT · 3 ROUTES · CLOSE QUARTERS</small></div>
        <footer class="menu-footer"><span class="offline-status" id="offline-status">正在准备本地资源</span><span class="menu-desktop-hint">WASD 移动 <i>·</i> 鼠标瞄准 <i>·</i> G 手雷</span><span class="menu-touch-hint">左侧移动 <i>·</i> 右侧瞄准 <i>·</i> 按住开火</span><span class="build-label">HERO PASS / 01</span></footer>
      </section>

      <section class="combat-hud" aria-label="战斗状态">
        <div class="location-label"><span class="location-square"></span> 沙漠仓储区<small>爆破行动 · A / B 双点</small></div>
        <div class="scoreboard">
          <div class="team-score blue"><span class="team-name">蓝方</span><strong id="blue-score">0</strong><div id="blue-alive" class="alive-dots"></div></div>
          <div class="round-clock"><span id="round-label">回合 01</span><strong id="round-time">01:30</strong><small>先胜 3 局</small></div>
          <div class="team-score red"><span class="team-name">红方</span><strong id="red-score">0</strong><div id="red-alive" class="alive-dots"></div></div>
        </div>
        <button id="pause-button" class="icon-button pause-button" aria-label="暂停游戏">${icon('pause')}</button>
        <button id="sound-recovery" class="sound-recovery" data-action="audio-enable" hidden>${icon('sound')}<span id="sound-recovery-label">开启声音</span></button>
        <div id="kill-feed" class="kill-feed" aria-label="击杀记录"></div>
        <div id="round-banner" class="round-banner"><span id="banner-kicker">准备阶段</span><strong id="banner-title">部署中</strong><small id="banner-description">寻找掩体，准备交火</small></div>
        <div id="objective-hud" class="objective-hud"><span id="bomb-state">炸弹：CT 防守</span><b id="site-state">A  ·  B</b></div>
        <div id="crosshair" class="crosshair" aria-hidden="true"><i></i><i></i><i></i><i></i><b></b><span class="hitmark"></span></div>
        <div id="damage-indicator" class="damage-indicator" aria-hidden="true"><i></i></div>
        <div id="health-cluster" class="health-cluster"><span class="health-symbol">+</span><strong id="health-value">100</strong><div class="health-details"><span id="health-label">生命值</span><div class="health-track"><i id="health-bar"></i></div><small id="armor-value">护甲 0</small></div></div>
        <div id="ammo-cluster" class="ammo-cluster"><div class="weapon-inventory" aria-label="随身武器"><span id="slot-rifle">1 AK</span><span id="slot-pistol">2 HG</span><b>HE <i id="grenade-count">1</i></b></div><div class="weapon-label"><span id="weapon-name">AK 系突击步枪</span><small id="weapon-short">7.62 / AR</small></div><div class="ammo-values"><strong id="ammo-value">30</strong><span>/ <b id="reserve-value">90</b></span></div><div id="reload-status" class="reload-status">点射，控制后坐力</div></div>
        <div id="spectator-label" class="spectator-label"></div>
        <div class="desktop-controls">WASD <span>移动</span>　R <span>换弹</span>　E <span>安放 / 拆除</span>　1 / 2 <span>切枪</span>　G <span>手雷</span>　C <span>蹲伏</span>　ESC <span>暂停</span></div>
      </section>

      <div class="touch-controls" aria-label="触屏操作">
        <div id="look-zone" class="look-zone" aria-label="拖动瞄准"><span>滑动瞄准</span></div>
        <div id="joystick" class="joystick" aria-label="移动摇杆"><i class="stick-tick top"></i><i class="stick-tick right"></i><i class="stick-tick bottom"></i><i class="stick-tick left"></i><div id="joystick-knob" class="joystick-knob"></div></div>
        <button id="aim-button" class="touch-button aim-button" aria-label="切换精细瞄准" aria-pressed="false"><span>精瞄</span></button>
        <button id="fire-button" class="fire-button" aria-label="按住开火">${icon('fire')}<span>开火</span></button>
        <button id="interact-button" class="touch-button interact-button" aria-label="安放或拆除炸弹">${icon('arrow')}<span>目标</span></button>
        <button id="reload-button" class="touch-button reload-button" aria-label="换弹">${icon('reload')}<span>换弹</span></button>
        <button id="grenade-button" class="touch-button grenade-button" aria-label="投掷手雷">${icon('grenade')}<span>手雷</span><b id="grenade-button-count">1</b></button>
        <button id="switch-button" class="touch-button switch-button" data-weapon="rifle" aria-label="切换武器">${icon('switch')}<span>切枪</span></button>
        <button id="crouch-button" class="touch-button crouch-button" aria-label="切换蹲伏" aria-pressed="false">${icon('crouch')}<span>蹲伏</span></button>
      </div>

      <section class="pause-overlay modal-overlay" aria-label="暂停与设置" role="dialog" aria-modal="true">
        <div class="pause-panel">
          <div class="panel-heading"><div><span class="eyebrow">TACTICAL CONTROL</span><h2 id="pause-title">行动暂停</h2></div><button class="icon-button" data-action="return" aria-label="关闭设置并返回">${icon('close')}</button></div>
          <div class="settings-grid">
            <label class="setting-item"><span>瞄准灵敏度 <output id="sensitivity-value">1.0</output></span><input id="setting-sensitivity" type="range" min="0.3" max="2.5" step="0.1" value="1" aria-label="瞄准灵敏度"></label>
            <label class="setting-item"><span>声音音量 <output id="volume-value">60%</output></span><input id="setting-volume" type="range" min="0" max="1" step="0.05" value="0.6" aria-label="声音音量"></label>
            <label class="setting-item setting-toggle"><span>触屏辅助瞄准<small>轻微修正准星附近的目标</small></span><input id="setting-assist" type="checkbox" checked><i class="toggle-track" aria-hidden="true"></i></label>
            <label class="setting-item"><span>画面质量</span><select id="setting-quality" aria-label="画面质量"><option value="low">流畅 · 推荐手机</option><option value="high">精细 · 更高画质</option></select></label>
          </div>
          <button class="primary-button resume-button" data-action="return"><span id="resume-label">继续行动</span>${icon('arrow')}</button>
          <div class="pause-secondary"><button class="text-button match-action" data-action="restart">重新开始</button><button class="text-button audio-test-button" data-action="audio-test">${icon('sound')}试听音效</button><button class="text-button" data-action="fullscreen">${icon('expand')}全屏</button><button class="text-button match-action" data-action="menu">返回主界面</button></div>
          <p class="settings-footnote" id="settings-footnote">战斗时间已停止 · 设置自动保存在本机</p>
          <p class="audio-state-detail" id="audio-state-detail">点击试听，检查背景与战斗音效</p>
          <div class="community-links"><button class="text-button" data-community="help">操作说明</button><button class="text-button" data-community="feedback">问题反馈</button><button class="text-button" data-community="share">分享游戏</button></div>
          <div class="asset-credits"><a href="${import.meta.env.BASE_URL}assets/CREDITS.html" target="_blank" rel="noopener">素材来源</a><a href="${import.meta.env.BASE_URL}assets/audio/CREDITS.html" target="_blank" rel="noopener">音效素材</a></div>
        </div>
      </section>

      <section class="result-overlay modal-overlay" aria-label="对局结算">
        <div class="result-panel"><div class="eyebrow">OPERATION REPORT</div><div class="result-rule"></div><h2 id="result-title">任务完成</h2><p id="result-description">蓝方小队赢得本次行动</p><div class="result-score"><span id="result-blue">3</span><i>:</i><span id="result-red">0</span></div><div class="result-stats"><span>本场击杀 <strong id="result-kills">0</strong></span><span>阵亡 <strong id="result-deaths">0</strong></span></div><button class="primary-button" data-action="restart"><span>再战一场</span>${icon('arrow')}</button><button class="text-button result-menu" data-action="menu">返回主界面</button><div class="community-links"><button class="text-button" data-community="help">操作说明</button><button class="text-button" data-community="feedback">问题反馈</button><button class="text-button" data-community="share">分享游戏</button></div></div>
      </section>
      <section class="handbook-overlay modal-overlay" aria-label="战术手册"><div class="handbook-panel"><div class="panel-heading"><div><span class="eyebrow">FIELD MANUAL</span><h2>战术手册</h2></div><button class="icon-button" data-action="close-handbook" aria-label="关闭">${icon('close')}</button></div><div class="handbook-grid"><article><b>枪械</b><p>AK 用于中远距离点射；手枪用于近距离应急。按 1 / 2 切换，移动中开火会放大散布。</p></article><article><b>阵营</b><p>CT 先占 A/B 交叉视线；T 让携弹者活到目标点，安放后围绕炸弹拖延。</p></article><article><b>投掷物</b><p>烟雾切断长线，闪光帮助过点，手雷清理箱后和拆弹位。每回合保留有限投掷物。</p></article><article><b>残局</b><p>炸弹已安放时优先听引线节奏；CT 有拆弹器可快速处理。无胜算时保枪，下一回合保留经济。</p></article></div></div></section>
      <div class="orientation-prompt"><span class="rotate-icon">${icon('rotate')}</span><strong>横屏，视野更开阔</strong><span>转动手机，进入战场</span><button class="text-button" data-action="menu">返回主界面</button></div>
    `;
    document.body.append(this.root);
    if (!this.callbacks.audioTest) this.root.querySelector<HTMLButtonElement>('.audio-test-button')!.hidden = true;
    for (const element of this.root.querySelectorAll<HTMLElement>('[id]')) this.refs.set(element.id, element);
    this.root.addEventListener('click', event => {
      const action = (event.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action;
      if (!action) return;
      event.stopPropagation();
      if (action === 'settings') { this.settingsOpen = true; this.refreshVisibility(); }
      if (action === 'handbook') this.root.classList.add('is-handbook');
      if (action === 'close-handbook') this.root.classList.remove('is-handbook');
      if (action === 'buy') this.callbacks.purchase?.((event.target as HTMLElement).closest<HTMLElement>('[data-item]')?.dataset.item as 'rifle'|'pistol'|'armor'|'defuseKit'|'he');
      if (action === 'fullscreen') this.callbacks.fullscreen();
      if (action === 'audio-test') this.callbacks.audioTest?.();
      if (action === 'audio-enable') this.callbacks.audioEnable?.();
      if (action === 'return') {
        this.settingsOpen = false;
        if (this.snapshot?.phase !== 'menu') this.callbacks.resume();
        this.refreshVisibility();
      }
      if (action === 'start' || action === 'restart' || action === 'menu') {
        this.settingsOpen = false;
        this.root.classList.remove('is-handbook');
        this.callbacks[action]();
        this.refreshVisibility();
      }
    });
    this.element<HTMLInputElement>('setting-sensitivity').addEventListener('input', event => {
      const sensitivity = Number((event.target as HTMLInputElement).value);
      this.setText('sensitivity-value', sensitivity.toFixed(1));
      this.callbacks.settings({ sensitivity });
    });
    this.element<HTMLInputElement>('setting-volume').addEventListener('input', event => {
      const volume = Number((event.target as HTMLInputElement).value);
      this.setText('volume-value', `${Math.round(volume * 100)}%`);
      this.callbacks.settings({ volume });
    });
    this.element<HTMLInputElement>('setting-assist').addEventListener('change', event => {
      this.callbacks.settings({ aimAssist: (event.target as HTMLInputElement).checked });
    });
    this.element<HTMLSelectElement>('setting-quality').addEventListener('change', event => {
      this.callbacks.settings({ quality: (event.target as HTMLSelectElement).value as Settings['quality'] });
    });
  }

  private element<T extends HTMLElement = HTMLElement>(id: string): T { return this.refs.get(id) as T; }
  private setText(id: string, value: string): void {
    const element = this.element(id);
    if (!element) return;
    if (element.textContent !== value) element.textContent = value;
  }

  private refreshVisibility(): void {
    const phase = this.snapshot?.phase ?? 'menu';
    const paused = Boolean(this.snapshot?.paused);
    this.root.dataset.phase = phase;
    this.root.classList.toggle('is-menu', phase === 'menu');
    this.root.classList.toggle('is-paused', paused || this.settingsOpen);
    this.root.classList.toggle('is-result', phase === 'matchEnd' && !paused);
    this.root.classList.toggle('is-spectating', Boolean(this.snapshot && this.snapshot.player.health <= 0));
    this.setText('pause-title', phase === 'menu' ? '行动设置' : '行动暂停');
    this.setText('resume-label', phase === 'menu' ? '返回主界面' : '继续行动');
    this.setText('settings-footnote', phase === 'menu' ? '设置自动保存在本机' : '战斗时间已停止 · 设置自动保存在本机');
  }

  update(snapshot: GameSnapshot): void {
    this.snapshot = snapshot;
    this.refreshVisibility();
    const actor = snapshot.spectating ?? snapshot.player;
    const gun = actor.guns[actor.weapon];
    this.setText('blue-score', String(snapshot.blueScore));
    this.setText('red-score', String(snapshot.redScore));
    this.setText('round-label', `回合 ${String(snapshot.round).padStart(2, '0')}`);
    const seconds = Math.max(0, Math.ceil(snapshot.roundTime));
    this.setText('round-time', `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`);
    this.element('round-time').classList.toggle('urgent', snapshot.phase === 'playing' && seconds <= 15);
    const aliveSignature = snapshot.actors.map(person => `${person.team}:${person.health > 0}`).join('|');
    if (aliveSignature !== this.aliveSignature) {
      this.aliveSignature = aliveSignature;
      for (const team of ['blue', 'red'] as const) {
        const teamActors = snapshot.actors.filter(person => person.team === team);
        this.element(`${team}-alive`).innerHTML = teamActors.map(person => `<i class="${person.health > 0 ? 'alive' : 'dead'}"></i>`).join('');
        this.element(`${team}-alive`).setAttribute('aria-label', `${team === 'blue' ? '蓝方' : '红方'}存活 ${teamActors.filter(person => person.health > 0).length} 人`);
      }
    }
    this.setText('health-value', String(Math.max(0, Math.ceil(actor.health))));
    this.setText('armor-value', `护甲 ${Math.max(0, Math.ceil(actor.armor))}`);
    this.setText('health-label', snapshot.spectating ? '队友生命' : '生命值');
    this.element('health-bar').style.transform = `scaleX(${Math.max(0, actor.health) / 100})`;
    this.element('health-cluster').classList.toggle('critical', actor.health <= 30);
    const weaponLabel = WEAPON_LABELS[actor.weapon];
    this.setText('weapon-name', weaponLabel.name);
    this.setText('weapon-short', weaponLabel.code);
    for (const kind of WEAPON_KINDS) this.element(`slot-${kind}`).classList.toggle('is-selected', actor.weapon === kind);
    this.setText('grenade-count', String(actor.grenades));
    this.setText('grenade-button-count', String(snapshot.player.grenades));
    this.element<HTMLButtonElement>('grenade-button').disabled = snapshot.player.grenades <= 0;
    this.setText('ammo-value', String(gun.ammo).padStart(2, '0'));
    this.setText('reserve-value', String(gun.reserve));
    this.element('ammo-cluster').classList.toggle('low-ammo', gun.ammo <= 5);
    this.element('ammo-cluster').classList.toggle('is-reloading', gun.reloadLeft > 0);
    this.setText('reload-status', gun.reloadLeft > 0 ? `装填中 · ${gun.reloadLeft.toFixed(1)}s` : gun.ammo === 0 ? '弹匣已空 · 请换弹' : '点射，控制后坐力');
    this.element('switch-button').dataset.weapon = snapshot.player.weapon;
    this.element('reload-button').classList.toggle('is-active', snapshot.player.guns[snapshot.player.weapon].reloadLeft > 0);
    const spread = 5 + Math.min(20, actor.spread * 170);
    this.element('crosshair').style.setProperty('--spread', `${spread}px`);
    this.element('crosshair').classList.toggle('is-hit', snapshot.hitMarker > 0);
    this.element('crosshair').classList.toggle('is-hidden', actor.health <= 0);
    const recentlyHurt = snapshot.time - snapshot.player.hurtTime >= 0 && snapshot.time - snapshot.player.hurtTime < 0.35 && snapshot.player.hurtTime > 0;
    this.root.classList.toggle('is-hurt', recentlyHurt);
    this.element('damage-indicator').style.transform = `rotate(${snapshot.damageAngle}rad)`;
    const banner = this.element('round-banner');
    banner.classList.toggle('is-visible', snapshot.phase === 'roundEnd');
    const bomb = snapshot.bomb;
    this.setText('bomb-state', bomb.status === 'planted' ? `炸弹 ${bomb.site} · ${Math.ceil(bomb.timer)}s` : bomb.status === 'dropped' ? '炸弹已掉落' : snapshot.player.faction === 'ct' ? 'CT 防守 A / B' : snapshot.player.hasBomb ? 'T 携带炸弹' : 'T 进攻 A / B');
    this.setText('site-state', bomb.status === 'planted' ? `拆除进度 ${Math.round(bomb.progress * 100)}%` : 'A  ·  B');
    if (snapshot.phase === 'roundEnd') {
      this.setText('banner-kicker', 'ROUND COMPLETE');
      this.setText('banner-title', snapshot.winner === 'blue' ? '蓝方回合胜利' : snapshot.winner === 'red' ? '红方回合胜利' : '回合平局');
      this.setText('banner-description', '下一回合即将开始');
    }
    this.setText('spectator-label', snapshot.player.health > 0 ? '' : snapshot.spectating ? `你已阵亡 · 正在观察 ${snapshot.spectating.name}` : '你已阵亡 · 等待下一回合');
    const feedSignature = snapshot.feed.map(entry => `${entry.at}:${entry.killer}:${entry.victim}:${entry.headshot}`).join('|');
    if (feedSignature !== this.feedSignature) {
      this.feedSignature = feedSignature;
      this.element('kill-feed').innerHTML = snapshot.feed.slice(-4).reverse().map(entry => `<div class="feed-entry"><span class="${entry.team}">${escapeText(entry.killer)}</span><i>${entry.headshot ? '爆头' : '击倒'}</i><span>${escapeText(entry.victim)}</span></div>`).join('');
    }
    if (snapshot.phase === 'matchEnd') {
      this.setText('result-title', snapshot.winner === 'blue' ? '任务完成' : '行动失利');
      this.setText('result-description', snapshot.winner === 'blue' ? '蓝方小队赢得本次行动' : '红方小队赢得本次行动 · 整装，再战');
      this.setText('result-blue', String(snapshot.blueScore));
      this.setText('result-red', String(snapshot.redScore));
      this.setText('result-kills', String(snapshot.player.kills));
      this.setText('result-deaths', String(snapshot.player.deaths));
    }
    const sensitivity = this.element<HTMLInputElement>('setting-sensitivity');
    const volume = this.element<HTMLInputElement>('setting-volume');
    if (document.activeElement !== sensitivity) sensitivity.value = String(snapshot.settings.sensitivity);
    if (document.activeElement !== volume) volume.value = String(snapshot.settings.volume);
    this.setText('sensitivity-value', snapshot.settings.sensitivity.toFixed(1));
    this.setText('volume-value', `${Math.round(snapshot.settings.volume * 100)}%`);
    this.element<HTMLInputElement>('setting-assist').checked = snapshot.settings.aimAssist;
    this.element<HTMLSelectElement>('setting-quality').value = snapshot.settings.quality;
  }

  setOffline(status: string): void { this.setText('offline-status', status); }
  setAudioStatus(status:{code:string;label:string;detail:string;needsGesture:boolean;muted:boolean}):void {
    this.setText('menu-audio-label',status.muted?'声音已关':status.needsGesture?'开启声音':status.code==='loading'?'声音载入中':'声音已开启');
    this.element('menu-audio-button').title=status.detail;
    this.element('sound-recovery').hidden=!status.needsGesture&&!status.muted;
    this.setText('sound-recovery-label',status.muted?'声音已关 · 开启':'轻触恢复声音');
    this.setText('audio-state-detail',status.detail);
  }
}
