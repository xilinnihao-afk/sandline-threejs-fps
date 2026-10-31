import type {Simulation} from './simulation';
import {resetWeaponSwitch} from './weaponSwitch';
import type {GameEvent,HitRegion} from './types';

/** Debug-only range: position the sight, then use the real touch fire control.
 * Collect emitted combat events and measured health/ammo deltas, not a second
 * damage calculation masquerading as a playtest. */
export async function hitRegionInputQA(sim:Simulation,events:GameEvent[]){
 const p=sim.state.player,target=sim.state.actors.find(a=>a.team!==p.team)!;
 sim.state.actors.forEach((a,i)=>Object.assign(a,{player:true,x:-15,z:15-i,moving:false,spawnProtectionUntil:0}));
 Object.assign(p,{x:3,z:14,y:0,groundY:0,yaw:0,pitch:0,weapon:'pistol',health:10000,armor:0,inventory:['pistol','knife','rifle'],spread:0});
 Object.assign(target,{x:3,z:10,y:0,groundY:0,yaw:Math.PI,health:1000,armor:0});
 resetWeaponSwitch(p);p.guns.pistol.ammo=12;p.guns.pistol.cooldown=0;p.guns.pistol.reloadLeft=0;
 const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
 const specs:readonly [HitRegion,number,number,number,number][]=[['head',0,1.62,1.08,66],['chest',-.15,1.32,.81,24],['abdomen',0,.89,.49,30],['arm',.32,1.22,.80,19],['leg',.13,.35,.20,16]];
 const button=document.getElementById('fire-button')!;
 const fire=(type:string)=>{const rect=button.getBoundingClientRect();button.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:91,pointerType:'touch',button:0,buttons:type==='pointerdown'?1:0,clientX:rect.x+rect.width/2,clientY:rect.y+rect.height/2}));};
 const rows=[];
 for(const crouched of [false,true])for(const [region,x,y,duckY,expected] of specs){
  target.crouched=crouched;p.x=3+x;p.pitch=Math.atan2((crouched?duckY:y)-1.62,3.75);p.spread=0;
  await pause(450);events.length=0;const health=target.health,ammo=p.guns.pistol.ammo;
  fire('pointerdown');await pause(75);fire('pointerup');await pause(150);
  const hits=events.filter(e=>e.type==='hit'&&e.targetId===target.id);
  rows.push({region,crouched,expected,damage:health-target.health,ammoSpent:ammo-p.guns.pistol.ammo,hits:structuredClone(hits)});
 }
 return {test:'regional-damage-real-fire-input',passed:rows.every(r=>r.damage===r.expected&&r.ammoSpent===1&&r.hits.length===1&&r.hits[0].hitRegion===r.region),rows};
}
