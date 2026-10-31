import test from 'node:test';
import assert from 'node:assert/strict';
import {TouchAim} from '../src/ui/touchAim';
test('tiny corrections respond without a deadzone, then stop immediately after release',()=>{
 const a=new TouchAim(); a.begin(); a.move(.2,-.1,1);const first=a.consume(1/60);assert.ok(first.x<0&&first.y>0);
 a.end();const rest=a.consume(1/60);assert.ok(Math.abs(first.x+rest.x+.2)<1e-10);assert.deepEqual(a.consume(1/60),{x:0,y:0});
 a.clear(); assert.deepEqual(a.consume(1/60),{x:0,y:0});
});
test('30/60/120Hz smoothing conserves the same swipe displacement',()=>{
 for(const hz of [30,60,120]){const a=new TouchAim();a.begin();let total=0;for(let i=0;i<hz;i++){a.move(120/hz,0,.01);total+=a.consume(1/hz).x;}for(let i=0;i<hz;i++)total+=a.consume(1/hz).x;assert.ok(Math.abs(total+1.2)<1e-6);}
});
test('quick swipe survives pointerup before the next render; cancellation clears it',()=>{
 const a=new TouchAim(); a.begin(); a.move(25,0,.01); a.end();
 let total=0;for(let i=0;i<120;i++)total+=a.consume(1/60).x;
 assert.ok(Math.abs(total+.25)<1e-8);
 a.begin();a.move(25,0,.01);a.clear();assert.deepEqual(a.consume(1/60),{x:0,y:0});
});
