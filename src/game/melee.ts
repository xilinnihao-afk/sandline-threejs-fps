import type {MeleeAttack} from './types';

export interface MeleeAttackSpec {
 damage:number;
 interval:number;
 contactDelay:number;
 range:number;
 yawOffsets:readonly number[];
}

/** Contact timing is shared with first- and third-person animation. */
export const MELEE_ATTACKS:Record<MeleeAttack,MeleeAttackSpec> = {
 slash:{damage:40,interval:.62,contactDelay:.12,range:1.65,yawOffsets:[0,-.12,.12,-.24,.24]},
 stab:{damage:75,interval:.95,contactDelay:.22,range:1.5,yawOffsets:[0,-.035,.035]},
};
