import test from 'node:test';
import {loadCPU} from './loadCharacterFixture';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {FIREARM_KINDS, type FirearmKind} from '../src/game/types';
import {setActiveMap} from '../src/game/map';
import {Simulation, WEAPONS} from '../src/game/simulation';
import {createViewWeapon,createHeldWeapon,createGroundWeapon,loadImportedWeaponAssets,updateViewWeapon,updateHeldWeapon,weaponAssetSource} from '../src/render/weapons';

const assetRoot=new URL('../assets-source/retired-20261023/assets/weapons/sketchfab/',import.meta.url);
const manifest=JSON.parse(fs.readFileSync(new URL('manifest.json',assetRoot),'utf8'));
const expectedLengths:Record<FirearmKind,number>={rifle:1,pistol:.235,smg:.75,shotgun:1.2,m4:1,sniper:1.3,deagle:.27};
const parsed=new Map<FirearmKind,Promise<THREE.Group>>();
function readWeapon(kind:FirearmKind):Promise<THREE.Group>{
 let result=parsed.get(kind);
 if(!result){result=(async()=>{
  const bytes=fs.readFileSync(new URL(`${kind}.glb`,assetRoot));
  assert.equal(bytes.readUInt32LE(0),0x46546c67);
  assert.equal(bytes.readUInt32LE(4),2);
  assert.equal(bytes.readUInt32LE(8),bytes.length);
  const jsonLength=bytes.readUInt32LE(12),doc=JSON.parse(bytes.subarray(20,20+jsonLength).toString());
  const binAt=20+jsonLength,binary=bytes.subarray(binAt+8,binAt+8+bytes.readUInt32LE(binAt));
  assert.ok((doc.images?.length??0)>0,`${kind}: textured source lost its images`);
  assert.equal(doc.images.length,manifest.weapons[kind].images.length);
  for(const [index,image] of doc.images.entries()){
   assert.equal(typeof image.bufferView,'number',`${kind}: image must be embedded`);
   assert.equal(image.uri,undefined);
   const view=doc.bufferViews[image.bufferView],offset=view.byteOffset??0;
   assert.ok(offset>=0&&view.byteLength>32&&offset+view.byteLength<=binary.length,`${kind}: truncated image ${index}`);
   const png=binary.subarray(offset,offset+view.byteLength);
   assert.equal(image.mimeType,'image/png');
   assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
   const width=png.readUInt32BE(16),height=png.readUInt32BE(20);
   assert.ok(width>0&&height>0&&width<=512&&height<=512,`${kind}: texture exceeds mobile size budget`);
   assert.deepEqual([width,height],manifest.weapons[kind].images[index].size);
  }
  // Browser QA owns texture appearance. Node parses the actual exported mesh,
  // hierarchy and sockets without depending on a DOM image decoder.
  doc.buffers[0].uri='data:application/octet-stream;base64,'+binary.toString('base64');
  doc.materials=(doc.materials??[{}]).map(()=>({}));delete doc.images;delete doc.textures;
  (globalThis as any).ProgressEvent??=class{};
  return (await new GLTFLoader().parseAsync(JSON.stringify(doc),'')).scene;
 })();parsed.set(kind,result);}
 return result;
}

