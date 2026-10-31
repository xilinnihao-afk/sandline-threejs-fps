import test from 'node:test';
import assert from 'node:assert/strict';
import {InputController} from '../src/ui/input';
import {Simulation} from '../src/game/simulation';
import {EMPTY_INPUT} from '../src/game/types';

// 最小事件宿主，直接走实际控制器，不复制触控算法。
class ElementStub extends EventTarget {
 style:any={};dataset:any={};classList={add(){},remove(){},toggle(){}};
 attributes=new Map<string,string>(); label={textContent:''}; disabled=false;
 setAttribute(name:string,value:string){this.attributes.set(name,value);} querySelector(){return this.label;} setPointerCapture(){} hasPointerCapture(){return false;} releasePointerCapture(){}
 getBoundingClientRect(){return {left:0,top:0,width:118,height:118};}
}
test('independent move / full-screen look / fire, mouse overlay and pistol shooting',()=>{
 const win=new EventTarget(),doc=new EventTarget() as any;
 const nodes=new Map<string,ElementStub>();
 doc.getElementById=(id:string)=>{if(!nodes.has(id))nodes.set(id,new ElementStub());return nodes.get(id);};
 Object.assign(globalThis,{window:win,document:doc,innerWidth:844});
 const canvas=new ElementStub(),input=new InputController(canvas as any);
 const send=(target:EventTarget,type:string,id:number,x:number,y:number,pointerType='touch')=>{
  const e=new Event(type,{cancelable:true});Object.assign(e,{pointerId:id,clientX:x,clientY:y,pointerType,button:0});target.dispatchEvent(e);
 };
 const fire=nodes.get('fire-button')!,look=nodes.get('look-zone')!,joy=nodes.get('joystick')!;
 send(joy,'pointerdown',1,80,40);send(fire,'pointerdown',2,700,300);send(win,'pointermove',2,750,280);
 assert.equal(input.consume().lookDX,0);
 // The exposed left half must aim too, while movement and fire keep ownership.
 send(canvas,'pointerdown',8,210,100);send(win,'pointermove',8,250,80);
 const active=input.consume();assert.ok(active.fire&&active.moveX>0&&active.lookDX<0&&active.lookDY>0);
 const sim=new Simulation(42);sim.start();sim.state.phase='playing';sim.state.player.weapon='pistol';
 const ammo=sim.state.player.guns.pistol.ammo;sim.update(1/60,{...EMPTY_INPUT,fire:active.fire});
 assert.equal(sim.state.player.guns.pistol.ammo,ammo-1);
 send(win,'pointercancel',2,750,280);assert.equal(input.consume().fire,false);input.clear();
 send(look,'pointerdown',3,500,100);send(fire,'pointerdown',4,700,300);send(win,'pointermove',4,800,300);
 assert.equal(input.consume().lookDX,0);send(win,'pointermove',3,540,100);assert.ok(input.consume().lookDX<0);input.clear();
 send(look,'pointerdown',5,500,100,'mouse');assert.equal(input.consume().fire,true);
 send(win,'pointerup',5,500,100,'mouse');assert.equal(input.consume().fire,false);
 send(fire,'pointerdown',7,700,300);send(win,'pointerup',7,700,300);assert.equal(input.consume().fire,true);assert.equal(input.consume().fire,false);
 send(look,'pointerdown',6,500,100);send(win,'pointermove',6,530,100);send(win,'pointerup',6,530,100);
 const swipe=input.consume();assert.ok(swipe.lookDX<0);assert.equal(swipe.fire,false);input.clear();
 const right=new Event('pointerdown',{cancelable:true});Object.assign(right,{pointerId:10,clientX:500,clientY:100,pointerType:'mouse',button:2});look.dispatchEvent(right);
 assert.equal(input.precisionActive,true);assert.equal(input.consume().fire,false);input.resetPrecision();assert.equal(input.precisionActive,false);
 const key=(code:string)=>{const e=new Event('keydown',{cancelable:true});Object.assign(e,{code,repeat:false});Object.defineProperty(e,'target',{value:{matches:()=>false}});win.dispatchEvent(e);};
 input.setAvailableWeapons(['rifle','pistol']);key('Digit6');assert.equal(input.consume().switchWeapon,null);
 input.setAvailableWeapons(['rifle','pistol','sniper','knife']);key('Digit7');assert.equal(input.consume().switchWeapon,'knife');key('KeyV');assert.equal(input.consume().switchWeapon,'knife');key('Digit6');assert.equal(input.consume().switchWeapon,'sniper');
 key('KeyQ');assert.equal(input.precisionActive,true);input.clear();assert.equal(input.precisionActive,false);
 input.setGameplayActive(true);key('Space');assert.equal(input.consume().jump,true);assert.equal(input.consume().jump,false);
 key('Space');assert.equal(input.consume().jump,false); // held key is not a second press
 const up=new Event('keyup');Object.assign(up,{code:'Space'});win.dispatchEvent(up);key('Space');assert.equal(input.consume().jump,true);
 input.clear();key('Space');win.dispatchEvent(new Event('blur'));assert.equal(input.consume().jump,false);
 input.setGameplayActive(false);key('Space');assert.equal(input.consume().jump,false);
});

