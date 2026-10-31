import type * as THREE from 'three';
import type {Team} from '../game/types';
import type {SoldierModelId} from './soldierRoster';

/** The supplied faction outfits already identify the teams. Preserve their textures. */
export function applyTeamUniform(model:THREE.Object3D,id:SoldierModelId,team:Team):void {
 model.userData.uniformColor='authored';
 model.userData.uniformSource=id;
 model.userData.team=team;
}
