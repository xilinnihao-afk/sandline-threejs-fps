import test from 'node:test';
import assert from 'node:assert/strict';
import { VisitSession, type Props } from '../src/analytics/session';
function fixture() { let now = 0; const events: { name: string; props: Props }[] = []; const session = new VisitSession((name, props) => events.push({ name, props }), () => now); return { session, events, advance: (ms: number) => { now += ms; } }; }
test('one load attempt has exactly one terminal outcome, and failure retains its phase', () => {
 const {session:s,events,advance}=fixture(); s.beginLoad();s.beginLoad();s.loadStage('weapons');advance(1200);s.fail('network');s.fail('runtime');s.ready();
 assert.equal(events.filter(e=>e.name==='load_start').length,1);assert.equal(events.filter(e=>e.name==='load_failure').length,1);assert.equal(events.filter(e=>e.name==='load_success').length,0);
 assert.equal(events.find(e=>e.name==='load_failure')!.props.phase,'weapons');assert.equal(s.stage,'load_failed');
});
test('only visible unpaused play counts; heartbeat deltas never double count',()=>{
 const {session:s,events,advance}=fixture();s.beginLoad();advance(10000);s.ready();advance(2000);s.setGame('playing',false);advance(15500);s.flush();s.visibility(false);advance(30000);s.visibility(true);advance(4500);s.setGame('playing',true);advance(20000);s.leave(false);
 assert.equal(events.filter(e=>e.name==='play_duration').reduce((n,e)=>n+Number(e.props.seconds),0),20);
 assert.equal(events.find(e=>e.name==='page_exit')!.props.total_seconds,20);assert.equal(events.find(e=>e.name==='page_exit')!.props.stage,'paused');
});
test('background is distinct from exit, and bfcache restoration resumes accounting',()=>{
 const {session:s,events,advance}=fixture();s.beginLoad();s.ready();s.setGame('playing',false);advance(2500);s.visibility(false);s.visibility(false);s.leave(true);advance(50000);s.visibility(true);advance(1500);s.leave(false);
 assert.equal(events.filter(e=>e.name==='page_background').length,1);assert.equal(events.filter(e=>e.name==='play_duration').reduce((n,e)=>n+Number(e.props.seconds),0),4);
 assert.deepEqual(events.filter(e=>e.name==='page_exit').map(e=>e.props.total_seconds),[2,4]);
});
test('entry and loading exits are distinguishable and successful loads cannot fail later',()=>{
 const {session:s,events}=fixture();s.leave(false);s.visibility(true);s.beginLoad();s.loadStage('physics');s.leave(false);s.visibility(true);s.ready();s.ready();s.fail('late');
 assert.deepEqual(events.filter(e=>e.name==='page_exit').map(e=>e.props.stage),['entry','loading']);assert.equal(events.filter(e=>e.name==='load_success').length,1);assert.equal(events.filter(e=>e.name==='load_failure').length,0);
});
