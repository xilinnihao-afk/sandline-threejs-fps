import type {Actor,WeaponKind} from './types';
import {requestWeaponSwitch} from './weaponSwitch';

/** Call after ownership/rules validation. Attack poses belong to the old object. */
export function setEquippedWeapon(actor:Actor,kind:WeaponKind):void {
 if(actor.weapon===kind)return;
 requestWeaponSwitch(actor,kind);
 actor.weapon=kind;
 actor.shotTime=-10;
}
