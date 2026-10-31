import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation} from '../src/game/simulation';
import {EMPTY_INPUT} from '../src/game/types';
import {botObjective,findBotCover,patrolPoint} from '../src/game/botTactics';
import {setActiveMap} from '../src/game/map';
import {blocked,lineClear} from '../src/game/collision';
const setup=()=>{const sim=new Simulation(77);sim.start('demolition');return sim;};
test('one bot defuses while allies guard; an active human defuser is respected',()=>{
 const sim=setup(),s=sim.state;s.phase='planted';s.bomb={...s.bomb,status:'planted',x:3,z:10,defuserId:null};
 assert.equal(s.actors.filter(a=>a.team==='blue'&&botObjective(a,s).role==='defuse').length,1);
 s.bomb.defuserId=0;assert.ok(s.actors.slice(1,3).every(a=>botObjective(a,s).role==='guard'));
});
test('last surviving bot completes defuse after all enemies die',()=>{
 const sim=setup(),s=sim.state;
 s.actors.forEach(a=>a.health=0);const a=s.actors[1];a.health=100;a.x=3;a.z=10;
 s.phase='planted';s.bomb={...s.bomb,status:'planted',x:3,z:10,timer:20,progress:0,defuserId:null};
 for(let i=0;i<650&&s.bomb.status==='planted';i++)sim.update(1/60,EMPTY_INPUT);
 assert.equal(s.bomb.status,'defused');assert.equal(s.blueScore,1);
});
test('cover point is reachable free space and blocks the threat line',()=>{
 const sim=setup(),a=sim.state.actors[1];a.x=3;a.z=7;
 const cover=findBotCover(a,{x:0,z:2});assert.ok(cover);
 assert.equal(blocked(cover.x,cover.z,.4),false);assert.equal(lineClear(cover.x,cover.z,0,2,1.05),false);
});
test('patrol does not follow exact hidden enemy coordinates',()=>{
 const sim=setup(),s=sim.state,a=s.actors[1];const first=botObjective(a,s);
 for(const enemy of s.actors.filter(a=>a.team==='red')){enemy.x+=9;enemy.z+=4;}
 assert.deepEqual(botObjective(a,s),first);
});
test('bots react before shooting and switch to pistol when caught with an empty AK',()=>{
 const sim=setup(),s=sim.state,a=s.actors[1],enemy=s.actors[3];
 a.x=3;a.z=14;a.yaw=0;enemy.x=3;enemy.z=10;s.actors.filter(v=>v!==a&&v!==enemy).forEach(v=>v.health=0);
 a.guns.rifle.ammo=0;sim.events=[];
 // 单独驱动机器人决策以隔离其他机器人的攻击及回合规则。
 for(let i=0;i<3;i++)(sim as any).bot(a,.1);
 assert.equal(a.weapon,'pistol');assert.equal(sim.events.filter(e=>e.type==='shot').length,0);
 for(let i=0;i<8;i++)(sim as any).bot(a,.1);
 assert.ok(sim.events.some(e=>e.type==='shot'&&e.weapon==='pistol'));
});
test('visible imminent grenade makes a bot move away',()=>{
 const sim=setup(),s=sim.state,a=s.actors[1];a.x=3;a.z=10;
 s.grenades=[{id:1,ownerId:3,x:3,y:.1,z:12,vx:0,vy:0,vz:0,fuse:.5,bounces:0}];
 const before=Math.hypot(a.x-3,a.z-12);(sim as any).bot(a,.1);
 assert.ok(a.moving);assert.ok(Math.hypot(a.x-3,a.z-12)>before);
});

test('team sightings are approximate, expire, and do not permit blind shooting',()=>{
 const sim=setup(),s=sim.state,a=s.actors[1];s.time=10;
 // Keep all opponents behind spawn cover, out of personal sight/hearing.
 (sim as any).teamReports.set('blue',{x:4,z:-10,until:12});
 sim.events=[];(sim as any).bot(a,.01);
 assert.deepEqual((sim as any).brains[a.id].memory,{x:4,z:-10,until:12});
 assert.equal(sim.events.some(e=>e.type==='shot'),false);
 s.time=13;(sim as any).bot(a,.01);
 assert.equal((sim as any).brains[a.id].memory,null);
});

test('low-ammo bot moves toward cover before starting a tactical reload',()=>{
 const sim=setup(),a=sim.state.actors[1];a.x=3;a.z=4;a.guns.rifle.ammo=5;
 sim.state.time=10;(sim as any).brains[a.id].memory={x:0,z:2,until:14};
 sim.state.actors.filter(v=>v.team!==a.team).forEach(v=>{v.health=0;});
 const before={x:a.x,z:a.z};(sim as any).bot(a,.1);
 assert.equal(a.guns.rifle.reloadLeft,0);assert.ok(Math.hypot(a.x-before.x,a.z-before.z)>0);
});

test('open-lane travel follows a diagonal without grid-corner snaps and stays outside cover',()=>{
 try{
  setActiveMap('snow');const sim=setup(),a=sim.state.actors[1];
  sim.state.actors.forEach(p=>p.health=p===a?100:0);a.x=0;a.z=10;
  const b=(sim as any).brains[a.id];const goal={x:2,z:-10};
  (sim as any).botMove(a,b,goal,.1);
  assert.ok(a.x>.005&&a.z<9.95,'the accelerating route should advance along both axes');
  for(let i=0;i<600;i++){b.repath-=1/60;(sim as any).botMove(a,b,goal,1/60);assert.equal(blocked(a.x,a.z,.32),false);}
  assert.ok(Math.hypot(a.x-goal.x,a.z-goal.z)<.3);
 }finally{setActiveMap('desert');}
});

test('patrol slots are distributed and an empty bot can restock its owned gun',()=>{
 try{
  setActiveMap('snow');const sim=setup(),s=sim.state;
  assert.equal(new Set(s.actors.slice(0,3).map(a=>patrolPoint(a,0).x)).size,3);
  const a=s.actors[1];s.actors.forEach(v=>v.health=v===a?100:0);a.x=3;a.z=14;
  for(const gun of Object.values(a.guns)){gun.ammo=0;gun.reserve=0;}
  (sim as any).bot(a,.1);
  assert.equal(a.weapon,'rifle');assert.equal(a.guns.rifle.ammo,30);assert.equal(a.guns.rifle.reserve,90);
 }finally{setActiveMap('desert');}
});

test('a sustained duel includes committed changes of angle as well as aimed fire',()=>{
 try{
  setActiveMap('snow');const sim=setup(),s=sim.state,a=s.actors[1],enemy=s.actors[3];
  s.actors.forEach(v=>v.health=v===a||v===enemy?100:0);
  a.x=0;a.z=3;a.yaw=0;a.grenades=0;enemy.x=0;enemy.z=-6;enemy.health=10000;
  let minX=0,maxX=0,shots=0;
  for(let i=0;i<600;i++){
   s.time+=1/60;for(const g of Object.values(a.guns))g.cooldown=Math.max(0,g.cooldown-1/60);
   (sim as any).bot(a,1/60);minX=Math.min(minX,a.x);maxX=Math.max(maxX,a.x);
   shots+=sim.events.filter(e=>e.type==='shot').length;sim.events=[];
  }
  assert.ok(maxX-minX>1.5,'bot should change firing position instead of staying planted');
  assert.ok(shots>=4&&enemy.health<10000,'movement must still allow aimed bursts');
 }finally{setActiveMap('desert');}
});
