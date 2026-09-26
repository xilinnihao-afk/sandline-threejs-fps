// @ts-nocheck
import test from 'node:test';import assert from 'node:assert/strict';import {detachRifleMagazine} from '../src/render/rifleMagazine';import fs from 'node:fs';import * as T from 'three';import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
const b=fs.readFileSync('public/assets/weapons/ss2-v5_a1_kal.5.56_mm_pindad.glb'),len=b.readUInt32LE(12),j=JSON.parse(b.subarray(20,20+len));const at=20+len;j.buffers[0].uri='data:application/octet-stream;base64,'+b.subarray(at+8,at+8+b.readUInt32LE(at)).toString('base64');j.materials=[{}];for(const m of j.meshes)for(const p of m.primitives)p.material=0;delete j.textures;delete j.images;delete j.extensionsUsed;delete j.extensionsRequired;globalThis.ProgressEvent=class{};const {scene:s}=await new GLTFLoader().parseAsync(JSON.stringify(j),'');const root=s.getObjectByName('RootNode');for(const c of [...root.children])if(!/Magazine_Low\.?001$/.test(c.name))root.remove(c);s.rotation.y=-Math.PI/2;s.updateMatrixWorld(true);const box=new T.Box3().setFromObject(s),scale=.76/box.getSize(new T.Vector3()).z;s.scale.multiplyScalar(scale);s.position.addScaledVector(box.getCenter(new T.Vector3()),-scale);s.updateMatrixWorld(true);

test('actual SS2 magazine moves once while body keeps the remaining triangles',()=>{
 const normalized=new T.Group();normalized.add(s);normalized.updateMatrixWorld(true);
 const count=()=>{let n=0;normalized.traverse(o=>{if(o.isMesh)n+=o.geometry.index.count;});return n;};const before=count();
 const magazine=detachRifleMagazine(normalized);assert.equal(magazine.children.length,1);assert.equal(count(),before);
 const mesh=magazine.children[0];assert.ok(mesh.geometry.index.count>100);const body=normalized.getObjectByName('Magazine_Low001_SS2_0');
 const used=new Set(Array.from(body.geometry.index.array));for(const id of mesh.geometry.index.array)assert.ok(!used.has(id));
 const at=new T.Box3().setFromObject(magazine);magazine.position.y=-.245;normalized.updateMatrixWorld(true);const moved=new T.Box3().setFromObject(magazine);assert.ok(Math.abs(moved.min.y-at.min.y+.245)<1e-6);
});
