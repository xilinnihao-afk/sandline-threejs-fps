import test from 'node:test';
import assert from 'node:assert/strict';
import {SNIPER_MAGNIFICATION,sniperScopeFov} from '../src/ui/scope';

test('sniper sight preserves 3x perspective magnification across phone and desktop FOV',()=>{
 for(const baseFov of [56,62,76]){
  const scoped=sniperScopeFov(baseFov);
  assert.ok(scoped>15&&scoped<30);
  const magnification=Math.tan(baseFov*Math.PI/360)/Math.tan(scoped*Math.PI/360);
  assert.ok(Math.abs(magnification-SNIPER_MAGNIFICATION)<1e-10);
 }
});
