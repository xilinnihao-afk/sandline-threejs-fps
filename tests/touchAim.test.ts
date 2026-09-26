import test from 'node:test';
import assert from 'node:assert/strict';
import {TouchAim} from '../src/ui/touchAim';
test('gesture slop accumulates slow movement and retains fine aim after activation',()=>{
 const a=new TouchAim(); a.begin(); for(let i=0;i<5;i++)a.move(1,0,1); assert.equal(a.consume(1/60).x,0);
 a.move(1,0,1); assert.ok(a.consume(1/60).x<0); a.move(.1,0,1); assert.ok(a.consume(1/60).x<0);
 a.clear(); assert.deepEqual(a.consume(1/60),{x:0,y:0});
});
test('30/60/120Hz smoothing conserves the same swipe displacement',()=>{
 for(const hz of [30,60,120]){const a=new TouchAim();a.begin();let total=0;for(let i=0;i<hz;i++){a.move(120/hz,0,.01);total+=a.consume(1/hz).x;}for(let i=0;i<hz;i++)total+=a.consume(1/hz).x;assert.ok(Math.abs(total+1.15)<1e-6);}
});
test('quick swipe survives pointerup before the next render; cancellation clears it',()=>{
 const a=new TouchAim(); a.begin(); a.move(25,0,.01); a.end();
 let total=0;for(let i=0;i<120;i++)total+=a.consume(1/60).x;
 assert.ok(Math.abs(total+.2)<1e-8);
 a.begin();a.move(25,0,.01);a.clear();assert.deepEqual(a.consume(1/60),{x:0,y:0});
});