test('Digit8 equips an owned Deagle while knife shortcuts and catalog cycling remain stable',()=>{
 const {win,nodes,canvas,input}=touchFixture();
 const key=(code:string)=>{const event=new Event('keydown',{cancelable:true});Object.assign(event,{code,repeat:false});Object.defineProperty(event,'target',{value:{matches:()=>false}});win.dispatchEvent(event);return event;};
 input.setAvailableWeapons(['pistol','knife']);
 key('Digit8');assert.equal(input.consume().switchWeapon,null);
 input.setAvailableWeapons(['pistol','knife','deagle']);
 assert.equal(key('Digit8').defaultPrevented,true);assert.equal(input.consume().switchWeapon,'deagle');
 key('Digit7');assert.equal(input.consume().switchWeapon,'knife');
 key('KeyV');assert.equal(input.consume().switchWeapon,'knife');
 key('Digit2');assert.equal(input.consume().switchWeapon,'pistol');
 const switchButton=nodes.get('switch-button')!;switchButton.dataset.weapon='knife';
 const wheel=new Event('wheel',{cancelable:true});Object.assign(wheel,{deltaY:1});canvas.dispatchEvent(wheel);
 assert.equal(input.consume().switchWeapon,'deagle');assert.equal(wheel.defaultPrevented,true);
 switchButton.dataset.weapon='deagle';switchButton.dispatchEvent(new Event('click',{cancelable:true}));
 assert.equal(input.consume().switchWeapon,'pistol');
 input.setAvailableWeapons(['pistol']);key('Digit8');assert.equal(input.consume().switchWeapon,null);
});

