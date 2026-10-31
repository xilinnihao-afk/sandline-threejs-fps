import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createKnifeModel,loadKnifeAsset,knifeAssetSource} from '../src/render/knifeModel';
import {createViewWeapon,createHeldWeapon,createGroundWeapon,updateViewWeapon,updateHeldWeapon} from '../src/render/weapons';
import {Simulation} from '../src/game/simulation';
import {MELEE_ATTACKS} from '../src/game/melee';
import type {MeleeAttack} from '../src/game/types';

const project=new URL('../',import.meta.url);
const report=JSON.parse(fs.readFileSync(new URL('artifacts/classic-knife-20261026/asset-preparation.json',project),'utf8'));
function readGlb(path:string){
 const bytes=fs.readFileSync(new URL(path,project));
 assert.equal(bytes.readUInt32LE(0),0x46546c67);assert.equal(bytes.readUInt32LE(4),2);assert.equal(bytes.readUInt32LE(8),bytes.length);
 const length=bytes.readUInt32LE(12),doc=JSON.parse(bytes.subarray(20,20+length).toString());
 return {bytes,doc,binary:bytes.subarray(28+length)};
}
function values(glb:ReturnType<typeof readGlb>,index:number):number[][]{
 const a=glb.doc.accessors[index],v=glb.doc.bufferViews[a.bufferView];
 const components=({SCALAR:1,VEC2:2,VEC3:3,VEC4:4} as Record<string,number>)[a.type],width=a.componentType===5123?2:4;
 return Array.from({length:a.count},(_,i)=>Array.from({length:components},(_,c)=>{
  const offset=(v.byteOffset??0)+(a.byteOffset??0)+i*(v.byteStride??components*width)+c*width;
  return a.componentType===5126?glb.binary.readFloatLE(offset):a.componentType===5123?glb.binary.readUInt16LE(offset):glb.binary.readUInt32LE(offset);
 }));
}
let parsed:Promise<THREE.Group>|undefined;
function readKnife():Promise<THREE.Group>{
 return parsed??=(async()=>{
  const {doc,binary}=readGlb('public/assets/runtime/classic-knife.glb');
  // Browser verification owns texture decoding. Preserve material factors and
  // source geometry here, removing only decoder-dependent references.
  const removeTextureRefs=(value:any):void=>{if(!value||typeof value!=='object')return;for(const key of Object.keys(value)){if(key.endsWith('Texture'))delete value[key];else removeTextureRefs(value[key]);}};
  doc.materials.forEach(removeTextureRefs);delete doc.images;delete doc.textures;delete doc.extensionsRequired;delete doc.extensionsUsed;
  doc.buffers[0].uri='data:application/octet-stream;base64,'+binary.toString('base64');
  (globalThis as any).ProgressEvent??=class{};
  return (await new GLTFLoader().parseAsync(JSON.stringify(doc),'')).scene;
 })();
}
async function installKnife(t:TestContext){
 const calls:string[]=[];
 const loader=t.mock.method(GLTFLoader.prototype,'loadAsync',async(url:string)=>{calls.push(url);return {scene:(await readKnife()).clone(true)};});
 try{
  const first=loadKnifeAsset(),second=loadKnifeAsset();assert.equal(first,second,'concurrent loads must reuse one request');
  await Promise.all([first,second]);await loadKnifeAsset();
  assert.deepEqual(calls,['/assets/runtime/classic-knife.glb']);
 }finally{loader.mock.restore();}
}

