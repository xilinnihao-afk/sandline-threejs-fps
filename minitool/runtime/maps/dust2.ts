import snapshot from '../../generated/maps/dust2-collision';
import {restoreCollision} from './restore';
import {MAPS} from '../../../src/game/map';
import {MAX_TEAM_SIZE} from '../../../src/game/botRoster';
import {Dust2Collision,type DustNavigation,GOLDSRC_SCALE} from '../../../src/game/dust2Collision';
export const DUST2_LANDMARKS=[
 {name:'A 区',x:1120,z:-2752},{name:'A 大道',x:1440,z:-1408},
 {name:'A 门外',x:800,z:-128},{name:'T 出生区',x:-832,z:704},
 {name:'B 洞',x:-1920,z:-864},{name:'B 区',x:-1600,z:-2560},
 {name:'中门',x:-448,z:-1824},{name:'A 小道',x:416,z:-1664},
].map(p=>({...p,x:p.x*GOLDSRC_SCALE,z:p.z*GOLDSRC_SCALE}));
export function installDust2Geometry(geometry:Dust2Collision){
 const map=MAPS.dust2;map.geometry=geometry;
 map.blueSpawns=geometry.spawns.blue.slice(0,MAX_TEAM_SIZE);map.redSpawns=geometry.spawns.red.slice(0,MAX_TEAM_SIZE);
 // Original func_bomb_target brushes (*42 A, *16 B), in GoldSrc units.
 map.bombSites=[{id:'A' as const,min:[1024,2304,96],max:[1280,2624,192]},{id:'B' as const,min:[-1728,2496,0],max:[-1344,2880,96]}].map(source=>{
  const k=GOLDSRC_SCALE,bounds={minX:source.min[0]*k,maxX:source.max[0]*k,minY:source.min[2]*k,maxY:source.max[2]*k,minZ:-source.max[1]*k,maxZ:-source.min[1]*k};
  const x=(bounds.minX+bounds.maxX)/2,z=(bounds.minZ+bounds.maxZ)/2;
  const point=geometry.navigation.points.filter(p=>p.x>bounds.minX&&p.x<bounds.maxX&&p.z>bounds.minZ&&p.z<bounds.maxZ&&Math.abs(p.y-bounds.minY)<.3)
   .sort((a,b)=>(a.x-x)**2+(a.z-z)**2-(b.x-x)**2-(b.z-z)**2)[0];
  if(!point)throw new Error(`Dust2 bombsite ${source.id} has no walkable floor`);
  return {id:source.id,x:point.x,y:point.y,z:point.z,radius:Math.min(bounds.maxX-bounds.minX,bounds.maxZ-bounds.minZ)/2,bounds};
 });
 map.size={width:2*Math.max(Math.abs(geometry.bounds.min.x),Math.abs(geometry.bounds.max.x)),depth:2*Math.max(Math.abs(geometry.bounds.min.z),Math.abs(geometry.bounds.max.z))};
 map.patrol=DUST2_LANDMARKS.map(p=>({...geometry.nearest(p.x,p.z)!}));
}

/** Offline map geometry is available from bundled scene data. */
export function prepareDust2():Promise<void>{
 if(!MAPS.dust2.geometry)installDust2Geometry(restoreCollision(snapshot) as Dust2Collision);
 return Promise.resolve();
}