test('sniper scope controls share state, reduce mouse aim gain, and clear on unavailable context',()=>{
 const win=new EventTarget(),doc=new EventTarget() as any;
 const nodes=new Map<string,ElementStub>();
 doc.getElementById=(id:string)=>{if(!nodes.has(id))nodes.set(id,new ElementStub());return nodes.get(id);};
 Object.assign(globalThis,{window:win,document:doc,innerWidth:844});
 const canvas=new ElementStub(),input=new InputController(canvas as any);
 doc.pointerLockElement=canvas;
 const move=()=>{const e=new Event('mousemove');Object.assign(e,{movementX:60,movementY:30});win.dispatchEvent(e);return input.consume();};
 const hip=move();
 input.setAimContext('sniper',true);
 const desktop=nodes.get('desktop-aim-button')!,touch=nodes.get('aim-button')!;
 assert.equal(touch.label.textContent,'开镜');
 desktop.dispatchEvent(new Event('click',{cancelable:true}));
 assert.equal(input.precisionActive,true);
 assert.equal(touch.label.textContent,'关镜');
 assert.equal(desktop.attributes.get('aria-pressed'),'true');
 const scoped=move();
 assert.ok(Math.abs(scoped.lookDX/hip.lookDX-1/3)<1e-10);
 assert.ok(Math.abs(scoped.lookDY/hip.lookDY-1/3)<1e-10);
 // Shooting stays available through the optical overlay, without dropping zoom.
 const fire=new Event('pointerdown',{cancelable:true});Object.assign(fire,{pointerType:'mouse',button:0,pointerId:1});canvas.dispatchEvent(fire);
 assert.equal(input.consume().fire,true);assert.equal(input.precisionActive,true);
 // Main supplies unavailable on reload, pause, death or leaving combat.
 input.setAimContext('sniper',false);
 assert.equal(input.precisionActive,false);assert.equal(desktop.disabled,true);
 touch.dispatchEvent(new Event('click'));assert.equal(input.precisionActive,false);
 input.setAimContext('sniper',true);assert.equal(input.precisionActive,false);
 touch.dispatchEvent(new Event('click'));assert.equal(input.precisionActive,true);
 input.setAimContext('rifle',true);assert.equal(input.precisionActive,false);assert.equal(touch.label.textContent,'精瞄');
 input.setAimContext('knife',true);assert.equal(touch.disabled,false);assert.equal(touch.label.textContent,'刺击');touch.dispatchEvent(new Event('click'));assert.equal(input.precisionActive,false);assert.equal(input.consume().secondaryFire,true);assert.equal(input.consume().secondaryFire,false);
 input.setAimContext('sniper',true);desktop.dispatchEvent(new Event('click'));
 win.dispatchEvent(new Event('blur'));assert.equal(input.precisionActive,false);
 assert.equal(desktop.attributes.get('aria-pressed'),'false');
});


test('knife secondary attack uses right mouse, touch and Q without enabling precision or leaking into a firearm',()=>{
 const win=new EventTarget(),doc=new EventTarget() as any,nodes=new Map<string,ElementStub>();
 doc.getElementById=(id:string)=>{if(!nodes.has(id))nodes.set(id,new ElementStub());return nodes.get(id);};
 Object.assign(globalThis,{window:win,document:doc,innerWidth:844});
 const canvas=new ElementStub(),input=new InputController(canvas as any);
 input.setAimContext('knife',true);
 const right=new Event('pointerdown',{cancelable:true});Object.assign(right,{pointerId:11,pointerType:'mouse',button:2});canvas.dispatchEvent(right);
 const stab=input.consume();assert.equal(stab.secondaryFire,true);assert.equal(stab.fire,false);assert.equal(input.precisionActive,false);assert.equal(input.consume().secondaryFire,false);
 const key=new Event('keydown',{cancelable:true});Object.assign(key,{code:'KeyQ',repeat:false});Object.defineProperty(key,'target',{value:{matches:()=>false}});win.dispatchEvent(key);
 assert.equal(input.consume().secondaryFire,true);
 nodes.get('aim-button')!.dispatchEvent(new Event('click'));input.setAimContext('rifle',true);assert.equal(input.consume().secondaryFire,false);
 input.setAimContext('knife',false);nodes.get('aim-button')!.dispatchEvent(new Event('click'));assert.equal(input.consume().secondaryFire,false);
 input.setAimContext('knife',true);nodes.get('aim-button')!.dispatchEvent(new Event('click'));input.clear();assert.equal(input.consume().secondaryFire,false);
});

function touchFixture() {
 const win=new EventTarget(),doc=new EventTarget() as any,nodes=new Map<string,ElementStub>();
 doc.getElementById=(id:string)=>{if(!nodes.has(id))nodes.set(id,new ElementStub());return nodes.get(id);};
 Object.assign(globalThis,{window:win,document:doc,innerWidth:844,innerHeight:390});
 const canvas=new ElementStub(),input=new InputController(canvas as any);
 const send=(target:EventTarget,type:string,id:number,x=500,y=200,pointerType='touch')=>{
  const e=new Event(type,{cancelable:true});Object.assign(e,{pointerId:id,clientX:x,clientY:y,pointerType,button:0});target.dispatchEvent(e);
 };
 return {win,doc,nodes,canvas,input,send};
}

