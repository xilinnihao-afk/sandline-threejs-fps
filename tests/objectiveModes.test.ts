import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Simulation} from '../src/game/simulation';
import {MAPS,setActiveMap,type MapId} from '../src/game/map';
import {Dust2Collision} from '../src/game/dust2Collision';
import {AssaultCollision} from '../src/game/assaultCollision';
import {installDust2Geometry} from '../src/game/dust2';
import {installAssaultGeometry} from '../src/game/assault';
import {EMPTY_INPUT,type Actor,type PlayerInput,type GameMode,type HostageState} from '../src/game/types';
import {mapPlayableModes,modeForMap} from '../src/game/offlineModes';
import {objectiveInteraction,objectiveReachable,insideBombSite} from '../src/game/objectiveInteraction';
import {purchaseWindow,WIN_REWARD} from '../src/game/economy';

function bytes(path:string){const b=readFileSync(path);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);}
const dust=new Dust2Collision(bytes('public/assets/maps/dust2/de_dust2.bsp'));
dust.navigation=JSON.parse(readFileSync('public/assets/maps/dust2/navigation.json','utf8'));installDust2Geometry(dust);
const assault=new AssaultCollision(bytes('public/assets/maps/assault/cs_assault.bsp'));
assault.navigation=JSON.parse(readFileSync('public/assets/maps/assault/navigation.json','utf8'));installAssaultGeometry(assault);
const DT=1/60,HOLD={...EMPTY_INPUT,interact:true};
function onMap(map:MapId,run:()=>void){try{setActiveMap(map);run();}finally{setActiveMap('desert');}}
function place(a:Actor,p:{x:number;y?:number;z:number}){Object.assign(a,{x:p.x,y:p.y??0,z:p.z,groundY:p.y??0,verticalSpeed:0,climbing:false,moving:false,crouched:false,shotTime:-10});}
function frames(sim:Simulation,count:number,input:PlayerInput=EMPTY_INPUT){for(let n=0;n<count;n++)sim.update(DT,input);}
function passive(sim:Simulation){
 // Suppress combat/AI decisions, retaining real movement, gravity, separation,
 // objective logic and both living teams for deterministic round tests.
 for(const a of sim.state.actors)a.player=true;
}
function game(mode?:GameMode){const sim=new Simulation(123);sim.start(mode);passive(sim);return sim;}
function plant(sim:Simulation,id:'A'|'B'='A'){
 const s=sim.state,t=s.actors.find(a=>a.id===s.bomb.carrierId)!,site=s.sites.find(site=>site.id===id)!;
 s.player=t;place(t,site);frames(sim,180,HOLD);
 assert.equal(s.bomb.status,'planted',`plant at ${id}`);assert.equal(s.bomb.site,id);
 return {t,site};
}
function defuser(sim:Simulation,kit=false){
 const s=sim.state,ct=s.actors.find(a=>a.faction==='ct')!;s.player=ct;ct.defuseKit=kit;
 for(const a of s.actors.filter(a=>a.faction==='t'))place(a,MAPS.dust2.redSpawns[a.id%MAPS.dust2.redSpawns.length]);
 place(ct,s.bomb);return ct;
}
function nearHostage(h:HostageState){
 const p=assault.navigation.points.filter(p=>!p.crouched&&p.ladder===undefined&&Math.abs(p.y-h.y)<.1&&objectiveReachable(p,h,2.1))
  .sort((a,b)=>Math.hypot(a.x-h.x,a.z-h.z)-Math.hypot(b.x-h.x,b.z-h.z))[0];
 assert.ok(p,'original hostage has a reachable interaction position');return p;
}

test('classic maps force their objective on normal selection/start; legacy maps retain five selectable modes',()=>{
 for(const [map,mode] of [['dust2','demolition'],['assault','hostageRescue']] as const)onMap(map,()=>{
  assert.deepEqual(mapPlayableModes(),[mode]);assert.equal(modeForMap('armsRace'),mode);
  const sim=new Simulation(8);assert.equal(sim.state.mode,mode);sim.selectMode('knifeOnly');assert.equal(sim.state.mode,mode);
  sim.start();assert.equal(sim.state.mode,mode);assert.equal(sim.state.roundTime,map==='assault'?180:120);
  sim.start('deathmatch');assert.equal(sim.state.mode,'deathmatch','explicit simulation fixtures remain supported');
 });
 for(const map of ['desert','snow'] as const)onMap(map,()=>{
  assert.deepEqual(mapPlayableModes(),['deathmatch','knifeOnly','pistolOnly','armsRace','defense']);
  const sim=new Simulation(8);sim.selectMode('pistolOnly');sim.start();assert.equal(sim.state.mode,'pistolOnly');
 });
});

