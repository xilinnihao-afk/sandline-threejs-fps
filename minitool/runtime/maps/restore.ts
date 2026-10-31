import {Dust2Collision} from '../../../src/game/dust2Collision';
import {AssaultCollision} from '../../../src/game/assaultCollision';

function bounds(a:number[]|null){return a?{min:{x:a[0],y:a[1],z:a[2]},max:{x:a[3],y:a[4],z:a[5]}}:undefined;}

/** Restore the exact original collision algorithms from build-time scene data.
 * Shared hull node arrays stay shared, rather than copying entire BSP trees for
 * every solid brush. The binary parser and resource requests are never invoked.
 */
export function restoreCollision(snapshot:any):Dust2Collision|AssaultCollision {
 if(snapshot.format!=='sandline-collision-v1')throw new Error('Unsupported offline map collision');
 const result=Object.create(snapshot.kind==='assault'?AssaultCollision.prototype:Dust2Collision.prototype);
 const planes=[];
 for(let i=0;i<snapshot.planes.length;i+=4)planes.push({x:snapshot.planes[i],y:snapshot.planes[i+1],z:snapshot.planes[i+2],d:snapshot.planes[i+3]});
 const nodeSets=snapshot.nodeSets.map((set:number[])=>{
  const nodes=[];for(let i=0;i<set.length;i+=3)nodes.push({plane:set[i],children:[set[i+1],set[i+2]]});return nodes;
 });
 const hull=(h:any)=>({root:h[0],nodes:nodeSets[h[1]],bounds:bounds(h[2])});
 Object.assign(result,{
  planes,pointHulls:snapshot.pointHulls.map(hull),bodyHulls:snapshot.bodyHulls.map(hull),crouchHulls:snapshot.crouchHulls.map(hull),
  bounds:bounds(snapshot.bounds),entities:snapshot.entities,spawns:snapshot.spawns,
  navigation:{points:snapshot.navigation.points.map((p:number[])=>({x:p[0],y:p[1],z:p[2],...(p.length>3?{crouched:!!p[3]}:{}),...(p.length>4?{ladder:p[4]}:{})})),edges:snapshot.navigation.edges},
 });
 if(snapshot.kind==='assault')Object.assign(result,{jumpSpeed:snapshot.jumpSpeed,ladders:snapshot.ladders,excludedModels:snapshot.excludedModels,walkingEdges:new Map()});
 return result;
}