test('fire drag is optional, preserves another look finger and supports simultaneous movement',()=>{
 const {win,nodes,input,send}=touchFixture(),fire=nodes.get('fire-button')!,look=nodes.get('look-zone')!;
 send(fire,'pointerdown',1,710,250);send(win,'pointermove',1,750,230);
 assert.equal(input.consume().lookDX,0);input.clear();
 input.configureTouch({fireDrag:true});
 send(nodes.get('joystick')!,'pointerdown',2,80,35);
 send(fire,'pointerdown',3,710,250);send(win,'pointermove',3,750,230);
 const drag=input.consume();assert.ok(drag.fire&&drag.moveX>0&&drag.lookDX<0&&drag.lookDY>0);assert.equal(drag.inputSource,'touch');
 send(look,'pointerdown',4,400,180);send(win,'pointermove',4,390,180);
 send(win,'pointercancel',3);assert.equal(input.consume().lookDX,0);
 // A finger rejected while another owned look must not spring into life later.
 send(win,'pointermove',4,300,180);assert.equal(input.consume().lookDX,0);input.clear();
 send(look,'pointerdown',5,400,180);send(fire,'pointerdown',6,710,250);send(win,'pointermove',6,750,250);
 assert.equal(input.consume().lookDX,0);
 send(win,'pointermove',5,440,180);assert.ok(input.consume().lookDX<0);
});

test('cancel, unexpected capture loss and blur clear queued fire and drag; quick tap still fires once',()=>{
 const {win,nodes,input,send}=touchFixture(),fire=nodes.get('fire-button')!;
 input.configureTouch({fireDrag:true});
 for(const ending of ['pointercancel','lostpointercapture','blur']) {
  send(fire,'pointerdown',1,710,250);send(win,'pointermove',1,740,230);
  if(ending==='blur')win.dispatchEvent(new Event('blur'));
  else send(ending==='lostpointercapture'?fire:win,ending,1);
  const stopped=input.consume();assert.equal(stopped.fire,false);assert.equal(stopped.lookDX,0);assert.equal(stopped.lookDY,0);
  send(win,'pointermove',1,800,200);assert.equal(input.consume().lookDX,0);
 }
 send(fire,'pointerdown',2,710,250);send(win,'pointerup',2);send(fire,'lostpointercapture',2);
 assert.equal(input.consume().fire,true);assert.equal(input.consume().fire,false);
});

test('touch jump is one pointerdown edge, respects gameplay, and cancels without click duplication',()=>{
 const {win,nodes,input,send}=touchFixture(),jump=nodes.get('jump-button')!;
 send(jump,'pointerdown',1);assert.equal(input.consume().jump,false);
 input.setGameplayActive(true);send(jump,'pointerdown',2);assert.equal(input.consume().jump,true);
 send(jump,'pointerdown',3);assert.equal(input.consume().jump,false);
 send(win,'pointerup',2);jump.dispatchEvent(new Event('click'));assert.equal(input.consume().jump,false);
 send(jump,'pointerdown',4);send(win,'pointercancel',4);assert.equal(input.consume().jump,false);
 send(jump,'pointerdown',5);win.dispatchEvent(new Event('blur'));assert.equal(input.consume().jump,false);
});

test('new edge look starts are filtered while captured motion and explicit edge controls remain usable',()=>{
 const {win,nodes,input,send}=touchFixture(),look=nodes.get('look-zone')!;
 for(const [x,y] of [[2,100],[840,100],[500,2],[500,388]]){
  send(look,'pointerdown',1,x,y);send(win,'pointermove',1,400,200);assert.equal(input.consume().lookDX,0);input.clear();
 }
 send(look,'pointerdown',2,500,200);send(win,'pointermove',2,840,200);assert.ok(input.consume().lookDX<0);input.clear();
 input.configureTouch({fireDrag:true});send(nodes.get('fire-button')!,'pointerdown',3,840,200);send(win,'pointermove',3,800,200);
 const edgeFire=input.consume();assert.ok(edgeFire.fire&&edgeFire.lookDX>0);
});

