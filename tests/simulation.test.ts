import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulation,WEAPONS} from '../src/game/simulation.ts';
import {EMPTY_INPUT} from '../src/game/types.ts';
import {blocked,findPath,lineClear,moveBody,wallDistance} from '../src/game/collision.ts';
import {BLUE_SPAWNS,RED_SPAWNS} from '../src/game/map.ts';
const ready=()=>{const s=new Simulation(42);s.start();s.state.phase='playing';s.state.roundTime=90;return s;};
test('opposing spawn points cannot see each other at round start',()=>{for(const a of BLUE_SPAWNS)for(const b of RED_SPAWNS)assert.equal(lineClear(a.x,a.z,b.x,b.z),false,JSON.stringify({a,b}));});
test('reload conserves ammunition and blocks firing; switching cannot bypass reload',()=>{
 const sim=ready(),p=sim.state.player;sim.state.actors.slice(1).forEach(a=>a.x=18);
 for(let i=0;i<5;i++){p.guns.rifle.cooldown=0;assert.equal(sim.fire(p),true);}
 assert.equal(p.guns.rifle.ammo,25);assert.equal(sim.reload(p),true);assert.equal(sim.fire(p),false);
 sim.update(.01,{...EMPTY_INPUT,switchWeapon:'pistol'});assert.equal(p.weapon,'rifle');
 for(let i=0;i<140;i++)sim.update(1/60);
 assert.equal(p.guns.rifle.ammo,30);assert.equal(p.guns.rifle.reserve,85);
});
test('movement slides along solid cover and cannot tunnel through it',()=>{
 const pos=moveBody(0,9,0,-8);assert.ok(pos.z>6.6);assert.equal(blocked(pos.x,pos.z),false);
 const slide=moveBody(2.3,8,-2,-5);assert.ok(slide.z<8);assert.equal(blocked(slide.x,slide.z),false);
});
test('wall proxies block vision and bullets; actor hitboxes do not defeat cover',()=>{
 assert.equal(lineClear(0,16,0,-16),false);assert.ok(wallDistance(0,1.62,16,0,0,-1)<10);
 const sim=ready(),p=sim.state.player,enemy=sim.state.actors[3];enemy.x=0;enemy.z=-16;
 sim.state.actors.filter(a=>a!==p&&a!==enemy).forEach(a=>a.health=0);
 p.spread=0;sim.fire(p);assert.equal(enemy.health,100);
});
test('a clear headshot damages an enemy, while a teammate shields without damage',()=>{
 const sim=ready(),p=sim.state.player,enemy=sim.state.actors[3],ally=sim.state.actors[1];
 p.x=3;p.z=14;p.yaw=0;p.pitch=0;enemy.x=3;enemy.z=10;ally.x=15;sim.state.actors.filter(a=>![p,enemy,ally].includes(a)).forEach(a=>a.health=0);
 sim.fire(p);assert.equal(enemy.health,100-WEAPONS.rifle.head);
 enemy.health=100;ally.x=3;ally.z=12;p.guns.rifle.cooldown=0;p.pitch=0;p.spread=0;sim.fire(p);assert.equal(ally.health,100);assert.equal(enemy.health,100);
});
test('navigation connects both spawn zones using free cells',()=>{
 const path=findPath(0,16,0,-16);assert.ok(path.length>30);assert.ok(path.every(p=>!blocked(p.x,p.z,.45)));assert.ok(Math.abs(path.at(-1)!.z+16)<1);
});
test('pause freezes clocks, ammunition, actors and round transitions',()=>{
 const sim=ready();sim.setPaused(true);const before=JSON.stringify(sim.state);for(let i=0;i<120;i++)sim.update(1/60,{...EMPTY_INPUT,moveZ:1,fire:true});assert.equal(JSON.stringify(sim.state),before);
});
test('death triggers observation and team elimination awards exactly one round',()=>{
 const sim=ready();sim.state.player.health=0;sim.update(1/60);assert.ok(sim.state.spectating?.team==='blue');
 sim.state.actors.filter(a=>a.team==='red').forEach(a=>a.health=0);sim.update(1/60);assert.equal(sim.state.blueScore,1);assert.equal(sim.state.phase,'roundEnd');for(let i=0;i<30;i++)sim.update(1/60);assert.equal(sim.state.blueScore,1);
});
test('match completion and restart reset deaths, score and ammo',()=>{
 const sim=ready();sim.state.blueScore=2;sim.state.actors.filter(a=>a.team==='red').forEach(a=>a.health=0);sim.update(1/60);assert.equal(sim.state.phase,'matchEnd');sim.start();assert.equal(sim.state.phase,'playing');assert.equal(sim.state.blueScore,0);assert.equal(sim.state.player.health,100);assert.equal(sim.state.player.guns.rifle.ammo,30);
});
test('bots behind low cover seek an exposed target instead of firing into a crate',()=>{
 const sim=ready(),p=sim.state.player,enemy=sim.state.actors[3];p.x=15;p.z=13.5;p.crouched=true;enemy.x=15;enemy.z=8;enemy.yaw=Math.PI;sim.state.actors.filter(a=>a!==p&&a!==enemy).forEach(a=>a.health=0);let shots=0;
 for(let i=0;i<180;i++){sim.update(1/60,{...EMPTY_INPUT,crouch:true});shots+=sim.events.filter(e=>e.type==='shot').length;sim.events=[];}
 assert.ok(shots<10||p.health<100,'bot spent repeated shots on an occluded aim point');
 assert.ok(p.health<100||Math.hypot(enemy.x-15,enemy.z-8)>1,'bot should change its angle when no target part is exposed');
});
test('overlapping friendly actors separate before shooting, avoiding zero-length shots',()=>{
 const sim=ready(),p=sim.state.player,ally=sim.state.actors[1];p.x=3;p.z=14;ally.x=3;ally.z=14;sim.update(1/60);assert.ok(Math.hypot(p.x-ally.x,p.z-ally.z)>.55);
});
test('seeded bot matches complete with navigation and actual two-sided kills',()=>{
 const report=[];
 for(const seed of [7,42,2026]){const sim=new Simulation(seed);sim.start();let frames=0,shots=0,hits=0;while(sim.state.phase!=='matchEnd'&&frames<60*600){sim.update(1/60,EMPTY_INPUT,true);for(const e of sim.events){if(e.type==='shot')shots++;if(e.type==='hit')hits++;}sim.events=[];frames++;}
 assert.equal(sim.state.phase,'matchEnd',`seed ${seed} did not finish`);assert.ok(shots>20);assert.ok(hits>10);assert.ok(sim.state.actors.some(a=>a.team==='blue'&&a.kills>0));assert.ok(sim.state.actors.some(a=>a.team==='red'&&a.kills>0));assert.ok(sim.state.actors.every(a=>!blocked(a.x,a.z,.30)));report.push({seed,seconds:frames/60,shots,hits,blue:sim.state.blueScore,red:sim.state.redScore});}
 console.log('BOT_MATCH_METRICS',JSON.stringify(report));
});
