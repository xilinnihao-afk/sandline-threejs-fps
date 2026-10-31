import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Dust2Collision,GOLDSRC_SCALE as SCALE} from '../src/game/dust2Collision';
import {installDust2Geometry} from '../src/game/dust2';
import {setActiveMap} from '../src/game/map';
import {Simulation,eyeHeight} from '../src/game/simulation';
import {advanceJump,JUMP_GRAVITY} from '../src/game/jump';
import {EMPTY_INPUT,type Actor} from '../src/game/types';

const bytes=readFileSync('public/assets/maps/dust2/de_dust2.bsp');
const geometry=new Dust2Collision(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
geometry.navigation=JSON.parse(readFileSync('public/assets/maps/dust2/navigation.json','utf8'));
installDust2Geometry(geometry);
const onDust=(run:()=>void)=>{try{setActiveMap('dust2');run();}finally{setActiveMap('desert');}};
const close=(actual:number,expected:number,label='height')=>assert.ok(Math.abs(actual-expected)<.004,`${label}: ${actual} != ${expected}`);
function ready(x:number,z:number,y:number){
 const sim=new Simulation(42);sim.start('deathmatch');
 for(const a of sim.state.actors.slice(1)){a.health=0;a.respawnAt=999;}
 Object.assign(sim.state.player,{x:x*SCALE,z:z*SCALE,y:y*SCALE,groundY:y*SCALE,verticalSpeed:0,crouched:false,yaw:0,pitch:0});
 return sim;
}
function stepToward(sim:Simulation,hz:number,x:number,z:number,jump=false,crouch=false){
 const p=sim.state.player,dx=x*SCALE-p.x,dz=z*SCALE-p.z,distance=Math.hypot(dx,dz);
 if(distance>.00001)p.yaw=Math.atan2(-dx,-dz);
 const moveZ=Math.min(1,distance*hz/(crouch?1.65:3.9));
 sim.update(1/hz,{...EMPTY_INPUT,moveZ,jump,crouch});
 assert.equal(geometry.blocked(p.x,p.z,p.y,p.crouched),false,`solid hull: ${JSON.stringify({x:p.x,y:p.y,z:p.z,crouch:p.crouched})}`);
}
const routes=[
 {name:'B right crate',start:[-1520,-2624,0],end:[-1458,-2624,64],duckAt:.15},
 {name:'B divider',start:[-1680,-2700,0],end:[-1748,-2700,64],duckAt:.15},
 {name:'B rear platform crate',start:[-2000,-2464,32],end:[-2064,-2464,96],duckAt:.15},
 {name:'B platform to low divider',start:[-1820,-2700,32],end:[-1748,-2700,64],duckAt:Infinity},
] as const;
for(const route of routes)for(const hz of [30,60,120])test(`${route.name}: input jump, land and walk off at ${hz} Hz`,()=>onDust(()=>{
 const [x,z,y]=route.start,[tx,tz,ty]=route.end,sim=ready(x,z,y),p=sim.state.player;
 close(geometry.ground(x*SCALE,z*SCALE,y*SCALE+.1)!,y*SCALE,'BSP start');
 close(geometry.ground(tx*SCALE,tz*SCALE,ty*SCALE+.1)!,ty*SCALE,'BSP crate');
 for(let i=0;i<2*hz;i++)stepToward(sim,hz,tx,tz,i===0||i===Math.round(hz*.22),i/hz>=route.duckAt&&i<hz);
 close(p.x,tx*SCALE,'destination x');close(p.z,tz*SCALE,'destination z');close(p.y!,ty*SCALE);assert.equal(p.verticalSpeed,0);assert.equal(p.crouched,false);
 for(let i=0;i<2*hz;i++)stepToward(sim,hz,x,z);
 close(p.x,x*SCALE,'return x');close(p.z,z*SCALE,'return z');close(p.y!,y*SCALE);assert.equal(p.verticalSpeed,0);
}));

test('B right crate requires duck jumping; regular jumping cannot climb a 64-unit wall',()=>onDust(()=>{
 const sim=ready(-1520,-2624,0),p=sim.state.player;
 for(let i=0;i<90;i++)stepToward(sim,60,-1458,-2624,i===0);
 close(p.y!,0);assert.ok(p.x<-37.79);
}));

test('a crouched touch player can jump from beside the B crate without frame-perfect input',()=>onDust(()=>{
 const sim=ready(-1500,-2624,0),p=sim.state.player;
 for(let i=0;i<90;i++)stepToward(sim,60,-1458,-2624,i===0,true);
 close(p.y!,64*SCALE);close(p.x,-1458*SCALE,'crouched destination');assert.equal(p.verticalSpeed,0);
}));

test('B entry stairs remain walkable without a jump, including the reverse descent',()=>onDust(()=>{
 const sim=ready(-1920,-2350,0),p=sim.state.player;
 for(let i=0;i<120;i++)stepToward(sim,60,-1920,-2500);
 close(p.y!,32*SCALE);close(p.z,-2500*SCALE,'stair destination');
 for(let i=0;i<120;i++)stepToward(sim,60,-1920,-2350);
 close(p.y!,0);close(p.z,-2350*SCALE,'stair return');
}));

test('duck/stand toggles do not add height or air jumps, and crouched landings stay planted',()=>onDust(()=>{
 for(const hz of [30,60,120]){
  const p=ready(-1600,-2300,0).state.player;let peak=0,landed=0;
  for(let i=0;i<hz*2;i++){
   p.crouched=i%2===1||i>hz*.7;
   const result=advanceJump(p,1/hz,i===0||i===Math.round(hz*.2));
   if(i===Math.round(hz*.2))assert.equal(result.tookOff,false);
   if(result.landed)landed++;
   peak=Math.max(peak,p.y!);
   assert.equal(geometry.blocked(p.x,p.z,p.y,p.crouched),false);
  }
  assert.ok(peak<65*SCALE+.004);assert.equal(landed,1);close(p.y!,0);assert.equal(p.verticalSpeed,0);
  p.crouched=false;advanceJump(p,1/hz);close(p.y!,0);
 }
}));

test('original tunnel ceiling stops duck jumps and postpones standing until the hull fits',()=>onDust(()=>{
 const tunnel=geometry.navigation.points.find(p=>{const ceiling=.1+geometry.ray(p.x,p.y+.1,p.z,0,1,0);return ceiling>2.4&&ceiling<2.8;});
 assert.ok(tunnel,'real BSP tunnel with low ceiling');
 for(const hz of [30,60,120]){
  const sim=ready(tunnel.x/SCALE,tunnel.z/SCALE,tunnel.y/SCALE),p=sim.state.player;let preventedStand=false;
  for(let i=0;i<hz*2;i++){
   const crouch=i/hz<.28;sim.update(1/hz,{...EMPTY_INPUT,jump:i===0,crouch});
   preventedStand ||= !crouch&&p.crouched;
   assert.equal(geometry.blocked(p.x,p.z,p.y,p.crouched),false);
  }
  assert.equal(preventedStand,true,'ceiling must prevent early stand-up');close(p.y!,tunnel.y);assert.equal(p.crouched,false);
 }
}));

test('duck jump state clears on death, respawn and round restart',()=>onDust(()=>{
 const sim=ready(-1600,-2300,0),p=sim.state.player;
 const tuck=(actor:Actor)=>{actor.crouched=true;advanceJump(actor,1/60,true);assert.ok(actor.y!>.45);};
 tuck(p);p.health=0;advanceJump(p,1/60);
 Object.assign(p,{health:100,y:0,groundY:0,verticalSpeed:0,crouched:false,spawnedAt:7});advanceJump(p,1/60);close(p.y!,0);
 tuck(p);Object.assign(p,{y:0,groundY:0,verticalSpeed:0,crouched:false,spawnedAt:8});advanceJump(p,1/60);close(p.y!,0);
 tuck(p);sim.start('deathmatch');assert.notEqual(sim.state.player,p);advanceJump(sim.state.player,1/60);assert.equal(sim.state.player.verticalSpeed,0);
}));

test('Dust2 movement does not snap the first 120 Hz jump frame back to the floor',()=>onDust(()=>{
 const sim=ready(-1600,-2300,0),p=sim.state.player;
 stepToward(sim,120,-1580,-2300,true);
 assert.ok(p.y!>.05&&p.y!<.06);assert.ok(p.verticalSpeed!>6);
 const expected=geometry.jumpSpeed!**2/(2*JUMP_GRAVITY);let peak=p.y!;
 for(let i=1;i<120;i++){stepToward(sim,120,-1580,-2300);peak=Math.max(peak,p.y!);}
 close(peak,expected,'moving jump peak');close(p.y!,0);
}));

test('duck-jump camera stays inside the original short hull at the real tunnel ceiling',()=>onDust(()=>{
 for(const hz of [30,60,120]){
  const sim=ready(-536,-1432,-112),p=sim.state.player;
  for(let i=0;i<2*hz;i++){
   sim.update(1/hz,{...EMPTY_INPUT,jump:i===0,crouch:i/hz<.28});
   const eye=eyeHeight(p),probe=geometry.trace({x:p.x,y:eye,z:p.z},{x:p.x,y:eye+.08,z:p.z});
   assert.equal(probe.startSolid,false,`eye inside ceiling at ${hz}Hz`);assert.equal(probe.fraction,1,'near plane needs headroom');
  }
 }
}));
