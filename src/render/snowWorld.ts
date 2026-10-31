import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MAP_BOXES, MAP_SIZE } from '../game/map';

// Original, repeatable texture artwork. The intentionally diffuse, low frequency
// surfaces match the visual language of the classic ice arena reference.
const mod = (n: number, p: number) => ((n % p) + p) % p;
const hash = (x: number, y: number, seed: number) => {
  let h = Math.imul(x + seed, 374761393) ^ Math.imul(y + 17, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};
function noise(u: number, v: number, cellsX: number, cellsY: number, seed: number) {
  const x = u * cellsX, y = v * cellsY, ix = Math.floor(x), iy = Math.floor(y);
  const sx = x - ix, sy = y - iy, tx = sx * sx * (3 - 2 * sx), ty = sy * sy * (3 - 2 * sy);
  const sample = (dx: number, dy: number) => hash(mod(ix + dx, cellsX), mod(iy + dy, cellsY), seed);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(sample(0, 0), sample(1, 0), tx), THREE.MathUtils.lerp(sample(0, 1), sample(1, 1), tx), ty);
}
function cloud(u: number, v: number, seed: number) {
  return noise(u, v, 4, 4, seed) * .51 + noise(u, v, 9, 9, seed + 5) * .28
    + noise(u, v, 21, 21, seed + 11) * .14 + noise(u, v, 53, 53, seed + 19) * .07;
}
type Paint = (u: number, v: number, x: number, y: number) => [number, number, number];
function texture(size: number, paint: Paint) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
  const context = canvas.getContext('2d')!;
  const pixels = context.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const rgb = paint(x / size, y / size, x, y), i = (y * size + x) * 4;
    pixels.data[i] = rgb[0]; pixels.data[i + 1] = rgb[1]; pixels.data[i + 2] = rgb[2]; pixels.data[i + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  const result = new THREE.CanvasTexture(canvas);
  result.colorSpace = THREE.SRGBColorSpace;
  result.wrapS = result.wrapT = THREE.RepeatWrapping;
  result.minFilter = THREE.LinearMipmapLinearFilter; result.magFilter = THREE.LinearFilter;
  result.anisotropy = 4;
  return result;
}

