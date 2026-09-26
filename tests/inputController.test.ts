import test from 'node:test';
import assert from 'node:assert/strict';
import {InputController} from '../src/ui/input';
import {Simulation} from '../src/game/simulation';
import {EMPTY_INPUT} from '../src/game/types';

// 最小事件宿主，直接走实际控制器，不复制触控算法。
class ElementStub extends EventTarget {
 style:any={};dataset:any={};classList={add(){},remove(){},toggle(){}};
 setAttribute(){} setPointerCapture(){} hasPointerCapture(){return false;} releasePointerCapture(){}
 getBoundingClientRect(){return {left:0,top:0,width:118,height:118};}
}
test('touch fire-drag, independent look owner, mouse overlay and pistol shooting',()=>{
 const win=new EventTarget(),doc=new EventTarget() as any;
 const nodes=new Map<string,ElementStub>();
 doc.getElementById=(id:string)=>{if(!nodes.has(id))nodes.set(id,new ElementStub());return nodes.get(id);};
 Object.assign(globalThis,{window:win,document:doc,innerWidth:844});
 const input=new InputController(new ElementStub() as any);
 const send=(target:EventTarget,type:string,id:number,x:number,y:number,pointerType='touch')=>{
  const e=new Event(type,{cancelable:true});Object.assign(e,{pointerId:id,clientX:x,clientY:y,pointerType,button:0});target.dispatchEvent(e);
 };
 const fire=nodes.get('fire-button')!,look=nodes.get('look-zone')!,joy=nodes.get('joystick')!;
 send(joy,'pointerdown',1,80,40);send(fire,'pointerdown',2,700,300);send(win,'pointermove',2,750,280);
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
});