test('archived six-gun sources retain finite canonical geometry, sockets, honest moving parts and provenance',async()=>{
 let totalBytes=0;
 for(const kind of Object.keys(manifest.weapons) as FirearmKind[]){
  const entry=manifest.weapons[kind],bytes=fs.readFileSync(new URL(entry.file,assetRoot));
  totalBytes+=bytes.length;
  assert.equal(bytes.length,entry.bytes);
  assert.ok(bytes.length<=8*1024*1024,`${kind}: mobile transfer exceeds 8 MiB`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256);
  const source=JSON.parse(fs.readFileSync(new URL(`../assets-source/sketchfab-six-guns-20261008/${kind}/source.json`,import.meta.url),'utf8'));
  assert.match(entry.sourceSha256,/^[a-f0-9]{64}$/);
  assert.equal(entry.sourceSha256,source.sha256,`${kind}: derivative no longer identifies downloaded source`);
  assert.equal(source.license.slug,'by');
  assert.match(source.license.url,/creativecommons\.org\/licenses\/by\/4\.0/);
  assert.ok(source.author.length>0&&source.url.includes(source.uid));
  const provenance={uid:source.uid,url:source.url,author:source.author,authorUrl:source.authorUrl,license:source.license};
  assert.deepEqual(entry.source,provenance,`${kind}: shipped manifest must preserve source attribution and license`);
  const model=await readWeapon(kind);model.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(model),size=bounds.getSize(new THREE.Vector3());
  assert.ok([...bounds.min.toArray(),...bounds.max.toArray()].every(Number.isFinite));
  assert.ok(Math.abs(size.z-expectedLengths[kind])<.002,`${kind}: incorrect metre scale or forward axis`);
  assert.ok(size.x>.02&&size.x<.18&&size.y>.1&&size.y<.45&&size.y>size.x,`${kind}: gun is sideways or implausibly proportioned`);
  const root=model.getObjectByName(`sketchfab-${kind}`)!;
  assert.ok(root);assert.equal(root.userData.assetSource,'sketchfab');
  assert.deepEqual(root.userData.source,provenance,`${kind}: embedded attribution differs from source`);
  assert.deepEqual(root.userData.movingParts,entry.movingParts);
  const muzzle=model.getObjectByName('muzzle')!.getWorldPosition(new THREE.Vector3());
  assert.ok(Math.abs(muzzle.z-bounds.min.z)<.015,`${kind}: muzzle socket is not at forward end`);
  assert.ok(muzzle.y>root.userData.weaponSockets.primaryGrip[1]&&muzzle.y<bounds.max.y+.02,`${kind}: grip must sit below the barrel`);
  let triangles=0;
  model.traverse(object=>{if(object instanceof THREE.Mesh){
   const positions=object.geometry.getAttribute('position');
   for(let i=0;i<positions.count;i++)assert.ok(Number.isFinite(positions.getX(i))&&Number.isFinite(positions.getY(i))&&Number.isFinite(positions.getZ(i)),`${kind}: nonfinite vertex`);
   triangles+=(object.geometry.index?.count??positions.count)/3;
  }});
  assert.equal(triangles,entry.triangles);assert.ok(triangles>1000&&triangles<100000);
  for(const name of ['magazine','bolt','pump']){
   const part=model.getObjectByName(name);assert.ok(part,`${kind}: missing ${name} wrapper`);
   assert.ok(part.position.length()<1e-6&&part.quaternion.angleTo(new THREE.Quaternion())<1e-6&&part.scale.distanceTo(new THREE.Vector3(1,1,1))<1e-6,`${kind}: ${name} bind transform is not identity`);
   let meshes=0;part.traverse(object=>{if(object instanceof THREE.Mesh)meshes++;});
   assert.equal(meshes>0,entry.movingParts[name],`${kind}: ${name} availability misrepresents source geometry`);
  }
 }
 assert.equal(totalBytes,manifest.totalBytes);assert.ok(totalBytes<=30*1024*1024,'six-gun transfer exceeds 30 MiB');
});

test('both maps use imported guns in all three contexts and animate independent clones',async t=>{
 const requested:string[]=[];
 const loader=t.mock.method(GLTFLoader.prototype,'loadAsync',async(url:string)=>{
  requested.push(url);
  const kind=url.split('/').at(-1)!.split('?')[0].replace('.glb','') as FirearmKind;
  return loadCPU('public/assets/runtime/'+kind+'.glb');
 });
 try{
  await loadImportedWeaponAssets();assert.equal(requested.length,FIREARM_KINDS.length);
  assert.ok(requested.every(url=>url.includes('/assets/runtime/')));
  await loadImportedWeaponAssets();assert.equal(requested.length,FIREARM_KINDS.length,'repeated map entry should reuse downloads');
  setActiveMap('snow');const actor=new Simulation(42).state.player;
  for(const kind of FIREARM_KINDS){
   const view=createViewWeapon(kind),held=createHeldWeapon(kind),ground=createGroundWeapon(kind);
   for(const model of [view,held,ground])assert.equal(model.userData.assetSource,'sketchfab',`${kind}: context used fallback`);
   assert.notEqual(view.getObjectByName('magazine'),held.getObjectByName('magazine'));
   actor.weapon=kind;actor.shotTime=10;actor.guns[kind].reloadLeft=0;
   updateViewWeapon(view,actor,10.03,1/60);updateHeldWeapon(held,actor,10.03);
   assert.ok(view.userData.pose.recoil>0);
   updateViewWeapon(view,actor,10.25,1/60);updateHeldWeapon(held,actor,10.25);
   if(kind==='shotgun')assert.ok(view.getObjectByName('pump')!.position.z>.05);
   if(kind==='sniper')assert.ok(view.getObjectByName('bolt')!.position.z>.05);
   actor.guns[kind].ammo=0;
   for(const progress of [.2,.4,.6,.85,.93,.99]){
    actor.guns[kind].reloadLeft=WEAPONS[kind].reload*(1-progress);
    updateViewWeapon(view,actor,11+progress,1/60);updateHeldWeapon(held,actor,11+progress);
    for(const model of [view,held]){model.updateMatrixWorld(true);model.traverse(object=>assert.ok(object.matrixWorld.elements.every(Number.isFinite),`${kind}: animation generated a nonfinite transform`));}
   }
   for(const name of ['magazine','bolt','pump'])assert.equal(ground.getObjectByName(name)!.position.length(),0,`${kind}: animation leaked into ground clone`);
  }
  setActiveMap('desert');
  for(const kind of FIREARM_KINDS){
   assert.equal(weaponAssetSource(kind),'sketchfab');
   for(const create of [createViewWeapon,createHeldWeapon,createGroundWeapon])assert.equal(create(kind).userData.assetSource,'sketchfab');
  }
 }finally{loader.mock.restore();setActiveMap('desert');}
});