test('input source follows actual touch, mouse and gameplay keyboard events and reports precision',()=>{
 const {win,doc,nodes,canvas,input,send}=touchFixture();
 send(nodes.get('look-zone')!,'pointerdown',1);assert.equal(input.consume().inputSource,'touch');input.clear();
 doc.pointerLockElement=canvas;
 const mouse=new Event('mousemove');Object.assign(mouse,{movementX:4,movementY:2});win.dispatchEvent(mouse);assert.equal(input.consume().inputSource,'mouse');
 send(nodes.get('joystick')!,'pointerdown',2,80,35);assert.equal(input.consume().inputSource,'touch');
 const key=new Event('keydown',{cancelable:true});Object.assign(key,{code:'KeyW',repeat:false});Object.defineProperty(key,'target',{value:{matches:()=>false}});win.dispatchEvent(key);assert.equal(input.consume().inputSource,'mouse');
 nodes.get('aim-button')!.dispatchEvent(new Event('click'));assert.equal(input.consume().aiming,true);input.clear();assert.equal(input.consume().aiming,false);
});

test('right mouse chord reaches knife secondary input while primary remains held',()=>{
 const win=new EventTarget(),doc=new EventTarget() as any,nodes=new Map<string,ElementStub>();
 doc.getElementById=(id:string)=>{if(!nodes.has(id))nodes.set(id,new ElementStub());return nodes.get(id);};
 Object.assign(globalThis,{window:win,document:doc,innerWidth:844});
 const canvas=new ElementStub(),input=new InputController(canvas as any);input.setAimContext('knife',true);
 const left=new Event('pointerdown',{cancelable:true});Object.assign(left,{pointerId:1,pointerType:'mouse',button:0});canvas.dispatchEvent(left);
 const chord=new Event('mousedown',{cancelable:true});Object.assign(chord,{button:2,buttons:3});canvas.dispatchEvent(chord);
 const result=input.consume();assert.equal(result.fire,true);assert.equal(result.secondaryFire,true);assert.equal(input.precisionActive,false);
 assert.equal(input.consume().secondaryFire,false);input.clear();
});

test('objective touch interaction remains held across frames and stops on every release path',()=>{
 const {win,doc,nodes,input,send}=touchFixture(),button=nodes.get('interact-button')!;
 button.dataset.hold='true';
 send(button,'pointerdown',1);assert.equal(input.consume().interact,false);
 input.setGameplayActive(true);
 for(const ending of ['pointerup','pointercancel','lostpointercapture','blur','visibilitychange','inactive']){
  send(button,'pointerdown',2);
  for(let frame=0;frame<200;frame++)assert.equal(input.consume().interact,true,`${ending}: held at frame ${frame}`);
  // Another finger cannot steal the active objective control.
  send(button,'pointerdown',3);send(win,'pointerup',3);assert.equal(input.consume().interact,true);
  if(ending==='blur')win.dispatchEvent(new Event('blur'));
  else if(ending==='visibilitychange'){doc.hidden=true;doc.dispatchEvent(new Event('visibilitychange'));doc.hidden=false;}
  else if(ending==='inactive')input.setGameplayActive(false);
  else send(ending==='lostpointercapture'?button:win,ending,2);
  assert.equal(input.consume().interact,false,ending);
  button.dispatchEvent(new Event('click'));assert.equal(input.consume().interact,false,`${ending}: no duplicate click`);
  input.setGameplayActive(true);
 }
 send(button,'pointerdown',4);send(win,'pointerup',4);assert.equal(input.consume().interact,false,'a released hold never becomes a queued action');
});

test('pickup and hostage follow preserve a quick tap, while cancelled taps never interact',()=>{
 const {win,nodes,input,send}=touchFixture(),button=nodes.get('interact-button')!;
 input.setGameplayActive(true);button.dataset.hold='false';
 send(button,'pointerdown',1);send(win,'pointerup',1);send(button,'lostpointercapture',1);
 assert.equal(input.consume().interact,true);assert.equal(input.consume().interact,false);
 button.dispatchEvent(new Event('click'));assert.equal(input.consume().interact,false);
 for(const ending of ['pointercancel','lostpointercapture']){
  send(button,'pointerdown',2);send(ending==='lostpointercapture'?button:win,ending,2);
  assert.equal(input.consume().interact,false);
 }
 button.disabled=true;send(button,'pointerdown',3);assert.equal(input.consume().interact,false);
});

