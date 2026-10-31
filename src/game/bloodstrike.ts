import {MAPS} from './map';
import {MAX_TEAM_SIZE} from './botRoster';
import {Dust2Collision,type DustNavigation} from './dust2Collision';

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

let preparing:Promise<void>|undefined;
export function prepareBloodstrike():Promise<void>{
 if(MAPS.bloodstrike.geometry)return Promise.resolve();
 return preparing??=(async()=>{
  const base=`${import.meta.env.BASE_URL}assets/maps/bloodstrike/`;
  const [bsp,nav]=await Promise.all([fetch(base+'cs_bloodstrike.bsp'),fetch(base+'navigation.json')]);
  if(!bsp.ok||!nav.ok)throw new Error('Bloodstrike 地图资源下载失败');
  const geometry=new Dust2Collision(await bsp.arrayBuffer());
  geometry.navigation=await nav.json() as DustNavigation;
  if(!geometry.navigation.points.length||geometry.navigation.edges.length!==geometry.navigation.points.length||geometry.spawns.blue.length<MAX_TEAM_SIZE||geometry.spawns.red.length<MAX_TEAM_SIZE)throw new Error('Bloodstrike 地图数据不完整');
  installBloodstrikeGeometry(geometry);
 })().catch(error=>{preparing=undefined;throw error;});
}
