import {strict as assert} from 'node:assert';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Dust2Collision} from '../src/game/dust2Collision';

const root='public/assets/maps/bloodstrike/';
const evidence='artifacts/bloodstrike-20261025/assets/';
mkdirSync(evidence,{recursive:true});
const bytes=readFileSync(root+'cs_bloodstrike.bsp');
const map=new Dust2Collision(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
console.time('navigation');
const nav=map.buildNavigation();
console.timeEnd('navigation');
assert.equal(map.spawns.blue.length,10);
assert.equal(map.spawns.red.length,10);
const origin=map.spawns.blue[0];
const nearest=map.nearest(origin.x,origin.z,origin.y);
assert(nearest,'The original CT spawn must connect to the navigation graph');
const start=nav.points.indexOf(nearest);
const reachable=new Set([start]),queue=[start];
for(let i=0;i<queue.length;i++)for(const n of nav.edges[queue[i]])if(!reachable.has(n)){reachable.add(n);queue.push(n);}
const indices=new Map(queue.map((old,i)=>[old,i]));
const result={points:queue.map(i=>nav.points[i]),edges:queue.map(i=>nav.edges[i].filter(n=>indices.has(n)).map(n=>indices.get(n)!))};
map.navigation=result;
const spawnPaths=[...map.spawns.blue,...map.spawns.red].map(p=>map.path(origin.x,origin.z,p.x,p.z,origin.y,p.y).length);
assert(spawnPaths.every(length=>length>0),'Every original spawn must be reachable');
assert([...map.spawns.blue,...map.spawns.red].every(p=>!map.blocked(p.x,p.z,p.y)),'Original spawns must be clear');
const landingErrors=[...map.spawns.blue,...map.spawns.red].map(p=>{
 const floor=map.ground(p.x,p.z,p.y+.5);
 assert(floor!==null&&floor<0,'The original negative-height floor must remain valid');
 const landed=map.vertical(p.x,p.z,p.y+.5,p.y-2);
 assert(Math.abs(landed-p.y)<.005,'A falling body must stop on the original negative-height floor');
 return Math.abs(landed-p.y);
});
const menuCamera={eye:{x:17,y:-5.8,z:17},target:{x:-10,y:-7,z:0},verticalFovDegrees:75};
assert(!map.trace(menuCamera.eye,{...menuCamera.eye,x:menuCamera.eye.x+.001}).startSolid,'Menu camera must remain outside original BSP solids');
assert(map.ground(menuCamera.eye.x,menuCamera.eye.z,menuCamera.eye.y)!<0,'Menu camera must look from a real walkable floor');
assert(result.points.every(p=>Object.values(p).every(Number.isFinite)));
for(let i=0;i<result.edges.length;i++)for(const j of result.edges[i]){
 assert(j>=0&&j<result.points.length&&result.edges[j].includes(i),'Navigation edges must be valid and reciprocal');
 const a=result.points[i],b=result.points[j];
 assert(map.segment(a.x,a.z,b.x,b.z,a.y,b.y),'Navigation edge must traverse original BSP collision');
}
const json=JSON.stringify(result);
writeFileSync(root+'navigation.json',json);
const metrics={map:'cs_bloodstrike',bounds:map.bounds,spawns:map.spawns,
 points:nav.points.length,reachable:queue.length,spawnPaths,
 minFloor:Math.min(...result.points.map(p=>p.y)),maxFloor:Math.max(...result.points.map(p=>p.y)),
 allSpawnsClear:true,allEdgesTraversable:true,negativeHeightLandingVerified:true,maxLandingError:Math.max(...landingErrors),menuCamera,
 navigationBytes:Buffer.byteLength(json),navigationSha256:createHash('sha256').update(json).digest('hex')};
writeFileSync(evidence+'navigation-build.json',JSON.stringify(metrics,null,2)+'\n');
console.log(JSON.stringify(metrics,null,2));
