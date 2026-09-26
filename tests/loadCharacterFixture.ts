import fs from 'node:fs';
import path from 'node:path';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
export async function loadCPU(file:string){
 const b=fs.readFileSync(file);let json:any;
 if(file.endsWith('.glb')){const length=b.readUInt32LE(12);json=JSON.parse(b.subarray(20,20+length).toString());json.buffers[0].uri='data:application/octet-stream;base64,'+b.subarray(28+length).toString('base64');}
 else {json=JSON.parse(b.toString());for(const buffer of json.buffers)buffer.uri='data:application/octet-stream;base64,'+fs.readFileSync(path.join(path.dirname(file),buffer.uri)).toString('base64');}
 json.materials=[{}];for(const mesh of json.meshes)for(const p of mesh.primitives)p.material=0;
 delete json.images;delete json.textures;delete json.extensionsRequired;delete json.extensionsUsed;
 (globalThis as any).ProgressEvent??=class{};
 return new GLTFLoader().parseAsync(JSON.stringify(json),'');
}