test('imported magazines move real vertices with a fixed hand contact and return exactly into the well',async()=>{
 setActiveMap('snow');
 try{
  const actor=new Simulation(72).state.player;actor.shotTime=-10;actor.moving=false;
  for(const kind of ['pistol','deagle','smg','m4','sniper'] as const){
   actor.weapon=kind;actor.guns[kind].ammo=0;
   const view=createViewWeapon(kind),r=view.userData.rig,pivot=r.pivot as THREE.Object3D;
   const vertices=(part:THREE.Object3D)=>{
    view.updateMatrixWorld(true);const points:THREE.Vector3[]=[];
    part.traverse(o=>{if(o instanceof THREE.Mesh){const p=o.geometry.getAttribute('position');for(let i=0;i<p.count;i++)points.push(pivot.worldToLocal(o.localToWorld(new THREE.Vector3().fromBufferAttribute(p,i))));}});return points;
   };
   actor.guns[kind].reloadLeft=0;updateViewWeapon(view,actor,20,0);
   const seated=vertices(r.magazine),body=view.getObjectByName('body')!,staticVertices=vertices(body);
   assert.ok(seated.length>100,`${kind}: animated magazine is empty`);
   let contact:THREE.Vector3|undefined;
   for(const p of [.18,.25,.38,.45,.53,.65,.72,.78]){
    actor.guns[kind].reloadLeft=WEAPONS[kind].reload*(1-p);updateViewWeapon(view,actor,20+p,0);
    const moving=vertices(r.magazine),fixed=vertices(body);
    for(let i=0;i<moving.length;i++)assert.ok(moving[i].clone().sub(seated[i]).distanceTo(r.magazine.position)<1e-6,`${kind}: visual mesh is detached from moving wrapper`);
    for(let i=0;i<fixed.length;i++)assert.ok(fixed[i].distanceTo(staticVertices[i])<1e-6,`${kind}: receiver moved with magazine`);
    const localContact=r.left.position.clone().sub(r.magazine.position);
    contact??=localContact.clone();assert.ok(localContact.distanceTo(contact)<1e-6,`${kind}: hand slides off magazine`);
    if(p===.38)assert.ok(moving[0].distanceTo(seated[0])>.15,`${kind}: magazine did not leave the well`);
   }
   actor.guns[kind].reloadLeft=0;updateViewWeapon(view,actor,22,0);
   vertices(r.magazine).forEach((v,i)=>assert.ok(v.distanceTo(seated[i])<1e-7,`${kind}: magazine does not seat exactly`));
  }
 }finally{setActiveMap('desert');}
});

