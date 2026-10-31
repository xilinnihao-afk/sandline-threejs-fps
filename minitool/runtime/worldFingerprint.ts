import type * as THREE from 'three';

/** Runtime/source agreement for authored vertex order. Float32 normals and
 * colors may differ at the last bit between JS engines, and are irrelevant to
 * applying original-vertex indices. Hash ordered positions/UVs at 0.1mm / 1e-4
 * UV precision instead; retain exact layout, count and index-order agreement.
 */
export function geometryFingerprint(geometry:THREE.BufferGeometry):string{
 const hashIntegers=(values:ArrayLike<number>,scale:number)=>{
  let hash=2166136261;
  for(let i=0;i<values.length;i++){
   const value=Math.round(values[i]*scale);
   for(let byte=0;byte<4;byte++)hash=Math.imul(hash^((value>>>(byte*8))&255),16777619);
  }
  return (hash>>>0).toString(16);
 };
 const layout=Object.keys(geometry.attributes).sort().map(name=>{
  const attribute=geometry.getAttribute(name);return `${name}:${attribute.itemSize}:${attribute.count}`;
 }).join(',');
 const position=geometry.getAttribute('position'),uv=geometry.getAttribute('uv');
 return `q1e4/${layout}/p:${hashIntegers(position.array,1e4)}/uv:${uv?hashIntegers(uv.array,1e4):'none'}/i:${geometry.index?hashIntegers(geometry.index.array,1):'none'}`;
}