test('classic knife retains the supplied binary geometry, image, PBR and provenance exactly',()=>{
 const source=readGlb(report.source),runtime=readGlb('public/assets/runtime/classic-knife.glb');
 assert.equal(createHash('sha256').update(source.bytes).digest('hex'),report.sourceSha256);
 assert.equal(createHash('sha256').update(runtime.bytes).digest('hex'),report.sha256);
 assert.ok(runtime.bytes.length<200*1024);
 assert.equal(fs.existsSync(new URL('public/assets/runtime/m9-bayonet.glb',project)),false,'retired knife stays outside new runtime graph');
 assert.deepEqual(runtime.doc.asset.extras,source.doc.asset.extras);
 for(const field of ['meshes','accessors','bufferViews','materials','images','textures','samplers'])
  assert.deepEqual(runtime.doc[field],source.doc[field],field+' must preserve the source definitions');
 assert.deepEqual(runtime.binary,source.binary,'original vertices, winding, UVs, normals and PNG remain byte-exact');
 assert.equal(runtime.doc.meshes.length,3);assert.equal(runtime.doc.materials.length,3);assert.equal(runtime.doc.images.length,1);
 assert.equal(runtime.doc.skins,undefined);assert.equal(runtime.doc.animations,undefined);
 assert.equal(runtime.doc.buffers[0].uri,undefined);
 const image=runtime.doc.images[0],view=runtime.doc.bufferViews[image.bufferView],offset=view.byteOffset??0;
 assert.equal(image.uri,undefined);assert.equal(image.mimeType,'image/png');
 assert.equal(createHash('sha256').update(runtime.binary.subarray(offset,offset+view.byteLength)).digest('hex'),report.images[0].sha256);
 assert.deepEqual(report.images[0].size,[1024,512]);
 let triangles=0,vertices=0;
 for(const mesh of runtime.doc.meshes)for(const primitive of mesh.primitives){
  triangles+=values(runtime,primitive.indices).length/3;vertices+=values(runtime,primitive.attributes.POSITION).length;
 }
 assert.equal(triangles,402);assert.equal(vertices,628);
 const normalization=new THREE.Matrix4().fromArray(report.normalization.sourceVertexToRuntime);
 const bounds=new THREE.Box3();
 for(const mesh of runtime.doc.meshes)for(const primitive of mesh.primitives)
  for(const point of values(runtime,primitive.attributes.POSITION))bounds.expandByPoint(new THREE.Vector3().fromArray(point).applyMatrix4(normalization));
 assert.ok(bounds.min.distanceTo(new THREE.Vector3().fromArray(report.bounds.min))<1e-8);
 assert.ok(bounds.max.distanceTo(new THREE.Vector3().fromArray(report.bounds.max))<1e-8);
 assert.ok(normalization.determinant()>0,'normalization must preserve triangle winding');
});

test('classic knife download failure retries without instantiating an obsolete knife',async t=>{
 const failure=t.mock.method(GLTFLoader.prototype,'loadAsync',async()=>{throw new Error('simulated classic knife download failure');});
 try{await assert.rejects(loadKnifeAsset(),/simulated classic knife/);}finally{failure.mock.restore();}
 assert.equal(knifeAssetSource(),'classic-knife-pending');
 const pending=createKnifeModel();let meshes=0;pending.traverse(o=>{if(o instanceof THREE.Mesh)meshes++;});assert.equal(meshes,0);
 for(const name of ['muzzle','magazine','bolt','pump','eject'])assert.ok(pending.getObjectByName(name));
 await installKnife(t);assert.equal(knifeAssetSource(),'classic-knife-glb');
});

test('runtime classic knife has a real enclosing handle, upward blade and independent view/held/ground instances',()=>{
 const model=createKnifeModel();model.updateMatrixWorld(true);
 const bounds=new THREE.Box3().setFromObject(model),size=bounds.getSize(new THREE.Vector3());
 assert.ok(Math.abs(size.y-.32)<2e-8);assert.ok(size.x>.053&&size.x<.055&&size.z>.012&&size.z<.013);
 let mesh!:THREE.Mesh;model.traverse(o=>{if(o instanceof THREE.Mesh&&!mesh)mesh=o;});assert.ok(mesh instanceof THREE.Mesh);
 let triangles=0;model.traverse(o=>{if(o instanceof THREE.Mesh)triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;});assert.equal(triangles,402);
 const handle=model.userData.measurements.handle;
 assert.ok(Math.abs(handle.dimensions[1]-.10279682266154366)<1e-8);
 for(const y of [-.009,0,.009])for(const direction of [new THREE.Vector3(1,0,0),new THREE.Vector3(-1,0,0),new THREE.Vector3(0,0,1),new THREE.Vector3(0,0,-1)]){
  const hits=new THREE.Raycaster(new THREE.Vector3(0,y,0),direction,0,.03).intersectObject(model,true);
  const expected=direction.z? [.004,.005]:[.010,.014];
  assert.ok(hits.length>0&&hits[0].distance>expected[0]&&hits[0].distance<expected[1],'grip origin is enclosed by actual classic knife handle surface');
 }
 const tip=model.getObjectByName('muzzle')!.getWorldPosition(new THREE.Vector3());
 assert.ok(Math.abs(tip.y-bounds.max.y)<2e-8&&Math.abs(tip.x-(-.013600776368388322))<1e-8&&Math.abs(tip.z)<1e-8);
 assert.ok(model.getObjectByName('guard')!.position.y>.054&&model.getObjectByName('guard')!.position.y<.055);
 assert.ok(model.userData.measurements.blade.bounds.min[1]>.057);
 const view=createViewWeapon('knife'),held=createHeldWeapon('knife'),ground=createGroundWeapon('knife');
 for(const context of [view,held,ground])assert.equal(context.userData.assetSource,'classic-knife-glb');
 const meshes=[view,held,ground].map(context=>context.getObjectByName(mesh.name) as THREE.Mesh);
 assert.notEqual(meshes[0],meshes[1]);assert.notEqual(meshes[1],meshes[2]);
 for(const copy of meshes){assert.equal(copy.geometry,mesh.geometry);assert.equal(copy.material,mesh.material);}
 const originalX=meshes[1].position.x;meshes[0].position.x=.1;assert.equal(meshes[1].position.x,originalX);assert.equal(meshes[2].position.x,originalX);
});

