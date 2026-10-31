import {restrictedWeapon,isTeamDeathmatch,hasRespawns,hasUnlimitedReserve,mapPlayableModes,modeForMap,PLAYABLE_MODES,RACE_LADDER,raceRanking,DEFENSE_UPGRADES,BOUNTY_KILL_REWARD,type PlayableMode,type DefenseUpgrade} from '../game/offlineModes';
import type {ArsenalItem} from '../game/loadouts';
import {killRanking} from '../game/deathmatch';
import {BOT_PRESETS,MAX_TEAM_SIZE} from '../game/botRoster';
import {purchaseWindow,itemPrice,itemAvailability,KILL_REWARD,DEATH_PENALTY} from '../game/economy';
import {WEAPON_KINDS} from '../game/types';
import {LOADOUTS} from '../game/loadouts';
import {nearestPickup} from '../game/pickups';
import {objectiveInteraction} from '../game/objectiveInteraction';
import type { GameSnapshot, Settings, WeaponKind } from '../game/types';
import {getActiveMap, MAPS, type MapId} from '../game/map';
import {Minimap} from './minimap';
import {handleShopKey,SHOP_SHORTCUT_ITEMS} from './shopKeyboard';
import './styles.css';

type Callbacks = {
  start: () => void; resume: () => void; restart: () => void; menu: () => void;
  settings: (patch: Partial<Settings>) => void; fullscreen: () => void;
  purchase?: (item: ArsenalItem) => boolean;
  toggleShop?: () => void;
  selectMode?: (mode:PlayableMode)=>void;
  nextWave?: ()=>void;
  upgrade?: (upgrade:DefenseUpgrade)=>void;
  botCounts?: (teammates:number,enemies:number)=>void;
  audioTest?: () => void;
  audioEnable?: () => void;
  gyroEnable?: () => void;
  gyroCalibrate?: () => void;
  selectMap?: (id: MapId) => Promise<void>;
};

