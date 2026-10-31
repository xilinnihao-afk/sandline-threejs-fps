import { WEAPON_KINDS } from '../game/types';
import { TouchAim } from './touchAim';
import { SNIPER_MAGNIFICATION } from './scope';
import type { PlayerInput, WeaponKind } from '../game/types';

/** UI contract: joystick / joystick-knob, look-zone, fire-button,
 * reload-button, switch-button, grenade-button, crouch-button, jump-button and pause-button. */
export class InputController {
  private touchAim = new TouchAim();
  private fireDrag = false;
  private inputSource: 'touch' | 'mouse' = 'mouse';
  private jumpPointer: number | null = null;
  private interactPointer: number | null = null;
  private interactKey = false;
  configureTouch(options: {fireDrag: boolean}): void { this.fireDrag = options.fireDrag; }
  private notePointer(event: PointerEvent): void {
    this.inputSource = event.pointerType === 'touch' ? 'touch' : 'mouse';
  }
  private precision = false;
  private secondaryFire = false;
  private aimWeapon: WeaponKind = 'rifle';
  private aimAvailable = true;
  private get aimGain(): number { return !this.precision ? 1 : this.aimWeapon === 'sniper' ? 1 / SNIPER_MAGNIFICATION : .55; }
  private keys = new Set<string>();
  private fireSources = new Set<string>();
  private pendingShots = new Set<string>();
  private pressFire(source:string):void { this.fireSources.add(source); this.pendingShots.add(source); }
  private lookPointers = new Map<number, { x: number; y: number }>();
  private captures = new Map<number, HTMLElement>();
  private movePointer: number | null = null;
  private stickX = 0;
  private stickZ = 0;
  private lookDX = 0;
  private lookDY = 0;
  private reload = false;
  private jump = false;
  private sprint = false;
  private gameplayActive = false;
  setGameplayActive(active:boolean):void {
    this.gameplayActive=active;
    if(!active){this.setSprint(false);this.keys.delete('ShiftLeft');this.keys.delete('ShiftRight');this.jump=false;this.interact=false;this.interactPointer=null;this.interactKey=false;this.keys.delete('KeyE');document.getElementById('interact-button')?.classList.remove('is-active');}
  }
  private grenade = false;
  private switchWeapon: WeaponKind | null = null;
  private availableWeapons: WeaponKind[] = ['rifle', 'pistol', 'knife'];
  private crouch = false;
  private pause = false;
  private interact = false;
  private stick: HTMLElement | null;
  private knob: HTMLElement | null;
  private fireButton: HTMLElement | null;
  private crouchButton: HTMLElement | null;

