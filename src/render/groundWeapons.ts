import * as THREE from 'three';
import {createGroundWeapon} from './weapons';
import {nearestPickup} from '../game/pickups';
import type {GameSnapshot,WeaponKind} from '../game/types';

/** Reuses shared gun meshes; floor items never allocate models every frame. */
export class GroundWeapons {
 readonly root=new THREE.Group();
 private items=new Map<number,{weapon:WeaponKind;mesh:THREE.Group}>();
 private pool=new Map<WeaponKind,THREE.Group[]>();
 private marker:THREE.Mesh;
 constructor(){
  this.root.name='World weapon pickups';
  const material=new THREE.MeshBasicMaterial({color:'#dbc684',transparent:true,opacity:.75,depthWrite:false,side:THREE.DoubleSide});
  this.marker=new THREE.Mesh(new THREE.RingGeometry(.37,.39,32),material);this.marker.rotation.x=-Math.PI/2;this.marker.visible=false;this.root.add(this.marker);
 }
 /** A map change also changes the arsenal skin; old pickup IDs can be reused. */
 reset(){
  for(const child of [...this.root.children])if(child!==this.marker)this.root.remove(child);
  this.items.clear();this.pool.clear();this.marker.visible=false;
 }
 update(state:GameSnapshot){
  const ids=new Set(state.pickups.map(p=>p.id));
  for(const [id,item] of this.items)if(!ids.has(id)||state.pickups.find(p=>p.id===id)?.weapon!==item.weapon){
   item.mesh.visible=false;this.items.delete(id);
   if(!this.pool.has(item.weapon))this.pool.set(item.weapon,[]);this.pool.get(item.weapon)!.push(item.mesh);
  }
  for(const pickup of state.pickups){
   let item=this.items.get(pickup.id);
   if(!item){
    let mesh=this.pool.get(pickup.weapon)?.pop();
    if(!mesh){
     mesh=new THREE.Group();const gun=createGroundWeapon(pickup.weapon);gun.rotation.z=Math.PI/2;gun.updateMatrixWorld(true);
     const bounds=new THREE.Box3().setFromObject(gun),center=bounds.getCenter(new THREE.Vector3());
     gun.position.set(-center.x,.025-bounds.min.y,-center.z);mesh.add(gun);mesh.name=`pickup:${pickup.weapon}`;this.root.add(mesh);
    }
    item={weapon:pickup.weapon,mesh};this.items.set(pickup.id,item);
   }
   item.mesh.visible=true;item.mesh.position.set(pickup.x,pickup.y??0,pickup.z);item.mesh.rotation.y=pickup.id%2?.2:-.25;
  }
  const near=nearestPickup(state);this.marker.visible=!!near;
  if(near)this.marker.position.set(near.x,(near.y??0)+.019,near.z);
 }
}
