import * as THREE from 'three';

/** 先旋转再测量包围盒；所有握持点都使用此统一的米制坐标。 */
export function normalizePistol(source: THREE.Group): THREE.Group {
  source.rotation.y = Math.PI;
  source.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(source);
  // APX 全尺寸手枪约 21 厘米长，避免旧版 34 厘米模型遮住双手。
  const scale = .21 / Math.max(bounds.getSize(new THREE.Vector3()).z, .001);
  source.scale.multiplyScalar(scale);
  source.position.addScaledVector(bounds.getCenter(new THREE.Vector3()), -scale);
  const normalized = new THREE.Group();
  normalized.name = 'beretta-apx-a1-imported';
  normalized.add(source);
  return normalized;
}
