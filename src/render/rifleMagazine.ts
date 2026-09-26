import * as THREE from 'three';

/** Split the SS2's welded magazine island, including its hidden feed end.
 * Keep original UVs/normals/material; never cut triangles across a spatial plane. */
export function detachRifleMagazine(root: THREE.Group): THREE.Group {
  const magazine = new THREE.Group();
  magazine.name = 'magazine';
  root.updateWorldMatrix(true, true);
  const inverse = root.matrixWorld.clone().invert();
  const meshes: THREE.Mesh[] = [];
  root.traverse(o => { if (o instanceof THREE.Mesh && o.name.includes('SS2_0')) meshes.push(o); });
  for (const mesh of meshes) {
    const geometry = mesh.geometry, p = geometry.attributes.position, index = geometry.index;
    if (!index) continue;
    const parents = Array.from({ length: p.count }, (_, i) => i);
    const find = (i: number): number => parents[i] === i ? i : (parents[i] = find(parents[i]));
    const weld = new Map<string, number>();
    for (let i = 0; i < p.count; i++) {
      const key = [p.getX(i), p.getY(i), p.getZ(i)].map(v => v.toFixed(4)).join(',');
      const other = weld.get(key);
      if (other !== undefined) parents[find(i)] = find(other); else weld.set(key, i);
    }
    for (let i = 0; i < index.count; i += 3) {
      parents[find(index.getX(i + 1))] = find(index.getX(i));
      parents[find(index.getX(i + 2))] = find(index.getX(i));
    }
    const transform = inverse.clone().multiply(mesh.matrixWorld);
    const bounds = new Map<number, THREE.Box3>();
    for (let i = 0; i < p.count; i++) {
      const key = find(i), box = bounds.get(key) ?? new THREE.Box3();
      box.expandByPoint(new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(transform));
      bounds.set(key, box);
    }
    const islands = new Set([...bounds].filter(([, b]) => b.min.y < -.13 && b.min.z > -.10 && b.max.z < .02).map(([id]) => id));
    const fixed: number[] = [], moving: number[] = [];
    for (let i = 0; i < index.count; i += 3) {
      const dest = islands.has(find(index.getX(i))) ? moving : fixed;
      dest.push(index.getX(i), index.getX(i + 1), index.getX(i + 2));
    }
    if (!moving.length) continue;
    const body = geometry.clone(); body.setIndex(fixed); body.computeBoundingBox(); body.computeBoundingSphere(); mesh.geometry = body;
    const part = geometry.clone(); part.setIndex(moving); part.applyMatrix4(transform); part.computeBoundingBox(); part.computeBoundingSphere();
    const detached = new THREE.Mesh(part, mesh.material);
    detached.name = 'ss2-original-magazine'; detached.castShadow = true; detached.receiveShadow = true;
    magazine.add(detached);
  }
  root.add(magazine);
  return magazine;
}
