import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import worldLod from '../generated/world-lod';
import {geometryFingerprint} from './worldFingerprint';

type RenderRoot=THREE.Object3D;
type Resources={geometries:Set<THREE.BufferGeometry>;materials:Set<THREE.Material>;textures:Set<THREE.Texture>};
export interface RenderBudget {
 drawCallsUpperBound:number;
 trianglesUpperBound:number;
 geometries:number;
 geometryBytes:number;
 materials:number;
 textures:number;
 textureBytesEstimate:number;
 maximumTextureEdge:number;
}
export interface DisposalReport {maps:number;geometries:number;materials:number;textures:number;textureBytesEstimate:number;}
const resourceSet=():Resources=>({geometries:new Set(),materials:new Set(),textures:new Set()});
function collect(roots:Iterable<RenderRoot>):Resources {
 const resources=resourceSet();
 const texture=(value:unknown)=>{if(value instanceof THREE.Texture)resources.textures.add(value);};
 for(const root of roots){
  root.traverse(object=>{
   const mesh=object as THREE.Mesh;
   if(mesh.geometry instanceof THREE.BufferGeometry)resources.geometries.add(mesh.geometry);
   for(const geometry of Object.values(object.userData.staticMapLods||{}))if(geometry instanceof THREE.BufferGeometry)resources.geometries.add(geometry);
   if(mesh.material){
    const list=Array.isArray(mesh.material)?mesh.material:[mesh.material];
    for(const material of list){
     resources.materials.add(material);
     for(const value of Object.values(material))texture(value);
     if(material instanceof THREE.ShaderMaterial)for(const uniform of Object.values(material.uniforms)){
      if(Array.isArray(uniform.value))uniform.value.forEach(texture);else texture(uniform.value);
     }
    }
   }
   if(object instanceof THREE.Scene){texture(object.background);texture(object.environment);}
   // GoldSrc skies belong to their map, even when currently assigned to Scene.background.
   texture(object.userData.sky);
  });
 }
 return resources;
}
function imageSize(image:any):[number,number] {
 return [Number(image?.naturalWidth||image?.videoWidth||image?.width||image?.image?.width)||0,
  Number(image?.naturalHeight||image?.videoHeight||image?.height||image?.image?.height)||0];
}
function textureInfo(texture:THREE.Texture){
 const source=texture.image,faces=Array.isArray(source)?source:[source];
 const channelBytes=texture.type===THREE.FloatType?4:texture.type===THREE.HalfFloatType?2:1;
 let bytes=0,edge=0;
 for(const face of faces){const [w,h]=imageSize(face);bytes+=w*h*4*channelBytes;edge=Math.max(edge,w,h);}
 return {bytes:Math.ceil(bytes*(texture.generateMipmaps?4/3:1)),edge};
}

/** Static upper bounds and allocated resource estimates, not measured FPS/VRAM.
 * Visible geometry is counted before camera-frustum and depth culling. Hidden
 * allocated assets still contribute to geometry/texture memory estimates.
 */
export function inspectRenderBudget(roots:Iterable<RenderRoot>):RenderBudget {
 const rootList=[...roots],resources=collect(rootList),buffers=new Set<ArrayBufferLike>();
 let drawCalls=0,triangles=0,geometryBytes=0,textureBytes=0,maximumTextureEdge=0;
 for(const geometry of resources.geometries){
  for(const attribute of [...Object.values(geometry.attributes),...(geometry.index?[geometry.index]:[])]){
   const array=attribute instanceof THREE.InterleavedBufferAttribute?attribute.data.array:attribute.array;
   if(!buffers.has(array.buffer)){buffers.add(array.buffer);geometryBytes+=array.buffer.byteLength;}
  }
 }
 const visited=new Set<THREE.Object3D>();
 for(const root of rootList)root.traverseVisible(object=>{
  if(visited.has(object))return;visited.add(object);
  if(!(object instanceof THREE.Mesh))return;
  const count=object.geometry.index?.count??object.geometry.getAttribute('position')?.count??0;
  const instances=object instanceof THREE.InstancedMesh?object.count:1;
  const drawCount=Math.max(0,Math.min(count-object.geometry.drawRange.start,object.geometry.drawRange.count));
  if(Array.isArray(object.material)){
   for(const group of object.geometry.groups){if(!object.material[group.materialIndex??0]?.visible)continue;
    const start=Math.max(group.start,object.geometry.drawRange.start),end=Math.min(group.start+group.count,object.geometry.drawRange.start+drawCount);
    if(end>start){drawCalls++;triangles+=(end-start)/3*instances;}
   }
  }else if(object.material.visible&&drawCount>0){drawCalls++;triangles+=drawCount/3*instances;}
 });
 for(const texture of resources.textures){const info=textureInfo(texture);textureBytes+=info.bytes;maximumTextureEdge=Math.max(maximumTextureEdge,info.edge);}
 return {drawCallsUpperBound:drawCalls,trianglesUpperBound:triangles,geometries:resources.geometries.size,geometryBytes,materials:resources.materials.size,textures:resources.textures.size,textureBytesEstimate:textureBytes,maximumTextureEdge};
}

