import * as THREE from 'three';
import dust2 from '../generated/maps/dust2-mesh';
import assault from '../generated/maps/assault-mesh';
import bloodstrike from '../generated/maps/bloodstrike-mesh';

type MapId='dust2'|'assault'|'bloodstrike';
type MeshGroup={name:string;rect:number[];vertices:number[];indices:number[];alphaTest:number;opacity:number};
type MapScene={triangles:number;atlas:string;lightmap:string;sky:string[];groups:MeshGroup[]};
const scenes:Record<MapId,MapScene>={dust2,assault,bloodstrike};

/** Actual CS geometry and baked lighting, loaded entirely from the offline bundle. */
export function createGoldSrcWorld(mapId:MapId,sourceName:string):THREE.Group {
 const root=new THREE.Group();root.name=`Sandline / CS 1.6 ${sourceName}`;
 root.userData.mapId=mapId;root.userData.bakedLighting=true;
 root.userData.assetsReady=loadWorld(root,mapId,sourceName);
 return root;
}

/** Merge materials sharing blend behavior. Atlas rectangles are per-vertex so
 * each source brush retains its original repeating UVs within a single draw.
 */
export function mergeMapGroups(groups:MeshGroup[]){
 const batches=new Map<string,{alphaTest:number;opacity:number;vertices:number[];rects:number[];indices:number[];names:string[]}>();
 for(const group of groups){
  const key=`${group.alphaTest}/${group.opacity}`;
  let batch=batches.get(key);
  if(!batch){batch={alphaTest:group.alphaTest,opacity:group.opacity,vertices:[],rects:[],indices:[],names:[]};batches.set(key,batch);}
  const offset=batch.vertices.length/7;
  for(const n of group.vertices)batch.vertices.push(n);
  for(let i=0;i<group.vertices.length/7;i++)batch.rects.push(group.rect[0],group.rect[1],group.rect[2],group.rect[3]);
  for(const n of group.indices)batch.indices.push(n+offset);
  batch.names.push(group.name);
 }
 return [...batches.values()];
}

async function loadWorld(root:THREE.Group,mapId:MapId,sourceName:string):Promise<void>{
 const scene=scenes[mapId],assetRoot=`./assets/maps/${mapId}/`;
 const resources:Array<THREE.Texture|THREE.BufferGeometry|THREE.Material>=[];
 const loader=new THREE.TextureLoader();
 const loadTexture=(name:string)=>loader.loadAsync(assetRoot+name).then(texture=>{resources.push(texture);return texture;});
 try{
  const [atlas,lightmap,sky]=await Promise.all([
   loadTexture(scene.atlas),loadTexture(scene.lightmap),
   scene.sky.length===6?new THREE.CubeTextureLoader().loadAsync(scene.sky.map(name=>assetRoot+name)).then(texture=>{resources.push(texture);return texture;}):Promise.resolve(null),
  ]);
  atlas.name=`${sourceName} / local texture atlas`;atlas.flipY=false;atlas.colorSpace=THREE.SRGBColorSpace;
  atlas.minFilter=atlas.magFilter=THREE.LinearFilter;atlas.generateMipmaps=false;
  lightmap.name=`${sourceName} / original BSP radiosity`;lightmap.flipY=false;lightmap.channel=1;
  lightmap.colorSpace=THREE.NoColorSpace;lightmap.minFilter=lightmap.magFilter=THREE.LinearFilter;lightmap.generateMipmaps=false;
  if(sky){sky.name=`${sourceName} / original sky`;sky.colorSpace=THREE.SRGBColorSpace;}
  const batches=mergeMapGroups(scene.groups);
  for(const batch of batches){
   const buffer=new THREE.InterleavedBuffer(new Float32Array(batch.vertices),7),geometry=new THREE.BufferGeometry();
   geometry.setAttribute('position',new THREE.InterleavedBufferAttribute(buffer,3,0));
   geometry.setAttribute('uv',new THREE.InterleavedBufferAttribute(buffer,2,3));
   geometry.setAttribute('uv1',new THREE.InterleavedBufferAttribute(buffer,2,5));
   geometry.setAttribute('atlasRect',new THREE.Float32BufferAttribute(batch.rects,4));
   geometry.setIndex(batch.indices);geometry.computeBoundingSphere();resources.push(geometry);
   const material=new THREE.MeshBasicMaterial({
    name:`${sourceName} / atlas ${batch.alphaTest}/${batch.opacity}`,map:atlas,lightMap:lightmap,
    lightMapIntensity:Math.PI,toneMapped:false,fog:false,alphaTest:batch.alphaTest,
    opacity:batch.opacity,transparent:batch.opacity<1,depthWrite:batch.opacity>=1,
   });
   material.onBeforeCompile=shader=>{
    shader.vertexShader='attribute vec4 atlasRect;\nvarying vec4 vAtlasRect;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>\nvAtlasRect = atlasRect;');
    shader.fragmentShader='varying vec4 vAtlasRect;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',THREE.ShaderChunk.map_fragment.replace('texture2D( map, vMapUv )','texture2D( map, vAtlasRect.xy + fract( vMapUv ) * vAtlasRect.zw )'));
    shader.fragmentShader=shader.fragmentShader.replace('vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );','vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );\nlightMapTexel.rgb = mix( vec3( 0.08 ), lightMapTexel.rgb, 0.92 );');
   };
   material.customProgramCacheKey=()=> 'sandline-offline-atlas-v1';resources.push(material);
   const mesh=new THREE.Mesh(geometry,material);mesh.name=`${sourceName} / ${batch.names.join(', ')}`;
   mesh.castShadow=mesh.receiveShadow=false;root.add(mesh);
  }
  root.userData.triangles=scene.triangles;root.userData.sky=sky;root.userData.assetsLoaded=true;
  root.userData.materialBatches=batches.length;
  // Clear ownership lets the host release a map when it leaves the active world.
  root.userData.dispose=()=>{root.clear();for(const resource of resources)resource.dispose();};
 }catch(error){root.clear();for(const resource of resources)resource.dispose();throw error;}
}
