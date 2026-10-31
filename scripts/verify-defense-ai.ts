import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {Simulation} from '../src/game/simulation';
import {EMPTY_INPUT} from '../src/game/types';
import {setActiveMap,type MapId} from '../src/game/map';
import {blocked} from '../src/game/collision';
import {Dust2Collision} from '../src/game/dust2Collision';
import {installDust2Geometry} from '../src/game/dust2';

const option=(name:string,fallback:string)=>process.argv.find(a=>a.startsWith('--'+name+'='))?.split('=').slice(1).join('=')??fallback;
const output=option('output','artifacts/grip-defense-20261023/defense-metrics.json');
const seeds=option('seeds','77,2026,149').split(',').map(Number),seconds=Number(option('seconds','120')),hz=30;
const bytes=readFileSync('public/assets/maps/dust2/de_dust2.bsp');
const geometry=new Dust2Collision(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
geometry.navigation=JSON.parse(readFileSync('public/assets/maps/dust2/navigation.json','utf8'));installDust2Geometry(geometry);
const results=[];
for(const map of option('maps','desert,snow,dust2').split(',') as MapId[])for(const seed of seeds)for(const wave of [1,4,8]){
 setActiveMap(map);const sim=new Simulation(seed);sim.start('defense');sim.state.defense!.completed=wave-1;sim.startDefenseWave();
 const site=sim.state.defense!.site;
 const stats=sim.state.actors.map(a=>({id:a.id,team:a.team,aliveSeconds:0,distance:0,shots:0,reloads:0,firstShot:null as number|null,stationaryTurningSeconds:0,maxSiteDistance:0}));
 const roles=new Set<string>(),actions=new Set<string>();let invalidPositions=0,firstBreach:number|null=null;
 for(let frame=0;frame<seconds*hz&&sim.state.phase==='playing';frame++){
  const previous=sim.state.actors.map(a=>({x:a.x,z:a.z,yaw:a.yaw,alive:a.health>0}));
  sim.update(1/hz,EMPTY_INPUT,true);
  sim.state.actors.forEach((a,i)=>{
   if(!previous[i].alive)return;const stat=stats[i],travel=Math.hypot(a.x-previous[i].x,a.z-previous[i].z);
   stat.aliveSeconds+=1/hz;stat.distance+=travel;stat.maxSiteDistance=Math.max(stat.maxSiteDistance,Math.hypot(a.x-site.x,a.z-site.z));
   if(travel<.002&&Math.abs(Math.atan2(Math.sin(a.yaw-previous[i].yaw),Math.cos(a.yaw-previous[i].yaw)))>.2/hz)stat.stationaryTurningSeconds+=1/hz;
   if(frame%hz===0&&(![a.x,a.y,a.z].every(Number.isFinite)||blocked(a.x,a.z,.3,undefined,a.y)))invalidPositions++;
  });
  for(const event of sim.events){if(event.type==='shot'){const stat=stats[event.actorId];stat.shots++;stat.firstShot??=sim.state.time;}else if(event.type==='reload')stats[event.actorId].reloads++;}
  for(const bot of sim.botDiagnostics()){roles.add(bot.role);actions.add(bot.action);}
  if(sim.state.defense!.attackers>0)firstBreach??=sim.state.time;
  sim.events=[];
 }
 const result={map,seed,wave,seconds:sim.state.time,phase:sim.state.phase,siteHealth:sim.state.defense!.health,remaining:sim.state.defense!.remaining,reason:sim.state.defense!.reason,firstBreach,invalidPositions,roles:[...roles],actions:[...actions],actors:stats};
 results.push(result);console.log(JSON.stringify({map,seed,wave,seconds:+sim.state.time.toFixed(1),phase:result.phase,siteHealth:+result.siteHealth.toFixed(1),shots:stats.reduce((n,a)=>n+a.shots,0),invalidPositions}));
}
mkdirSync(output.slice(0,output.lastIndexOf('/')),{recursive:true});writeFileSync(output,JSON.stringify({hz,seeds,maxSeconds:seconds,results},null,2)+'\n');
