import type {WeaponKind} from '../game/types';
type Contact=readonly [number,number,number];

// Surface contacts measured on the original AK, in canonical metres.
export const CLASSIC_HAND_CONTACTS={
  left:[-.00007845,.0015,-.2715],right:[.0105,-.050,.020],
} as const;

// First-person CS16 palms have a different wrist offset from the third-person
// characters. Anchor their original shape at actual grip/fore-end surfaces.
export const CLASSIC_VIEW_CONTACTS:Partial<Record<WeaponKind,{left:Contact;right:Contact}>>={
  // A cylindrical knife needs the axis inside the closed fist, rather than
  // the firearm's palm-surface anchor. The right hand uses its grasp centre.
  knife:{left:[-.205,.002,-.012],right:[0,.0001944,0]},
  m4:{left:[-.006,.029533,-.330],right:[.013123,-.055,.030]},
  smg:{left:[0,.028826,-.315],right:[.015272,-.065,-.090]},
  shotgun:{left:[0,.014989,-.430],right:[.017375,.020,.065]},
  sniper:{left:[0,.015319,-.260],right:[.010500,-.045,.115]},
  deagle:{left:[-.024,-.023,0],right:[.014762,-.023001,-.011958]},
  pistol:{left:[-.024,-.025,.012],right:[.017847,-.025,0]},
};