for(const id of ['A','B'] as const)test(`Dust2 ${id}: original bomb trigger floor accepts exactly three seconds of continuous plant input`,()=>onMap('dust2',()=>{
 const sim=game(),s=sim.state,t=s.actors.find(a=>a.id===s.bomb.carrierId)!,site=s.sites.find(site=>site.id===id)!;
 assert.equal(dust.blocked(site.x,site.z,site.y),false);assert.ok(insideBombSite(site,site));
 s.player=t;place(t,site);assert.equal(objectiveInteraction(s,t)?.kind,'plant');
 frames(sim,179,HOLD);assert.equal(s.bomb.status,'carried');assert.ok(s.bomb.plantProgress!>.99);assert.equal(s.phase,'playing');
 frames(sim,1,HOLD);assert.equal(s.bomb.status,'planted');assert.equal(s.phase,'planted');assert.equal(s.bomb.site,id);assert.equal(s.bomb.timer,40);
 assert.equal(s.bomb.x,t.x);assert.equal(s.bomb.y,t.y);assert.equal(s.bomb.z,t.z);assert.equal(t.hasBomb,false);
 assert.equal(sim.events.filter(e=>e.type==='plantComplete').length,1);
}));

test('Dust2 plant resets on release, movement, jump, shooting, leaving a site and changing site',()=>onMap('dust2',()=>{
 const sim=game(),s=sim.state,t=s.actors.find(a=>a.id===s.bomb.carrierId)!,a=s.sites[0],b=s.sites[1];s.player=t;
 for(const cancel of ['release','move','jump','fire','leave','site'] as const){
  place(t,a);t.guns[t.weapon].cooldown=0;frames(sim,60,HOLD);assert.ok(s.bomb.plantProgress!>.3,cancel);
  if(cancel==='leave')place(t,MAPS.dust2.redSpawns[0]);
  if(cancel==='site')place(t,b);
  frames(sim,1,cancel==='release'?EMPTY_INPUT:cancel==='move'?{...HOLD,moveX:1}:cancel==='jump'?{...HOLD,jump:true}:cancel==='fire'?{...HOLD,fire:true}:HOLD);
  assert.equal(s.bomb.status,'carried',cancel);
  assert.ok((s.bomb.plantProgress??0)<.01,`${cancel} resets the accumulated hold`);
  if(cancel==='site')assert.equal(s.bomb.plantSite,'B');
  frames(sim,1);place(t,a);
 }
 place(t,{...a,y:(a.y??0)-2});assert.equal(objectiveInteraction(s,t),null,'same XZ on a lower floor cannot plant');
 place(t,{...a,y:(a.bounds!.maxY)+.1});assert.equal(objectiveInteraction(s,t),null,'above original trigger cannot plant');
}));

for(const kit of [false,true])test(`Dust2 defuse needs ${kit?5:10} seconds; ending all T after plant does not end the round`,()=>onMap('dust2',()=>{
 const sim=game(),s=sim.state;plant(sim);const ct=defuser(sim,kit);
 for(const a of s.actors.filter(a=>a.faction==='t'))a.health=0;
 frames(sim,1);assert.equal(s.phase,'planted');assert.equal(s.winner,null);
 const duration=(kit?5:10)*60;frames(sim,duration-1,HOLD);assert.equal(s.bomb.status,'planted');assert.ok(s.bomb.progress>.99);
 frames(sim,1,HOLD);assert.equal(s.bomb.status,'defused');assert.equal(s.winner,'blue');assert.equal(s.blueScore,1);
 assert.match(s.roundReason!,/拆除/);assert.equal(sim.events.filter(e=>e.type==='defuseComplete').length,1);assert.ok(ct.health>0);
}));

