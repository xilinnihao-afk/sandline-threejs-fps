import test from 'node:test';
import assert from 'node:assert/strict';
import {AimAssist} from '../src/game/aimAssist';
import {Simulation} from '../src/game/simulation';
import {EMPTY_INPUT} from '../src/game/types';
import {MAP_BOXES,setActiveMap} from '../src/game/map';
import {mobileSettings} from '../src/game/mobileSettings';

function setup(){
 setActiveMap('snow');const sim=new Simulation(41);sim.start();
 const p=sim.state.player,t=sim.state.actors[3];
 Object.assign(p,{x:0,z:0,yaw:0,pitch:-.02});Object.assign(t,{x:.38,z:-10});
 return {p,t,assist:new AimAssist()};
}
test('friction applies only to touch and leaves mouse, gyro and disabled input exact',()=>{
 const {p,t,assist}=setup();
 const input={...EMPTY_INPUT,lookDX:-.005,lookDY:0};
 const touch=assist.apply(p,[t],{...input,inputSource:'touch'},1/60,1,true);
 assert.equal(touch.targetId,t.id);assert.ok(touch.slowdown<.8);assert.ok(Math.abs(touch.yaw)<Math.abs(input.lookDX));
 for(const source of ['mouse','gyro',undefined] as const){
  const r=assist.apply(p,[t],{...input,inputSource:source,gyroDX:.002},1/60,1.5,true);
  assert.equal(r.yaw,input.lookDX*1.5+.002);assert.equal(r.targetId,null);
 }
 assert.equal(assist.apply(p,[t],{...input,inputSource:'touch'},1/60,1,false).yaw,input.lookDX);
});
test('assist cannot reveal targets through cover, select allies, or reach beyond 32 metres',()=>{
 const {p,t,assist}=setup();const input={...EMPTY_INPUT,inputSource:'touch' as const,lookDX:-.003};
 const cover={x:0,z:-5,w:2,d:1,h:3,kind:'wall' as const};MAP_BOXES.push(cover);
 try{assert.equal(assist.apply(p,[t],input,1/60,1,true).targetId,null);}finally{MAP_BOXES.splice(MAP_BOXES.indexOf(cover),1);}
 assert.equal(assist.apply(p,[{...t,team:p.team}],input,1/60,1,true).targetId,null);
 assert.equal(assist.apply(p,[{...t,z:-34}],input,1/60,1,true).targetId,null);
 assert.equal(assist.apply(p,[{...t,health:0}],input,1/60,1,true).targetId,null);
});
test('arms race touch assist sees same-uniform rivals and still excludes the player',()=>{
 const {p,t,assist}=setup();t.team=p.team;
 const input={...EMPTY_INPUT,inputSource:'touch' as const,lookDX:-.003};
 assert.equal(assist.apply(p,[p,t],input,1/60,1,true,'armsRace').targetId,t.id);
 assert.equal(assist.apply(p,[p,t],input,1/60,1,true,'deathmatch').targetId,null);
});
test('no unattended tracking; pulling away overrides friction and attraction; sniper receives no attraction',()=>{
 const {p,t,assist}=setup();
 assert.equal(assist.apply(p,[t],{...EMPTY_INPUT,inputSource:'touch',fire:true},1/60,1,true).yaw,0);
 const away={...EMPTY_INPUT,inputSource:'touch' as const,fire:true,lookDX:.01};
 const r=assist.apply(p,[t],away,1/60,1,true);assert.equal(r.yaw,.01);assert.equal(r.slowdown,1);
 const walking={...EMPTY_INPUT,inputSource:'touch' as const,moveX:1,fire:true};
 const correction=assist.apply(p,[t],walking,1/60,1,true);assert.ok(correction.yaw<0&&correction.yaw>=-Math.PI/100/60);
 p.weapon='sniper';assert.equal(assist.apply(p,[t],walking,1/60,1,true).yaw,0);
 p.weapon='knife';assert.equal(assist.apply(p,[t],walking,1/60,1,true).targetId,null);
});
test('small candidate changes retain the target; occlusion and large changes release it immediately',()=>{
 const {p,t,assist}=setup(),input={...EMPTY_INPUT,inputSource:'touch' as const};
 const second={...t,id:7,x:.42};
 assert.equal(assist.apply(p,[t,second],input,1/60,1,true).targetId,t.id);
 second.x=.33;assert.equal(assist.apply(p,[t,second],input,1/60,1,true).targetId,t.id);
 t.x=4;assert.equal(assist.apply(p,[t,second],input,1/60,1,true).targetId,second.id);
});
test('stationary sensor preferences remain separate from permission state and survive old saves',()=>{
 assert.deepEqual(mobileSettings({}),{gyroMode:'off',gyroSensitivity:1,fireDrag:true});
 assert.deepEqual(mobileSettings({gyroMode:'bad',gyroSensitivity:Infinity,fireDrag:0}),{gyroMode:'off',gyroSensitivity:1,fireDrag:true});
 assert.deepEqual(mobileSettings({gyroMode:'aim',gyroSensitivity:9,fireDrag:false}),{gyroMode:'aim',gyroSensitivity:3,fireDrag:false});
});
