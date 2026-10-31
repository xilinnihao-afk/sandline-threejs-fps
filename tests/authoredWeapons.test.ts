import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {inflateSync} from 'node:zlib';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

// Blender can silently zero a generated image when changing its color space
// after writing pixels. Catch that in the actual exported ORM green channel.
function pngChannels(bytes:Buffer) {
 let at=8,width=0,height=0,channels=0;const chunks:Buffer[]=[];
 while(at<bytes.length){const n=bytes.readUInt32BE(at),kind=bytes.toString('ascii',at+4,at+8),data=bytes.subarray(at+8,at+8+n);
  if(kind==='IHDR'){width=data.readUInt32BE(0);height=data.readUInt32BE(4);assert.equal(data[8],8);channels=data[9]===2?3:data[9]===6?4:0;assert.ok(channels,'ORM must be RGB or RGBA');}
  if(kind==='IDAT')chunks.push(data);at+=12+n;
 }
 const raw=inflateSync(Buffer.concat(chunks)),stride=width*channels;let prev=new Uint8Array(stride),offset=0;
 const stats=Array.from({length:3},()=>({min:255,max:0,mean:0}));
 for(let y=0;y<height;y++){
  const filter=raw[offset++],row=new Uint8Array(stride);
  for(let x=0;x<stride;x++){
   const a=x>=channels?row[x-channels]:0,b=prev[x],c=x>=channels?prev[x-channels]:0;
   let predictor=0;
   if(filter===1)predictor=a;else if(filter===2)predictor=b;else if(filter===3)predictor=Math.floor((a+b)/2);
   else if(filter===4){const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);predictor=pa<=pb&&pa<=pc?a:pb<=pc?b:c;}
   else assert.equal(filter,0);
   row[x]=(raw[offset++]+predictor)&255;
   const channel=x%channels;
   if(channel<3){const s=stats[channel];s.min=Math.min(s.min,row[x]);s.max=Math.max(s.max,row[x]);s.mean+=row[x]/(width*height);}
  }
  prev=row;
 }
 return stats;
}

// Parse shipped geometry rather than procedural fallbacks. Textures are checked
// for embedded payloads and data-channel correctness; appearance needs browser QA.
async function readWeapon(kind:string){
 const data=fs.readFileSync(new URL(`../assets-source/retired-20261023/assets/weapons/authored/${kind}.glb`,import.meta.url));
 assert.equal(data.readUInt32LE(0),0x46546c67);
 const jsonLength=data.readUInt32LE(12),doc=JSON.parse(data.subarray(20,20+jsonLength).toString());
 const binaryAt=20+jsonLength,binary=data.subarray(binaryAt+8,binaryAt+8+data.readUInt32LE(binaryAt));
 for(const image of doc.images??[]){assert.equal(typeof image.bufferView,'number',`${kind}: texture must ship in GLB`);const view=doc.bufferViews[image.bufferView];assert.ok(view.byteLength>100&&view.byteOffset+view.byteLength<=binary.length,`${kind}: truncated texture`);}
 for(const material of doc.materials??[]){
  const normalIndex=material.normalTexture?.index;
  if(normalIndex!==undefined){
   const image=doc.images[doc.textures[normalIndex].source],view=doc.bufferViews[image.bufferView];
   assert.equal(image.mimeType,'image/png',`${kind}: normals must retain lossless data`);
   const normal=pngChannels(binary.subarray(view.byteOffset,view.byteOffset+view.byteLength));
   // A neutral tangent normal is (128,128,255). An accidental sRGB conversion
   // moves XY towards 188 or 55 and bends the entire surface's lighting.
   for(const axis of [0,1])assert.ok(Math.abs(normal[axis].mean-128)<16,`${kind}: ${material.name} normal data has a color-space bias`);
   assert.ok(normal[2].min>=128&&normal[2].mean>220,`${kind}: ${material.name} has invalid or excessive normal relief`);
  }
  const index=material.pbrMetallicRoughness?.metallicRoughnessTexture?.index;if(index===undefined)continue;
  const image=doc.images[doc.textures[index].source],view=doc.bufferViews[image.bufferView];
  if(image.mimeType==='image/png')assert.ok(pngChannels(binary.subarray(view.byteOffset,view.byteOffset+view.byteLength))[1].max>16,`${kind}: ${material.name} exported a zero roughness texture`);
 }
 doc.buffers[0].uri='data:application/octet-stream;base64,'+binary.toString('base64');
 doc.materials=(doc.materials??[{}]).map(()=>({}));delete doc.images;delete doc.textures;
 (globalThis as any).ProgressEvent??=class{};
 return (await new GLTFLoader().parseAsync(JSON.stringify(doc),'')).scene;
}

test('archived authored weapon sources have usable scale, finite geometry and articulated parts',async()=>{
 const metrics=[];
 // This archive predates the imported Desert Eagle; test only its six sources.
 for(const kind of ['rifle','pistol','smg','shotgun','m4','sniper']){
  const model=await readWeapon(kind);model.updateMatrixWorld(true);
  const size=new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  assert.ok(size.toArray().every(Number.isFinite),`${kind}: nonfinite bounds`);
  assert.ok(size.z>.15&&size.z<1.55,`${kind}: incorrect forward axis or length ${size.z}`);
  assert.ok(size.x>.02&&size.x<.3,`${kind}: excessive body width ${size.x}`);
  let triangles=0;
  model.traverse(o=>{if(o instanceof THREE.Mesh){const p=o.geometry.getAttribute('position');for(let i=0;i<p.count;i++)assert.ok(Number.isFinite(p.getX(i)+p.getY(i)+p.getZ(i)),`${kind}: invalid vertex`);triangles+=(o.geometry.index?.count??p.count)/3;}});
  assert.ok(triangles>500&&triangles<60000,`${kind}: unexpected topology budget ${triangles}`);
  for(const name of ['magazine','bolt',...(kind==='shotgun'?['pump']:[])]){
   const part=model.getObjectByName(name);assert.ok(part,`${kind}: missing animated ${name}`);
   assert.ok(part.position.length()<1e-6&&part.quaternion.angleTo(new THREE.Quaternion())<1e-6&&part.scale.distanceTo(new THREE.Vector3(1,1,1))<1e-6,`${kind}: ${name} has an unexpected bind transform`);
  }
  metrics.push({kind,triangles,length:+size.z.toFixed(3),width:+size.x.toFixed(3)});
 }
 console.log('AUTHORED_WEAPON_GEOMETRY',JSON.stringify(metrics));
});
