import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blocked, findPath, moveBody } from '../src/game/collision.ts';
import { BLUE_SPAWNS, RED_SPAWNS, MAP_BOXES, MAPS, getActiveMap, mapRevision, setActiveMap } from '../src/game/map.ts';
import { Simulation } from '../src/game/simulation.ts';
import { createMapPickups } from '../src/game/pickups.ts';
import { EMPTY_INPUT } from '../src/game/types.ts';

test('both arenas have clear spawns and navigable routes between every spawn pair', () => {
  try {
    for (const id of ['desert', 'snow'] as const) {
      setActiveMap(id);
      const spawns = [...BLUE_SPAWNS, ...RED_SPAWNS];
      for (const spawn of spawns) assert.equal(blocked(spawn.x, spawn.z), false, `${id}: spawn inside cover ${JSON.stringify(spawn)}`);
      for (let i = 0; i < spawns.length; i++) for (let j = 0; j < spawns.length; j++) {
        if (i === j) continue;
        const a = spawns[i], b = spawns[j], path = findPath(a.x, a.z, b.x, b.z);
        assert.ok(path.length > 0, `${id}: no route from spawn ${i} to ${j}`);
        assert.deepEqual(path.at(-1), b, `${id}: route failed to reach destination`);
        let position = { ...a };
        for (const point of path) {
          assert.equal(blocked(point.x, point.z, .48), false, `${id}: navigation cell overlaps cover`);
          position = moveBody(position.x, position.z, point.x - position.x, point.z - position.z);
          assert.ok(Math.hypot(position.x - point.x, position.z - point.z) < .001, `${id}: route segment cannot be traversed`);
        }
      }
    }
  } finally { setActiveMap('desert'); }
});

test('desert to snow to desert switching invalidates navigation and collision together', () => {
  try {
    setActiveMap('desert');
    const initialRevision = mapRevision;
    const desertPath = findPath(-19, 2, 19, 2);
    assert.equal(blocked(-9, 0), true);
    setActiveMap('snow');
    assert.equal(getActiveMap().mode, 'elimination');
    assert.equal(MAP_BOXES, MAPS.snow.boxes);
    assert.ok(mapRevision > initialRevision);
    assert.equal(blocked(-9, 0), false);
    const snowPath = findPath(-19, 2, 19, 2);
    assert.ok(snowPath.length < desertPath.length, 'snow crossroad should replace the desert detour');
    assert.ok(snowPath.every(point => !blocked(point.x, point.z, .48)));
    setActiveMap('desert');
    assert.equal(getActiveMap().mode, 'demolition');
    assert.equal(blocked(-9, 0), true);
    assert.deepEqual(findPath(-19, 2, 19, 2), desertPath, 'switching back must rebuild the desert navigation grid');
  } finally { setActiveMap('desert'); }
});

test('refreshing a menu simulation adopts snow spawns and removes demolition objectives', () => {
  try {
    setActiveMap('desert');
    const sim = new Simulation(42);
    setActiveMap('snow'); sim.refreshMap();
    assert.equal(sim.state.mode, 'deathmatch');
    assert.deepEqual(sim.state.sites, []);
    assert.deepEqual({ x: sim.state.player.x, z: sim.state.player.z }, BLUE_SPAWNS[0]);
    assert.ok(sim.state.actors.every(actor => !actor.hasBomb && !blocked(actor.x, actor.z)));
    assert.equal(sim.state.pickups.length,7);assert.equal(new Set(sim.state.pickups.map(p=>p.weapon)).size,7);
    setActiveMap('desert'); sim.refreshMap();
    assert.equal(sim.state.mode, 'deathmatch');
    assert.equal(sim.state.sites.length, 0);
    assert.deepEqual({ x: sim.state.player.x, z: sim.state.player.z }, BLUE_SPAWNS[0]);
    assert.equal(sim.state.pickups.length,14);
  } finally { setActiveMap('desert'); }
});

test('snow interaction cannot plant even when a stale carrier and nearby site are present', () => {
  try {
    setActiveMap('snow');
    const sim = new Simulation(42); sim.start('elimination');
    const player = sim.state.player;
    assert.deepEqual(sim.state.sites, []);
    assert.ok(sim.state.actors.every(actor => !actor.hasBomb));
    // Exercise the mode guard directly through real input, independently of
    // the normal no-bomb/no-sites initialization safeguards.
    player.faction = 't'; player.hasBomb = true;
    sim.state.bomb.carrierId = player.id;
    sim.state.sites = [{ id: 'A', x: player.x, z: player.z, radius: 2.6 }];
    sim.events = [];
    sim.update(1 / 60, { ...EMPTY_INPUT, interact: true });
    assert.equal(sim.state.phase, 'playing');
    assert.equal(sim.state.bomb.status, 'carried');
    assert.equal(player.hasBomb, true);
    assert.ok(sim.events.every(event => event.type !== 'plantComplete'));
  } finally { setActiveMap('desert'); }
});

