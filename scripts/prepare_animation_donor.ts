/** Strip the obsolete donor body/textures; retain only skeleton and required clips. */
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import {loadCPU} from '../tests/loadCharacterFixture';
const source=process.argv[2];if(!source)throw new Error('Pass the source soldier.gltf path');
const input=await loadCPU(source),mixer=new THREE.AnimationMixer(input.scene);
mixer.clipAction(input.animations.find(c=>c.name==='TPose')!).play();mixer.update(0);input.scene.updateMatrixWorld(true);
const height=new THREE.Box3().setFromObject(input.scene).getSize(new THREE.Vector3()).y;
const doc=JSON.parse(fs.readFileSync(source,'utf8')),binary=fs.readFileSync(path.join(path.dirname(source),doc.buffers[0].uri));
doc.animations=doc.animations.filter((a:any)=>['TPose','Idle','Walk','Run'].includes(a.name));
for(const n of doc.nodes){delete n.mesh;delete n.skin;delete n.weights;}
for(const s of doc.scenes)s.extras={...s.extras,animationDonorHeight:height};
for(const key of ['meshes','materials','textures','images','samplers','extensionsUsed','extensionsRequired'])delete doc[key];
const indices=new Set<number>();
for(const a of doc.animations)for(const s of a.samplers){indices.add(s.input);indices.add(s.output);}
for(const s of doc.skins)if(s.inverseBindMatrices!==undefined)indices.add(s.inverseBindMatrices);
const accessors=[...indices],accessorMap=new Map(accessors.map((old,i)=>[old,i]));
const views=[...new Set(accessors.map(i=>doc.accessors[i].bufferView))] as number[],viewMap=new Map(views.map((old,i)=>[old,i]));
const chunks:Buffer[]=[];let offset=0;
const bufferViews=views.map(i=>{const old=doc.bufferViews[i];const padding=Buffer.alloc((-offset)&3);chunks.push(padding);offset+=padding.length;const bytes=binary.subarray(old.byteOffset??0,(old.byteOffset??0)+old.byteLength);const view={buffer:0,byteOffset:offset,byteLength:bytes.length};chunks.push(bytes);offset+=bytes.length;return view;});
doc.accessors=accessors.map(i=>({...doc.accessors[i],bufferView:viewMap.get(doc.accessors[i].bufferView)}));doc.bufferViews=bufferViews;
for(const a of doc.animations)for(const s of a.samplers){s.input=accessorMap.get(s.input);s.output=accessorMap.get(s.output);}
for(const s of doc.skins)if(s.inverseBindMatrices!==undefined)s.inverseBindMatrices=accessorMap.get(s.inverseBindMatrices);
chunks.push(Buffer.alloc((-offset)&3));const bin=Buffer.concat(chunks);doc.buffers=[{byteLength:bin.length}];
const json=Buffer.from(JSON.stringify(doc)),meta=Buffer.concat([json,Buffer.alloc((-json.length)&3,32)]),header=Buffer.alloc(20),binHeader=Buffer.alloc(8);
[0x46546c67,2,28+meta.length+bin.length,meta.length,0x4e4f534a].forEach((v,i)=>header.writeUInt32LE(v,i*4));binHeader.writeUInt32LE(bin.length);binHeader.writeUInt32LE(0x004e4942,4);
const out=Buffer.concat([header,meta,binHeader,bin]);fs.writeFileSync('public/assets/characters/locomotion.glb',out);console.log({bytes:out.length,height});