test('Dust2 defuse cancels on release, distance, height, movement and firing, and cannot pass through original walls',()=>onMap('dust2',()=>{
 const sim=game(),s=sim.state;plant(sim,'B');const ct=defuser(sim,true);
 for(const cancel of ['release','distance','height','move','fire'] as const){
  place(ct,s.bomb);ct.guns[ct.weapon].cooldown=0;frames(sim,30,HOLD);assert.ok(s.bomb.progress>.09);
  if(cancel==='distance')place(ct,{...s.bomb,x:s.bomb.x+3});
  if(cancel==='height')place(ct,{...s.bomb,y:(s.bomb.y??0)+2});
  frames(sim,1,cancel==='release'?EMPTY_INPUT:cancel==='move'?{...HOLD,moveX:1}:cancel==='fire'?{...HOLD,fire:true}:HOLD);
  assert.equal(s.bomb.progress,0,cancel);assert.equal(s.bomb.defuserId,null,cancel);
 }
 // Find two real walkable positions separated by a source wall, within use range.
 const points=dust.navigation.points;let blockedPair:{a:typeof points[number];b:typeof points[number]}|undefined;
 outer:for(let i=0;i<points.length;i+=7)for(let j=i+1;j<points.length;j++){
  const a=points[i],b=points[j],d=Math.hypot(a.x-b.x,a.z-b.z);
  if(d>.7&&d<2.35&&Math.abs(a.y-b.y)<.1&&!objectiveReachable(a,b,2.4)){blockedPair={a,b};break outer;}
 }
 assert.ok(blockedPair,'fixture finds a nearby source wall');place(ct,blockedPair.a);Object.assign(s.bomb,blockedPair.b);
 assert.equal(objectiveInteraction(s,ct),null,'wall blocks the use prompt and defuse eligibility');
}));

for(const margin of [0,.001])test(`Dust2 fuse arbitration: ${margin?'finishing just before':'finishing exactly at'} detonation`,()=>onMap('dust2',()=>{
 const sim=game(),s=sim.state;plant(sim);const ct=defuser(sim,true);
 s.bomb.defuserId=ct.id;s.bomb.progress=.998;s.bomb.timer=.01+margin;
 frames(sim,1,HOLD);
 assert.equal(s.bomb.status,margin?'defused':'exploded');assert.equal(s.winner,margin?'blue':'red');
 assert.equal(sim.events.filter(e=>e.type==='roundReward').length,s.actors.length);
}));

test('Dust2 dropped C4 can only be recovered by a live T on the same floor',()=>onMap('dust2',()=>{
 const sim=game(),s=sim.state,t=s.actors.find(a=>a.id===s.bomb.carrierId)!,other=s.actors.find(a=>a.faction==='t'&&a!==t)!,site=s.sites[1];
 place(t,site);t.health=0;place(s.player,{...site,x:site.x+.9});frames(sim,1);
 assert.equal(s.bomb.status,'dropped');assert.equal(t.hasBomb,false);assert.equal(s.player.hasBomb,false);
 place(other,{...site,x:site.x-.8,y:(site.y??0)+2});frames(sim,1);assert.equal(s.bomb.status,'dropped');
 place(other,{...site,x:site.x-.8});frames(sim,1);assert.equal(s.bomb.status,'carried');assert.equal(s.bomb.carrierId,other.id);assert.equal(other.hasBomb,true);
}));

test('Dust2 before planting: T elimination and no-plant timeout win CT; rewards occur once and first three rounds end the match',()=>onMap('dust2',()=>{
 const sim=game(),s=sim.state;
 for(let round=1;round<=3;round++){
  passive(sim);assert.equal(s.round,round);assert.equal(s.roundTime,120);assert.equal(s.bomb.status,'carried');assert.equal(s.bomb.progress,0);
  const before=s.player.money,events=sim.events.filter(e=>e.type==='roundReward').length;
  if(round===1)for(const a of s.actors.filter(a=>a.team==='red'))a.health=0;else s.roundTime=.001;
  frames(sim,1);assert.equal(s.winner,'blue');assert.equal(s.blueScore,round);assert.equal(s.player.money,before+WIN_REWARD);
  assert.match(s.roundReason!,round===1?/恐怖分子.*消灭/:/未能安放/);
  assert.equal(sim.events.filter(e=>e.type==='roundReward').length,events+s.actors.length);
  frames(sim,60);assert.equal(s.player.money,before+WIN_REWARD,'reward is never repeated during result delay');
  if(round<3){frames(sim,181);assert.equal(s.phase,'playing');assert.ok(s.actors.every(a=>a.health===100));assert.equal(s.roundReason,undefined);}
 }
 assert.equal(s.phase,'matchEnd');const final=JSON.stringify(s);frames(sim,300);assert.equal(JSON.stringify(s),final);
 sim.start();assert.equal(s.mode,'demolition');assert.equal(s.blueScore,0);assert.equal(s.round,1);assert.equal(s.player.money,800);
}));

