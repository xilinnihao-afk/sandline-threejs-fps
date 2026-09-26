import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation} from '../src/game/simulation';
import {EMPTY_INPUT} from '../src/game/types';
import {botObjective,findBotCover} from '../src/game/botTactics';
import {blocked,lineClear} from '../src/game/collision';
const setup=()=>{const sim=new Simulation(77);sim.start();return sim;};
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
