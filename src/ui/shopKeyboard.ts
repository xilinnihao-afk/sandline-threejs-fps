import type {ArsenalItem} from '../game/loadouts';

// Stable shop slots, independent of the gameplay weapon-switch slots.
export const SHOP_SHORTCUT_ITEMS=['rifle','pistol','smg','shotgun','m4','sniper','deagle','ammo','he'] as const satisfies readonly ArsenalItem[];
export interface ShopKeyboardActions {
  isOpen:()=>boolean;
  canOpen:()=>boolean;
  toggle:()=>void;
  buy:(item:ArsenalItem)=>void;
}
/** Capture before gameplay so buying never also switches, shoots or moves. */
export function handleShopKey(event:KeyboardEvent,actions:ShopKeyboardActions):void {
  const target=event.target as HTMLElement|null;
  if(target?.matches('input,select,textarea,[contenteditable="true"]'))return;
  if(event.ctrlKey||event.metaKey||event.altKey)return;
  const open=actions.isOpen();
  if(event.code==='KeyB'&&(open||actions.canOpen())){
    event.preventDefault();event.stopImmediatePropagation();
    if(!event.repeat)actions.toggle();return;
  }
  if(!open)return;
  if(event.code==='Escape'){
    event.preventDefault();event.stopImmediatePropagation();if(!event.repeat)actions.toggle();return;
  }
  const match=/^(?:Digit|Numpad)([1-9])$/.exec(event.code);
  if(match){event.preventDefault();event.stopImmediatePropagation();if(!event.repeat)actions.buy(SHOP_SHORTCUT_ITEMS[Number(match[1])-1]);return;}
  if(['KeyW','KeyA','KeyS','KeyD','KeyR','KeyG','KeyE','KeyQ','KeyC','KeyV','ShiftLeft','ShiftRight','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.code)){
    event.preventDefault();event.stopImmediatePropagation();
  }
}
