import type {MapBox,ObjectiveSite,HostageState,RescueZone} from './types';
import type {MapGeometry,MapPoint} from './mapGeometry';
const DESERT_SIZE={width:44,depth:40};
const DESERT_BOXES:MapBox[]=[
 {x:-22,z:0,w:1,d:41,h:5,kind:'wall'},{x:22,z:0,w:1,d:41,h:5,kind:'wall'},
 {x:0,z:-20,w:45,d:1,h:5,kind:'wall'},{x:0,z:20,w:45,d:1,h:5,kind:'wall'},
 {x:-9,z:0,w:9,d:13,h:5.3,kind:'wall'},{x:10,z:0,w:8,d:12,h:4.5,kind:'wall'},
 {x:0,z:5,w:3.8,d:2.6,h:2.2,kind:'crate'},{x:1,z:-7,w:3.8,d:2.6,h:2.2,kind:'crate'},
 {x:-17,z:9,w:3,d:4.5,h:2.1,kind:'crate'},{x:17,z:-9,w:3,d:4.5,h:2.1,kind:'crate'},
 {x:-8,z:13,w:6,d:2.7,h:2.5,kind:'container'},{x:8,z:-13,w:6,d:2.7,h:2.5,kind:'container'},
 {x:15,z:12,w:2.2,d:2.2,h:1.15,kind:'crate'},{x:-15,z:-12,w:2.2,d:2.2,h:1.15,kind:'crate'},
];
// Preserve the original slots, then spread additions behind cover on both flanks.
const DESERT_BLUE=[{x:0,z:16},{x:-8,z:17},{x:8,z:17},{x:-10,z:18},{x:-6,z:18},{x:18,z:18},{x:-18,z:16},{x:13,z:16},{x:-15,z:18},{x:15,z:18}];
const DESERT_RED=[{x:0,z:-16},{x:4,z:-17},{x:-5,z:-17},{x:-10,z:-18},{x:-2,z:-18},{x:18,z:-18},{x:-18,z:-16},{x:11,z:-16},{x:8,z:-18},{x:-8,z:-16}];

export type MapId = 'desert' | 'snow' | 'dust2' | 'assault' | 'bloodstrike';
export interface MapDefinition {
 id:MapId; name:string; subtitle:string; description:string; preview:string;
 mode:'demolition'|'elimination'|'hostageRescue'|'bounty'; size:{width:number;depth:number}; boxes:MapBox[];
 blueSpawns:MapPoint[]; redSpawns:MapPoint[];
 geometry?:MapGeometry; patrol?:MapPoint[]; bombSites?:ObjectiveSite[]; hostageSpawns?:HostageState[]; rescueZones?:RescueZone[];
}
// 43 m of interior width = 9 m flank + 9.5 m cover + 6 m center + 9.5 m cover + 9 m flank.
// Grow the four ice blocks inward only: the central cross is 6 m wide in both
// directions, while the outer flanks, end openings and low-cover positions stay fixed.
const SNOW_BOXES:MapBox[] = [
 {x:-22,z:0,w:1,d:41,h:4.4,kind:'wall'}, {x:22,z:0,w:1,d:41,h:4.4,kind:'wall'},
 {x:0,z:-20,w:45,d:1,h:4.4,kind:'wall'}, {x:0,z:20,w:45,d:1,h:4.4,kind:'wall'},
 ...[-7.75,7.75].flatMap(x=>[-7.75,7.75].map(z=>({x,z,w:9.5,d:9.5,h:4,kind:'wall' as const}))),
 // Mid-flank ice buttresses grow 4 m inward from each exterior wall.
 // The 5 m passage between each buttress and the four blocks stays traversable.
 ...[-19.5,19.5].map(x=>({x,z:0,w:4,d:3.2,h:4,kind:'wall' as const})),
 // Low cover hugs the end faces, leaving all three lanes and the crossroad open.
 ...[-11,11].flatMap(x=>[-13.65,13.65].map(z=>({x,z,w:2.6,d:2.3,h:1.65,kind:'crate' as const}))),
];
export const MAPS:Record<MapId,MapDefinition>={
 desert:{id:'desert',name:'沙漠旧城',subtitle:'DUST QUARTER',description:'旧城巷战 · 双侧绕行 · 持续对战',preview:'assets/ui/desert-preview.jpg',mode:'demolition',size:DESERT_SIZE,boxes:DESERT_BOXES,blueSpawns:DESERT_BLUE,redSpawns:DESERT_RED},
 snow:{id:'snow',name:'雪地竞技场',subtitle:'ICE WORLD',description:'三路交锋 · 十字通路 · 持续对战',preview:'assets/ui/snow-preview.jpg',mode:'elimination',size:{width:44,depth:40},boxes:SNOW_BOXES,
 blueSpawns:[{x:-3,z:17},{x:-9,z:17},{x:9,z:17},{x:-17,z:17},{x:17,z:17},{x:3,z:17},{x:-13,z:18},{x:13,z:18},{x:-6,z:18},{x:6,z:18}],
 redSpawns:[{x:3,z:-17},{x:9,z:-17},{x:-9,z:-17},{x:17,z:-17},{x:-17,z:-17},{x:-3,z:-17},{x:13,z:-18},{x:-13,z:-18},{x:6,z:-18},{x:-6,z:-18}]},
 dust2:{id:'dust2',name:'经典沙漠 2',subtitle:'DE_DUST2 · CS 1.6',description:'A 大道 · 中门 · B 洞 · A 小道',preview:'assets/ui/dust2-preview.jpg',mode:'demolition',size:{width:112,depth:112},boxes:[],blueSpawns:[],redSpawns:[]},
 assault:{id:'assault',name:'仓库突击',subtitle:'CS_ASSAULT · CS 1.6',description:'解救人质 · 仓库突入 · 护送至救援区',preview:'assets/ui/assault-preview.jpg',mode:'hostageRescue',size:{width:112,depth:112},boxes:[],blueSpawns:[],redSpawns:[]},
 bloodstrike:{id:'bloodstrike',name:'Bloodstrike 血战',subtitle:'BLOOD STRIKE · CS 1.6',description:'经典对称竞技场 · 团队歼灭 · 赏金跨局购枪',preview:'assets/ui/bloodstrike-preview.jpg',mode:'bounty',size:{width:44,depth:44},boxes:[],blueSpawns:[],redSpawns:[]},
};
let activeMap:MapDefinition=MAPS.desert;
// Live bindings keep collision, navigation, renderer and radar on one map definition.
export let MAP_SIZE=activeMap.size;
export let MAP_BOXES=activeMap.boxes;
export let BLUE_SPAWNS=activeMap.blueSpawns;
export let RED_SPAWNS=activeMap.redSpawns;
export let mapRevision=0;
export function getActiveMap():MapDefinition{return activeMap;}
export function setActiveMap(id:MapId):void{
 if(!Object.prototype.hasOwnProperty.call(MAPS,id))throw new Error('Unknown map: '+id);
 if((id==='dust2'||id==='assault'||id==='bloodstrike')&&!MAPS[id].geometry)throw new Error(`${MAPS[id].name} geometry has not loaded`);
 activeMap=MAPS[id];MAP_SIZE=activeMap.size;MAP_BOXES=activeMap.boxes;
 BLUE_SPAWNS=activeMap.blueSpawns;RED_SPAWNS=activeMap.redSpawns;mapRevision++;
}
