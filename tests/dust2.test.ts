import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Dust2Collision,DUST_HALF_HEIGHT} from '../src/game/dust2Collision';
import {installDust2Geometry} from '../src/game/dust2';
import {setActiveMap,MAPS} from '../src/game/map';
import {Simulation} from '../src/game/simulation';
import {EMPTY_INPUT} from '../src/game/types';
import {advanceJump} from '../src/game/jump';
import {friendlyBlocksShot} from '../src/game/botTactics';
const bytes=readFileSync('public/assets/maps/dust2/de_dust2.bsp');
const geometry=new Dust2Collision(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
geometry.navigation=JSON.parse(readFileSync('public/assets/maps/dust2/navigation.json','utf8'));
installDust2Geometry(geometry);
test('classic Dust II keeps original BSP geometry, inch scale and actual elevated spawns',()=>{
 assert.equal(createHash('sha256').update(bytes).digest('hex'),'15945389528d113562ede0a2c80647ebfa799079ed1c05a25379bcf84e4e9286');
 assert.equal(geometry.spawns.blue.length,20);assert.equal(geometry.spawns.red.length,20);
 assert.equal(geometry.bodyHulls.length,11);assert.equal(geometry.pointHulls.length,11);
 for(const spawn of [...geometry.spawns.blue,...geometry.spawns.red]){
  assert.equal(geometry.blocked(spawn.x,spawn.z,spawn.y),false);
  assert.ok(Math.abs(geometry.ground(spawn.x,spawn.z,spawn.y+.1)!-spawn.y)<.002);
 }
 assert.ok(geometry.spawns.blue[0].y<0);assert.ok(geometry.spawns.red[0].y>0);
});
test('routes to both sites, long, middle and tunnels are traversable at actual heights',()=>{
 const starts=[geometry.spawns.blue[0],geometry.spawns.red[0]];
 for(const start of starts)for(const end of MAPS.dust2.patrol!){
  const path=geometry.path(start.x,start.z,end.x,end.z,start.y,end.y);assert.ok(path.length>0);
  let p:{x:number;y:number;z:number}={...start};for(const next of path){p=geometry.move(p.x,p.z,next.x-p.x,next.z-p.z,p.y);assert.ok(Math.hypot(p.x-next.x,p.z-next.z)<.05,JSON.stringify({p,next}));assert.ok(Math.abs(p.y-next.y)<.08,JSON.stringify({p,next,start,end}));assert.equal(geometry.blocked(p.x,p.z,p.y),false);}
 }
});
test('Dust II jump lands on local floors and cannot jump through a tunnel ceiling',()=>{
 try{setActiveMap('dust2');const sim=new Simulation(42);sim.start();const p=sim.state.player,base=p.y!;
  let peak=base;for(let i=0;i<120;i++){advanceJump(p,1/60,i===0);peak=Math.max(peak,p.y!);}
  assert.ok(peak>base+.7);assert.ok(Math.abs(p.y!-base)<.015);
  const tunnel=geometry.navigation.points.find(n=>{const head=geometry.ray(n.x,n.y+1.8,n.z,0,1,0);return head>1&&head<3;});assert.ok(tunnel);
  Object.assign(p,tunnel,{groundY:tunnel.y,verticalSpeed:14});
  for(let i=0;i<90;i++){advanceJump(p,1/60,i===0);assert.equal(geometry.blocked(p.x,p.z,p.y),false);assert.ok(geometry.ray(p.x,p.y!+DUST_HALF_HEIGHT,p.z,0,1,0)>.5);}
 }finally{setActiveMap('desert');}
});
test('Dust II path connectors go around diagonal corners and preserve stacked floor destinations',()=>{
 const p={x:-29.5104,y:.1999626307770973,z:-59.4912},goal=geometry.spawns.blue[0];
 const path=geometry.path(p.x,p.z,goal.x,goal.z,p.y,goal.y);assert.ok(path.length);
 assert.ok(geometry.segment(p.x,p.z,path[0].x,path[0].z,p.y,path[0].y));
 const upper=geometry.nearest(11.5824,-62.3824,2.4384)!,lower=geometry.nearest(11.5824,-62.3824,-3.2512)!;
 assert.ok(upper.y-lower.y>5);
 const up=geometry.path(goal.x,goal.z,upper.x,upper.z,goal.y,upper.y);assert.ok(up.length);assert.equal(up.at(-1)!.y,upper.y);
});
test('a teammate under the A platform does not prevent a bot shooting along the platform',()=>{
 try{setActiveMap('dust2');const sim=new Simulation(42),[shooter,ally]=sim.state.actors,enemy=sim.state.actors[3];
 Object.assign(shooter,{x:9.9568,y:2.4384,z:-62.3824});Object.assign(enemy,{x:13.208,y:2.4384,z:-62.3824});Object.assign(ally,{x:11.5824,y:-3.2512,z:-62.3824});
 assert.equal(friendlyBlocksShot(shooter,enemy,enemy.y!+1.2,ally),false);
 ally.y=shooter.y;assert.equal(friendlyBlocksShot(shooter,enemy,enemy.y!+1.2,ally),true);
 }finally{setActiveMap('desert');}
});
test('Dust II bots traverse the original map and fight without penetrating its solid hull',()=>{
 try{setActiveMap('dust2');const sim=new Simulation(42);sim.start();let shots=0,hits=0,kills=0;
  const minY=sim.state.actors.map(a=>a.y!),maxY=[...minY];
  for(let frame=0;frame<60*180;frame++){
   sim.update(1/60,EMPTY_INPUT,true);
   for(const e of sim.events){if(e.type==='shot')shots++;if(e.type==='hit')hits++;if(e.type==='kill')kills++;}sim.events=[];
   if(frame%10===0)for(const a of sim.state.actors)if(a.health>0){assert.equal(geometry.blocked(a.x,a.z,a.y),false,`actor ${a.id} at ${JSON.stringify([a.x,a.y,a.z])}`);minY[a.id]=Math.min(minY[a.id],a.y!);maxY[a.id]=Math.max(maxY[a.id],a.y!);}
  }
  console.log('DUST2_BOT_METRICS',JSON.stringify({shots,hits,kills,score:[sim.state.blueScore,sim.state.redScore],heightRanges:minY.map((y,i)=>maxY[i]-y)}));
  assert.ok(shots>20&&hits>10&&kills>=3);assert.ok(minY.some((y,i)=>maxY[i]-y>3));
 }finally{setActiveMap('desert');}
});