const icons = {
  shop: '<path d="M2 3h3l3 12h10l3-9H6"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  expand: '<path d="M9 4H4v5m11-5h5v5M4 15v5h5m6 0h5v-5"/>',
  settings: '<path d="M4 7h16M4 17h16"/><path d="M9 4v6M15 14v6"/>',
  reload: '<path d="M19 8a8 8 0 1 0 1 7M19 3v6h-6"/>',
  switch: '<path d="M3 8h16l-4-4M21 16H5l4 4"/>',
  sprint: '<circle cx="15" cy="4" r="2"/><path d="m12 8 4 4 4-1M12 8l-4 4-4 1m8-5-2 7 5 3-1 4m-4-7-4 6H2"/>',
  jump: '<path d="M12 20V4m-6 6 6-6 6 6M5 21h14"/>',
  crouch: '<circle cx="13" cy="5" r="2"/><path d="m11 10 5 3 3-1M11 10l-3 5 6 2-1 4M8 15l-5 5h5"/>',
  fire: '<circle cx="12" cy="12" r="6"/><path d="M12 2v5m0 10v5M2 12h5m10 0h5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  rotate: '<rect x="6" y="3" width="12" height="18" rx="2"/><path d="M2 10V5h3M22 14v5h-3"/>',
  grenade: '<path d="m10 7-1-4h6l1 5M14 3h4l2 4M9 8c-3 2-4 5-3 9 1 4 10 4 12 0 1-4-1-7-4-9z"/><path d="m8 12 8 1M8 16h9"/>',
  armor: '<path d="M12 2 4 5v6c0 5 4 9 8 11 4-2 8-6 8-11V5z"/>',
  clock: '<circle cx="12" cy="13" r="8"/><path d="M12 8v5l3 2M9 2h6"/>',
  sound: '<path d="M4 9h4l5-4v14l-5-4H4zM17 8c3 2 3 6 0 8M20 5c5 4 5 10 0 14"/>',
};
const WEAPON_LABELS: Record<WeaponKind, { name: string; code: string; key: string; short: string }> = {
  rifle: { name: 'AK 系突击步枪', code: '7.62 / AR', key: '1', short: 'AK' },
  pistol: { name: 'USP 战术手枪', code: '.45 / HG', key: '2', short: 'USP' },
  smg: { name: 'MP 系冲锋枪', code: '9×19 / SMG', key: '3', short: 'MP5' },
  shotgun: { name: 'Nova 泵动霰弹', code: '12 GA / SG', key: '4', short: 'NOVA' },
  m4: { name: 'M4A1 突击步枪', code: '5.56 / AR', key: '5', short: 'M4' },
  knife: { name: '经典匕首', code: '劈砍 / 刺击', key: '7', short: '刀' },
  sniper: { name: 'AWP 狙击步枪', code: '.338 / SR', key: '6', short: 'AWP' },
  deagle: { name: '沙漠之鹰', code: '.50 AE / HG', key: '8', short: '沙鹰' },
};
const BOUNTY_GUNS = ['pistol','shotgun','deagle','smg','rifle','m4','sniper'] as const;
const DEFENSE_ITEMS = ['rifle','m4','smg','shotgun','sniper','pistol','deagle','armor','he'] as const;
function gunStats(kind:WeaponKind):string {
  const gun=LOADOUTS[kind];
  return `${gun.magazine} 发弹匣 · ${gun.damage}${gun.pellets>1?`×${gun.pellets}`:''} 基础伤害`;
}
function formatElapsed(seconds:number):string {
  const elapsed=Math.max(0,Math.floor(seconds));
  return `${String(Math.floor(elapsed/60)).padStart(2,'0')}:${String(elapsed%60).padStart(2,'0')}`;
}
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
  private shopOpen = false;
  private rankingRequested = false;
  private refs = new Map<string, HTMLElement>();
  private feedSignature = '';
  private aliveSignature = '';
  private mapLoading = false;
  private mapSignature = '';
  private modeOptionsSignature = '';
  private minimap: Minimap;

  constructor(private callbacks: Callbacks) {
    this.root = document.createElement('div');
    this.root.id = 'game-ui';
    this.root.className = 'game-ui is-menu';
    if (new URLSearchParams(location.search).get('touch') === '1') this.root.classList.add('force-touch');
    const coarsePointer = window.matchMedia('(pointer: coarse)');
    const updateTouchLayout = () => this.root.classList.toggle('compact-hud', coarsePointer.matches || this.root.classList.contains('force-touch'));
    updateTouchLayout();
    coarsePointer.addEventListener('change', updateTouchLayout);
    this.root.innerHTML = `
      <section class="main-menu" aria-label="沙线行动主界面">
          <header class="menu-masthead"><div class="wordmark"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span><span>SANDLINE<span class="wordmark-sub">TACTICAL OPERATIONS</span></span></div><span class="edition">HERO PASS <b>01</b></span></header>
        <div class="menu-content">
          <div class="eyebrow"><span class="live-dot"></span> 单机战术行动 <span class="eyebrow-line"></span> <span id="menu-map-counter"></span></div>
          <h1>沙线行动<span>SANDLINE</span></h1>
          <p class="menu-description">穿越沙尘，守住阵线。<br>与你的小队，完成下一次突入。</p>
          <div class="mode-strip"><button class="roster-button" data-action="bot-settings" aria-label="调整双方人数" aria-haspopup="dialog"><strong id="mode-count">3 VS 3</strong><small><span id="roster-action">调整人数</span>${icon('settings')}</small></button><span id="mode-name">击杀排名</span><span id="mode-format" class="mode-continuous">持续对战</span></div>
          <div class="deployment-options"><div class="map-choice"><div class="map-choice-label"><label for="map-select">作战地图</label><small id="map-choice-count"></small></div><div class="map-select-wrap"><select id="map-select" aria-describedby="map-description map-load-error">${Object.values(MAPS).map(map => `<option value="${escapeText(map.id)}"${map.id === getActiveMap().id ? ' selected' : ''}>${escapeText(map.name)}</option>`).join('')}</select><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5 7 5 5 5-5" stroke="currentColor" stroke-width="1.5"/></svg></div></div>
          <div class="mode-choice"><label for="mode-select">行动玩法</label><select id="mode-select" aria-describedby="mode-brief">${mapPlayableModes().map(id=>`<option value="${id}">${PLAYABLE_MODES[id].name}</option>`).join('')}</select></div></div>
          <button class="primary-button start-button" data-action="start"><span>突入战场<small>DEPLOY SQUAD</small></span>${icon('arrow')}</button>
          <div class="menu-secondary"><button class="text-button" data-action="settings">${icon('settings')}行动设置</button><button class="text-button" data-action="handbook">战术手册</button><button class="text-button" data-action="audio-enable" id="menu-audio-button">${icon('sound')}<span id="menu-audio-label">开启声音</span></button><button class="text-button" data-action="fullscreen">${icon('expand')}全屏</button></div>
        </div>
        <section class="map-selection" id="map-selection" aria-label="所选地图预览" aria-busy="false">
          <div class="map-selection-heading"><span>战场预览</span><small id="map-preview-number"></small></div>
          <figure class="map-preview" id="map-preview"><img id="map-preview-image" alt=""><span class="map-preview-shade" aria-hidden="true"></span><span class="map-preview-fallback" id="map-preview-fallback" hidden>地图预览暂不可用</span><span class="map-preview-tag">作战区域</span><figcaption aria-live="polite" aria-atomic="true"><small id="map-preview-subtitle"></small><strong id="map-preview-name"></strong></figcaption></figure>
          <p id="map-description"></p><p id="mode-brief" class="mode-brief"></p>
          <div class="map-load" id="map-load" hidden><img id="map-load-image" src="${import.meta.env.BASE_URL}${getActiveMap().preview}" alt=""><div><span id="map-load-label">正在准备作战区域</span><strong id="map-load-percent">0%</strong><i id="map-load-progress" role="progressbar" aria-label="地图加载进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><b id="map-load-bar"></b></i></div></div>
          <p id="map-load-error" role="alert" hidden></p>
        </section>
        <div class="community-links"><button class="text-button" data-community="help">操作说明</button><button class="text-button" data-community="feedback">问题反馈</button><button class="text-button" data-community="share">分享游戏</button></div>
        <div class="scene-caption"><span id="scene-number">作战区域 / 01</span><strong id="scene-name">沙漠仓储区</strong><small id="scene-subtitle">DUST DEPOT · 3 ROUTES · CLOSE QUARTERS</small></div>
        <footer class="menu-footer"><span class="offline-status" id="offline-status">正在准备本地资源</span><span class="menu-desktop-hint">WASD 移动 <i>·</i> Shift 跑步 <i>·</i> 空格跳跃 <i>·</i> 鼠标瞄准 <span class="unrestricted-control"><i>·</i> G 手雷</span></span><span class="menu-touch-hint">左侧移动 <i>·</i> 空白处瞄准 <i>·</i> 按住开火</span><span class="build-label">HERO PASS / 01</span></footer>
      </section>

      <section class="combat-hud" aria-label="战斗状态">
        <div class="scope-reticle" aria-hidden="true"><div class="scope-lens"><svg class="scope-glass" viewBox="0 0 400 400" fill="none"><circle cx="200" cy="200" r="198" stroke="currentColor" stroke-width="2"/><path class="scope-posts" d="M2 200H112M288 200H398M200 2V112M200 288V398"/><path class="scope-hairlines" d="M112 200H196M204 200H288M200 112V196M200 204V288M152 196V204M168 197V203M184 197V203M216 197V203M232 197V203M248 196V204M196 152H204M197 168H203M197 184H203M197 216H203M197 232H203M196 248H204M191 264H209M188 280H212"/><circle class="scope-center" cx="200" cy="200" r="1"/><g class="scope-marks"><text x="251" y="213">3</text><text x="212" y="251">3</text><text x="215" y="283">5</text></g></svg><span class="scope-magnification">3× <i>SNIPER OPTIC</i></span></div></div>
        <button id="desktop-aim-button" class="desktop-aim-button" aria-label="开镜 · 3 倍狙击镜" aria-pressed="false"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="7"/><path d="M12 1v7m0 8v7M1 12h7m8 0h7"/></svg><span>开镜</span><small>Q / 鼠标右键</small></button>
        <div class="minimap-cluster"><canvas id="minimap" width="300" height="300" aria-label="战术小地图：自己的位置、朝向与存活队友"></canvas><span class="minimap-north">N</span><div class="location-label"><span id="location-name">沙漠仓储区</span><small id="location-mode">爆破行动</small></div></div>
        <div class="scoreboard">
          <div class="team-score blue"><span id="blue-team-name" class="team-name">蓝方</span><strong id="blue-score">0</strong><div id="blue-alive" class="alive-dots"></div><span id="blue-survivors" class="survivor-count">存活 3 / 3</span></div>
          <div class="round-clock"><span id="round-label">团队击杀</span><b class="round-score-divider">:</b><small id="round-format">持续对战</small></div>
          <div class="team-score red"><span id="red-team-name" class="team-name">红方</span><strong id="red-score">0</strong><div id="red-alive" class="alive-dots"></div><span id="red-survivors" class="survivor-count">存活 3 / 3</span></div>
        </div>
        <div id="mode-status" class="mode-status" hidden><strong id="mode-status-title"></strong><span id="mode-status-detail"></span><div class="mode-progress"><i id="mode-progress-fill"></i></div><small id="mode-status-alert" role="status"></small></div>
        <button id="ranking-button" class="ranking-button" aria-label="查看击杀排行榜"><span id="personal-rank">你 · 第 1 名</span><small id="leader-line">查看击杀排名</small></button>
        <button id="pause-button" class="icon-button pause-button" aria-label="暂停游戏">${icon('pause')}</button>
        <button id="sound-recovery" class="sound-recovery" data-action="audio-enable" hidden>${icon('sound')}<span id="sound-recovery-label">开启声音</span></button>
        <div class="economy-hud"><strong id="money-balance">$800</strong><button id="battle-button" aria-label="打开补给商店" title="补给商店 · B 键打开">${icon('shop')}商店 <kbd>B</kbd></button><small id="shop-hint">出生区购买</small><span id="money-change" role="status"></span></div><div id="kill-feed" class="kill-feed" aria-label="击杀记录"></div>
        <div id="round-banner" class="round-banner"><span id="banner-kicker">准备阶段</span><strong id="banner-title">部署中</strong><small id="banner-description">寻找掩体，准备交火</small></div>
        <div id="objective-hud" class="objective-hud"><span id="bomb-state">炸弹：CT 防守</span><b id="site-state">A  ·  B</b><small id="objective-round"></small></div>
        <div id="crosshair" class="crosshair" aria-hidden="true"><i></i><i></i><i></i><i></i><b></b><span class="hitmark"></span></div>
        <div class="damage-blood" aria-hidden="true"></div><div id="damage-indicator" class="damage-indicator" aria-hidden="true"><i></i></div>
        <div class="classic-clock">${icon("clock")}<strong id="round-time">01:30</strong></div>
        <div id="health-cluster" class="health-cluster"><span class="health-symbol">+</span><strong id="health-value">100</strong><div class="health-details"><span id="health-label">生命值</span><div class="health-track"><i id="health-bar"></i></div></div><div class="armor-stat">${icon("armor")}<strong id="armor-value">0</strong><small>护甲</small></div></div>
        <div id="ammo-cluster" class="ammo-cluster"><div class="weapon-inventory" aria-label="随身武器">${WEAPON_KINDS.map(kind => `<span id="slot-${kind}" title="${LOADOUTS[kind].name}"${kind === 'rifle' || kind === 'pistol' || kind === 'knife' ? '' : ' hidden'}>${WEAPON_LABELS[kind].key} ${WEAPON_LABELS[kind].short}</span>`).join('')}<b>HE <i id="grenade-count">1</i></b></div><div class="weapon-label"><span id="weapon-name">AK 系突击步枪</span><small id="weapon-short">7.62 / AR</small></div><div class="ammo-values"><strong id="ammo-value">30</strong><span>/ <b id="reserve-value">90</b></span></div><div id="reload-status" class="reload-status">点射，控制后坐力</div></div>
        <div id="pickup-prompt" class="pickup-prompt" hidden><kbd id="interaction-key">E</kbd><span id="pickup-name"></span><small id="pickup-detail"></small><div id="interaction-progress" class="interaction-progress" role="progressbar" aria-label="目标操作进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" hidden><i id="interaction-progress-fill"></i></div></div>
        <div id="spectator-label" class="spectator-label"></div>
        <div class="desktop-controls">WASD <span>移动</span>　Shift <span>跑步</span>　<span class="reload-control">R <span>换弹</span>　</span><span class="unrestricted-control"><span id="interact-hint">E 拾取 / 目标</span>　1–8 / 滚轮 <span>切换</span>　V <span>短刀</span></span><span id="desktop-aim-control">　Q / 右键 <span id="desktop-aim-hint">精瞄</span></span><span class="unrestricted-control">　G <span>手雷</span>　B <span>商店</span></span>　空格 <span>跳跃</span>　C <span>蹲伏</span>　ESC <span>暂停</span></div>
      </section>

      <div class="touch-controls" aria-label="触屏操作">
        <div id="look-zone" class="look-zone" aria-label="拖动瞄准"><span>滑动瞄准</span></div>
        <div id="joystick" class="joystick" aria-label="移动摇杆"><i class="stick-tick top"></i><i class="stick-tick right"></i><i class="stick-tick bottom"></i><i class="stick-tick left"></i><div id="joystick-knob" class="joystick-knob"></div></div>
        <button id="aim-button" class="touch-button aim-button" aria-label="切换精细瞄准" aria-pressed="false"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="7"/><path d="M12 1v7m0 8v7M1 12h7m8 0h7"/></svg><span>精瞄</span></button>
        <button id="fire-button" class="fire-button" aria-label="按住开火">${icon('fire')}<span id="fire-button-label">开火</span></button>
        <button id="interact-button" class="touch-button interact-button" aria-label="安放或拆除炸弹">${icon('arrow')}<span id="interact-label">目标</span></button>
        <button id="reload-button" class="touch-button reload-button" aria-label="换弹">${icon('reload')}<span>换弹</span></button>
        <button id="grenade-button" class="touch-button grenade-button" aria-label="投掷手雷">${icon('grenade')}<span>手雷</span><b id="grenade-button-count">1</b></button>
        <button id="switch-button" class="touch-button switch-button" data-weapon="rifle" aria-label="切换武器">${icon('switch')}<span>切换</span></button>
        <button id="jump-button" class="touch-button jump-button" aria-label="跳跃">${icon('jump')}<span>跳跃</span></button>
        <button id="sprint-button" class="touch-button sprint-button" aria-label="切换跑步" aria-pressed="false">${icon('sprint')}<span id="sprint-label">跑步</span></button>
        <button id="crouch-button" class="touch-button crouch-button" aria-label="切换蹲伏" aria-pressed="false">${icon('crouch')}<span>蹲伏</span></button>
      </div>

      <section class="pause-overlay modal-overlay" aria-label="暂停与设置" role="dialog" aria-modal="true">
        <div class="pause-panel">
          <div class="panel-heading"><div><span class="eyebrow">TACTICAL CONTROL</span><h2 id="pause-title">行动暂停</h2></div><button class="icon-button" data-action="return" aria-label="关闭设置并返回">${icon('close')}</button></div>
          <section class="bot-setup" aria-label="机器人配置"><h3>对战人数</h3><p id="bot-team-hint">蓝方包含你 1 人；手机推荐 3 对 3 或 5 对 5。</p>
            <div class="bot-presets" role="group" aria-label="双方人数预设">${BOT_PRESETS.map(size=>`<button data-action="bot-preset" data-size="${size}" id="bot-preset-${size}" aria-pressed="false">${size} 对 ${size}</button>`).join('')}</div>
            <div class="bot-row"><span>队友机器人 <b id="ally-bot-count">2</b><small>不含自己 · 0–${MAX_TEAM_SIZE-1} 人</small></span><button data-action="bot-count" data-team="blue" data-delta="-1" id="ally-remove" aria-label="减少队友机器人">−</button><button data-action="bot-count" data-team="blue" data-delta="1" id="ally-add" aria-label="添加队友机器人">＋</button></div>
            <div class="bot-row"><span>对手机器人 <b id="enemy-bot-count">3</b><small>1–${MAX_TEAM_SIZE} 人</small></span><button data-action="bot-count" data-team="red" data-delta="-1" id="enemy-remove" aria-label="减少对手机器人">−</button><button data-action="bot-count" data-team="red" data-delta="1" id="enemy-add" aria-label="添加对手机器人">＋</button></div>
            <div class="bot-setup-footer"><span id="bot-summary" role="status" aria-live="polite">蓝方 3 人 · 红方 3 人</span><button class="text-button" data-action="return">完成 ${icon('arrow')}</button></div>
          </section>
          <div class="settings-grid">
            <label class="setting-item setting-view-scale"><span>视角放大 <output id="view-scale-value">1.00×</output></span><input id="setting-view-scale" type="range" min="1" max="1.3" step="0.05" value="1" aria-label="视角放大" aria-describedby="view-scale-hint"><small id="view-scale-hint">放大目标会缩小两侧视野</small></label>
            <label class="setting-item"><span>瞄准灵敏度 <output id="sensitivity-value">1.0</output></span><input id="setting-sensitivity" type="range" min="0.3" max="2.5" step="0.1" value="1" aria-label="瞄准灵敏度"></label>
            <label class="setting-item"><span>声音音量 <output id="volume-value">60%</output></span><input id="setting-volume" type="range" min="0" max="1" step="0.05" value="0.6" aria-label="声音音量"></label>
            <label class="setting-item setting-toggle"><span>触屏辅助瞄准<small>触屏准星减速与轻微吸附</small></span><input id="setting-assist" type="checkbox" checked><i class="toggle-track" aria-hidden="true"></i></label>
            <label class="setting-item setting-toggle"><span>开火拖动瞄准<small>按住开火键滑动，同时调整准星</small></span><input id="setting-fire-drag" type="checkbox" checked><i class="toggle-track" aria-hidden="true"></i></label>
            <label class="setting-item"><span>陀螺仪瞄准</span><select id="setting-gyro-mode" aria-label="陀螺仪瞄准"><option value="off">关闭</option><option value="aim">仅开镜 / 精瞄</option><option value="always">始终开启</option></select></label>
            <label class="setting-item"><span>陀螺仪灵敏度 <output id="gyro-sensitivity-value">1.0×</output></span><input id="setting-gyro-sensitivity" type="range" min="0.3" max="3" step="0.1" value="1" aria-label="陀螺仪灵敏度"></label>
            <div class="gyro-settings" aria-label="陀螺仪状态"><p id="gyro-status" role="status">陀螺仪已关闭</p><p id="gyro-detail">选择模式后，点击启用以检查手机传感器权限。</p><div class="gyro-actions"><button id="gyro-enable" class="text-button" data-action="gyro-enable">启用陀螺仪</button><button id="gyro-calibrate" class="text-button" data-action="gyro-calibrate" disabled>转动归零</button></div><small>横屏握稳手机，进入游戏后转动瞄准；“仅开镜”模式需要按住开镜 / 精瞄。</small><a href="https://ihca.cn/sandline/" target="_blank" rel="noopener">用 HTTPS 打开沙线行动</a><details class="gyro-diagnostics"><summary>传感器诊断</summary><pre id="gyro-diagnostics">尚未启用</pre><small>iPhone 建议使用 Safari；微信、抖音等内置浏览器可能不开放权限。</small></details></div>
            <label class="setting-item"><span>画面质量</span><select id="setting-quality" aria-label="画面质量"><option value="low">流畅 · 推荐手机</option><option value="high">精细 · 更高画质</option></select></label>
          </div>
          <section class="battle-management" aria-label="双方战况"><h3>双方战况</h3><div class="roster-columns"><div><h4 id="blue-roster-title">蓝方</h4><table><thead><tr><th>成员</th><th>状态</th><th>击杀 / 死亡</th></tr></thead><tbody id="blue-roster"></tbody></table></div><div><h4 id="red-roster-title">红方</h4><table><thead><tr><th>成员</th><th>状态</th><th>击杀 / 死亡</th></tr></thead><tbody id="red-roster"></tbody></table></div></div>
          </section>
          <button class="primary-button resume-button" data-action="return"><span id="resume-label">继续行动</span>${icon('arrow')}</button>
          <div class="pause-secondary"><button class="text-button match-action" data-action="restart">重新开始</button><button class="text-button audio-test-button" data-action="audio-test">${icon('sound')}试听音效</button><button class="text-button" data-action="fullscreen">${icon('expand')}全屏</button><button class="text-button match-action" data-action="menu">返回主界面</button></div>
          <p class="settings-footnote" id="settings-footnote">战斗时间已停止 · 设置自动保存在本机</p>
          <p class="audio-state-detail" id="audio-state-detail">点击试听，检查背景与战斗音效</p>
          <div class="community-links"><button class="text-button" data-community="help">操作说明</button><button class="text-button" data-community="feedback">问题反馈</button><button class="text-button" data-community="share">分享游戏</button></div>
          <div class="asset-credits"><a href="${import.meta.env.BASE_URL}assets/CREDITS.html" target="_blank" rel="noopener">素材来源</a><a href="${import.meta.env.BASE_URL}assets/audio/CREDITS.html" target="_blank" rel="noopener">音效素材</a></div>
        </div>
      </section>

      <section class="ranking-overlay modal-overlay" aria-label="击杀排行榜" role="dialog" aria-modal="true">
        <div class="ranking-panel"><div class="panel-heading"><div><span class="eyebrow">LIVE LEADERBOARD</span><h2>击杀排行榜</h2></div><button class="icon-button" data-action="return" aria-label="关闭排行榜">${icon('close')}</button></div>
        <p id="ranking-rules">不限局数 · 阵亡 3 秒后复活 · 击杀相同时死亡少者优先</p>
        <table><thead><tr><th>排名</th><th>成员</th><th>击杀</th><th>死亡</th><th>状态</th></tr></thead><tbody id="kill-ranking"></tbody></table>
        <button class="primary-button" data-action="return">继续战斗 ${icon('arrow')}</button><small>查看排名时战斗暂停 · 重新开始会清空本场排名</small></div>
      </section>

      <section id="supply-shop" class="supply-shop-overlay" role="dialog" aria-modal="true" aria-labelledby="shop-heading" hidden>
        <div class="supply-shop-panel">
          <header class="shop-header"><div><span class="eyebrow">FIELD SUPPLY</span><h2 id="shop-heading">补给商店</h2></div><div class="shop-wallet"><small>可用资金</small><strong id="shop-money">$800</strong></div><button id="shop-close" class="icon-button" data-action="close-shop" aria-label="关闭商店">${icon('close')}</button></header>
          <div class="shop-status"><span id="shop-window"></span><small>战斗已暂停</small></div>
          <div class="shop-scroll">
            <p id="shop-instructions" class="shop-instructions"></p>
            <div class="shop-catalog" aria-label="枪械与补给">${SHOP_SHORTCUT_ITEMS.map((item,index)=>{
              const gun=BOUNTY_GUNS.find(kind=>kind===item),name=gun?WEAPON_LABELS[gun].short:item==='ammo'?'弹药补给':'高爆手雷';
              return `<button class="shop-product" data-action="buy" data-item="${item}" id="shop-buy-${item}"><span class="shop-product-art"><kbd>${index+1}</kbd>${gun?`<img src="${import.meta.env.BASE_URL}assets/ui/shop/${gun}.png" alt="${LOADOUTS[gun].name}" width="512" height="220" draggable="false">`:icon(item==='he'?'grenade':'reload')}</span><strong>${name}<b>$${itemPrice(item)}</b></strong><span class="shop-product-detail">${gun?gunStats(gun):item==='ammo'?'补满所有枪械备用弹药':'最多携带 2 枚'}</span><small id="shop-status-${item}"></small></button>`;
            }).join('')}</div>
            <div class="shop-equipment"><span>其他装备</span><button data-action="buy" data-item="armor" id="buy-armor">${icon('armor')}护甲 <b>$650</b></button><button data-action="buy" data-item="defuseKit" id="buy-kit">拆弹器 <b>$400</b></button><small id="shop-inventory"></small></div>
            <p id="shop-economy-rules"></p>
          </div>
          <footer class="shop-footer"><p id="shop-feedback" role="status" aria-live="polite">选择商品购买</p><span><kbd>1–9</kbd> 购买 · <kbd>B / Esc</kbd> 返回战斗</span></footer>
        </div>
      </section>
      <section class="intermission-overlay" aria-label="据点补给" role="dialog" aria-modal="true">
        <div class="intermission-panel"><header><span class="eyebrow">HOLD THE LINE</span><h2 id="defense-break-title">守住据点</h2><p id="defense-break-detail"></p></header>
          <div class="intermission-body"><section id="defense-upgrades"><h3>本次强化 · 三选一</h3><div class="upgrade-options">${Object.entries(DEFENSE_UPGRADES).map(([id,upgrade])=>`<button data-action="upgrade" data-upgrade="${id}" id="upgrade-${id}"><strong>${upgrade.name}</strong><span>${upgrade.description}</span></button>`).join('')}</div></section>
          <p id="defense-perks"></p><div class="supply-title"><h3>波间补给</h3><b id="defense-money"></b></div><p class="supply-hint">生命与弹药已补满 · 购买枪械后自动装备</p>
          <div class="defense-shop">${DEFENSE_ITEMS.map(item=>`<button data-action="buy" data-item="${item}" id="supply-${item}"><span>${item==='armor'?'护甲':item==='he'?'高爆手雷':WEAPON_LABELS[item].short}${item!=='armor'&&item!=='he'?`<small>${gunStats(item)}</small>`:''}</span><b>$${itemPrice(item)}</b></button>`).join('')}</div><p id="defense-shop-feedback" role="status"></p></div>
          <footer><button class="text-button" data-action="menu">返回主界面</button><button class="primary-button" data-action="next-wave" id="next-wave">开始第 1 波 ${icon('arrow')}</button></footer>
        </div>
      </section>
      <section class="result-overlay modal-overlay" aria-label="对局结算">
        <div class="result-panel"><div class="eyebrow">OPERATION REPORT</div><div class="result-rule"></div><h2 id="result-title">任务完成</h2><p id="result-description">蓝方小队赢得本次行动</p><div class="result-score"><span id="result-blue">3</span><i>:</i><span id="result-red">0</span></div><p id="bounty-result-progress" class="bounty-result-progress" hidden></p><div class="result-stats"><span>本场击杀 <strong id="result-kills">0</strong></span><span>阵亡 <strong id="result-deaths">0</strong></span></div><button class="primary-button" data-action="restart"><span id="result-restart-label">再战一场</span>${icon('arrow')}</button><button class="text-button result-menu" data-action="menu">返回主界面</button><div class="community-links"><button class="text-button" data-community="help">操作说明</button><button class="text-button" data-community="feedback">问题反馈</button><button class="text-button" data-community="share">分享游戏</button></div></div>
      </section>
      <section class="handbook-overlay modal-overlay" aria-label="战术手册"><div class="handbook-panel"><div class="panel-heading"><div><span class="eyebrow">FIELD MANUAL</span><h2>战术手册</h2></div><button class="icon-button" data-action="close-handbook" aria-label="关闭">${icon('close')}</button></div><div class="handbook-grid"><article><b>Bloodstrike · 自由交火</b><p>支持 3v3、5v5、8v8、10v10。首局全员 USP 手枪、匕首和 $800，首局不可购买。每次击杀获得 $${BOUNTY_KILL_REWARD}，余额带入下一回合，阵亡不扣钱。第二局起在己方出生补给区按 B 或点击商店购买，1–9 快捷购买；手雷限每局开始后 20 秒。每局无复活、无时间限制，全歼对方赢一局，双方同时全灭则平局，先赢 3 回合获胜。阵亡后观战队友，下局配发手枪；存活者保留装备和剩余弹药。机器人按相同经济购枪。新回合自动打开商店并暂停战斗，关闭商店后继续。</p></article><article><b>仓库突击 · 解救人质</b><p>反恐精英需在 180 秒内救出全部 4 名人质。靠近人质按 E 或触屏「跟随」，将其护送到小地图绿色救援区；再次交互可让人质等待。歼灭恐怖分子后仍需完成救援。反恐精英全员阵亡或时间耗尽，恐怖分子获胜。</p></article><article><b>Dust2 · 定时爆破</b><p>恐怖分子在 A / B 区域按住 E 或触屏「安放」3 秒，C4 在 40 秒后引爆。反恐精英靠近炸弹按住 E 或「拆除」10 秒；携带拆弹器只需 5 秒。安放前歼灭恐怖分子或守满 120 秒，反恐精英获胜；安放后即使恐怖分子全灭，也必须拆弹。两张地图均先赢 3 回合获胜，阵亡后等待下一回合。</p></article><article><b>刀战 / 手枪战</b><p>蓝红两队持续交战，按击杀排名，阵亡 3 秒后复活。刀战全员只用匕首，可劈砍和刺击；手枪战全员只用 USP，备用弹药不限，但仍需换弹。两种模式均不能切换其他武器、购买、拾枪或投雷。</p></article><article><b>军备竞赛</b><p>除自己外全是对手。AK → M4 → MP5 → Nova → AWP → USP，每两杀升一级，最后一刀获胜。死亡保级，备用弹药不限；本模式不能购买、拾枪或投雷。</p></article><article><b>据点守卫</b><p>你与两名队友守住 8 波攻势。敌人进入金色据点圈会损伤耐久，全队阵亡、耐久归零或单波超过 210 秒则失败。波间补满生命和弹药；第 2、4、6 波后选择强化，再开始下一波。</p></article><article><b>枪械</b><p>1 AK、2 USP、3 MP5、4 Nova、5 M4A1、6 AWP、7 匕首、8 沙鹰。按数字键 1–8 或滚轮切换已持有枪械；触屏点击切枪。沙鹰为 8 发高伤害手枪，适合沉稳点射；AWP 弹匣为 10 发。Q / 鼠标右键或触屏「精瞄」切换瞄准；AWP 开启狙击镜。步枪适合点射，霰弹用于近战，狙击适合远射。V / 7 切匕首：左键或「劈砍」快速挥刀；右键、Q 或「刺击」向前突刺，伤害更高但收刀更慢。</p></article><article><b>自由交火</b><p>蓝红两队持续交战，按个人击杀数排名，同分时死亡少者优先。阵亡 3 秒后复活，保留击杀、金钱和已获得枪械。复活保护持续 1.5 秒，开火或投雷即结束。</p></article><article><b>补给商店</b><p>在出生补给区按 B，或点击战斗界面「商店」。面板内按 1–9 或点击图片购买，B / Esc 关闭；打开时战斗暂停。每回合开始或复活后 20 秒内可购买。弹药补给 $200，补满所有已持枪械的备用弹药，仍需正常换弹。Bloodstrike 可随时购买，据点守卫在波间补给；刀战、手枪战和军备竞赛固定装备。</p></article><article><b>投掷物</b><p>当前提供高爆手雷。在回合开局或复活后的 20 秒内，可在出生补给区购买，最多携带 2 枚、每条生命最多买 2 枚；没有烟雾弹或闪光弹。</p></article><article><b>地面武器</b><p>靠近地上的枪，按 E 或触屏「拾取」获得并装备；附近有人质或炸弹时优先操作目标，弹药显示在右下角。已有同款时补充弹药；复活补满已持有武器的弹药，地面补给每 20 秒刷新。</p></article></div></div></section>
      <div class="orientation-prompt" role="status"><span class="rotate-icon">${icon('rotate')}</span><strong>请横屏游玩《沙线行动》</strong><span>转动手机，进入战场</span></div>
    `;
    document.body.append(this.root);
    if (!this.callbacks.audioTest) this.root.querySelector<HTMLButtonElement>('.audio-test-button')!.hidden = true;
    for (const element of this.root.querySelectorAll<HTMLElement>('[id]')) this.refs.set(element.id, element);
    this.minimap = new Minimap(this.element<HTMLCanvasElement>('minimap'));
    this.element<HTMLSelectElement>('map-select').disabled = !this.callbacks.selectMap;
    this.element('mode-select').addEventListener('change',event=>{event.stopPropagation();if(!this.mapLoading)this.callbacks.selectMode?.((event.target as HTMLSelectElement).value as PlayableMode);});
    this.element('map-select').addEventListener('change', event => {
      event.stopPropagation();
      void this.selectMap((event.target as HTMLSelectElement).value as MapId);
    });
    this.element('map-preview-image').addEventListener('error', () => {
      this.element('map-preview-fallback').hidden = false;
      this.element('map-preview').classList.add('is-unavailable');
    });
    this.element('map-preview-image').addEventListener('load', () => {
      this.element('map-preview-fallback').hidden = true;
      this.element('map-preview').classList.remove('is-unavailable');
    });
    this.refreshMap();
    this.element('battle-button').addEventListener('click',()=>this.callbacks.toggleShop?.());
    window.addEventListener('keydown',event=>{
      handleShopKey(event,{isOpen:()=>this.shopOpen,canOpen:()=>this.canOpenShop(),toggle:()=>this.callbacks.toggleShop?.(),buy:item=>this.purchaseItem(item)});
      if(this.shopOpen&&event.code==='Tab'){
        const buttons=Array.from(this.element('supply-shop').querySelectorAll<HTMLButtonElement>('button:not(:disabled):not([hidden])'));
        const first=buttons[0],last=buttons[buttons.length-1];
        if(event.shiftKey&&(document.activeElement===first||!this.element('supply-shop').contains(document.activeElement))){event.preventDefault();last?.focus();}
        else if(!event.shiftKey&&(document.activeElement===last||!this.element('supply-shop').contains(document.activeElement))){event.preventDefault();first?.focus();}
      }
    },{capture:true});
    this.element('ranking-button').addEventListener('click',()=>{this.rankingRequested=true;});
    this.root.addEventListener('click', event => {
      const action = (event.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action;
      if (!action) return;
      event.stopPropagation();
      if (action === 'start' && this.mapLoading) return;
      if (action === 'settings' || action === 'bot-settings') {
        this.settingsOpen = true; this.refreshVisibility();
        this.root.querySelector('.pause-panel')!.scrollTop=0;
        if(action==='bot-settings')this.element('bot-preset-3').focus({preventScroll:true});
      }
      if (action === 'handbook') this.root.classList.add('is-handbook');
      if (action === 'close-handbook') this.root.classList.remove('is-handbook');
      if (action === 'buy') this.purchaseItem((event.target as HTMLElement).closest<HTMLElement>('[data-item]')?.dataset.item as ArsenalItem);
      if (action === 'close-shop') this.callbacks.toggleShop?.();
      if((action==='bot-count'||action==='bot-preset')&&this.snapshot?.phase==='menu'&&!this.mapLoading){
        const button=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-action]')!;
        if(button.disabled)return;
        const allies=this.snapshot.actors.filter(a=>a.team==='blue').length-1,enemies=this.snapshot.actors.filter(a=>a.team==='red').length;
        if(action==='bot-preset'){const size=Number(button.dataset.size);this.callbacks.botCounts?.(size-1,size);}
        else{const delta=Number(button.dataset.delta);this.callbacks.botCounts?.(allies+(button.dataset.team==='blue'?delta:0),enemies+(button.dataset.team==='red'?delta:0));}
      }
      if(action==='next-wave')this.callbacks.nextWave?.();
      if(action==='upgrade'){const upgrade=(event.target as HTMLElement).closest<HTMLElement>('[data-upgrade]')?.dataset.upgrade as DefenseUpgrade;this.callbacks.upgrade?.(upgrade);}
      if (action === 'fullscreen') this.callbacks.fullscreen();
      if (action === 'audio-test') this.callbacks.audioTest?.();
      if (action === 'audio-enable') this.callbacks.audioEnable?.();
      // Keep permission requests in the original click call stack for iOS.
      if (action === 'gyro-enable') this.callbacks.gyroEnable?.();
      if (action === 'gyro-calibrate') this.callbacks.gyroCalibrate?.();
      if (action === 'return') {
        this.settingsOpen = false;
        if (this.snapshot?.phase !== 'menu') this.callbacks.resume();
        this.refreshVisibility();
      }
      if (action === 'start' || action === 'restart' || action === 'menu') {
        this.setText('defense-shop-feedback','');this.setText('shop-feedback','');
        this.settingsOpen = false;this.setShopOpen(false);
        this.root.classList.remove('is-handbook');
        this.callbacks[action]();
        this.refreshVisibility();
      }
    });
    this.element<HTMLInputElement>('setting-view-scale').addEventListener('input', event => {
      const viewScale = Number((event.target as HTMLInputElement).value);
      this.setText('view-scale-value', `${viewScale.toFixed(2)}×`);
      this.callbacks.settings({ viewScale });
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
    this.element<HTMLInputElement>('setting-fire-drag').addEventListener('change', event => {
      this.callbacks.settings({ fireDrag: (event.target as HTMLInputElement).checked });
    });
    this.element<HTMLSelectElement>('setting-gyro-mode').addEventListener('change', event => {
      this.callbacks.settings({ gyroMode: (event.target as HTMLSelectElement).value as Settings['gyroMode'] });
    });
    this.element<HTMLInputElement>('setting-gyro-sensitivity').addEventListener('input', event => {
      const gyroSensitivity = Number((event.target as HTMLInputElement).value);
      this.setText('gyro-sensitivity-value', `${gyroSensitivity.toFixed(1)}×`);
      this.callbacks.settings({ gyroSensitivity });
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

  private async selectMap(id: MapId): Promise<void> {
    if (this.mapLoading) return;
    if (!Object.prototype.hasOwnProperty.call(MAPS, id) || id === getActiveMap().id || !this.callbacks.selectMap) {
      this.refreshMap(true);
      return;
    }
    this.mapLoading = true;
    this.setText('map-load-error', '');
    this.element('map-load-error').hidden = true;
    this.refreshMapPreview(id);
    this.element('map-selection').setAttribute('aria-busy', 'true');
    this.element<HTMLImageElement>('map-load-image').src = `${import.meta.env.BASE_URL}${MAPS[id].preview}`;
    this.setText('map-load-label', `正在准备${MAPS[id].name}`);
    this.setMapLoading(8);
    this.element<HTMLSelectElement>('map-select').disabled = true;
    this.root.querySelectorAll<HTMLButtonElement>('.start-button').forEach(button => button.disabled = true);
    try { await this.callbacks.selectMap(id); this.setMapLoading(100); }
    catch (error) { this.setText('map-load-error', '地图准备失败，请重试'); this.element('map-load-error').hidden = false; console.error('Map selection failed', error); }
    finally {
      this.mapLoading = false;
      this.element('map-load').hidden = true;
      this.element('map-selection').setAttribute('aria-busy', 'false');
      this.element<HTMLSelectElement>('map-select').disabled = !this.callbacks.selectMap;
      this.root.querySelectorAll<HTMLButtonElement>('.start-button').forEach(button => button.disabled = false);
      // The callback restores the active map on failure; reflect that committed map.
      this.refreshMap(true);
    }
  }

  setMapLoading(percent: number): void {
    const value = Math.min(100, Math.max(0, Math.round(percent)));
    this.element('map-load').hidden = value >= 100;
    this.setText('map-load-percent', `${value}%`);
    this.element('map-load-bar').style.width = `${value}%`;
    this.element('map-load-progress').setAttribute('aria-valuenow', String(value));
  }

  private refreshMapPreview(id: MapId): void {
    const map = MAPS[id];
    const maps = Object.values(MAPS);
    const index = String(maps.findIndex(entry => entry.id === id) + 1).padStart(2, '0');
    const count = String(maps.length).padStart(2, '0');
    this.element<HTMLSelectElement>('map-select').value = id;
    this.element('map-preview').dataset.map = id;
    const image = this.element<HTMLImageElement>('map-preview-image');
    const source = `${import.meta.env.BASE_URL}${map.preview}`;
    if (image.getAttribute('src') !== source) {
      this.element('map-preview-fallback').hidden = true;
      this.element('map-preview').classList.remove('is-unavailable');
      image.src = source;
    }
    image.alt = `${map.name}地图预览`;
    this.setText('map-choice-count', `${maps.length} 张地图`);
    this.setText('map-preview-number', `${index} / ${count}`);
    this.setText('map-preview-name', map.name);
    this.setText('map-preview-subtitle', map.subtitle);
    this.setText('map-description', map.description);
  }

  private refreshMap(force = false): void {
    // Map preparation changes global geometry before committing the world.
    if (this.mapLoading) return;
    const map = getActiveMap();
    if (!force && this.mapSignature === map.id) return;
    this.mapSignature = map.id;
    const maps = Object.values(MAPS);
    const index = String(maps.findIndex(entry => entry.id === map.id) + 1).padStart(2, '0');
    this.root.dataset.map = map.id;
    this.setText('scene-number', `作战区域 / ${index}`);
    this.setText('menu-map-counter', `${index} / ${String(maps.length).padStart(2, '0')}`);
    this.setText('scene-name', map.name);
    this.setText('scene-subtitle', map.subtitle);
    this.setText('location-name', map.name);
    this.refreshMapPreview(map.id);
  }

  private updateOfflineUI(s:GameSnapshot):void {
    const only=restrictedWeapon(s.mode),race=s.mode==='armsRace',defense=s.mode==='defense',bounty=s.mode==='bounty',objective=s.mode==='demolition'||s.mode==='hostageRescue',mode=PLAYABLE_MODES[s.mode as PlayableMode];
    this.root.dataset.mode=s.mode;
    this.root.classList.toggle('restricted-loadout',only!==null);
    this.element<HTMLButtonElement>('switch-button').disabled=only!==null;
    if(only)this.setText('reload-status',only==='knife'?(s.player.guns.knife.cooldown>0?(s.player.meleeAttack==='stab'?'刺击中':'劈砍中'):'刀战 · 左键劈砍 · 右键刺击'):(s.player.guns.pistol.reloadLeft>0?`装填中 · ${s.player.guns.pistol.reloadLeft.toFixed(1)}s`:s.player.guns.pistol.ammo===0?'手枪战 · 弹匣已空，请换弹':'手枪战 · 无限备用弹药'));
    if(hasUnlimitedReserve(s.mode))this.setText('reserve-value','∞');
    this.setText('ranking-rules',bounty?'全歼赢一局 · 先赢 3 回合 · 阵亡观战队友 · 赏金跨局保留':objective?'先赢 3 回合获胜 · 目标决定回合胜负 · 阵亡后观察队友，等待下一回合':race?'按武器阶段、本级击杀、死亡数排序 · 死亡保级 · 最后一刀获胜':'不限局数 · 阵亡 3 秒后复活 · 击杀相同时死亡少者优先');
    const select=this.element<HTMLSelectElement>('mode-select'),available=mapPlayableModes(),signature=available.join('|');
    if(this.modeOptionsSignature!==signature){
      this.modeOptionsSignature=signature;
      select.innerHTML=available.map(id=>`<option value="${id}">${PLAYABLE_MODES[id].name}</option>`).join('');
    }
    select.value=modeForMap(s.mode);select.disabled=this.mapLoading||available.length===1;
    select.title=available.length===1?'本地图采用固定胜利目标':'';
    this.root.classList.toggle('is-objective-mode',objective);
    this.setText('mode-name',bounty?'自由交火 · 赏金回合':objective?mode.name:defense?'固定 3 人防守':race?'个人混战':'击杀排名');
    this.setText('mode-format',bounty?'全歼赢一局 · 先赢 3 回合':objective?'先赢 3 回合':'持续对战');
    this.setText('round-format',bounty?(s.round===1?'首局手枪 · 先赢 3 回合':'赏金回合 · 先赢 3 回合'):objective?'先赢 3 回合':hasRespawns(s.mode)?'持续对战':'回合制');
    this.setText('blue-team-name',objective?'CT':'蓝方');this.setText('red-team-name',objective?'T':'红方');
    this.setText('blue-roster-title',objective?'反恐精英 CT':'蓝方');this.setText('red-roster-title',objective?'恐怖分子 T':'红方');
    this.setText('location-mode',mode?.name??'战术行动');
    this.setText('mode-brief',s.mode==='hostageRescue'?`${mode.description} · 180 秒内救出全部人质`:s.mode==='demolition'?`${mode.description} · 回合 120 秒，安放 3 秒，引爆 40 秒；拆弹 10 秒 / 拆弹器 5 秒`:mode?.description??'');
    this.setText('bot-team-hint',`${objective?'反恐精英 CT':'蓝方'}包含你 1 人；手机推荐 3 对 3 或 5 对 5。`);
    this.element('minimap').setAttribute('aria-label',s.mode==='hostageRescue'?'战术小地图：绿色救援区、人质与存活队友':s.mode==='demolition'?'战术小地图：A / B 爆破区、已知炸弹与存活队友':'战术小地图：自己的位置、朝向与存活队友');
    this.root.querySelector<HTMLButtonElement>('.roster-button')!.disabled=defense;
    this.setText('roster-action',defense?'固定阵容':'调整人数');
    this.root.querySelector<HTMLButtonElement>('.roster-button')!.setAttribute('aria-label',defense?'本模式采用固定阵容':'调整双方人数');
    if(race)this.setText('mode-count',`${s.actors.length} 人混战`);
    if(defense){this.setText('mode-count','坚守 8 波');this.setText('bot-summary','据点守卫固定你与 2 名队友，敌人随波次增加');}
    this.element('mode-status').hidden=!(race||defense);
    this.element('ranking-button').hidden=defense||objective||bounty;
    this.element('mode-status').classList.toggle('under-attack',Boolean(s.defense?.attackers));
    this.setText('shop-instructions',bounty?'首局统一手枪；第二局起在己方出生补给区购买，手雷限开局 20 秒。打开商店会暂停战斗，按图片或 1–9 购买，B / Esc 返回。':defense?'战斗中无法购买。波间补给区可直接购买并装备武器。':objective?'每回合开始后 20 秒内，可在己方出生区域购买。按图片或 1–9 购买，B / Esc 返回。':'复活后 20 秒内，在出生补给区按图片或 1–9 购买。B / Esc 返回战斗。');
    this.setText('shop-economy-rules',bounty?`开局 $800 · 击杀 +$${BOUNTY_KILL_REWARD} · 余额跨局保留 · 阵亡不扣钱。存活保留装备，阵亡下局配发手枪；先赢 3 回合获胜。`:defense?'初始 $2000 · 击杀 +$300 · 阵亡 −$200 · 每波完成 +$650。波间生命、弹药补满，据点修复 12。':objective?'开局 $800 · 击杀 +$300 · 阵亡 −$200 · 回合结束发放胜负奖励。阵亡后等待下一回合。':'开局 $800 · 击杀 +$300 · 阵亡 −$200。每次复活补满弹药并赠送 1 枚手雷。');
    this.setText('result-restart-label','再战一场');
    this.element('bounty-result-progress').hidden=!bounty;
    if(bounty&&s.phase==='matchEnd'){
      this.setText('result-title',s.winner==='blue'?'蓝方获胜':'红方获胜');
      this.setText('result-description',`${s.winner==='blue'?'蓝方':'红方'}率先赢得 3 回合 · 全场 ${s.round} 回合`);
      this.setText('bounty-result-progress',`本场击杀 ${s.player.kills} · 剩余赏金 $${s.player.money} · 新开一场重置装备和余额`);
      this.setText('spectator-label','');
    }
    if(race){
      const p=s.player,stage=p.raceStage??0,kills=p.raceKills??0,ranking=raceRanking(s.actors),leader=ranking[0].actor;
      this.setText('mode-status-title',`军备竞赛 · ${stage+1} / ${RACE_LADDER.length}`);
      this.setText('mode-status-detail',`${WEAPON_LABELS[RACE_LADDER[stage]].short} · ${kills}/${stage===6?1:2} 击杀${stage<6?' → '+WEAPON_LABELS[RACE_LADDER[stage+1]].short:' · 最后一刀决胜'}`);
      this.element('mode-progress-fill').style.width=`${Math.min(100,(stage+kills/2)/7*100)}%`;
      this.setText('mode-status-alert',s.race&&s.time<s.race.alertUntil?s.race.alert:'');
      this.setText('leader-line',`领先 ${leader.name} · 第 ${(leader.raceStage??0)+1} 级`);
      this.setText('reserve-value','∞');
    }
    if(defense&&s.defense){
      const d=s.defense;
      this.setText('mode-status-title',`据点守卫 · 第 ${Math.max(1,d.wave)} / ${d.total} 波`);
      this.setText('mode-status-detail',`据点 ${Math.ceil(d.health)}% · 剩余 ${d.remaining} 人`);
      this.element('mode-progress-fill').style.width=`${d.health}%`;
      this.setText('mode-status-alert',d.attackers?'敌人正在破坏据点！':'守住小地图上的金色据点');
      this.setText('shop-hint',purchaseWindow(s).allowed?'波间可购买':'波间补给');
      this.setText('defense-break-title',d.completed?`第 ${d.completed} 波已击退`:'守住据点，迎接八波攻势');
      this.setText('defense-break-detail',`据点耐久 ${Math.ceil(d.health)} / 100 · 下波 ${Math.min(10,4+d.completed)} 名敌人 · ${d.completed?'全队已补给，据点已修复':'你与 2 名队友共同防守'}`);
      this.element('defense-upgrades').hidden=!d.upgradePending;
      this.setText('defense-perks',`本场强化：装填 ${d.upgrades.reload} · 护甲 ${d.upgrades.armor} · 急救 ${d.upgrades.heal}`);
      this.setText('defense-money',`$${s.player.money}`);
      for(const item of DEFENSE_ITEMS){
        const button=this.element<HTMLButtonElement>(`supply-${item}`);button.disabled=s.phase!=='intermission'||s.player.money<itemPrice(item)||(item==='armor'&&s.player.armor>=100)||(item==='he'&&(s.player.grenades>=2||(s.player.grenadePurchases??0)>=2));
      }
      for(const id of Object.keys(DEFENSE_UPGRADES) as DefenseUpgrade[])this.element<HTMLButtonElement>(`upgrade-${id}`).disabled=!d.upgradePending;
      this.setText('next-wave',d.upgradePending?'先选择本次强化':`开始第 ${d.completed+1} 波 →`);this.element<HTMLButtonElement>('next-wave').disabled=d.upgradePending;
    }
    if(s.phase==='matchEnd'&&race){
      const won=s.race?.winnerId===s.player.id,winner=s.actors.find(a=>a.id===s.race?.winnerId);
      this.setText('result-title',won?'军备竞赛冠军':'竞赛结束');
      this.setText('result-description',`${winner?.name??'竞赛者'}以匕首完成最后击杀 · 你的最终阶段 ${(s.player.raceStage??0)+1} / 7`);
    }else if(s.phase==='matchEnd'&&defense&&s.defense){
      this.setText('result-title',s.winner==='blue'?'据点守卫成功':'防线失守');
      this.setText('result-description',`${s.defense.reason} · 完成 ${s.defense.completed} / 8 波 · 据点 ${Math.ceil(s.defense.health)}%`);
    }
  }

  get isShopOpen():boolean{return this.shopOpen;}
  canOpenShop():boolean {
    const s=this.snapshot;
    return Boolean(s&&s.player.health>0&&['playing','planted','intermission'].includes(s.phase)&&!restrictedWeapon(s.mode)&&s.mode!=='armsRace'&&(!s.paused||this.shopOpen));
  }
  setShopOpen(open:boolean):void {
    this.shopOpen=open;
    if(open){this.settingsOpen=false;this.root.classList.remove('is-ranking','is-handbook');this.setText('shop-feedback','选择商品购买');}
    this.refreshVisibility();
    if(open){this.element('shop-close').focus({preventScroll:true});this.root.querySelector('.shop-scroll')!.scrollTop=0;}
    else if(this.element('supply-shop').contains(document.activeElement))(document.activeElement as HTMLElement).blur();
  }
  private purchaseItem(item:ArsenalItem):void {
    if(!this.snapshot)return;
    const window=purchaseWindow(this.snapshot),availability=itemAvailability(this.snapshot.player,item);
    const okay=this.callbacks.purchase?.(item);
    const gun=BOUNTY_GUNS.find(kind=>kind===item);
    const name=gun?WEAPON_LABELS[gun].short:item==='ammo'?'备用弹药':item==='he'?'高爆手雷':item==='armor'?'护甲':'拆弹器';
    const feedback=okay?`${name}${item==='ammo'?'已补满':gun?'已购买并装备':'购买成功'} · −$${itemPrice(item)}`:!window.allowed?window.reason:availability.reason;
    this.setText('shop-feedback',feedback);this.setText('defense-shop-feedback',feedback);
  }

  private refreshVisibility(): void {
    const phase = this.snapshot?.phase ?? 'menu';
    const paused = Boolean(this.snapshot?.paused);
    this.root.dataset.phase = phase;
    this.root.classList.toggle('is-menu', phase === 'menu');
    this.root.classList.toggle('is-paused', (paused || this.settingsOpen)&&!this.shopOpen);
    this.root.classList.toggle('is-shop',this.shopOpen);
    this.element('supply-shop').hidden=!this.shopOpen;
    this.root.classList.toggle('is-intermission',phase==='intermission');
    this.root.classList.toggle('is-result', phase === 'matchEnd' && !paused);
    this.root.classList.toggle('is-spectating', Boolean(this.snapshot && this.snapshot.player.health <= 0));
    this.setText('pause-title', phase === 'menu' ? '行动设置' : '行动暂停');
    this.setText('resume-label', phase === 'menu' ? '返回主界面' : '继续行动');
    this.setText('settings-footnote', phase === 'menu' ? '设置自动保存在本机' : '战斗时间已停止 · 设置自动保存在本机');
  }

  update(snapshot: GameSnapshot): void {
    this.snapshot = snapshot;
    if(this.shopOpen&&(!snapshot.paused||snapshot.player.health<=0||!['playing','planted','intermission'].includes(snapshot.phase)))this.setShopOpen(false);
    this.refreshMap();
    if (snapshot.phase !== 'menu') this.minimap.update(snapshot);
    this.refreshVisibility();
    if(!snapshot.paused)this.root.classList.remove('is-ranking');
    if(snapshot.paused&&this.rankingRequested){this.rankingRequested=false;this.root.classList.add('is-ranking');}
    const actor = snapshot.spectating ?? snapshot.player;
    const gun = actor.guns[actor.weapon];
    this.setText('blue-score', String(snapshot.blueScore));
    this.setText('red-score', String(snapshot.redScore));
    this.setText('round-label', isTeamDeathmatch(snapshot.mode)?'团队击杀':`回合 ${String(snapshot.round).padStart(2, '0')}`);
    const ranking=snapshot.mode==='armsRace'?raceRanking(snapshot.actors):killRanking(snapshot.actors.filter(a=>a.active!==false)),self=ranking.find(row=>row.actor.player)!;
    this.setText('personal-rank',`你 · 第 ${self.rank} 名 · ${self.actor.kills} 击杀`);
    this.setText('leader-line',`领先 ${ranking[0].actor.name} ${ranking[0].actor.kills} · 查看排名`);
    const rankingHtml=ranking.map(({actor:a,rank})=>`<tr class="${a.player?'is-you':''}"><td>${rank}</td><td><i class="rank-team ${a.team}"></i>${escapeText(a.name)}${a.player&&a.name!=='你'?'（你）':''}</td><td>${a.kills}</td><td>${a.deaths}</td><td>${snapshot.mode==='armsRace'?`${WEAPON_LABELS[RACE_LADDER[a.raceStage??0]].short} · ${a.raceKills??0}/${a.raceStage===6?1:2}`:a.health>0?'作战中':snapshot.mode==='defense'?'本波阵亡':hasRespawns(snapshot.mode)?'待复活':'本回合阵亡'}</td></tr>`).join('');
    if(this.element('kill-ranking').innerHTML!==rankingHtml)this.element('kill-ranking').innerHTML=rankingHtml;
    const elapsedTimer=snapshot.phase!=='roundEnd'&&(hasRespawns(snapshot.mode)||snapshot.mode==='bounty');
    const seconds = Math.max(0, elapsedTimer?Math.floor(snapshot.roundTime):Math.ceil(snapshot.mode==='demolition'&&snapshot.bomb.status==='planted'?snapshot.bomb.timer:snapshot.roundTime));
    this.setText('round-time', `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`);
    this.element('round-time').classList.toggle('urgent', !elapsedTimer && (snapshot.phase === 'playing'||snapshot.phase==='planted') && seconds <= 15);
    this.element('round-time').setAttribute('aria-label',elapsedTimer?`已用时 ${seconds} 秒`:`${snapshot.phase==='planted'?'炸弹引爆':'回合'}倒计时 ${seconds} 秒`);
    const aliveSignature = snapshot.mode+snapshot.actors.map(person => `${person.team}:${person.health > 0}`).join('|');
    if (aliveSignature !== this.aliveSignature) {
      this.aliveSignature = aliveSignature;
      for (const team of ['blue', 'red'] as const) {
        const teamActors = snapshot.actors.filter(person => person.team === team && person.active !== false);
        this.element(`${team}-alive`).innerHTML = teamActors.map(person => `<i class="${person.health > 0 ? 'alive' : 'dead'}"></i>`).join('');
        this.element(`${team}-alive`).setAttribute('aria-label', `${snapshot.mode==='demolition'||snapshot.mode==='hostageRescue'?(team==='blue'?'反恐精英':'恐怖分子'):team==='blue'?'蓝方':'红方'}存活 ${teamActors.filter(person => person.health > 0).length} 人`);
      }
    }
    for(const team of ['blue','red'] as const){
      const members=snapshot.actors.filter(a=>a.team===team&&a.active!==false);
      this.setText(`${team}-survivors`,`存活 ${members.filter(a=>a.health>0).length} / ${members.length}`);
      const html=members.map(a=>`<tr class="${a.health>0?'':'fallen'}"><td>${escapeText(a.name)}</td><td>${a.health>0?'存活':'✕ 阵亡'}</td><td>${a.kills} / ${a.deaths}</td></tr>`).join('');
      if(this.element(`${team}-roster`).innerHTML!==html)this.element(`${team}-roster`).innerHTML=html;
    }
    const allies=snapshot.actors.filter(a=>a.team==='blue').length-1,enemies=snapshot.actors.filter(a=>a.team==='red').length;
    this.setText('mode-count',`${allies+1} VS ${enemies}`);this.setText('ally-bot-count',String(allies));this.setText('enemy-bot-count',String(enemies));
    const rosterLocked=snapshot.phase!=='menu'||this.mapLoading||snapshot.mode==='defense'||!this.callbacks.botCounts;
    this.element<HTMLButtonElement>('ally-remove').disabled=rosterLocked||allies<=0;this.element<HTMLButtonElement>('ally-add').disabled=rosterLocked||allies>=MAX_TEAM_SIZE-1;
    this.element<HTMLButtonElement>('enemy-remove').disabled=rosterLocked||enemies<=1;this.element<HTMLButtonElement>('enemy-add').disabled=rosterLocked||enemies>=MAX_TEAM_SIZE;
    for(const size of BOT_PRESETS){const button=this.element<HTMLButtonElement>(`bot-preset-${size}`);button.disabled=rosterLocked;button.setAttribute('aria-pressed',String(allies===size-1&&enemies===size));}
    this.setText('bot-summary',`${snapshot.mode==='demolition'||snapshot.mode==='hostageRescue'?'CT':'蓝方'} ${allies+1} 人 · ${snapshot.mode==='demolition'||snapshot.mode==='hostageRescue'?'T':'红方'} ${enemies} 人`);
    const wallet=snapshot.player,window=purchaseWindow(snapshot);
    this.setText('money-balance',`$${wallet.money}`);this.setText('shop-money',`$${wallet.money}`);this.setText('shop-window',window.reason);this.setText('shop-hint',window.allowed?'补给区 · 可购买':window.reason);this.element('battle-button').classList.toggle('can-buy',window.allowed);
    this.setText('shop-inventory',`手雷 ${wallet.grenades} / 2 · 本条生命已购买 ${wallet.grenadePurchases??0} / 2`);
    for(const item of SHOP_SHORTCUT_ITEMS){
      const itemWindow=purchaseWindow(snapshot,wallet,item),availability=itemAvailability(wallet,item),button=this.element<HTMLButtonElement>(`shop-buy-${item}`);
      button.disabled=!itemWindow.allowed||!availability.allowed;
      this.setText(`shop-status-${item}`,itemWindow.allowed?availability.reason:itemWindow.reason);
      button.title=itemWindow.allowed?availability.reason:itemWindow.reason;
    }
    this.element('buy-kit').hidden=snapshot.mode!=='demolition'||wallet.faction!=='ct';
    this.element<HTMLButtonElement>('buy-armor').disabled=!window.allowed||wallet.money<650||wallet.armor>=100;
    this.element<HTMLButtonElement>('buy-kit').disabled=!window.allowed||wallet.money<400||wallet.defuseKit||wallet.faction!=='ct';
    const death=snapshot.feed.filter(f=>snapshot.time-f.at<3&&(f.victim===wallet.name||f.killer===wallet.name)).at(-1);
    this.setText('money-change',death&&death.killer!=='炸弹爆炸'?(death.victim===wallet.name?(snapshot.mode==='bounty'?'赏金保留 · 等待下回合':`阵亡 −$${DEATH_PENALTY}`):`击杀 +$${snapshot.mode==='bounty'?BOUNTY_KILL_REWARD:KILL_REWARD}`):'');
    this.setText('health-value', String(Math.max(0, Math.ceil(actor.health))));
    this.setText('armor-value', String(Math.max(0, Math.ceil(actor.armor))));
    this.setText('health-label', snapshot.spectating ? '队友生命' : '生命值');
    this.element('health-bar').style.transform = `scaleX(${Math.max(0, actor.health) / 100})`;
    this.element('health-cluster').classList.toggle('critical', actor.health <= 30);
    const weaponLabel = WEAPON_LABELS[actor.weapon];
    this.setText('weapon-name', LOADOUTS[actor.weapon].name);
    this.setText('weapon-short', weaponLabel.code);
    for (const kind of WEAPON_KINDS) {
      const slot = this.element(`slot-${kind}`);
      slot.hidden = !actor.inventory.includes(kind);
      slot.classList.toggle('is-selected', actor.weapon === kind);
    }
    this.setText('grenade-count', String(actor.grenades));
    this.setText('grenade-button-count', String(snapshot.player.grenades));
    this.element<HTMLButtonElement>('grenade-button').disabled = snapshot.player.grenades <= 0;
    const melee=actor.weapon==='knife';
    this.setText('ammo-value', melee ? '∞' : String(gun.ammo).padStart(2, '0'));
    this.element('reserve-value').parentElement!.hidden=melee;
    this.setText('reserve-value', String(gun.reserve));
    this.element('ammo-cluster').classList.toggle('low-ammo', !melee && gun.ammo <= 5);
    this.element('ammo-cluster').classList.toggle('is-reloading', gun.reloadLeft > 0);
    this.setText('reload-status', melee ? (gun.cooldown > 0 ? (snapshot.player.meleeAttack==='stab'?'刺击中':'劈砍中') : '左键劈砍 · 右键刺击') : gun.reloadLeft > 0 ? `装填中 · ${gun.reloadLeft.toFixed(1)}s` : gun.ammo === 0 ? '弹匣已空 · 请换弹' : '点射，控制后坐力');
    this.element('desktop-aim-control').hidden=false;
    this.setText('desktop-aim-hint', snapshot.player.weapon === 'knife' ? '刺击' : snapshot.player.weapon === 'sniper' ? '3 倍开镜' : '精瞄');
    this.element('switch-button').dataset.weapon = snapshot.player.weapon;
    this.element('sprint-button').classList.toggle('is-running',!!snapshot.player.sprinting);
    this.setText('sprint-label',snapshot.player.sprinting?'跑步中':'跑步');
    this.element<HTMLButtonElement>('reload-button').disabled=snapshot.player.weapon==='knife';
    this.setText('fire-button-label', snapshot.player.weapon==='knife'?'劈砍':'开火');
    this.element('fire-button').setAttribute('aria-label', snapshot.player.weapon==='knife'?'劈砍':'开火');
    this.element('reload-button').classList.toggle('is-active', snapshot.player.guns[snapshot.player.weapon].reloadLeft > 0);
    const spread = 5 + Math.min(20, actor.spread * 170);
    this.element('crosshair').style.setProperty('--spread', `${spread}px`);
    this.element('crosshair').classList.toggle('is-hit', snapshot.hitMarker > 0);
    this.element('crosshair').classList.toggle('is-hidden', actor.health <= 0);
    const recentlyHurt = snapshot.time - snapshot.player.hurtTime >= 0 && snapshot.time - snapshot.player.hurtTime < 0.35 && snapshot.player.hurtTime > 0;
    this.root.classList.toggle('is-hurt', recentlyHurt);
    const woundAge=snapshot.time-snapshot.player.hurtTime;this.root.style.setProperty('--wound-alpha',String(woundAge>=0&&snapshot.player.hurtTime>0?Math.max(0,1-woundAge/.65)*.68:0));
    this.element('damage-indicator').style.transform = `rotate(${snapshot.damageAngle}rad)`;
    const banner = this.element('round-banner');
    banner.hidden=snapshot.phase!=='roundEnd';
    banner.classList.toggle('is-visible', snapshot.phase === 'roundEnd');
    const demolition = snapshot.mode === 'demolition',rescue=snapshot.mode==='hostageRescue',objective=demolition||rescue;
    this.element('objective-hud').hidden = !objective;
    const canInteract=snapshot.player.health>0&&!snapshot.paused&&(snapshot.phase==='playing'||snapshot.phase==='planted');
    const interaction=canInteract?objectiveInteraction(snapshot,snapshot.player):null;
    const pickup = canInteract&&!interaction ? nearestPickup(snapshot) : null;
    const holding=interaction?.kind==='plant'||interaction?.kind==='defuse';
    const progress=Math.round(Math.min(1,Math.max(0,interaction?.progress??0))*100);
    this.root.classList.toggle('has-pickup', Boolean(pickup));
    this.root.classList.toggle('has-objective-interaction',Boolean(interaction));
    this.element('pickup-prompt').hidden = !pickup&&!interaction;
    this.element('pickup-prompt').classList.toggle('is-objective-interaction',Boolean(interaction));
    this.element('interact-button').hidden = !pickup&&!interaction;
    this.element('interact-button').dataset.hold=String(holding);
    this.element('interact-button').style.setProperty('--interaction-progress',`${progress}%`);
    this.setText('interact-label', interaction?.label??(pickup?'拾取':'目标'));
    this.element('interact-button').setAttribute('aria-label',interaction?`${holding?'按住':''}${interaction.label}`:pickup?`拾取${LOADOUTS[pickup.weapon].name}`:'操作目标');
    this.setText('interaction-key',holding?'按住 E':'E');
    this.element('interaction-progress').hidden=!holding;
    this.element('interaction-progress').setAttribute('aria-valuenow',String(progress));
    this.element('interaction-progress').setAttribute('aria-label',`${interaction?.label??'目标操作'}进度`);
    this.element('interaction-progress-fill').style.width=`${progress}%`;
    this.element('interact-hint').hidden = false;
    this.setText('interact-hint',rescue?'E 跟随 / 等待':demolition?'按住 E 安放 / 拆弹':'E 拾取');
    if(interaction){
      this.setText('pickup-name',interaction.label);
      const hint=this.root.classList.contains('compact-hud')?interaction.hint.replace(/按住 E/g,`按住「${interaction.label}」`).replace(/按 E/g,`轻触「${interaction.label}」`):interaction.hint;
      this.setText('pickup-detail',`${hint}${holding?` · ${progress}%`:''}`);
    }else if (pickup) {
      this.setText('pickup-name', `拾取 ${LOADOUTS[pickup.weapon].name}`);
      this.setText('pickup-detail', snapshot.player.inventory.includes(pickup.weapon) ? '补充弹药' : `换为 ${WEAPON_LABELS[pickup.weapon].short}`);
    }
    this.element('buy-kit').hidden = !demolition;
    const bomb = snapshot.bomb;
    this.setText('objective-round',`回合 ${snapshot.round} · 先赢 3 回合`);
    this.element('objective-hud').classList.toggle('is-urgent',demolition&&bomb.status==='planted');
    if(rescue&&snapshot.rescue){
      const state=snapshot.rescue,escorting=state.hostages.filter(h=>h.status==='following'&&h.leaderId===snapshot.player.id).length;
      this.setText('bomb-state',`人质已救出 ${state.rescued} / ${state.total}`);
      this.setText('site-state',snapshot.player.faction==='ct'?(escorting?`护送 ${escorting} 人 → 绿色救援区`:this.root.classList.contains('compact-hud')?'接近人质 · 轻触跟随':'接近人质 · E 让其跟随'):'阻止人质抵达救援区');
    }else if(demolition){
      const carrier=snapshot.actors.find(a=>a.id===bomb.carrierId);
      this.setText('bomb-state',bomb.status==='planted'?`C4 · ${bomb.site} 区 · ${Math.ceil(bomb.timer)}s`:bomb.status==='defused'?'C4 已拆除':bomb.status==='exploded'?'C4 已引爆':snapshot.player.faction==='ct'?'CT 防守 A / B':bomb.status==='dropped'?'C4 已掉落':snapshot.player.hasBomb?'你携带 C4':`${carrier?.name??'队友'}携带 C4`);
      this.setText('site-state',bomb.status==='planted'?(bomb.progress>0?`正在拆除 ${Math.round(bomb.progress*100)}%`:snapshot.player.faction==='ct'?`靠近拆弹 · ${snapshot.player.defuseKit?'5':'10'} 秒`:'守住炸弹，等待引爆'):snapshot.player.faction==='t'&&(bomb.plantProgress??0)>0?`安放 ${bomb.plantSite??''} · ${Math.round((bomb.plantProgress??0)*100)}%`:snapshot.player.faction==='ct'?'阻止安放 · 安放后须拆弹':'在 A / B 按住安放 3 秒');
    }
    if (snapshot.phase === 'roundEnd') {
      this.setText('banner-kicker', 'ROUND COMPLETE');
      this.setText('banner-title', snapshot.winner === 'blue' ? `${objective?'反恐精英':'蓝方'}回合胜利` : snapshot.winner === 'red' ? `${objective?'恐怖分子':'红方'}回合胜利` : '回合平局');
      this.setText('banner-description', `${snapshot.roundReason?snapshot.roundReason+' · ':''}下一回合即将开始`);
    }
    this.setText('spectator-label', snapshot.player.health > 0 ? ((snapshot.player.spawnProtectionUntil??0)>snapshot.time?'复活保护 · 开火后结束':'') : hasRespawns(snapshot.mode)?`你已阵亡 · ${Math.max(1,Math.ceil((snapshot.player.respawnAt??snapshot.time+3)-snapshot.time))} 秒后复活${snapshot.spectating?' · 观察 '+snapshot.spectating.name:''}`:snapshot.spectating ? `本回合阵亡 · 观察 ${snapshot.spectating.name} · 等待下回合` : '你已阵亡 · 等待下一回合');
    const feedSignature = snapshot.feed.map(entry => `${entry.at}:${entry.killer}:${entry.victim}:${entry.headshot}`).join('|');
    if (feedSignature !== this.feedSignature) {
      this.feedSignature = feedSignature;
      this.element('kill-feed').innerHTML = snapshot.feed.slice(-4).reverse().map(entry => `<div class="feed-entry"><span class="${entry.team}">${escapeText(entry.killer)}</span><i>${entry.headshot ? '爆头击杀' : '击杀'}</i><span>${escapeText(entry.victim)}</span></div>`).join('');
    }
    if (snapshot.phase === 'matchEnd') {
      this.setText('result-title',objective?(snapshot.winner==='blue'?'反恐精英获胜':snapshot.winner==='red'?'恐怖分子获胜':'行动结束'):snapshot.winner==='blue'?'任务完成':'行动失利');
      this.setText('result-description',objective?`${snapshot.roundReason??'目标回合结束'} · ${snapshot.winner==='blue'?'CT':'T'} 先赢 3 回合`:snapshot.winner === 'blue' ? '蓝方小队赢得本次行动' : '红方小队赢得本次行动 · 整装，再战');
      this.setText('result-blue', String(snapshot.blueScore));
      this.setText('result-red', String(snapshot.redScore));
      this.setText('result-kills', String(snapshot.player.kills));
      this.setText('result-deaths', String(snapshot.player.deaths));
    }
    this.updateOfflineUI(snapshot);
    const sensitivity = this.element<HTMLInputElement>('setting-sensitivity');
    const volume = this.element<HTMLInputElement>('setting-volume');
    const viewScale = this.element<HTMLInputElement>('setting-view-scale');
    if (document.activeElement !== viewScale) viewScale.value = String(snapshot.settings.viewScale);
    this.setText('view-scale-value', `${snapshot.settings.viewScale.toFixed(2)}×`);
    if (document.activeElement !== sensitivity) sensitivity.value = String(snapshot.settings.sensitivity);
    if (document.activeElement !== volume) volume.value = String(snapshot.settings.volume);
    this.setText('sensitivity-value', snapshot.settings.sensitivity.toFixed(1));
    this.setText('volume-value', `${Math.round(snapshot.settings.volume * 100)}%`);
    this.element<HTMLInputElement>('setting-assist').checked = snapshot.settings.aimAssist;
    this.element<HTMLInputElement>('setting-fire-drag').checked = snapshot.settings.fireDrag;
    this.element<HTMLSelectElement>('setting-gyro-mode').value = snapshot.settings.gyroMode;
    const gyroSensitivity = this.element<HTMLInputElement>('setting-gyro-sensitivity');
    if (document.activeElement !== gyroSensitivity) gyroSensitivity.value = String(snapshot.settings.gyroSensitivity);
    this.setText('gyro-sensitivity-value', `${snapshot.settings.gyroSensitivity.toFixed(1)}×`);
    this.element<HTMLSelectElement>('setting-quality').value = snapshot.settings.quality;
  }

  setOffline(status: string): void { this.setText('offline-status', status); }
  setGyroStatus(status: {code: string; label: string; detail: string; needsGesture: boolean}): void {
    this.root.dataset.gyroStatus = status.code;
    this.setText('gyro-status', status.label);
    this.setText('gyro-detail', status.detail);
    const enable = this.element<HTMLButtonElement>('gyro-enable');
    enable.hidden = false;
    enable.disabled = status.code === 'requesting';
    this.setText('gyro-enable', ['denied', 'error', 'no-data', 'ready'].includes(status.code) ? '重试陀螺仪' : '启用陀螺仪');
    this.element<HTMLButtonElement>('gyro-calibrate').disabled = !['active', 'ready', 'calibrating', 'paused'].includes(status.code);
  }

  setAudioStatus(status:{code:string;label:string;detail:string;needsGesture:boolean;muted:boolean}):void {
    this.setText('menu-audio-label',status.muted?'声音已关':status.needsGesture?'开启声音':status.code==='loading'?'声音载入中':'声音已开启');
    this.element('menu-audio-button').title=status.detail;
    this.element('sound-recovery').hidden=!status.needsGesture&&!status.muted;
    this.setText('sound-recovery-label',status.muted?'声音已关 · 开启':'轻触恢复声音');
    this.setText('audio-state-detail',status.detail);
  }
}
