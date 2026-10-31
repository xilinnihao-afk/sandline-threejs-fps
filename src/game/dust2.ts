import {MAPS} from './map';
import {MAX_TEAM_SIZE} from './botRoster';
import {JUMP_GRAVITY} from './jump';
import {Dust2Collision,type DustNavigation,GOLDSRC_SCALE} from './dust2Collision';
export const DUST2_LANDMARKS=[
 {name:'A 区',x:1120,z:-2752},{name:'A 大道',x:1440,z:-1408},
 {name:'A 门外',x:800,z:-128},{name:'T 出生区',x:-832,z:704},
 {name:'B 洞',x:-1920,z:-864},{name:'B 区',x:-1600,z:-2560},
 {name:'中门',x:-448,z:-1824},{name:'A 小道',x:416,z:-1664},
].map(p=>({...p,x:p.x*GOLDSRC_SCALE,z:p.z*GOLDSRC_SCALE}));
export function installDust2Geometry(geometry:Dust2Collision){
 // Match the original map's 32-unit ledges / 64-unit duck-jump boxes.
 // A two-unit clearance above the classic 45-unit arc covers discrete sweeps.
 // This mesh has walking-only navigation; a player arc must not opt bots
 // into Assault's separate jump-edge traversal.
 geometry.jumpSpeed=Math.sqrt(2*JUMP_GRAVITY*47*GOLDSRC_SCALE);
 geometry.airDuckLift=18*GOLDSRC_SCALE;
 geometry.crouchEyeHeight=30*GOLDSRC_SCALE;
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
let preparing:Promise<void>|undefined;
export function prepareDust2():Promise<void>{
 if(MAPS.dust2.geometry)return Promise.resolve();
 return preparing??=(async()=>{
  const base=`${import.meta.env.BASE_URL}assets/maps/dust2/`;
  const [bsp,nav]=await Promise.all([fetch(base+'de_dust2.bsp'),fetch(base+'navigation.json')]);
  if(!bsp.ok||!nav.ok)throw new Error('经典沙漠 2 地图资源下载失败');
  const collision=new Dust2Collision(await bsp.arrayBuffer());collision.navigation=await nav.json() as DustNavigation;
  if(!collision.navigation.points.length||collision.spawns.blue.length<MAX_TEAM_SIZE||collision.spawns.red.length<MAX_TEAM_SIZE)throw new Error('经典沙漠 2 数据不完整');
  installDust2Geometry(collision);
 })().catch(error=>{preparing=undefined;throw error;});
}