test('source-map purchase windows use the actual team spawn and twenty elapsed seconds',()=>{
 for(const map of ['dust2','assault'] as const)onMap(map,()=>{
  const sim=game(),s=sim.state;assert.equal(purchaseWindow(s).allowed,true,map);assert.equal(sim.purchase('armor'),true);
  s.time=19.9;assert.equal(purchaseWindow(s).allowed,true);s.time=20.01;assert.equal(purchaseWindow(s).allowed,false);
  s.time=0;place(s.player,MAPS[map].redSpawns[0]);assert.equal(purchaseWindow(s).allowed,false,'opposing spawn is not your buy zone');
  place(s.player,{...MAPS[map].blueSpawns[0],y:(MAPS[map].blueSpawns[0].y??0)+3});assert.equal(purchaseWindow(s).allowed,false,'stacked floor is not the buy zone');
 });
});

test('Assault: original four hostages accept one follow action per press; enemy, height and pause cannot bypass use rules',()=>onMap('assault',()=>{
 const sim=game(),s=sim.state,r=s.rescue!,h=r.hostages[0];assert.equal(r.total,4);assert.equal(r.rescued,0);assert.equal(s.roundTime,180);
 place(s.player,nearHostage(h));
 s.pickups.push({id:999,weapon:'sniper',x:s.player.x,y:s.player.y,z:s.player.z,ammo:10,reserve:30});
 assert.equal(objectiveInteraction(s,s.player)?.kind,'rescue');frames(sim,60,HOLD);
 assert.equal(s.player.inventory.includes('sniper'),false,'nearby hostage interaction takes priority over a dropped gun');
 assert.equal(r.hostages.filter(h=>h.status==='following').length,1,'holding E never toggles or captures a second hostage');
 assert.equal(h.leaderId,s.player.id);assert.equal(h.status,'following');
 sim.setPaused(true);const before=JSON.stringify(r);frames(sim,120,HOLD);assert.equal(JSON.stringify(r),before);sim.setPaused(false);
 place(s.player,{...h,y:h.y-3});assert.equal(objectiveInteraction(s,s.player),null);
 const enemy=s.actors.find(a=>a.faction==='t')!;place(enemy,h);assert.equal(objectiveInteraction(s,enemy),null);
 s.player.health=0;frames(sim,1);assert.equal(h.status,'waiting');assert.equal(h.leaderId,null,'leader death releases the hostage');
 frames(sim,180);assert.equal(s.player.health,0,'round modes never respawn a dead player');
}));

test('Assault rescue requires all four arrivals and rewards each arrival only once; next round resets rescue state',()=>onMap('assault',()=>{
 const sim=game(),s=sim.state,r=s.rescue!,zone=r.zones[0],ct=s.player;
 for(const a of s.actors.filter(a=>a.team==='blue'&&a!==ct))a.health=0;
 // Arrival fixtures isolate the rescue gate from the separately tested long route.
 place(ct,zone);const before=ct.money;
 for(let i=0;i<r.hostages.length;i++){
  const h=r.hostages[i];Object.assign(h,{x:zone.x,y:zone.y,z:zone.z,leaderId:ct.id,status:'following'});frames(sim,1);
  assert.equal(h.status,'rescued');assert.equal(r.rescued,i+1);assert.equal(h.leaderId,null);
  if(i<3){assert.equal(s.phase,'playing');assert.equal(ct.money,before+300*(i+1));frames(sim,1);assert.equal(r.rescued,i+1);}
 }
 assert.equal(s.winner,'blue');assert.match(s.roundReason!,/全部人质/);assert.equal(s.blueScore,1);
 assert.equal(ct.money,before+1200+WIN_REWARD);assert.equal(sim.events.filter(e=>e.type==='hostageRescued').length,4);
 frames(sim,241);assert.equal(s.phase,'playing');assert.equal(s.round,2);assert.equal(s.rescue!.rescued,0);assert.equal(s.rescue!.total,4);
 assert.ok(s.rescue!.hostages.every(h=>h.status==='waiting'&&h.leaderId===null));assert.equal(s.roundTime,180);
}));

test('Assault T elimination alone does not win; CT wipe or 180-second timeout wins T',()=>onMap('assault',()=>{
 const sim=game(),s=sim.state;for(const a of s.actors.filter(a=>a.team==='red'))a.health=0;
 frames(sim,180);assert.equal(s.phase,'playing');assert.equal(s.winner,null);assert.equal(s.rescue!.rescued,0);
 s.roundTime=.001;frames(sim,1);assert.equal(s.winner,'red');assert.match(s.roundReason!,/时间耗尽/);
 sim.start();passive(sim);for(const a of s.actors.filter(a=>a.team==='blue'))a.health=0;
 frames(sim,1);assert.equal(s.winner,'red');assert.match(s.roundReason!,/全员阵亡/);
}));