test('seeded snow bot matches finish through combat without bomb events or wall penetration', () => {
  const metrics = [];
  try {
    setActiveMap('snow');
    for (const seed of [7, 42, 2026]) {
      const sim = new Simulation(seed); sim.start('elimination');
      let frames = 0, shots = 0, hits = 0, kills = 0;
      while (sim.state.phase !== 'matchEnd' && frames < 60 * 600) {
        sim.update(1 / 60, EMPTY_INPUT, true);
        for (const actor of sim.state.actors) if (actor.health > 0) {
          assert.equal(blocked(actor.x, actor.z, .319), false, `seed ${seed}, frame ${frames}: living actor ${actor.id} penetrated cover`);
          assert.equal(actor.hasBomb, false);
        }
        for (const event of sim.events) {
          assert.ok(!/^(plant|defuse|bomb)/.test(event.type), `seed ${seed}: elimination emitted ${event.type}`);
          if (event.type === 'shot') shots++;
          if (event.type === 'hit') hits++;
          if (event.type === 'kill') kills++;
        }
        sim.events = []; frames++;
      }
      assert.equal(sim.state.phase, 'matchEnd', `seed ${seed}: snow match did not finish`);
      assert.equal(Math.max(sim.state.blueScore, sim.state.redScore), 3);
      assert.ok(shots > 20 && hits > 10 && kills >= 9, `seed ${seed}: completion must include real combat`);
      assert.ok(sim.state.actors.some(actor => actor.team === 'blue' && actor.kills > 0));
      assert.ok(sim.state.actors.some(actor => actor.team === 'red' && actor.kills > 0));
      metrics.push({ seed, seconds: frames / 60, shots, hits, kills, blue: sim.state.blueScore, red: sim.state.redScore });
    }
    console.log('SNOW_MATCH_METRICS', JSON.stringify(metrics));
  } finally { setActiveMap('desert'); }
});


test('snow flank buttresses break outer-wall sightlines while leaving a continuous inside bypass', () => {
 try {
  setActiveMap('snow');
  for (const sign of [-1,1]) {
   // A player can walk the full flank without being routed back through the center.
   for (const laneX of [14,15.5,16.7]) {
    let position={x:sign*laneX,z:18};
    for(let i=0;i<360;i++) {
     const next=moveBody(position.x,position.z,0,-.1);
     assert.ok(Math.abs(next.z-(position.z-.1))<.001,'outside route hit a side cover or crate');
     assert.ok(Math.abs(next.x-sign*laneX)<.001,'outside route pushed toward center');
     position=next;
    }
    assert.ok(Math.abs(position.z+18)<.001);
   }
   const path=findPath(sign*19.3,18,sign*19.3,-18);
   assert.ok(path.length>0);assert.ok(path.every(p=>sign*p.x>12.9));
   assert.ok(path.some(p=>sign*p.x<17.2),'flank route must go around the new wall');
   assert.equal(blocked(sign*19.5,0),true,'mid-flank ice must collide');
   assert.equal(blocked(sign*16,0),false,'inside bypass must remain open');
   // Front, middle and rear cross-openings connect the flank to the central arena.
   for(const z of [-17,-2,2,17]) {
    let position={x:sign*8,z};
    for(let i=0;i<120;i++)position=moveBody(position.x,position.z,sign*.1,0);
    assert.ok(Math.abs(position.x-sign*20)<.001,`blocked cross-opening at z=${z}`);
   }
  }
 } finally {setActiveMap('desert');}
});


test('snow central cross remains 6 m with 9 m flank mouths and 5 m buttress bypasses',()=>{
 try{
  setActiveMap('snow');
  const blocks=MAP_BOXES.filter(b=>b.kind==='wall'&&Math.abs(b.x)<13&&Math.abs(b.z)<19);
  assert.equal(blocks.length,4);
  const left=blocks.find(b=>b.x<0)!,right=blocks.find(b=>b.x>0)!;
  assert.deepEqual([left.x-left.w/2+21.5,right.x-right.w/2-(left.x+left.w/2),21.5-right.x-right.w/2],[9,6,9]);
  const front=blocks.find(b=>b.z>0)!,back=blocks.find(b=>b.z<0)!;
  assert.equal(front.z-front.d/2-(back.z+back.d/2),6);
  assert.deepEqual([back.z-back.d/2,front.z+front.d/2],[-12.5,12.5]);
  assert.deepEqual(MAPS.snow.size,{width:44,depth:40});
  assert.ok(blocks.every(b=>b.h===4));assert.ok(MAP_BOXES.every(b=>b.h<=4.4));
  // Sample both edges and the center of all three longitudinal lanes.
  for(const x of [-17,-15.5,-13.2,-2.6,0,2.6,13.2,15.5,17]){
   let position={x,z:18};for(let i=0;i<360;i++)position=moveBody(position.x,position.z,0,-.1);
   assert.ok(Math.abs(position.z+18)<.001,`longitudinal lane blocked at x=${x}`);
  }
  for(const z of [-2.6,0,2.6]){
   let position={x:-17,z};for(let i=0;i<340;i++)position=moveBody(position.x,position.z,.1,0);
   assert.ok(Math.abs(position.x-17)<.001,`crossroad blocked at z=${z}`);
  }
  // Newly occupied strips must also be solid in gameplay, not only visually narrower.
  for(const sign of [-1,1]){
   assert.equal(blocked(sign*3.8,8),true);
   assert.equal(blocked(8,sign*3.8),true);
  }
  const pickups=createMapPickups();
  assert.equal(pickups.length,7,'snow provides exactly one ground copy of every firearm');
  assert.equal(new Set(pickups.map(p=>p.weapon)).size,7);
  for(const pickup of pickups){
   assert.equal(blocked(pickup.x,pickup.z,.5),false);
   const spawn=pickup.z>0?BLUE_SPAWNS[0]:RED_SPAWNS[0];
   assert.ok(findPath(spawn.x,spawn.z,pickup.x,pickup.z).length>0);
  }
 }finally{setActiveMap('desert');}
});
