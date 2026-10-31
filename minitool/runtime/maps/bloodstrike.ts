import snapshot from '../../generated/maps/bloodstrike-collision';
import {restoreCollision} from './restore';
import {MAPS} from '../../../src/game/map';
import {MAX_TEAM_SIZE} from '../../../src/game/botRoster';
import {Dust2Collision,type DustNavigation} from '../../../src/game/dust2Collision';

export function installBloodstrikeGeometry(geometry:Dust2Collision):void {
 const map=MAPS.bloodstrike;
 map.geometry=geometry;
 // Face along the spawn corridor; the central wall blocks a north-facing start.
 map.blueSpawns=geometry.spawns.blue.slice(0,MAX_TEAM_SIZE).map(p=>({...p,yaw:-Math.PI/2}));
 map.redSpawns=geometry.spawns.red.slice(0,MAX_TEAM_SIZE).map(p=>({...p,yaw:Math.PI/2}));
 map.size={width:2*Math.max(Math.abs(geometry.bounds.min.x),Math.abs(geometry.bounds.max.x)),depth:2*Math.max(Math.abs(geometry.bounds.min.z),Math.abs(geometry.bounds.max.z))};
 // Author a circuit through the center and both flanks, retaining BSP height.
 map.patrol=[[-17,14],[-17,0],[-17,-14],[0,-17],[17,-14],[17,0],[17,14],[0,17],[0,0]]
  .map(([x,z])=>({...geometry.nearest(x,z)!}));
}


/** Offline map geometry is available from bundled scene data. */
export function prepareBloodstrike():Promise<void>{
 if(!MAPS.bloodstrike.geometry)installBloodstrikeGeometry(restoreCollision(snapshot) as Dust2Collision);
 return Promise.resolve();
}
