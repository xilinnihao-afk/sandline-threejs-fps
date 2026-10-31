import * as THREE from 'three';
import type {GameSnapshot} from '../game/types';

/** One lightweight marker shared across all maps; no lights or collision bodies. */
export class DefenseObjective extends THREE.Group {
 private material=new THREE.MeshBasicMaterial({color:0xf0cb7f,transparent:true,opacity:.85,depthWrite:false,side:THREE.DoubleSide});
 constructor(){
  super();this.name='defense-objective';this.visible=false;
  const ring=new THREE.Mesh(new THREE.RingGeometry(2.88,3,64),this.material);ring.rotation.x=-Math.PI/2;ring.position.y=.035;this.add(ring);
  const postGeometry=new THREE.CylinderGeometry(.035,.035,1.1,6),flagGeometry=new THREE.PlaneGeometry(.45,.3);
  for(let i=0;i<4;i++){
   const angle=Math.PI/4+i*Math.PI/2,x=Math.sin(angle)*2.8,z=Math.cos(angle)*2.8;
   const post=new THREE.Mesh(postGeometry,this.material);post.position.set(x,.55,z);this.add(post);
   const flag=new THREE.Mesh(flagGeometry,this.material);flag.position.set(x,.95,z);flag.rotation.y=angle;this.add(flag);
  }
 }
 update(s:GameSnapshot){
  const d=s.defense;this.visible=s.mode==='defense'&&!!d&&s.phase!=='menu';if(!this.visible||!d)return;
  this.position.set(d.site.x,d.site.y,d.site.z);this.material.color.setHex(d.attackers?0xff7350:0xf0cb7f);
 }
}
