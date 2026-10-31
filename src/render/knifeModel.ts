import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

let importedTemplate:THREE.Group|undefined;
let importPromise:Promise<void>|undefined;

export function knifeAssetSource():string {
 return importedTemplate?'classic-knife-glb':'classic-knife-pending';
}

/** One embedded asset serves view, held and ground contexts. Immutable geometry,
 * textures and PBR materials are shared; each instance owns its transforms. */
export function loadKnifeAsset(anisotropy=1):Promise<void> {
 return importPromise??=(async()=>{
  const gltf=await new GLTFLoader().loadAsync(`${import.meta.env?.BASE_URL??'/'}assets/runtime/classic-knife.glb`);
  const model=gltf.scene,source=model.getObjectByName('classic-knife');
  model.name='classic-knife-knife';
  model.userData={...model.userData,...source?.userData,assetSource:'classic-knife-glb',assetKind:'knife'};
  const textureAnisotropy=Number.isFinite(anisotropy)?Math.max(1,Math.min(4,anisotropy)):1;
  model.traverse(o=>{
   if(!(o instanceof THREE.Mesh))return;
   o.castShadow=o.receiveShadow=true;
   for(const m of Array.isArray(o.material)?o.material:[o.material])if(m instanceof THREE.MeshStandardMaterial){
    for(const t of [m.map,m.normalMap,m.roughnessMap,m.metalnessMap,m.aoMap])if(t)t.anisotropy=textureAnisotropy;
   }
  });
  importedTemplate=model;
 })().catch(error=>{importPromise=undefined;throw error;});
}

/** Startup preloads the classic knife before constructing gameplay. A caller constructing
 * a rig earlier receives sockets only, never retired or substitute geometry. */
export function createKnifeModel():THREE.Group {
 if(importedTemplate)return importedTemplate.clone(true);
 const pending=new THREE.Group();pending.name='classic-knife-pending';
 pending.userData={assetSource:'classic-knife-pending',assetKind:'knife'};
 for(const name of ['muzzle','magazine','bolt','pump','eject']){
  const socket=new THREE.Group();socket.name=name;pending.add(socket);
 }
 return pending;
}