test('Dust2 cannot complete a plant after the round deadline within the final simulation step',()=>onMap('dust2',()=>{
 const sim=game(),s=sim.state,t=s.actors.find(a=>a.id===s.bomb.carrierId)!;
 s.player=t;place(t,s.sites[0]);s.roundTime=2.99;
 frames(sim,179,HOLD);assert.equal(s.bomb.status,'carried');assert.equal(s.phase,'playing');
 frames(sim,1,HOLD);
 assert.equal(s.phase,'roundEnd');assert.equal(s.winner,'blue');assert.notEqual(s.bomb.status,'planted');
 assert.match(s.roundReason!,/未能安放/);
}));

test('Dust2 T bots navigate from original spawns and complete an autonomous plant',()=>onMap('dust2',()=>{
 const sim=new Simulation(42);sim.start();const s=sim.state;
 // The CT squad remains at its real spawn and cannot kill attackers. The T
 // squad uses its actual perception, objective choices, navigation and holds.
 for(const a of s.actors.filter(a=>a.faction==='ct')){a.player=true;a.health=1_000_000;}
 const carrier=s.actors.find(a=>a.hasBomb)!,start={x:carrier.x,z:carrier.z};let moved=0;
 for(let frame=0;frame<120*60&&s.phase==='playing';frame++){
  sim.update(DT);moved=Math.max(moved,Math.hypot(carrier.x-start.x,carrier.z-start.z));
  if(frame%60===0)for(const a of s.actors.filter(a=>a.health>0))assert.equal(dust.blocked(a.x,a.z,a.y),false,`actor ${a.id} keeps clear of source hulls`);
 }
 assert.ok(moved>15,'carrier traverses a real route');
 assert.equal(s.bomb.status,'planted',JSON.stringify({time:s.time,carrier:{x:carrier.x,y:carrier.y,z:carrier.z},reason:s.roundReason}));
 assert.ok(s.sites.some(site=>site.id===s.bomb.site&&insideBombSite(s.bomb,site)));
 assert.equal(sim.events.filter(e=>e.type==='plantComplete').length,1);
 console.log('DUST2_AI_PLANT',JSON.stringify({seconds:s.time,site:s.bomb.site,travelled:moved}));
}));

test('Dust2 CT bots leave original spawn and finish defusing with every T already dead',()=>onMap('dust2',()=>{
 const sim=game(),s=sim.state;plant(sim,'B');
 s.player=s.actors[0];s.player.health=0;
 for(const a of s.actors){
  if(a.faction==='t'){a.health=0;continue;}
  if(a===s.player)continue;
  a.player=false;a.defuseKit=false;place(a,MAPS.dust2.blueSpawns[a.id]);
 }
 const start=s.time;
 for(let frame=0;frame<40*60&&s.phase==='planted';frame++){
  sim.update(DT);
  if(frame%60===0)for(const a of s.actors.filter(a=>a.health>0))assert.equal(dust.blocked(a.x,a.z,a.y),false);
 }
 assert.equal(s.bomb.status,'defused',JSON.stringify({seconds:s.time-start,bomb:s.bomb,actors:s.actors.filter(a=>a.faction==='ct').map(a=>({x:a.x,y:a.y,z:a.z}))}));
 assert.equal(s.winner,'blue');assert.match(s.roundReason!,/拆除/);
 assert.ok(sim.events.some(e=>e.type==='defuseComplete'&&e.actorId!==s.player.id));
 assert.equal(sim.events.filter(e=>e.type==='respawn').length,0);
 console.log('DUST2_AI_DEFUSE',JSON.stringify({seconds:s.time-start,remaining:s.bomb.timer}));
}));

test('Dust2 planted fuse runs the full forty seconds even after every CT is dead',()=>onMap('dust2',()=>{
 const sim=game(),s=sim.state;plant(sim,'A');for(const a of s.actors.filter(a=>a.faction==='ct'))a.health=0;
 frames(sim,2399);assert.equal(s.phase,'planted');assert.equal(s.bomb.status,'planted');assert.equal(s.winner,null);
 frames(sim,1);assert.equal(s.bomb.status,'exploded');assert.equal(s.winner,'red');assert.match(s.roundReason!,/引爆/);
}));
