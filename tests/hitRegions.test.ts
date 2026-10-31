import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation,WEAPONS} from '../src/game/simulation';
import {rayActorHit} from '../src/game/hitRegions';
import {MAP_BOXES,setActiveMap} from '../src/game/map';
import {resetWeaponSwitch} from '../src/game/weaponSwitch';
import type {HitRegion,WeaponKind} from '../src/game/types';

const aims:Record<HitRegion,{x:number;y:number;duckY:number}>={
 head:{x:0,y:1.62,duckY:1.08},chest:{x:0,y:1.23,duckY:.81},
 abdomen:{x:0,y:.89,duckY:.49},arm:{x:.32,y:1.22,duckY:.80},leg:{x:.13,y:.35,duckY:.20},
};
function range(region:HitRegion,options:{weapon?:WeaponKind;yaw?:number;crouched?:boolean;base?:number;bot?:boolean;front?:boolean}={}){
 setActiveMap('desert');const sim=new Simulation(78);sim.start('deathmatch');
 const p=sim.state.player,target=sim.state.actors.find(a=>a.team==='red')!;
 sim.state.actors.forEach(a=>a.health=0);
 const kind=options.weapon??'pistol',yaw=options.yaw??0,base=options.base??0,aim=options.front&&region==='chest'?{x:-.15,y:1.32,duckY:.81}:aims[region],c=Math.cos(yaw),s=Math.sin(yaw);
 Object.assign(p,{health:100,weapon:kind,inventory:[kind],x:3+c*aim.x+s*4,z:10-s*aim.x+c*4,y:base,groundY:base,yaw,pitch:Math.atan2((options.crouched?aim.duckY:aim.y)-1.62,3.75),spread:0,moving:false,crouched:false,spawnProtectionUntil:0,player:!options.bot});
 Object.assign(target,{health:1000,armor:0,x:3,z:10,y:base,groundY:base,yaw:yaw+(options.front?Math.PI:0),crouched:!!options.crouched,spawnProtectionUntil:0});
 resetWeaponSwitch(p);sim.events=[];
 return {sim,p,target,shoot:()=>{assert.ok(sim.fire(p));return sim.events.filter(e=>e.type==='hit'&&e.targetId===target.id);}};
}

test('actual firearm shots distinguish all five regions for standing, crouched, raised and rotated actors',()=>{
 const expected={head:66,chest:24,abdomen:30,arm:19,leg:16};
 for(const front of [false,true])for(const yaw of [0,.7,Math.PI/2,Math.PI])for(const crouched of [false,true])for(const base of [0,1.6])for(const region of Object.keys(aims) as HitRegion[]){
  const {target,shoot}=range(region,{yaw,crouched,base,front});const hits=shoot();
  assert.equal(hits.length,1,JSON.stringify({region,yaw,crouched,base,hits}));
  assert.equal(hits[0].hitRegion,region,JSON.stringify({region,yaw,crouched,base,hits}));
  assert.equal(hits[0].headshot,region==='head');assert.equal(hits[0].healthDamage,expected[region]);
  assert.equal(target.health,1000-expected[region]);
 }
});

test('armor applies after regional damage; player and bot shots use the same rules',()=>{
 const expected={head:[42,24],chest:[15,9],abdomen:[19,11],arm:[12,7],leg:[10,6]};
 for(const bot of [false,true])for(const region of Object.keys(aims) as HitRegion[]){
  const {target,shoot}=range(region,{bot});target.armor=100;const [hit]=shoot();
  assert.equal(hit.hitRegion,region);assert.deepEqual([hit.healthDamage,hit.armorDamage],expected[region]);
  assert.equal(target.armor,100-expected[region][1]);
 }
});

test('AWP chest remains lethal unarmored while a leg shot leaves a full-health target alive',()=>{
 for(const [region,hp] of [['head',0],['chest',0],['abdomen',0],['arm',0],['leg',19]] as const){
  const {target,shoot}=range(region,{weapon:'sniper'});target.health=100;const [hit]=shoot();
  assert.equal(hit.hitRegion,region);assert.equal(target.health,hp);assert.equal(hit.healthDamage,100-hp);
 }
});

test('side rays meet the arm before the chest, and rays through the boot gap miss',()=>{
 const {target}=range('chest');
 const hit=rayActorHit(target,5,1.22,10,-1,0,0);assert.equal(hit?.region,'arm');
 assert.ok(Math.abs(hit!.distance-1.6)<1e-8);
 assert.equal(rayActorHit(target,3,.2,14,0,0,-1),null);
 assert.equal(rayActorHit(target,3,1.9,14,0,0,-1),null);
});

test('cover, a nearer ally and spawn protection block regional damage',()=>{
 {
  const {sim,target,shoot}=range('chest');
  MAP_BOXES.push({x:3,z:12,w:1,d:.2,h:2,kind:'crate'});
  try{assert.equal(shoot().length,0);assert.equal(target.health,1000);assert.ok(sim.events.some(e=>e.type==='impact'));}finally{MAP_BOXES.pop();}
 }
 {
  const {sim,p,target,shoot}=range('chest');const ally=sim.state.actors.find(a=>a!==p&&a.team===p.team)!;
  Object.assign(ally,{x:3,z:12,y:0,groundY:0,health:100,armor:0,crouched:false,yaw:0});
  assert.equal(shoot().length,0);assert.equal(target.health,1000);assert.equal(ally.health,100);
 }
 {
  const {sim,target,shoot}=range('head');target.spawnProtectionUntil=sim.state.time+1;
  assert.equal(shoot().length,0);assert.equal(target.health,1000);
 }
});

test('shotgun pellets each resolve their first region with distance falloff and do not double-hit',()=>{
 const {sim,p,target,shoot}=range('chest',{weapon:'shotgun'});const hits=shoot();
 assert.ok(hits.length>0);assert.ok(hits.length<=WEAPONS.shotgun.pellets);
 assert.equal(sim.events.filter(e=>e.type==='shot').length,1);
 let total=0;
 for(const hit of hits){
  assert.ok(hit.hitRegion);const d=Math.hypot(hit.x!-p.x,hit.y!-1.62,hit.z!-p.z);
  const raw=hit.hitRegion==='head'?22:12*({chest:1,abdomen:1.25,arm:.8,leg:.65}[hit.hitRegion!]);
  assert.equal(hit.healthDamage,Math.round(raw*Math.max(.25,1-d/32)));total+=hit.healthDamage!;
 }
 assert.equal(target.health,1000-total);
});


test('head proxies stay within measured roster height and forward support forearms can be hit',()=>{
 const {target}=range('head');
 assert.equal(rayActorHit(target,3,1.76,14,0,0,-1),null);
 target.crouched=true;
 assert.equal(rayActorHit(target,3,1.30,14,0,0,-1),null);
 assert.equal(rayActorHit(target,3,1.10,14,0,0,-1)?.region,'head');
 for(const crouched of [false,true]){
  target.crouched=crouched;
  const hit=rayActorHit(target,3,crouched?.78:1.22,6,0,0,1);
  assert.equal(hit?.region,'arm');assert.ok(hit!.distance<3.5);
 }
});
