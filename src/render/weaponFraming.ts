import type {WeaponKind} from '../game/types';

// Keep the rear receiver/stock away from the near plane. Weapon geometry stays
// at its authored scale; only the presentation camera-space position changes.
export const WEAPON_VIEW_OFFSETS:Record<WeaponKind,{x:number;y:number;z:number}>={
 knife:{x:.09,y:-.155,z:-.555},
 rifle:{x:.22,y:-.29,z:-.68},
 pistol:{x:.17,y:-.18,z:-.48},
 deagle:{x:.17,y:-.19,z:-.48},
 smg:{x:.22,y:-.21,z:-.49},
 shotgun:{x:.22,y:-.22,z:-.53},
 m4:{x:.22,y:-.22,z:-.52},
 sniper:{x:.22,y:-.23,z:-.56},
};