test('desktop E and focused objective-button Enter hold through frames and clear when released or paused',()=>{
 const {win,nodes,input}=touchFixture(),button=nodes.get('interact-button')!;
 input.setGameplayActive(true);button.dataset.hold='true';
 const key=(target:EventTarget,type:string,code:string)=>{const e=new Event(type,{cancelable:true});Object.assign(e,{code,repeat:false});Object.defineProperty(e,'target',{value:{matches:()=>false}});target.dispatchEvent(e);};
 key(win,'keydown','KeyE');assert.equal(input.consume().interact,true);assert.equal(input.consume().interact,true);
 key(win,'keyup','KeyE');assert.equal(input.consume().interact,false);
 key(win,'keydown','KeyE');key(win,'keyup','KeyE');assert.equal(input.consume().interact,false);
 key(button,'keydown','Enter');assert.equal(input.consume().interact,true);assert.equal(input.consume().interact,true);
 key(button,'keyup','Enter');assert.equal(input.consume().interact,false);
 key(button,'keydown','Enter');input.setGameplayActive(false);assert.equal(input.consume().interact,false);
 input.setGameplayActive(true);assert.equal(input.consume().interact,false);
});

test('Shift hold and touch run toggle share the sprint intent and clear on pause/blur/crouch',()=>{
 const {win,nodes,input}=touchFixture();const button=nodes.get('sprint-button')!;
 const key=(type:string,code:string)=>{const e=new Event(type,{cancelable:true});Object.assign(e,{code,repeat:false});Object.defineProperty(e,'target',{value:{matches:()=>false}});win.dispatchEvent(e);};
 button.dispatchEvent(new Event('click'));key('keydown','ShiftLeft');assert.equal(input.consume().sprint,false);
 input.setGameplayActive(true);key('keydown','KeyW');key('keydown','ShiftLeft');assert.equal(input.consume().sprint,true);assert.equal(input.consume().moveZ,1);
 key('keyup','ShiftLeft');assert.equal(input.consume().sprint,false);
 button.dispatchEvent(new Event('click'));assert.equal(input.consume().sprint,true);assert.equal(button.attributes.get('aria-pressed'),'true');
 key('keydown','KeyC');assert.equal(input.consume().sprint,false);assert.equal(button.attributes.get('aria-pressed'),'false');
 button.dispatchEvent(new Event('click'));win.dispatchEvent(new Event('blur'));assert.equal(input.consume().sprint,false);
 key('keydown','ShiftRight');assert.equal(input.consume().sprint,true);input.setGameplayActive(false);input.setGameplayActive(true);assert.equal(input.consume().sprint,false);
});

test('held fire survives multiple fixed simulation steps and cannot alternate back into sprint',()=>{
 for(const fps of [20,30,60]){
  const {win,nodes,input,send}=touchFixture();input.setGameplayActive(true);
  for(const code of ['KeyW','ShiftLeft']){const event=new Event('keydown',{cancelable:true});Object.assign(event,{code,repeat:false});Object.defineProperty(event,'target',{value:{matches:()=>false}});win.dispatchEvent(event);}
  send(nodes.get('fire-button')!,'pointerdown',41);
  const sim=new Simulation(42);sim.start();const p=sim.state.player;sim.state.actors.forEach(a=>a.player=true);Object.assign(p,{x:3,z:18,yaw:0});
  for(let frame=0;frame<fps;frame++){
   const pending=input.consume(1/fps);assert.equal(pending.fireHeld,true);
   for(let step=0;step<60/fps;step++){sim.update(1/60,pending);pending.fire=false;assert.equal(p.sprinting,false);}
  }
  assert.ok(Math.abs(18-p.z-3.9)<.001);send(win,'pointerup',41);assert.equal(input.consume().fireHeld,false);
 }
});
