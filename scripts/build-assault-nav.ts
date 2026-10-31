import {readFileSync,writeFileSync} from 'node:fs';
import {AssaultCollision} from '../src/game/assaultCollision';
const root='public/assets/maps/assault/';
const bytes=readFileSync(root+'cs_assault.bsp');
const map=new AssaultCollision(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
console.time('navigation');const nav=map.buildNavigation();console.timeEnd('navigation');
writeFileSync('artifacts/assault-20261024/navigation-all.json',JSON.stringify(nav));
const origin=map.spawns.blue[0];
const start=nav.points.indexOf(map.nearest(origin.x,origin.z,origin.y)!);
const reachable=new Set([start]),queue=[start];
for(let i=0;i<queue.length;i++)for(const n of nav.edges[queue[i]])if(!reachable.has(n)){reachable.add(n);queue.push(n);}
const indices=new Map(queue.map((old,i)=>[old,i]));
const result={points:queue.map(i=>nav.points[i]),edges:queue.map(i=>nav.edges[i].filter(n=>indices.has(n)).map(n=>indices.get(n)!))};
map.navigation=result;
const metrics={bounds:map.bounds,spawns:map.spawns,excludedModels:map.excludedModels,ladders:map.ladders,points:nav.points.length,reachable:queue.length,crouchPoints:result.points.filter(p=>p.crouched).length,ladderPoints:result.points.filter(p=>p.ladder!==undefined).length,spawnPaths:map.spawns.red.map(p=>map.path(origin.x,origin.z,p.x,p.z,origin.y,p.y).length)};
writeFileSync(root+'navigation.json',JSON.stringify(result));
writeFileSync('artifacts/assault-20261024/navigation-build.json',JSON.stringify(metrics,null,2));
console.log(JSON.stringify(metrics,null,2));
if(metrics.spawnPaths.some(n=>!n)||!metrics.crouchPoints||!metrics.ladderPoints)throw new Error('Assault navigation is incomplete');
