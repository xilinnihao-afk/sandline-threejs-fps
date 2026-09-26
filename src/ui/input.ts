import { WEAPON_KINDS } from '../game/types';
import { TouchAim } from './touchAim';
import type { PlayerInput, WeaponKind } from '../game/types';

/** UI contract: joystick / joystick-knob, look-zone, fire-button,
 * reload-button, switch-button, grenade-button, crouch-button and pause-button. */
export class InputController {
  private touchAim = new TouchAim();
  private precision = false;
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
  private grenade = false;
  private switchWeapon: WeaponKind | null = null;
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
        this.lookDX -= event.movementX * 0.0024;
        this.lookDY -= event.movementY * 0.0024;
      }
    });
    window.addEventListener('pointerup', this.endPointer);
    window.addEventListener('pointercancel', this.endPointer);
    this.canvas.addEventListener('contextmenu', event => event.preventDefault());
    this.canvas.addEventListener('wheel', event => event.preventDefault(), { passive: false });
    this.canvas.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      if (event.pointerType === 'mouse') this.pressFire(`pointer:${event.pointerId}`);
      if (event.pointerType !== 'mouse' && event.clientX < innerWidth * .5) return;
      if (document.pointerLockElement !== this.canvas) this.beginLook(event, this.canvas);
    });
    // 统一在 window 接收增量，捕获失败或手指越过按钮边缘时仍可瞄准。
    window.addEventListener('pointermove', this.moveLook, { passive: false });
    this.canvas.addEventListener('lostpointercapture', this.endPointer);

    this.stick?.addEventListener('pointerdown', event => {
      event.preventDefault();
      event.stopPropagation();
      if (this.movePointer !== null) return;
      this.movePointer = event.pointerId;
      this.capture(this.stick!, event.pointerId);
      this.moveStick(event);
      this.stick?.classList.add('is-active');
    });
    this.stick?.addEventListener('pointermove', this.moveStick);
    this.stick?.addEventListener('lostpointercapture', this.endPointer);

    const lookZone = document.getElementById('look-zone');
    lookZone?.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      if (event.pointerType === 'mouse') this.pressFire(`pointer:${event.pointerId}`);
      this.beginLook(event, lookZone);
    });
    
    lookZone?.addEventListener('lostpointercapture', this.endPointer);

    this.fireButton?.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      this.pressFire(`pointer:${event.pointerId}`);
      this.fireButton?.classList.add('is-active');
      this.capture(this.fireButton!, event.pointerId);
      // 开火按钮可拖动瞄准；已有瞄准手指时保持原来的独立控制权。
      this.beginLook(event, this.fireButton!);
    });

    this.fireButton?.addEventListener('lostpointercapture', this.endPointer);
    this.fireButton?.addEventListener('keydown', event => {
      if (event.code === 'Space' || event.code === 'Enter') {
        event.preventDefault();
        this.pressFire('button-key');
      }
    });
    this.fireButton?.addEventListener('keyup', event => {
      if (event.code === 'Space' || event.code === 'Enter') this.fireSources.delete('button-key');
    });

    this.action('aim-button', () => {
      this.precision = !this.precision;
      const button = document.getElementById('aim-button');
      button?.classList.toggle('is-active', this.precision);
      button?.setAttribute('aria-pressed', String(this.precision));
    });
    this.action('reload-button', () => { this.reload = true; });
    this.action('grenade-button', () => { this.grenade = true; });
    this.action('switch-button', () => {
      const current = this.switchWeapon ?? document.getElementById('switch-button')?.dataset.weapon ?? 'rifle';
      const order = WEAPON_KINDS;
      this.switchWeapon = order[(order.indexOf(current as WeaponKind) + 1) % order.length];
    });
    this.action('crouch-button', () => this.toggleCrouch());
    this.action('pause-button', () => { this.pause = true; });
    this.action('interact-button', () => { this.interact = true; });
  }

  private action(id: string, callback: () => void): void {
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

  private beginLook(event: PointerEvent, element: HTMLElement): void {
    if (this.lookPointers.size || event.pointerId === this.movePointer) return;
    this.touchAim.begin();
    this.lookPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.capture(element, event.pointerId);
  }

  private moveLook = (event: PointerEvent): void => {
    if (document.pointerLockElement === this.canvas && event.pointerType === 'mouse') return;
    const previous = this.lookPointers.get(event.pointerId);
    if (!previous) return;
    const dx = event.clientX - previous.x, dy = event.clientY - previous.y;
    if (event.pointerType === 'mouse') {
      this.lookDX -= dx * .0024; this.lookDY -= dy * .0024;
    } else {
      // A screen-width swipe turns 180 degrees; precision mode reduces gain 45%.
      this.touchAim.move(dx, dy, Math.PI / Math.max(innerWidth, 320) * (this.precision ? .55 : 1));
    }
    previous.x = event.clientX;
    previous.y = event.clientY;
    event.preventDefault();
  };

  private moveStick = (event: PointerEvent): void => {
    if (event.pointerId !== this.movePointer || !this.stick) return;
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
    if(event.type==='pointercancel')this.pendingShots.delete(`pointer:${event.pointerId}`);
    if (this.lookPointers.delete(event.pointerId)) {
      if (event.type === 'pointercancel') this.touchAim.clear();
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
    const relevant = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyR', 'KeyG', 'KeyE', 'Digit1', 'Digit2', 'KeyC', 'Escape'];
    if (!relevant.includes(event.code)) return;
    event.preventDefault();
    this.keys.add(event.code);
    if (event.repeat) return;
    if (event.code === 'KeyR') this.reload = true;
    if (event.code === 'KeyG') this.grenade = true;
    if (event.code === 'KeyE') this.interact = true;
    if (event.code === 'Digit1') this.switchWeapon = 'rifle';
    if (event.code === 'Digit2') this.switchWeapon = 'pistol';
    if (event.code === 'KeyC') this.toggleCrouch();
    if (event.code === 'Escape') this.pause = true;
  };

  private onKeyUp = (event: KeyboardEvent): void => { this.keys.delete(event.code); };

  private toggleCrouch(): void {
    this.crouch = !this.crouch;
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
      moveX, moveZ, lookDX: this.lookDX + touch.x, lookDY: this.lookDY + touch.y,
      fire: this.fireSources.size > 0 || this.pendingShots.size > 0, reload: this.reload,
      switchWeapon: this.switchWeapon, crouch: this.crouch, pause: this.pause, grenade: this.grenade, interact: this.interact || this.keys.has('KeyE'),
    };
    this.pendingShots.clear();
    this.lookDX = this.lookDY = 0;
    this.reload = this.pause = this.grenade = this.interact = false;
    this.switchWeapon = null;
    return input;
  }

  clear(): void {
    this.touchAim.clear();
    this.precision = false;
    document.getElementById('aim-button')?.classList.remove('is-active');
    document.getElementById('aim-button')?.setAttribute('aria-pressed', 'false');
    this.keys.clear();
    this.fireSources.clear();
    this.pendingShots.clear();
    this.lookPointers.clear();
    this.movePointer = null;
    this.stickX = this.stickZ = this.lookDX = this.lookDY = 0;
    this.reload = this.pause = this.crouch = this.grenade = this.interact = false;
    this.switchWeapon = null;
    this.stick?.classList.remove('is-active');
    this.fireButton?.classList.remove('is-active');
    this.crouchButton?.classList.remove('is-active');
    this.crouchButton?.setAttribute('aria-pressed', 'false');
    if (this.knob) this.knob.style.transform = 'translate(0px, 0px)';
    for (const [id, element] of this.captures) {
      try { if (element.hasPointerCapture(id)) element.releasePointerCapture(id); } catch { /* Already released. */ }
    }
    this.captures.clear();
  }
}
