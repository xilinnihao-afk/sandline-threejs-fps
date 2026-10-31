import * as THREE from 'three';

/** Split the authored MP5 handle + stem from the receiver's material batch.
 * Only indices change; every original vertex, UV and seated transform survives. */
export function prepareSmgChargingHandle(source:THREE.Group):void {
 const mesh=source.getObjectByName('Reciever_Mag_&_Barrel_0'),bolt=source.getObjectByName('bolt');
 if(!(mesh instanceof THREE.Mesh)||!bolt||bolt.children.length)return;
 source.updateMatrixWorld(true);
 const geometry=mesh.geometry,index=geometry.index,position=geometry.attributes.position;
 if(!index)return;
 const toSource=source.matrixWorld.clone().invert().multiply(mesh.matrixWorld);
 const points=Array.from({length:position.count},(_,i)=>new THREE.Vector3().fromBufferAttribute(position,i).applyMatrix4(toSource));
 const body:number[]=[],handle:number[]=[];
 // Measured closed components: left charging grip and its short connector.
 const inside=(v:THREE.Vector3)=>v.x<-.0018&&v.x>-.033&&v.y>.0828&&v.y<.0932&&v.z>-.3833&&v.z<-.3685;
 // Weld UV seams for connectivity, then move whole closed components. A
 // triangle-only bounds filter also cuts fragments out of the receiver tube.
 const parents=Array.from({length:index.count/3},(_,i)=>i),seen=new Map<string,number>();
 const find=(i:number):number=>parents[i]===i?i:parents[i]=find(parents[i]);
 for(let f=0;f<parents.length;f++)for(let k=0;k<3;k++){
  const key=points[index.getX(f*3+k)].toArray().map(v=>Math.round(v*1e6)).join(',');
  const previous=seen.get(key);if(previous!==undefined)parents[find(f)]=find(previous);else seen.set(key,f);
 }
 const components=new Map<number,number[]>();
 for(let f=0;f<parents.length;f++){const root=find(f),ids=components.get(root)??[];ids.push(index.getX(f*3),index.getX(f*3+1),index.getX(f*3+2));components.set(root,ids);}
 for(const ids of components.values())(ids.every(id=>inside(points[id]))?handle:body).push(...ids);
 if(handle.length!==340*3)throw new Error('MP5 charging handle geometry changed; recalibrate partition');
 const stationary=geometry.clone();stationary.setIndex(body);mesh.geometry=stationary;
 const moving=geometry.clone();moving.setIndex(handle);
 const part=new THREE.Mesh(moving,mesh.material);part.name='mp5-authored-charging-handle';
 part.matrixAutoUpdate=false;part.matrix.copy(bolt.matrixWorld).invert().multiply(mesh.matrixWorld);part.castShadow=mesh.castShadow;part.receiveShadow=mesh.receiveShadow;
 bolt.add(part);bolt.userData.movingPartAvailable=true;
}