test('Nova raises each shell through the actual port, feeds forward, then withdraws empty with no phase snap',async()=>{
 setActiveMap('snow');
 try{
  const actor=new Simulation(73).state.player;actor.weapon='shotgun';actor.shotTime=-10;actor.moving=false;
  for(const [ammo,reserve,count]of [[3,32,5],[0,32,8],[0,2,2],[7,32,1]]){
   actor.guns.shotgun.ammo=ammo;actor.guns.shotgun.reserve=reserve;
   const view=createViewWeapon('shotgun'),r=view.userData.rig,gate=view.getObjectByName('loading-gate')!;
   assert.ok(gate&&gate.children.length>0,'loading port has no moving carrier');
   const at=(p:number)=>{actor.guns.shotgun.reloadLeft=WEAPONS.shotgun.reload*(1-p);updateViewWeapon(view,actor,30+p,0);view.updateMatrixWorld(true);};
   at(.001);assert.equal(r.loadCount,count,'shell count differs from ammo actually available');
   for(let cycle=0;cycle<count;cycle++){
    const progress=(t:number)=>.15+.68*(cycle+t)/count;
    at(progress(.38));assert.equal(r.shell.visible,true);assert.ok(Math.abs(r.shell.position.x)<1e-6);assert.ok(r.shell.position.y<.03,'shell teleports inside before raising');
    at(progress(.54));assert.ok(r.shell.position.y>.04&&gate.position.y>.02,'carrier does not clear shell');
    // The complete shell lies inside the measured 29 x 70 mm port at lift.
    // Rotation of the presentation pivot enlarges world AABBs; use vertices.
    const pts:THREE.Vector3[]=[];r.shell.traverse((o:THREE.Object3D)=>{if(o instanceof THREE.Mesh){const a=o.geometry.getAttribute('position');for(let i=0;i<a.count;i++)pts.push(r.pivot.worldToLocal(o.localToWorld(new THREE.Vector3().fromBufferAttribute(a,i))));}});
    const bounds=new THREE.Box3().setFromPoints(pts);
    assert.ok(bounds.min.x>-.0146&&bounds.max.x<.0146&&bounds.min.z>-.1652&&bounds.max.z<-.0951,'shell misses loading aperture');
    let previousZ=r.shell.position.z;
    for(const t of [.58,.65,.72,.779]){at(progress(t));assert.ok(r.shell.visible);assert.ok(r.shell.position.z<previousZ,'shell reverses before fully entering tube');previousZ=r.shell.position.z;}
    assert.ok(r.shell.position.z+.029<-.167,'shell disappears before its brass head passes the mouth');
    at(progress(.781));assert.equal(r.shell.visible,false);
    at(progress(.88));assert.ok(r.left.position.y<-.06,'hand stays buried in receiver after release');
   }
   // Adjacent samples catch discontinuities that finite-transform tests miss.
   let last:THREE.Vector3|undefined;
   for(let i=0;i<=2000;i++){
    at(i/2001);if(last)assert.ok(r.left.position.distanceTo(last)<.024,`reload wrist snaps at ${i/2001}`);last=r.left.position.clone();
   }
   actor.guns.shotgun.reloadLeft=0;updateViewWeapon(view,actor,35,0);assert.equal(r.shell.visible,false);assert.equal(gate.position.y,0);assert.equal(r.pump.position.z,0);
  }
 }finally{setActiveMap('desert');}
});

// Full reloads must stay in a usable shoulder workspace. This catches a gun
// being rolled almost upside down or lifted away from the body despite a
// mathematically exact palm contact.
test('MP5 and Nova reloads stay shouldered with a restrained loading cant',()=>{
 const actor=new Simulation(731).state.player;actor.shotTime=-10;actor.moving=false;
 for(const kind of ['smg','shotgun'] as const){
  actor.weapon=kind;actor.guns[kind].ammo=0;
  const view=createViewWeapon(kind),r=view.userData.rig;
  actor.guns[kind].reloadLeft=0;updateViewWeapon(view,actor,40,0);view.updateMatrixWorld(true);
  const ready=r.right.getWorldPosition(new THREE.Vector3());
  for(let i=0;i<=240;i++){
   actor.guns[kind].reloadLeft=WEAPONS[kind].reload*(1-i/240);updateViewWeapon(view,actor,41+i/240,0);view.updateMatrixWorld(true);
   assert.ok(r.right.getWorldPosition(new THREE.Vector3()).distanceTo(ready)<.13,kind+' moves the firing grip away from the shoulder');
   assert.ok(Math.abs(r.pivot.rotation.z)<Math.PI/3,kind+' overturns the gun during reload');
   assert.ok(Math.abs(r.pivot.rotation.y)<Math.PI/4,kind+' swings the muzzle sideways during reload');
  }
 }
});