  constructor(private canvas: HTMLCanvasElement) {
    this.stick = document.getElementById('joystick');
    this.knob = document.getElementById('joystick-knob');
    this.fireButton = document.getElementById('fire-button');
    this.crouchButton = document.getElementById('crouch-button');
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => this.clear());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.clear();
    });
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== this.canvas) this.clear();
    });
    window.addEventListener('mousemove', (event) => {
      if (document.pointerLockElement === this.canvas) {
        this.inputSource = 'mouse';
        this.lookDX -= event.movementX * 0.0024 * this.aimGain;
        this.lookDY -= event.movementY * 0.0024 * this.aimGain;
      }
    });
    window.addEventListener('pointerup', this.endPointer);
    window.addEventListener('pointercancel', this.endPointer);
    this.canvas.addEventListener('contextmenu', event => event.preventDefault());
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('pointerdown', event => {
      if (this.handlePrecisionPointer(event)) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      this.notePointer(event);
      if (event.pointerType === 'mouse') this.pressFire(`pointer:${event.pointerId}`);
      if (document.pointerLockElement !== this.canvas) this.beginLook(event, this.canvas);
    });
    // 统一在 window 接收增量，捕获失败或手指越过按钮边缘时仍可瞄准。
    window.addEventListener('pointermove', this.moveLook, { passive: false });
    this.canvas.addEventListener('lostpointercapture', this.endPointer);

    this.stick?.addEventListener('pointerdown', event => {
      event.preventDefault();
      event.stopPropagation();
      if (this.movePointer !== null) return;
      this.notePointer(event);
      this.movePointer = event.pointerId;
      this.capture(this.stick!, event.pointerId);
      this.moveStick(event);
      this.stick?.classList.add('is-active');
    });
    this.stick?.addEventListener('pointermove', this.moveStick);
    this.stick?.addEventListener('lostpointercapture', this.endPointer);

    const lookZone = document.getElementById('look-zone');
    // Pointer Events omit a second pointerdown when another mouse button is
    // already held. Receive the right-button chord without duplicating a
    // normal right click (which is handled by handlePrecisionPointer).
    for(const surface of [this.canvas,lookZone,this.fireButton])surface?.addEventListener('mousedown',event=>{
      if(event.button!==2||(event.buttons&1)===0||this.aimWeapon!=='knife')return;
      event.preventDefault();event.stopPropagation();this.inputSource='mouse';this.secondaryAction();
    });
    lookZone?.addEventListener('wheel', this.onWheel, { passive: false });
    lookZone?.addEventListener('contextmenu', event => event.preventDefault());
    lookZone?.addEventListener('pointerdown', event => {
      if (this.handlePrecisionPointer(event)) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      this.notePointer(event);
      if (event.pointerType === 'mouse') this.pressFire(`pointer:${event.pointerId}`);
      this.beginLook(event, lookZone);
    });
    
    lookZone?.addEventListener('lostpointercapture', this.endPointer);

    this.fireButton?.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      this.notePointer(event);
      this.pressFire(`pointer:${event.pointerId}`);
      this.fireButton?.classList.add('is-active');
      this.capture(this.fireButton!, event.pointerId);
      // Opt-in drag keeps existing look ownership: a firing finger never steals it.
      if (this.fireDrag && event.pointerType === 'touch') this.beginLook(event, this.fireButton!, true);
    });

    this.fireButton?.addEventListener('lostpointercapture', this.endPointer);
    this.fireButton?.addEventListener('keydown', event => {
      if (event.code === 'Enter' || (event.code === 'Space' && !this.gameplayActive)) {
        event.preventDefault();
        this.inputSource = 'mouse';
        this.pressFire('button-key');
      }
    });
    this.fireButton?.addEventListener('keyup', event => {
      if (event.code === 'Enter' || (event.code === 'Space' && !this.gameplayActive)) this.fireSources.delete('button-key');
    });

    const jumpButton = document.getElementById('jump-button');
    jumpButton?.addEventListener('pointerdown', event => {
      if (!this.gameplayActive || this.jumpPointer !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
      event.preventDefault();
      event.stopPropagation();
      this.notePointer(event);
      this.jump = true;
      this.jumpPointer = event.pointerId;
      this.capture(jumpButton, event.pointerId);
    });
    jumpButton?.addEventListener('lostpointercapture', this.endPointer);

    this.action('aim-button', () => this.secondaryAction());
    this.action('desktop-aim-button', () => this.secondaryAction());
    this.action('sprint-button', () => { if(this.gameplayActive)this.setSprint(!this.sprint); });
    this.action('reload-button', () => { this.reload = true; });
    this.action('grenade-button', () => { this.grenade = true; });
    this.action('switch-button', () => this.cycleWeapon(1));
    this.action('crouch-button', () => this.toggleCrouch());
    this.action('pause-button', () => { this.pause = true; });
    this.action('ranking-button', () => { this.pause = true; });
    const interactButton=document.getElementById('interact-button') as HTMLButtonElement|null;
    interactButton?.addEventListener('pointerdown',event=>{
      if(!this.gameplayActive||interactButton.disabled||this.interactPointer!==null||(event.pointerType==='mouse'&&event.button!==0))return;
      event.preventDefault();event.stopPropagation();this.notePointer(event);
      this.interactPointer=event.pointerId;
      // Preserve quick pickup / follow taps between frames, but a hold action
      // must stop on release even when the first frame has not run yet.
      this.interact=interactButton.dataset.hold!=='true';
      interactButton.classList.add('is-active');this.capture(interactButton,event.pointerId);
    });
    interactButton?.addEventListener('lostpointercapture',this.endPointer);
    interactButton?.addEventListener('keydown',event=>{
      if(event.code!=='Enter'||!this.gameplayActive||interactButton.disabled)return;
      event.preventDefault();event.stopPropagation();this.interactKey=true;
      if(!event.repeat)this.interact=interactButton.dataset.hold!=='true';
    });
    interactButton?.addEventListener('keyup',event=>{if(event.code==='Enter'){event.preventDefault();this.interactKey=false;}});
    interactButton?.addEventListener('blur',()=>{this.interactKey=false;});
  }

  get precisionActive(): boolean { return this.precision; }

  resetPrecision(): void { this.setPrecision(false); }

  setAimContext(weapon: WeaponKind, available: boolean): void {
    const changed = weapon !== this.aimWeapon || available !== this.aimAvailable;
    if (weapon !== this.aimWeapon || !available) {this.precision = false;this.secondaryFire = false;}
    this.aimWeapon = weapon;
    this.aimAvailable = available;
    if (changed) this.updateAimButtons();
  }

  private setPrecision(active: boolean): void {
    this.precision = active && this.aimAvailable && this.aimWeapon !== 'knife';
    this.updateAimButtons();
  }

  private updateAimButtons(): void {
    const sniper = this.aimWeapon === 'sniper';
    const label = this.aimWeapon === 'knife' ? '刺击' : sniper ? (this.precision ? '关镜' : '开镜') : (this.precision ? '退出精瞄' : '精瞄');
    for (const id of ['aim-button', 'desktop-aim-button']) {
      const button = document.getElementById(id) as HTMLButtonElement | null;
      if (!button) continue;
      button.classList.toggle('is-active', this.precision);
      button.setAttribute('aria-pressed', String(this.precision));
      button.setAttribute('aria-label', sniper ? `${label} · 3 倍狙击镜` : label);
      button.disabled = !this.aimAvailable;
      const text = button.querySelector('span');
      if (text) text.textContent = label;
    }
  }

  private secondaryAction():void {
    if(!this.aimAvailable)return;
    if(this.aimWeapon==='knife')this.secondaryFire=true;
    else this.setPrecision(!this.precision);
  }

  private handlePrecisionPointer(event: PointerEvent): boolean {
    if (event.pointerType !== 'mouse' || event.button !== 2) return false;
    event.preventDefault();
    event.stopPropagation();
    this.notePointer(event);
    this.secondaryAction();
    return true;
  }

  setAvailableWeapons(weapons: readonly WeaponKind[]): void {
    this.availableWeapons = WEAPON_KINDS.filter(kind => weapons.includes(kind));
    if (this.switchWeapon && !this.availableWeapons.includes(this.switchWeapon)) this.switchWeapon = null;
  }

  private cycleWeapon(step: number): void {
    const order = this.availableWeapons;
    if (!order.length) return;
    const current = this.switchWeapon ?? document.getElementById('switch-button')?.dataset.weapon ?? 'rifle';
    const index = order.indexOf(current as WeaponKind);
    this.switchWeapon = order[index < 0 ? 0 : (index + step + order.length) % order.length];
  }

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    if (event.deltaY !== 0) { this.inputSource = 'mouse'; this.cycleWeapon(event.deltaY > 0 ? 1 : -1); }
  };

  private action(id: string, callback: () => void): void {
    document.getElementById(id)?.addEventListener('pointerdown', event => this.notePointer(event));
    document.getElementById(id)?.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      callback();
    });
  }

  private capture(element: HTMLElement, id: number): void {
    this.captures.set(id, element);
    try { element.setPointerCapture(id); } catch { /* Pointer ended before capture. */ }
  }

  private beginLook(event: PointerEvent, element: HTMLElement, explicitControl = false): void {
    if (this.lookPointers.size || event.pointerId === this.movePointer) return;
    // Only reject new free-look starts at the outer edge; captured motion stays live.
    if (!explicitControl && event.pointerType === 'touch' &&
        (event.clientX < 8 || event.clientX > innerWidth - 8 || event.clientY < 8 ||
         (typeof innerHeight === 'number' && event.clientY > innerHeight - 8))) return;
    this.touchAim.begin();
    this.lookPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.capture(element, event.pointerId);
  }

  private moveLook = (event: PointerEvent): void => {
    if (document.pointerLockElement === this.canvas && event.pointerType === 'mouse') return;
    const previous = this.lookPointers.get(event.pointerId);
    if (!previous) return;
    this.notePointer(event);
    const dx = event.clientX - previous.x, dy = event.clientY - previous.y;
    if (event.pointerType === 'mouse') {
      this.lookDX -= dx * .0024 * this.aimGain; this.lookDY -= dy * .0024 * this.aimGain;
    } else {
      // Preserve screen-space aim speed inside the magnified sniper sight.
      this.touchAim.move(dx, dy, Math.PI / Math.max(innerWidth, 320) * this.aimGain);
    }
    previous.x = event.clientX;
    previous.y = event.clientY;
    event.preventDefault();
  };

  private moveStick = (event: PointerEvent): void => {
    if (event.pointerId !== this.movePointer || !this.stick) return;
    this.notePointer(event);
    const bounds = this.stick.getBoundingClientRect();
    const radius = bounds.width * 0.34;
    let dx = (event.clientX - bounds.left - bounds.width / 2) / radius;
    let dy = (event.clientY - bounds.top - bounds.height / 2) / radius;
    const magnitude = Math.hypot(dx, dy);
    if (magnitude > 1) { dx /= magnitude; dy /= magnitude; }
    this.stickX = Math.abs(dx) < 0.07 ? 0 : dx;
    this.stickZ = Math.abs(dy) < 0.07 ? 0 : -dy;
    if (this.knob) this.knob.style.transform = `translate(${dx * radius}px, ${dy * radius}px)`;
    event.preventDefault();
  };

  private endPointer = (event: PointerEvent): void => {
    this.fireSources.delete(`pointer:${event.pointerId}`);
    const cancelled = event.type === 'pointercancel' || (event.type === 'lostpointercapture' && this.captures.has(event.pointerId));
    if (cancelled) this.pendingShots.delete(`pointer:${event.pointerId}`);
    if (this.jumpPointer === event.pointerId) {
      this.jumpPointer = null;
      if (cancelled) this.jump = false;
    }
    if(this.interactPointer===event.pointerId){
      this.interactPointer=null;
      if(cancelled)this.interact=false;
      document.getElementById('interact-button')?.classList.remove('is-active');
    }
    if (this.lookPointers.delete(event.pointerId)) {
      if (cancelled) this.touchAim.clear();
      else this.touchAim.end();
    }
    this.captures.delete(event.pointerId);
    if (this.movePointer === event.pointerId) {
      this.movePointer = null;
      this.stickX = 0;
      this.stickZ = 0;
      this.stick?.classList.remove('is-active');
      if (this.knob) this.knob.style.transform = 'translate(0px, 0px)';
    }
    if (this.fireSources.size === 0) this.fireButton?.classList.remove('is-active');
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    if (target?.matches('input, select, textarea, [contenteditable="true"]')) return;
    if(event.code==='KeyE'&&!this.gameplayActive)return;
    if(event.code==='Space'&&this.gameplayActive){this.inputSource='mouse';event.preventDefault();if(!event.repeat&&!this.keys.has('Space'))this.jump=true;this.keys.add('Space');return;}
    if((event.code==='ShiftLeft'||event.code==='ShiftRight')&&!this.gameplayActive)return;
    const relevant = ['ShiftLeft','ShiftRight','KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyR', 'KeyG', 'KeyE', 'KeyQ', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'KeyV', 'KeyC', 'Escape'];
    if (!relevant.includes(event.code)) return;
    this.inputSource = 'mouse';
    event.preventDefault();
    this.keys.add(event.code);
    if (event.repeat) return;
    if (event.code === 'KeyV' && this.availableWeapons.includes('knife')) this.switchWeapon = 'knife';
    if (event.code === 'KeyR') this.reload = true;
    if (event.code === 'KeyG') this.grenade = true;
    if (event.code === 'KeyE') this.interact = true;
    if (event.code === 'KeyQ') this.secondaryAction();
    if (event.code.startsWith('Digit')) {
      const weapon = WEAPON_KINDS[Number(event.code.slice(5)) - 1];
      if (weapon && this.availableWeapons.includes(weapon)) this.switchWeapon = weapon;
    }
    if (event.code === 'KeyC') this.toggleCrouch();
    if (event.code === 'Escape') this.pause = true;
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
    if(event.code==='KeyE'&&document.getElementById('interact-button')?.dataset.hold==='true')this.interact=false;
  };

  private setSprint(active:boolean):void {
    this.sprint=active;const button=document.getElementById('sprint-button');
    button?.classList.toggle('is-active',active);button?.setAttribute('aria-pressed',String(active));
  }

  private toggleCrouch(): void {
    this.crouch = !this.crouch;
    if(this.crouch)this.setSprint(false);
    this.crouchButton?.classList.toggle('is-active', this.crouch);
    this.crouchButton?.setAttribute('aria-pressed', String(this.crouch));
  }

  consume(dt = 1 / 60): PlayerInput {
    const touch = this.touchAim.consume(dt);
    let moveX = this.stickX + Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) - Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft'));
    let moveZ = this.stickZ + Number(this.keys.has('KeyW') || this.keys.has('ArrowUp')) - Number(this.keys.has('KeyS') || this.keys.has('ArrowDown'));
    const magnitude = Math.hypot(moveX, moveZ);
    if (magnitude > 1) { moveX /= magnitude; moveZ /= magnitude; }
    const input: PlayerInput = {
      inputSource: this.inputSource, aiming: this.precision,
      sprint:this.gameplayActive&&(this.sprint||this.keys.has('ShiftLeft')||this.keys.has('ShiftRight')),
      secondaryFire:this.secondaryFire, jump:this.jump, moveX, moveZ, lookDX: this.lookDX + touch.x, lookDY: this.lookDY + touch.y,
      fireHeld: this.fireSources.size > 0, fire: this.fireSources.size > 0 || this.pendingShots.size > 0, reload: this.reload,
      switchWeapon: this.switchWeapon, crouch: this.crouch, pause: this.pause, grenade: this.grenade, interact: this.interact || this.keys.has('KeyE') || this.interactPointer!==null || this.interactKey,
    };
    this.pendingShots.clear();
    this.secondaryFire = false;
    this.lookDX = this.lookDY = 0;
    this.jump = this.reload = this.pause = this.grenade = this.interact = false;
    this.switchWeapon = null;
    return input;
  }

  clear(): void {
    this.setSprint(false);
    this.touchAim.clear();
    this.secondaryFire = false;
    this.resetPrecision();
    this.keys.clear();
    this.fireSources.clear();
    this.pendingShots.clear();
    this.lookPointers.clear();
    this.movePointer = null;
    this.jumpPointer = null;
    this.interactPointer=null;
    this.interactKey=false;
    this.stickX = this.stickZ = this.lookDX = this.lookDY = 0;
    this.jump = this.reload = this.pause = this.crouch = this.grenade = this.interact = false;
    this.switchWeapon = null;
    this.stick?.classList.remove('is-active');
    this.fireButton?.classList.remove('is-active');
    this.crouchButton?.classList.remove('is-active');
    document.getElementById('interact-button')?.classList.remove('is-active');
    this.crouchButton?.setAttribute('aria-pressed', 'false');
    if (this.knob) this.knob.style.transform = 'translate(0px, 0px)';
    for (const [id, element] of this.captures) {
      try { if (element.hasPointerCapture(id)) element.releasePointerCapture(id); } catch { /* Already released. */ }
    }
    this.captures.clear();
  }
}
