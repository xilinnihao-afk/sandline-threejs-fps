import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {SOLDIER_MODELS} from '../src/render/soldierRoster';
function glb(path:string){
 const bytes=readFileSync(path),length=bytes.readUInt32LE(12);
 assert.equal(bytes.readUInt32LE(8),bytes.length);
 return {doc:JSON.parse(bytes.subarray(20,20+length).toString()),bin:bytes.subarray(28+length)};
}
test('texture-only mobile derivatives preserve every geometry, rig, animation and contact byte',()=>{
 const manifest=JSON.parse(readFileSync('public/assets/runtime/manifest.json','utf8'));
 // M4 and Desert Eagle also normalize source structure; their geometry and
 // articulation have dedicated tests instead of the texture-only byte check.
 for(const file of manifest.files.filter((file:any)=>!['m4.glb','deagle.glb'].includes(file.file))){
  const original=glb(file.source),mobile=glb('public/assets/runtime/'+file.file);
  for(const key of ['nodes','meshes','skins','animations','accessors','scenes'])assert.deepEqual(mobile.doc[key],original.doc[key],`${file.file}: changed ${key}`);
  const images=new Set((original.doc.images??[]).map((i:any)=>i.bufferView));
  original.doc.bufferViews.forEach((view:any,i:number)=>{
   if(images.has(i))return;const replacement=mobile.doc.bufferViews[i];
   assert.equal(replacement.byteLength,view.byteLength);
   assert.deepEqual(mobile.bin.subarray(replacement.byteOffset??0,(replacement.byteOffset??0)+replacement.byteLength),original.bin.subarray(view.byteOffset??0,(view.byteOffset??0)+view.byteLength),`${file.file}: changed binary view ${i}`);
  });
  if(images.size){
   assert.ok(mobile.doc.extensionsRequired.includes('EXT_texture_webp'));
   assert.ok(file.after<file.before*.9,`${file.file}: no material transfer reduction`);
  }else assert.deepEqual(mobile,original,`${file.file}: untextured asset must remain exact`);
 }
});

test('the public asset graph contains only the current characters, weapons and shared Dust2 arms',()=>{
 const manifest=JSON.parse(readFileSync('public/assets/runtime/manifest.json','utf8'));
 assert.deepEqual(manifest.files.map((file:any)=>file.file).sort(),['deagle.glb','m4.glb','pistol.glb','rifle.glb','shotgun.glb','smg.glb','sniper.glb']);
 assert.deepEqual(readdirSync('public/assets/runtime').filter(file=>file.endsWith('.glb')).sort(),
  [...manifest.files.map((file:any)=>file.file),'cs16-ak47.glb','cs16-arms-rigged.glb','classic-knife.glb'].sort());
 assert.deepEqual(readdirSync('public/assets/characters').filter(file=>file.endsWith('.glb')).sort(),
  ['locomotion.glb',...SOLDIER_MODELS.map(model=>model.file)].sort());
 assert.equal(existsSync('public/assets/player'),false,'retired arms and texture sources must not ship');
 assert.equal(existsSync('public/assets/weapons'),false,'authoring originals must remain outside the browser asset graph');
 for(const file of manifest.files){
  assert.ok(file.source.startsWith('assets-source/'),'runtime provenance must resolve to non-public sources');
  const bytes=readFileSync('public/assets/runtime/'+file.file);
  assert.equal(bytes.length,file.after);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256,`${file.file}: manifest hash is stale`);
  if(file.sourceSha256)assert.equal(createHash('sha256').update(readFileSync(file.source)).digest('hex'),file.sourceSha256);
  const {doc}=glb('public/assets/runtime/'+file.file);
  assert.ok((doc.buffers??[]).every((buffer:any)=>!buffer.uri),'runtime buffers must be embedded');
  assert.ok((doc.images??[]).every((image:any)=>!image.uri),'runtime textures must be embedded');
 }
});
