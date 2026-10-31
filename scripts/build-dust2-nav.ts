import {readFileSync,writeFileSync} from 'node:fs';
import {Dust2Collision} from '../src/game/dust2Collision';
const source=readFileSync('public/assets/maps/dust2/de_dust2.bsp');
const map=new Dust2Collision(source.buffer.slice(source.byteOffset,source.byteOffset+source.byteLength));
console.time('navigation');const nav=map.buildNavigation();console.timeEnd('navigation');
// Only publish the component connected to the original CT spawn. This removes roofs
// and decorative out-of-bounds islands, not walkable routes or stacked passages.
const start=nav.points.indexOf(map.nearest(map.spawns.blue[0].x,map.spawns.blue[0].z,map.spawns.blue[0].y)!);
const reachable=new Set([start]),queue=[start];for(let i=0;i<queue.length;i++)for(const n of nav.edges[queue[i]])if(!reachable.has(n)){reachable.add(n);queue.push(n);}
const indices=new Map(queue.map((old,i)=>[old,i]));
const result={points:queue.map(i=>nav.points[i]),edges:queue.map(i=>nav.edges[i].map(n=>indices.get(n)!))};
map.navigation=result;
writeFileSync('public/assets/maps/dust2/navigation.json',JSON.stringify(result));
console.log(JSON.stringify({bounds:map.bounds,spawns:map.spawns,points:nav.points.length,reachable:queue.length,spawnPaths:map.spawns.red.map(p=>map.path(map.spawns.blue[0].x,map.spawns.blue[0].z,p.x,p.z,map.spawns.blue[0].y,p.y).length)},null,2));