test('classic knife slash and stab share contact timing, stay distinct, freeze and recover continuously',()=>{
 assert.equal(knifeAssetSource(),'classic-knife-glb');
 const actor=new Simulation(91).state.player;actor.weapon='knife';actor.moving=false;actor.shotTime=-10;
 const contacts=new Map<MeleeAttack,{position:THREE.Vector3;rotation:THREE.Quaternion}>();
 for(const attack of ['slash','stab'] as const){
  const spec=MELEE_ATTACKS[attack],view=createViewWeapon('knife'),held=createHeldWeapon('knife');
  actor.meleeAttack=attack;actor.shotTime=-10;updateViewWeapon(view,actor,10,0);updateHeldWeapon(held,actor,10);
  const pivot=view.getObjectByName('weapon-pivot')!,heldPivot=held.getObjectByName('weapon-pivot')!;
  const readyPosition=pivot.position.clone(),readyRotation=pivot.quaternion.clone(),heldReady=heldPivot.position.clone(),heldReadyRotation=heldPivot.quaternion.clone();
  actor.shotTime=10;updateViewWeapon(view,actor,10+spec.contactDelay+1e-6,1/60);
  assert.equal(view.userData.pose.phase,attack);assert.equal(view.userData.pose.attack,attack);
  assert.ok(pivot.position.distanceTo(readyPosition)>.2);assert.ok(pivot.quaternion.angleTo(readyRotation)>.7);
  assert.deepEqual(heldPivot.position.toArray(),heldReady.toArray(),'view animation must not alter held pose');
  contacts.set(attack,{position:pivot.position.clone(),rotation:pivot.quaternion.clone()});
  updateHeldWeapon(held,actor,10+spec.contactDelay+1e-6);
  for(const group of [view,held]){
   const p=group.getObjectByName('weapon-pivot')!;p.updateMatrix();const frozen=p.matrix.toArray();
   for(let frame=0;frame<10;frame++){if(group===view)updateViewWeapon(group,actor,10+spec.contactDelay+1e-6,0);else updateHeldWeapon(group,actor,10+spec.contactDelay+1e-6);p.updateMatrix();assert.deepEqual(p.matrix.toArray(),frozen);}
  }
  const previous=new Map<THREE.Group,{position:THREE.Vector3;rotation:THREE.Quaternion}>();
  for(let frame=0;frame<=Math.ceil((spec.interval+.05)*120);frame++){
   const time=10+frame/120;updateViewWeapon(view,actor,time,1/120);updateHeldWeapon(held,actor,time);
   for(const group of [view,held]){
    const p=group.getObjectByName('weapon-pivot')!,last=previous.get(group);
    if(last){assert.ok(p.position.distanceTo(last.position)<.06,'no translation snap at windup/contact/recovery boundary');assert.ok(p.quaternion.angleTo(last.rotation)<.2,'no rotation snap at phase boundary');}
    previous.set(group,{position:p.position.clone(),rotation:p.quaternion.clone()});
    group.updateMatrixWorld(true);group.traverse(o=>assert.ok(o.matrixWorld.elements.every(Number.isFinite)));assert.equal(group.userData.rig.shell.visible,false);
   }
  }
  assert.equal(view.userData.pose.phase,'ready');assert.equal(held.userData.pose.phase,'ready');
  // The view wrist is intentionally straighter; third-person actors retain
  // their authored ready pose. Each must recover exactly to its own baseline.
  for(const [p,position,rotation] of [[pivot,readyPosition,readyRotation],[heldPivot,heldReady,heldReadyRotation]] as const){
   assert.ok(p.position.distanceTo(position)<1e-10);assert.ok(p.quaternion.angleTo(rotation)<1e-7);
  }
 }
 const slash=contacts.get('slash')!,stab=contacts.get('stab')!;
 assert.ok(stab.position.z<slash.position.z-.1,'stab extends farther forward');
 assert.ok(slash.position.x<stab.position.x-.05,'slash sweeps farther laterally');
 assert.ok(stab.rotation.angleTo(slash.rotation)>1,'stab and slash have visibly different blade orientation');
});