export function createSnowWorld(): THREE.Group {
  const root = new THREE.Group(); root.name = 'Sandline / classic snow arena';
  const ice = texture(256, (u, v, x, y) => {
    const mottling = cloud(u, v, 613), streak = noise(u, v, 23, 3, 92);
    const value = 194 + (mottling - .5) * 170 + (streak - .5) * 18 + (hash(x, y, 5) - .5) * 3;
    return [value, value + 1, value - 5];
  });
  ice.name = 'Original mottled ivory ice';
  const snow = texture(256, (u, v, x, y) => {
    const ripple = noise(u, v, 13, 63, 719), grain = hash(x, y, 831);
    const value = 184 + cloud(u, v, 199) * 30 + (ripple - .5) * 36 + (grain - .5) * 8;
    return [value + 2, value + 4, value - 3];
  });
  snow.name = 'Original compacted snow ripples';
  const stone = texture(256, (u, v, x, y) => {
    const rows = 5, cols = 3, row = Math.floor(v * rows), bx = u * cols + (row % 2) * .5;
    const warp = (noise(u, v, 15, 21, 591) - .5) * .03;
    const xx = mod(bx + warp, 1), yy = mod(v * rows + warp, 1);
    const seam = Math.min(xx, 1 - xx, yy, 1 - yy);
    const slab = hash(Math.floor(bx), row, 269), rough = cloud(u, v, 199);
    let value = 63 + slab * 21 + rough * 34 + (hash(x, y, 75) - .5) * 15;
    if (seam < .028) value *= .37;
    else if (seam < .06) value *= .76;
    else if (yy < .10) value += 10;
    return [value, value * .92, value * .75];
  });
  stone.name = 'Original dark brown rough stone brickwork';
  const skyMap = texture(512, (u, v) => {
    const haze = cloud(u, v, 851), veil = THREE.MathUtils.smoothstep(haze, .37, .71);
    const horizon = Math.pow(1 - Math.abs(v - .5) * 2, 4);
    return [134 + veil * 30 + horizon * 12, 153 + veil * 28 + horizon * 9, 175 + veil * 21 + horizon * 4];
  });
  skyMap.name = 'Original overcast blue grey cloud sky';
  const iceMaterial = new THREE.MeshStandardMaterial({ map: ice, roughness: 1, metalness: 0, envMapIntensity: .12, vertexColors: true });
  const snowMaterial = new THREE.MeshStandardMaterial({ map: snow, roughness: 1, metalness: 0, envMapIntensity: .10 });
  const stoneMaterial = new THREE.MeshStandardMaterial({ map: stone, roughness: 1, metalness: 0, envMapIntensity: .08, vertexColors: true });
  const iceParts: THREE.BufferGeometry[] = [], stoneParts: THREE.BufferGeometry[] = [];

  MAP_BOXES.forEach((b, index) => {
    // One visible box per collision box: dimensions and origin are identical.
    const g = new THREE.BoxGeometry(b.w, b.h, b.d);
    g.translate(b.x, b.h / 2, b.z);
    const p = g.getAttribute('position'), n = g.getAttribute('normal'), uv = g.getAttribute('uv');
    const colors = new Float32Array(p.count * 3), isIce = b.kind === 'wall';
    const scale = isIce ? 1 / 7 : 1 / 2.8;
    for (let i = 0; i < p.count; i++) {
      // World-space face projection preserves texture scale on thin outer walls.
      const nx = Math.abs(n.getX(i)), ny = n.getY(i);
      uv.setXY(i, (nx > .5 ? p.getZ(i) : p.getX(i)) * scale, (Math.abs(ny) > .5 ? p.getZ(i) : p.getY(i)) * scale);
      const shade = (isIce ? .96 + (index % 3) * .018 : .94) * (ny > .5 ? 1 : ny < -.5 ? .83 : .97);
      colors.set([shade, shade, shade], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    (isIce ? iceParts : stoneParts).push(g);
  });
  const addBatch = (name: string, parts: THREE.BufferGeometry[], material: THREE.Material) => {
    if (!parts.length) return;
    const geometry = mergeGeometries(parts, false)!; parts.forEach(part => part.dispose());
    const mesh = new THREE.Mesh(geometry, material); mesh.name = name;
    mesh.castShadow = mesh.receiveShadow = true; root.add(mesh);
  };
  addBatch('snow:collision-identical ice walls', iceParts, iceMaterial);
  addBatch('snow:collision-identical stone crates', stoneParts, stoneMaterial);

  const floorGeometry = new THREE.PlaneGeometry(MAP_SIZE.width + 2, MAP_SIZE.depth + 2);
  floorGeometry.rotateX(-Math.PI / 2);
  const floorUV = floorGeometry.getAttribute('uv'), floorPositions = floorGeometry.getAttribute('position');
  for (let i = 0; i < floorUV.count; i++) floorUV.setXY(i, floorPositions.getX(i) / 5, floorPositions.getZ(i) / 5);
  const floor = new THREE.Mesh(floorGeometry, snowMaterial); floor.name = 'snow:continuous flat ground'; floor.receiveShadow = true; root.add(floor);

  const skyMaterial = new THREE.MeshBasicMaterial({ map: skyMap, side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(150, 32, 16), skyMaterial);
  sky.name = 'snow:overcast sky'; sky.renderOrder = -100; root.add(sky);
  let triangles = 0;
  root.traverse(object => { if (object instanceof THREE.Mesh) triangles += (object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3; });
  root.userData = {
    bounds: { ...MAP_SIZE }, materialBatches: root.children.length, triangles,
    authoredParts: MAP_BOXES.length + 2,
    assetsReady: Promise.resolve(),
    textureStatus: { ready: 4, total: 4, failed: 0 },
    art: 'Original procedural textures / classic ice arena reference reconstruction',
    collisionParity: MAP_BOXES.map(b => ({ ...b })),
    textureScale: { iceMeters: 7, snowMeters: 5, brickMeters: 2.8 },
  };
  return root;
}