/** QA can publish this returned object into its existing visible diagnostics. */
export function renderBudgetBreakdown(groups:Record<string,Iterable<RenderRoot>>):Record<string,RenderBudget>{
 const report:Record<string,RenderBudget>={};for(const name of Object.keys(groups))report[name]=inspectRenderBudget(groups[name]);return report;
}

const worldLodRecords=new Map(worldLod.meshes.map(record=>[record.name,record]));

/** Apply precomputed edge-collapse indices to the authored desert meshes.
 * Original ground/decal/sign/cloth islands are exact. UVs on architectural PBR
 * surfaces use the same world projection as createWorld(), after flat-normal
 * regeneration. No runtime simplifier, triangle sampling, or collision changes.
 * A source mismatch throws BEFORE modifying any mesh; its full source survives.
 */
export function applyMapLOD(root:THREE.Group,level:'default'|'low'|'full'='default'):{meshes:number;triangles:number;level:string}{
 const matches:Array<{mesh:THREE.Mesh;source:THREE.BufferGeometry;record:typeof worldLod.meshes[number]}> = [];
 root.traverse(object=>{
  if(!(object instanceof THREE.Mesh))return;
  const record=worldLodRecords.get(object.name);if(!record)return;
  const previous=object.userData.staticMapLods as Record<string,THREE.BufferGeometry>|undefined,source=previous?.full||object.geometry;
  if(!previous){
   const count=source.getAttribute('position').count,actual=geometryFingerprint(source);
   if(count!==record.vertices||actual!==record.fingerprint)throw new Error(`Offline world LOD source mismatch: ${object.name}; vertices ${count}/${record.vertices}; actual ${actual}; expected ${record.fingerprint}`);
  }
  matches.push({mesh:object,source,record});
 });
 for(const {mesh,source,record} of matches){
  const geometries=(mesh.userData.staticMapLods||{full:source}) as Record<string,THREE.BufferGeometry>;
  if(!geometries[level]){
   const indices=record[level as 'default'|'low'];
   if(indices.length/3===record.sourceTriangles)geometries[level]=source;
   else{
    const indexed=source.clone();indexed.setIndex(indices);
    const geometry=indexed.toNonIndexed();indexed.dispose();geometry.computeVertexNormals();
    if(record.worldUVScale){
     const p=geometry.getAttribute('position'),n=geometry.getAttribute('normal'),uv=geometry.getAttribute('uv');
     for(let i=0;i<p.count;i++)uv.setXY(i,(Math.abs(n.getX(i))>.5?p.getZ(i):p.getX(i))*record.worldUVScale,(Math.abs(n.getY(i))>.5?p.getZ(i):p.getY(i))*record.worldUVScale);
    }
    geometry.computeBoundingBox();geometry.computeBoundingSphere();geometries[level]=geometry;
   }
  }
  mesh.userData.staticMapLods=geometries;mesh.geometry=geometries[level];
 }
 const triangles=inspectRenderBudget([root]).trianglesUpperBound;root.userData.triangles=triangles;root.userData.offlineLod=level;
 return {meshes:matches.length,triangles,level};
}

const pickupPosition=new THREE.Vector3(),viewerPosition=new THREE.Vector3();
/** Call immediately after GroundWeapons.update(). Only visual pickup roots are
 * culled; gameplay pickups and the nearby interaction marker are untouched. */
export function cullDistantPickups(root:THREE.Group,camera:THREE.Camera,lowQuality=false):{visible:number;culled:number}{
 camera.getWorldPosition(viewerPosition);const radius=lowQuality?8:12,limit=radius*radius;let visible=0,culled=0;
 for(const object of root.children){
  if(!object.name.startsWith('pickup:')||!object.visible)continue;
  object.getWorldPosition(pickupPosition);
  const dx=pickupPosition.x-viewerPosition.x,dz=pickupPosition.z-viewerPosition.z;
  if(dx*dx+dz*dz>limit){object.visible=false;culled++;}else visible++;
 }
 return {visible,culled};
}

/** Safe identity-material batching for static world roots only. Do not call on
 * character/weapon rigs. Transparent, skinned, instanced, mirrored, animated,
 * partial-draw and custom render-hook meshes deliberately remain separate.
 * Desert/snow already batch most materials, so this can correctly be a no-op.
 */
