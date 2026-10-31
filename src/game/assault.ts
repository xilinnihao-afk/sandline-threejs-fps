import {MAPS} from './map';
import {MAX_TEAM_SIZE} from './botRoster';
import {AssaultCollision} from './assaultCollision';
import {type DustNavigation,GOLDSRC_SCALE} from './dust2Collision';

// Original GoldSrc positions retain the floor hint for stacked rooms/rooftops.
export const ASSAULT_LANDMARKS=[
 {name:'CT 出生区',x:640,y:0,z:160},
 {name:'仓库正门',x:-760,y:0,z:2100},
 {name:'仓库大厅',x:-200,y:0,z:2100},
 {name:'二层走廊',x:-550,y:336,z:2500},
 {name:'仓库屋顶',x:-24,y:512,z:2200},
 {name:'西侧街道',x:-900,y:0,z:1300},
 {name:'仓库后门',x:760,y:0,z:2210},
].map(p=>({...p,x:p.x*GOLDSRC_SCALE,y:p.y*GOLDSRC_SCALE,z:-p.z*GOLDSRC_SCALE}));

export function installAssaultGeometry(geometry:AssaultCollision):void {
 const map=MAPS.assault;map.geometry=geometry;
 map.blueSpawns=geometry.spawns.blue.slice(0,MAX_TEAM_SIZE);
 map.redSpawns=geometry.spawns.red.slice(0,MAX_TEAM_SIZE);
 map.hostageSpawns=geometry.entities.filter(e=>e.classname==='hostage_entity').map((e,id)=>{
  const [x,z,y]=e.origin.split(/\s+/).map(n=>Number(n)*GOLDSRC_SCALE),floor=geometry.ground(x,-z,y+.15)??y;
  return {id,x,y:floor,z:-z,yaw:(Number(e.angle??0)-90)*Math.PI/180,status:'waiting' as const,leaderId:null,moving:false,crouched:false};
 });
 // cs_assault has no func_hostage_rescue brush: use its original CT start.
 const rescue=map.blueSpawns[0];map.rescueZones=[{id:'CT 救援区',x:rescue.x,y:rescue.y??0,z:rescue.z,radius:4.5}];
 map.size={width:2*Math.max(Math.abs(geometry.bounds.min.x),Math.abs(geometry.bounds.max.x)),depth:2*Math.max(Math.abs(geometry.bounds.min.z),Math.abs(geometry.bounds.max.z))};
 const floors=geometry.navigation.points.filter(p=>p.ladder===undefined&&!p.crouched);
 map.patrol=ASSAULT_LANDMARKS.map(p=>floors.reduce((best,n)=>(n.x-p.x)**2+(n.z-p.z)**2+4*(n.y-p.y)**2<(best.x-p.x)**2+(best.z-p.z)**2+4*(best.y-p.y)**2?n:best)).map(p=>({...p}));
}

let preparing:Promise<void>|undefined;
export function prepareAssault():Promise<void> {
 if(MAPS.assault.geometry)return Promise.resolve();
 return preparing??=(async()=>{
  const base=`${import.meta.env.BASE_URL}assets/maps/assault/`;
  const [bsp,nav]=await Promise.all([fetch(base+'cs_assault.bsp'),fetch(base+'navigation.json')]);
  if(!bsp.ok||!nav.ok)throw new Error('仓库突击地图资源下载失败');
  const collision=new AssaultCollision(await bsp.arrayBuffer());
  collision.navigation=await nav.json() as DustNavigation;
  if(!collision.navigation.points.length||collision.navigation.edges.length!==collision.navigation.points.length||collision.spawns.blue.length<MAX_TEAM_SIZE||collision.spawns.red.length<MAX_TEAM_SIZE)throw new Error('仓库突击地图数据不完整');
  installAssaultGeometry(collision);
 })().catch(error=>{preparing=undefined;throw error;});
}
