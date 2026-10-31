import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Simulation} from '../src/game/simulation';
import {MAPS,setActiveMap,type MapId} from '../src/game/map';
import {Dust2Collision} from '../src/game/dust2Collision';
import {AssaultCollision} from '../src/game/assaultCollision';
import {installDust2Geometry} from '../src/game/dust2';
import {installAssaultGeometry} from '../src/game/assault';
import {installBloodstrikeGeometry} from '../src/game/bloodstrike';
import {purchaseWindow,itemAvailability,itemPrice} from '../src/game/economy';
import {LOADOUTS} from '../src/game/loadouts';
import {SHOP_SHORTCUT_ITEMS,handleShopKey} from '../src/ui/shopKeyboard';
import {EMPTY_INPUT} from '../src/game/types';

for(const [id,file,install] of [['dust2','de_dust2',installDust2Geometry],['assault','cs_assault',installAssaultGeometry],['bloodstrike','cs_bloodstrike',installBloodstrikeGeometry]] as const){
 const bytes=readFileSync(`public/assets/maps/${id}/${file}.bsp`),data=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
 const geometry=id==='assault'?new AssaultCollision(data):new Dust2Collision(data);
 geometry.navigation=JSON.parse(readFileSync(`public/assets/maps/${id}/navigation.json`,'utf8'));
 install(geometry as AssaultCollision);
}

test('all five maps sell every shop item at each real player spawn; timer, altitude and location gates hold',()=>{
 try{
  for(const id of Object.keys(MAPS) as MapId[]){
   setActiveMap(id);const sim=new Simulation(42);sim.start();if(id==='bloodstrike'){sim.state.round=2;sim.resetRound();}const s=sim.state,p=s.player;
   for(const spawn of MAPS[id].blueSpawns){
    Object.assign(p,spawn,{money:16000,grenades:0,grenadePurchases:0});
    assert.equal(purchaseWindow(s).allowed,true,`${id} spawn ${JSON.stringify(spawn)}`);
    for(const item of SHOP_SHORTCUT_ITEMS){
     p.money=16000;if(item==='ammo')p.guns.rifle.reserve=0;
     assert.equal(sim.purchase(item),true,`${id} ${item}`);assert.equal(p.money,16000-itemPrice(item));
    }
   }
   if(id!=='bloodstrike'){
    const spawn={...MAPS[id].blueSpawns[0]};Object.assign(p,spawn);s.time=(p.spawnedAt??0)+20.001;
    assert.equal(sim.purchase('pistol'),false,`${id} timeout`);s.time=p.spawnedAt??0;
    if(MAPS[id].geometry){p.y=(spawn.y??0)+4;assert.equal(purchaseWindow(s).allowed,false,`${id} different floor`);}
    Object.assign(p,{x:10000,z:10000});assert.equal(sim.purchase('pistol'),false,`${id} outside spawn`);
   }
   p.health=0;assert.equal(sim.purchase('pistol'),false);
  }
 }finally{setActiveMap('desert');}
});

test('ammo purchase replenishes owned reserves once without reloading or changing a pending weapon',()=>{
 const sim=new Simulation(42);sim.start();const p=sim.state.player;p.money=1000;
 assert.equal(itemAvailability(p,'ammo').reason,'备用弹药已满');assert.equal(sim.purchase('ammo'),false);assert.equal(p.money,1000);
 p.guns.rifle.ammo=3;p.guns.rifle.reserve=1;p.guns.rifle.reloadLeft=1.2;p.guns.rifle.cooldown=.12;
 p.guns.pistol.reserve=0;p.guns.sniper.reserve=0;
 const weapon=p.weapon;sim.setPaused(true);assert.equal(sim.purchase('ammo'),true);
 assert.equal(p.money,800);assert.equal(p.weapon,weapon);assert.equal(p.guns.rifle.ammo,3);assert.equal(p.guns.rifle.reloadLeft,1.2);assert.equal(p.guns.rifle.cooldown,.12);
 assert.equal(p.guns.rifle.reserve,LOADOUTS.rifle.reserve);assert.equal(p.guns.pistol.reserve,LOADOUTS.pistol.reserve);assert.equal(p.guns.sniper.reserve,0);
 const before=JSON.stringify(sim.state);sim.update(1,{...EMPTY_INPUT,fire:true,grenade:true,moveZ:1});assert.equal(JSON.stringify(sim.state),before);
 assert.equal(sim.purchase('ammo'),false);assert.equal(p.money,800);assert.equal(sim.events.filter(e=>e.type==='buy'&&e.item==='ammo').length,1);
 p.guns.rifle.reserve=0;p.money=199;assert.equal(sim.purchase('ammo'),false);assert.equal(p.guns.rifle.reserve,0);assert.equal(p.money,199);
});

test('shop keyboard owns B, Escape and all nine slots, ignores repeats, and blocks gameplay keys',()=>{
 let open=false,toggles=0;const bought:string[]=[];
 const actions={isOpen:()=>open,canOpen:()=>true,toggle:()=>{open=!open;toggles++;},buy:(item:string)=>bought.push(item)};
 const send=(code:string,repeat=false,editable=false)=>{let prevented=false,stopped=false;handleShopKey({code,repeat,target:{matches:()=>editable},preventDefault:()=>{prevented=true;},stopImmediatePropagation:()=>{stopped=true;}} as any,actions);return {prevented,stopped};};
 assert.deepEqual(send('Digit1'),{prevented:false,stopped:false});assert.equal(bought.length,0);
 assert.deepEqual(send('KeyB'),{prevented:true,stopped:true});assert.equal(open,true);send('KeyB',true);assert.equal(toggles,1);
 for(let n=1;n<=9;n++){assert.deepEqual(send(`Digit${n}`),{prevented:true,stopped:true});send(`Digit${n}`,true);}
 assert.deepEqual(bought,[...SHOP_SHORTCUT_ITEMS]);send('Numpad9');assert.equal(bought.at(-1),'he');
 for(const key of ['KeyW','KeyR','KeyG','KeyQ','KeyV','ArrowUp'])assert.deepEqual(send(key),{prevented:true,stopped:true});
 assert.deepEqual(send('Digit1',false,true),{prevented:false,stopped:false});
 send('Escape');assert.equal(open,false);assert.equal(toggles,2);assert.deepEqual(send('Digit1'),{prevented:false,stopped:false});
});