export function mergeStaticMapMeshes(root:THREE.Group,protectedRoots:Iterable<RenderRoot>=[]):{before:RenderBudget;after:RenderBudget;mergedMeshes:number}{
 const before=inspectRenderBudget([root]),buckets=new Map<string,THREE.Mesh[]>();
 root.updateWorldMatrix(true,true);
 const inverse=new THREE.Matrix4().copy(root.matrixWorld).invert();
 root.traverseVisible(object=>{
  if(!(object instanceof THREE.Mesh)||object instanceof THREE.SkinnedMesh||object instanceof THREE.InstancedMesh||Array.isArray(object.material))return;
  if(object.children.length||object.animations.length||object.material.transparent||object.geometry.drawRange.start!==0||Number.isFinite(object.geometry.drawRange.count))return;
  if(Object.keys(object.geometry.morphAttributes).length||object.onBeforeRender!==THREE.Object3D.prototype.onBeforeRender||object.onAfterRender!==THREE.Object3D.prototype.onAfterRender)return;
  const relative=new THREE.Matrix4().multiplyMatrices(inverse,object.matrixWorld);if(relative.determinant()<=0)return;
  const attributes=Object.entries(object.geometry.attributes) as Array<[string,THREE.BufferAttribute|THREE.InterleavedBufferAttribute]>;
  const signature=attributes.sort(([a],[b])=>a.localeCompare(b)).map(([name,a])=>`${name}:${a.itemSize}:${a.normalized}:${a.array.constructor.name}`).join('|');
  const key=[object.material.uuid,object.renderOrder,object.layers.mask,object.castShadow,object.receiveShadow,object.frustumCulled,!!object.geometry.index,signature].join('/');
  const bucket=buckets.get(key)||[];bucket.push(object);buckets.set(key,bucket);
 });
 const removed=new Set<THREE.BufferGeometry>();let mergedMeshes=0;
 for(const meshes of buckets.values()){
  if(meshes.length<2)continue;
  const parts=meshes.map(mesh=>mesh.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse,mesh.matrixWorld)));
  const geometry=mergeGeometries(parts,false);parts.forEach(part=>part.dispose());if(!geometry)continue;
  geometry.computeBoundingSphere();geometry.computeBoundingBox();
  const original=meshes[0],mesh=new THREE.Mesh(geometry,original.material);
  mesh.name=`offline-map-batch:${original.material instanceof THREE.Material?original.material.name:'material'}`;
  mesh.renderOrder=original.renderOrder;mesh.layers.mask=original.layers.mask;mesh.castShadow=original.castShadow;mesh.receiveShadow=original.receiveShadow;mesh.frustumCulled=original.frustumCulled;
  mesh.userData.sourceNames=meshes.map(value=>value.name);
  for(const original of meshes){original.removeFromParent();removed.add(original.geometry);}
  root.add(mesh);mergedMeshes+=meshes.length-1;
 }
 const retained=collect([root,...protectedRoots]);for(const geometry of removed)if(!retained.geometries.has(geometry))geometry.dispose();
 const after=inspectRenderBudget([root]);root.userData.materialBatches=after.drawCallsUpperBound;root.userData.triangles=after.trianglesUpperBound;
 return {before,after,mergedMeshes};
}

/** Evict inactive worlds after the new world and its lighting are installed.
 * Resource identity is checked against every retained root. Scene environment,
 * active sky, model textures, and any explicitly shared geometries are protected.
 * Collision/navigation remains in MAPS and is never touched by this utility.
 */
export function releaseInactiveMaps<Key>(cache:Map<Key,THREE.Group>,activeKey:Key,protectedRoots:Iterable<RenderRoot>=[]):DisposalReport {
 const active=cache.get(activeKey),inactive=[...cache.entries()].filter(([key])=>key!==activeKey);
 const retained=collect([...(active?[active]:[]),...protectedRoots]),owned=collect(inactive.map(([,root])=>root));
 const report:DisposalReport={maps:inactive.length,geometries:0,materials:0,textures:0,textureBytesEstimate:0};
 for(const geometry of owned.geometries)if(!retained.geometries.has(geometry)){geometry.dispose();report.geometries++;}
 for(const material of owned.materials)if(!retained.materials.has(material)){material.dispose();report.materials++;}
 for(const texture of owned.textures)if(!retained.textures.has(texture)){texture.dispose();report.textures++;report.textureBytesEstimate+=textureInfo(texture).bytes;}
 for(const [key,root] of inactive){
  root.removeFromParent();root.clear();root.userData.sky=null;root.userData.shadowCasters=[];
  delete root.userData.dispose;root.userData.renderResourcesReleased=true;cache.delete(key);
 }
 return report;
}
