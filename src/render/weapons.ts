import { normalizePistol } from './pistolAsset';
import { detachRifleMagazine } from './rifleMagazine';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { WEAPONS } from '../game/simulation';
import type { Actor, WeaponKind } from '../game/types';

// Original, articulated weapon models. Metres, +Y up, -Z forward; the trigger
// is close to the origin. Static details are merged by material, not drawn singly.
type Surface = 'steel' | 'edge' | 'black' | 'wood' | 'rubber' | 'cloth' | 'glove' | 'skin' | 'brass' | 'shell';
type V3 = readonly [number, number, number];
const geometryCache = new Map<string, THREE.BufferGeometry>();
let surfaces: Record<Surface, THREE.MeshStandardMaterial> | undefined;
let markingMaterial: THREE.MeshBasicMaterial | undefined;
const assemblyTemplates = new Map<WeaponKind, THREE.Group>();
let berettaAsset:THREE.Group|null=null;
let akAsset:THREE.Group|null=null;
const UP = new THREE.Vector3(0, 1, 0);
const scratchA = new THREE.Vector3(), scratchB = new THREE.Vector3(), wristSocket = new THREE.Vector3();
const dimensions: Record<WeaponKind, { muzzle: V3; support: V3; label: string; row: number }> = {
  rifle: { muzzle: [0, .066, -.686], support: [-.044, -.014, -.324], label: 'S-47 / 7.62', row: 0 },
  smg: { muzzle: [0, .061, -.501], support: [-.043, -.013, -.303], label: 'MP-9 / 9×19', row: 1 },
  shotgun: { muzzle: [0, .076, -.788], support: [-.045, -.001, -.398], label: 'M-12 / 12 GA', row: 2 },
  pistol: { muzzle: [0, .069, -.196], support: [-.047, -.071, -.044], label: 'USP / .45', row: 3 },
};
function supportSocket(kind:WeaponKind):V3{
  return kind==='pistol'&&berettaAsset?[-.035,-.046,.048]:kind==='rifle'&&akAsset?[-.030,-.065,-.165]:dimensions[kind].support;
}
function primaryGripSocket(kind:WeaponKind):V3{
  // The imported SS2 grip sits farther toward the stock than the authored
  // placeholder. Keeping this socket separate makes the wrist line meet the
  // trigger guard instead of floating below the receiver.
  return kind==='pistol'&&berettaAsset?[.022,-.041,.085]:kind==='rifle'&&akAsset?[.024,-.086,.092]:[.024,-.095,.032];
}

/** Load the supplied Beretta APX model once. The procedural pistol remains a
 * fallback when an offline build omits the optional asset. */
export async function loadWeaponAssets():Promise<void>{
  try{
    const gltf=await new GLTFLoader().loadAsync(import.meta.env.BASE_URL+'assets/weapons/beretta_apx_a1_full_size_standard.glb');
    const normalized=normalizePistol(gltf.scene.clone(true));
    normalized.traverse(o=>{if(o instanceof THREE.Mesh){o.castShadow=true;o.receiveShadow=true;const mats=Array.isArray(o.material)?o.material:[o.material];for(const m of mats as THREE.MeshStandardMaterial[]){m.roughness=Math.min(.82,m.roughness??.65);m.metalness=Math.max(m.metalness??0,.18);}}});
    berettaAsset=normalized;
  }catch(error){console.warn('Beretta asset unavailable; using authored pistol fallback',error);}
  try{
    const gltf=await new GLTFLoader().loadAsync(import.meta.env.BASE_URL+'assets/weapons/ss2-v5_a1_kal.5.56_mm_pindad.glb');
    const source=gltf.scene.clone(true);
    // The export contains loose bullets/magazines and a second complete gun.
    // Remove those before measuring: their layout offsets are not gun sockets.
    const root=source.getObjectByName('RootNode');
    if(root){for(const child of [...root.children])if(!/Magazine_Low\.?001$/.test(child.name))root.remove(child);}
    source.rotation.y=-Math.PI/2;source.updateWorldMatrix(true,true);
    const bounds=new THREE.Box3().setFromObject(source),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
    const scale=.76/Math.max(size.z,.001),normalized=new THREE.Group();normalized.name='ss2-v5-a1-imported';
    source.scale.multiplyScalar(scale);source.position.addScaledVector(center,-scale);normalized.add(source);
    normalized.traverse(o=>{if(o instanceof THREE.Mesh){o.castShadow=true;o.receiveShadow=true;const mats=Array.isArray(o.material)?o.material:[o.material];for(const m of mats as THREE.MeshStandardMaterial[]){m.roughness=Math.min(.84,m.roughness??.66);m.metalness=Math.max(m.metalness??0,.22);}}});
    detachRifleMagazine(normalized);
    akAsset=normalized;
  }catch(error){console.warn('SS2 rifle asset unavailable; using authored rifle fallback',error);}
}

export interface WeaponPresentation {
  recoilDistance: number;
  recoilPitch: number;
  recoilYaw: number;
  cameraKick: number;
  flashScale: number;
  tracerChance: number;
}

export const WEAPON_PRESENTATION: Record<WeaponKind, WeaponPresentation> = {
  rifle: { recoilDistance: .054, recoilPitch: .072, recoilYaw: .012, cameraKick: .030, flashScale: .16, tracerChance: .62 },
  smg: { recoilDistance: .030, recoilPitch: .045, recoilYaw: .018, cameraKick: .020, flashScale: .14, tracerChance: .56 },
  pistol: { recoilDistance: .060, recoilPitch: .092, recoilYaw: .010, cameraKick: .040, flashScale: .13, tracerChance: .72 },
  shotgun: { recoilDistance: .105, recoilPitch: .135, recoilYaw: .020, cameraKick: .070, flashScale: .22, tracerChance: .86 },
};

function texture(style: 'metal' | 'wood' | 'fabric'): THREE.DataTexture {
  const size = 512, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const noise = ((x * 127 + y * 311 + (x * y) % 97) % 53) / 53;
    let light = .73 + noise * .19;
    if (style === 'metal') {
      light += (x < 5 || y < 5 || x > size-5 || y > size-5) ? .15 : 0;
      light += y % 103 < 2 && x % 89 < 31 ? .23 : 0;
      light -= x % 53 < 2 && y % 77 < 15 ? .17 : 0;
    }
    if (style === 'wood') light = .64 + .12 * Math.sin(x * .24 + Math.sin(y * .016) * 2) + .10 * Math.sin(x*.69+Math.sin(y*.031)*1.8) + noise * .13;
    if (style === 'fabric') light = .69 + ((x + y) % 4 < 2 ? .19 : .02) + noise * .08;
    const at = (y * size + x) * 4;
    pixels[at] = pixels[at + 1] = pixels[at + 2] = Math.min(255,Math.round(light * 255));
    pixels[at + 3] = 255;
  }
  const map = new THREE.DataTexture(pixels, size, size);
  map.colorSpace = THREE.SRGBColorSpace; map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.magFilter = THREE.LinearFilter; map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true; map.needsUpdate = true; map.name = `weapon:${style}-microtexture`;
  return map;
}

function material(role: Surface): THREE.MeshStandardMaterial {
  if (!surfaces) {
    const metal = texture('metal'), wood = texture('wood'), fabric = texture('fabric');
    const make = (color: string, roughness: number, metalness: number, map?: THREE.Texture, clearcoat = 0) => {
      const m = new THREE.MeshPhysicalMaterial({ color, roughness, metalness, ...(map ? { map, bumpMap: map, bumpScale: map === metal ? .018 : .008 } : {}) });
      m.clearcoat = clearcoat; m.clearcoatRoughness = Math.min(.7, roughness + .08); m.envMapIntensity = metalness > .4 ? 1.35 : .7;
      return m;
    };
    surfaces = {
      steel: make('#56615f', .37, .78, metal, .16), edge: make('#a9b4ab', .28, .86, metal, .22),
      black: make('#111718', .58, .28, metal, .08), wood: make('#9a6035', .48, .02, wood, .04),
      rubber: make('#202622', .91, .015, fabric), cloth: make('#405360', .96, 0, fabric),
      glove: make('#252b28', .82, .015, fabric), skin: make('#927059', .87, 0),
      brass: make('#d1a94f', .25, .82, metal, .1), shell: make('#9a3929', .48, .18, metal, .04),
    };
    for (const [name, entry] of Object.entries(surfaces)) entry.name = `weapon:${name}`;
  }
  return surfaces[role];
}

function geometry(key: string, factory: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let result = geometryCache.get(key);
  if (!result) { result = factory(); geometryCache.set(key, result); }
  return result;
}

class Builder {
  private batches = new Map<Surface, THREE.BufferGeometry[]>();
  add(role: Surface, source: THREE.BufferGeometry, position: V3 = [0, 0, 0], rotation: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]): void {
    const piece = source.index ? source.toNonIndexed() : source.clone();
    const transform = new THREE.Matrix4().compose(new THREE.Vector3(...position), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), new THREE.Vector3(...scale));
    piece.applyMatrix4(transform);
    if (!this.batches.has(role)) this.batches.set(role, []);
    this.batches.get(role)!.push(piece);
  }
  box(role: Surface, p: V3, size: V3, rotation: V3 = [0, 0, 0], bevel = true): void {
    const key = `${bevel ? 'bevel' : 'box'}:${size.join(',')}`;
    this.add(role, geometry(key, () => bevel ? new RoundedBoxGeometry(...size, 1, Math.min(...size) * .11) : new THREE.BoxGeometry(...size)), p, rotation);
  }
  cylinder(role: Surface, p: V3, radius: number, length: number, axis: 'x' | 'y' | 'z' = 'z', radiusEnd = radius): void {
    this.add(role, geometry(`cyl:${radius}:${radiusEnd}:${length}`, () => new THREE.CylinderGeometry(radiusEnd, radius, length, 16)), p,
      axis === 'z' ? [Math.PI / 2, 0, 0] : axis === 'x' ? [0, 0, Math.PI / 2] : [0, 0, 0]);
  }
  ring(role: Surface, p: V3, radius: number, thickness: number, rotation: V3 = [0, 0, 0]): void {
    this.add(role, geometry(`ring:${radius}:${thickness}`, () => new THREE.TorusGeometry(radius, thickness, 6, 20)), p, rotation);
  }
  profile(role: Surface, points: ReadonlyArray<readonly [number, number]>, width: number): void {
    const shape = new THREE.Shape(); points.forEach(([z, y], i) => i ? shape.lineTo(z, y) : shape.moveTo(z, y)); shape.closePath();
    this.shape(role, shape, width);
  }
  shape(role: Surface, shape: THREE.Shape, width: number): void {
    const form = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: true, bevelSize: .002, bevelThickness: .0015, bevelSegments: 2, steps: 1, curveSegments: 12 });
    form.rotateY(-Math.PI / 2); form.translate(width / 2, 0, 0); this.add(role, form); form.dispose();
  }
  path(role: Surface, points: V3[], radius: number, closed = false): void {
    const form = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)), closed), 20, radius, 6, closed);
    this.add(role, form); form.dispose();
  }
  finish(parent: THREE.Group, label: string): void {
    for (const [role, pieces] of this.batches) {
      const merged = mergeGeometries(pieces, false)!;
      for (const piece of pieces) piece.dispose();
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, material(role)); mesh.name = `${label}:${role}`;
      mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh);
    }
    this.batches.clear();
  }
}

function namedGroup(parent: THREE.Group, name: string): THREE.Group {
  const group = new THREE.Group(); group.name = name; parent.add(group); return group;
}

function receiverDetails(b: Builder, z: number, length: number): void {
  b.box('black', [-.038, .042, z], [.004, .024, length]);
  for (let i = 0; i < 3; i++) {
    const at = z - length / 2 + .014 + i * length * .34;
    b.cylinder('edge', [-.041, .027, at], .0035, .0025, 'x');
    b.box('black', [-.043, .027, at], [.001, .0008, .004], [0, .3, 0], false);
  }
  // Selector and finger-safe trigger guard are separate functional silhouettes.
  b.box('edge', [-.042, .023, -.015], [.005, .008, .032], [-.18, 0, 0]);
  b.path('black', [[-.017, -.013, -.017], [-.019, -.064, -.025], [-.019, -.072, -.072], [-.019, -.015, -.092]], .004);
  b.path('steel', [[0, -.012, -.047], [0, -.038, -.050], [0, -.049, -.063]], .003);
}

function addMarking(parent: THREE.Group, kind: WeaponKind, z: number, x = -.04): void {
  if (!markingMaterial) {
    if (typeof document === 'undefined') return;
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    for (const entry of Object.values(dimensions)) {
      ctx.fillStyle = '#b8b6a9'; ctx.font = 'bold 27px monospace'; ctx.fillText(entry.label, 12, entry.row * 64 + 29);
      ctx.fillStyle = '#818783'; ctx.font = '11px monospace'; ctx.fillText('SANDLINE ARMORY  /  № 260916', 13, entry.row * 64 + 49);
    }
    const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
    markingMaterial = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, opacity: .82 });
    markingMaterial.name = 'weapon:engraved-marking-atlas';
  }
  const plane = new THREE.PlaneGeometry(.125, .025), uv = plane.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setY(i, (uv.getY(i) + 3 - dimensions[kind].row) / 4);
  const mark = new THREE.Mesh(plane, markingMaterial); mark.name = 'engraved-calibre-and-serial';
  mark.position.set(x, .041, z); mark.rotation.y = -Math.PI / 2; parent.add(mark);
}

function buildAssembly(kind: WeaponKind): THREE.Group {
  const root = new THREE.Group(); root.name = `weapon-assembly:${kind}`;
  const body = new Builder(), movingMagazine = new Builder(), boltParts = new Builder(), pumpParts = new Builder();
  const magazine = namedGroup(root, 'magazine'), bolt = namedGroup(root, 'bolt'), pump = namedGroup(root, 'pump');
  if (kind === 'rifle') {
    body.box('steel', [0, .036, -.120], [.072, .081, .250]);
    body.cylinder('steel', [0, .077, -.129], .032, .233);
    body.box('black', [0, .092, -.13], [.028, .007, .227]);
    body.profile('wood', [[-.242, .004], [-.39, .006], [-.394, .062], [-.26, .074]], .077);
    body.cylinder('wood', [0, .085, -.309], .025, .135);
    body.cylinder('steel', [0, .066, -.503], .011, .345);
    body.cylinder('black', [0, .107, -.453], .010, .146);
    body.box('steel', [0, .076, -.405], [.06, .058, .018]);
    body.box('steel', [0, .079, -.497], [.047, .064, .018]);
    body.cylinder('steel', [0, .066, -.662], .017, .036);
    body.ring('edge', [0, .066, -.683], .010, .0028);
    body.cylinder('black', [0, .066, -.686], .008, .001);
    // AK-style dust cover, rear sight block and a compact slotted muzzle brake.
    body.box('steel', [0, .133, -.143], [.064, .018, .188]);
    body.box('black', [0, .149, -.109], [.047, .012, .098]);
    body.box('edge', [0, .125, -.456], [.075, .014, .052]);
    // High-contrast carry handle / rear sight silhouette from the M4 reference.
    body.box('black', [0, .177, -.145], [.052, .019, .205]);
    body.box('steel', [-.028, .150, -.085], [.010, .063, .026]);
    body.box('steel', [.028, .150, -.085], [.010, .063, .026]);
    body.box('edge', [0, .204, -.145], [.036, .008, .164], [0, 0, 0], false);
    body.box('black', [0, .192, -.497], [.035, .026, .072]);
    for (let i = 0; i < 3; i++) body.box('black', [0, .067, -.704 - i * .010], [.027, .016, .004], [0, 0, 0], false);
    body.box('steel', [0, .095, -.603], [.022, .063, .016]);
    body.ring('black', [0, .133, -.603], .018, .0035);
    body.box('edge', [0, .127, -.603], [.003, .018, .006]);
    body.box('black', [0, .111, -.225], [.038, .027, .032]);
    body.box('edge', [0, .126, -.221], [.026, .006, .014]);
    body.profile('wood', [[.003, .01], [.159, -.01], [.185, -.067], [.171, -.112], [.077, -.071], [.03, -.029]], .058);
    body.box('rubber', [0, -.061, .181], [.064, .107, .019], [.11, 0, 0]);
    body.box('wood', [0, -.085, .011], [.047, .121, .055], [-.26, 0, 0]);
    for (const side of [-1, 1]) for (let i = 0; i < 4; i++) {
      body.box('black', [side * .038, .056, -.273 - i * .028], [.004, .012, .013]);
      body.box('edge', [side * .036, .075, -.037 - i * .046], [.002, .002, .026], [0, 0, 0], false);
    }
    const shape = new THREE.Shape(); shape.moveTo(-.178, -.003); shape.lineTo(-.113, -.003);
    shape.quadraticCurveTo(-.107, -.132, -.013, -.232); shape.lineTo(-.073, -.272);
    shape.quadraticCurveTo(-.157, -.185, -.178, -.003);
    movingMagazine.shape('steel', shape, .048);
    for (const side of [-1, 1]) for (let i = 0; i < 3; i++) movingMagazine.path('black', [[side * .026, -.045, -.164 + i * .017], [side * .026, -.132, -.145 + i * .017], [side * .026, -.225, -.079 + i * .017]], .0026);
    movingMagazine.box('black', [0, -.252, -.045], [.057, .017, .073], [.55, 0, 0]);
    boltParts.box('edge', [.04, .058, -.067], [.014, .018, .079]);
    boltParts.cylinder('steel', [.061, .057, -.033], .009, .041, 'x');
    receiverDetails(body, -.10, .18);
  } else if (kind === 'smg') {
    body.cylinder('steel', [0, .063, -.133], .030, .285);
    body.box('steel', [0, .036, -.123], [.067, .071, .243]);
    body.profile('rubber', [[-.231, .012], [-.366, .004], [-.377, .050], [-.276, .082], [-.232, .062]], .073);
    body.cylinder('steel', [0, .061, -.395], .012, .207);
    body.cylinder('black', [0, .061, -.465], .019, .047);
    body.ring('edge', [0, .061, -.50], .012, .0024);
    body.cylinder('black', [0, .061, -.502], .009, .001);
    body.box('steel', [0, .087, -.395], [.027, .062, .017]);
    // Compact SMG rail and vented handguard, echoing the short black carbine reference.
    body.box('black', [0, .118, -.235], [.052, .014, .275]);
    for (let i = 0; i < 7; i++) body.box('edge', [0, .127, -.108 - i * .042], [.038, .003, .012], [0, 0, 0], false);
    body.box('rubber', [0, -.006, -.327], [.065, .055, .105], [-.16, 0, 0]);
    body.box('black', [0, .143, -.035], [.045, .018, .12]);
    body.box('steel', [.032, .126, .020], [.012, .060, .024]);
    body.box('black', [0, .015, .163], [.062, .038, .13], [.12, 0, 0]);
    body.ring('black', [0, .118, -.395], .026, .0037);
    body.box('edge', [0, .108, -.395], [.004, .023, .006]);
    body.cylinder('black', [0, .107, -.022], .020, .032, 'y');
    body.ring('edge', [0, .123, -.022], .014, .0019, [Math.PI / 2, 0, 0]);
    for (const side of [-1, 1]) {
      body.cylinder('steel', [side * .035, .027, .081], .0055, .18);
      body.box('black', [side * .038, .060, -.3], [.004, .01, .083]);
    }
    body.box('rubber', [0, -.019, .165], [.059, .107, .022]);
    body.box('rubber', [0, -.069, .008], [.052, .127, .061], [-.23, 0, 0]);
    const shape = new THREE.Shape(); shape.moveTo(-.141, -.001); shape.lineTo(-.096, -.001);
    shape.quadraticCurveTo(-.092, -.165, -.049, -.239); shape.lineTo(-.094, -.255);
    shape.quadraticCurveTo(-.132, -.172, -.141, -.001);
    movingMagazine.shape('steel', shape, .033);
    for (const side of [-1, 1]) movingMagazine.path('edge', [[side * .018, -.034, -.115], [side * .018, -.129, -.11], [side * .018, -.223, -.083]], .0018);
    movingMagazine.box('black', [0, -.244, -.071], [.043, .016, .049], [.30, 0, 0]);
    boltParts.cylinder('steel', [-.025, .092, -.264], .004, .085);
    boltParts.cylinder('black', [-.049, .097, -.299], .009, .035, 'x');
    receiverDetails(body, -.10, .14);
  } else if (kind === 'shotgun') {
    body.profile('steel', [[.075, -.007], [-.165, -.007], [-.185, .058], [-.154, .108], [.064, .092]], .073);
    body.cylinder('steel', [0, .076, -.469], .016, .625);
    body.cylinder('black', [0, .036, -.435], .018, .533);
    body.ring('edge', [0, .076, -.786], .012, .0035);
    body.cylinder('black', [0, .076, -.789], .010, .001);
    body.box('steel', [0, .049, -.687], [.043, .066, .018]);
    body.box('black', [0, .096, -.748], [.025, .034, .032]);
    body.cylinder('brass', [0, .118, -.75], .004, .008, 'y');
    body.box('black', [0, .11, .029], [.033, .021, .036]);
    body.profile('wood', [[.061, -.013], [.221, -.05], [.228, -.139], [.174, -.157], [.079, -.093], [.011, -.025]], .061);
    body.box('rubber', [0, -.102, .224], [.072, .108, .018], [.09, 0, 0]);
    body.box('wood', [0, -.079, .039], [.056, .104, .059], [-.35, 0, 0]);
    pumpParts.box('wood', [0, .028, -.398], [.078, .076, .184]);
    for (let i = 0; i < 9; i++) pumpParts.ring('black', [0, .034, -.318 - i * .020], .038, .0028);
    for (const side of [-1, 1]) body.cylinder('steel', [side * .024, .015, -.20], .004, .265);
    for (let i = 0; i < 3; i++) {
      body.cylinder('shell', [-.05, .04, -.007 - i * .04], .007, .049, 'y');
      body.cylinder('brass', [-.05, .067, -.007 - i * .04], .008, .009, 'y');
    }
    boltParts.box('edge', [.039, .052, -.04], [.005, .037, .095]);
    receiverDetails(body, -.065, .11);
  } else {
    body.profile('rubber', [[.031, .039], [-.162, .039], [-.17, .005], [-.079, -.003], [-.03, -.127], [.039, -.111]], .058);
    body.box('rubber', [0, -.069, .009], [.061, .106, .061], [-.24, 0, 0]);
    for (const side of [-1, 1]) {
      body.box('black', [side * .030, -.066, .014], [.002, .074, .042], [-.24, 0, 0]);
      for (let i = 0; i < 5; i++) body.box('glove', [side * .032, -.04 - i * .012, .009 + i * .003], [.001, .0008, .023], [0, 0, 0], false);
    }
    body.path('black', [[-.022, .014, -.044], [-.024, -.045, -.068], [-.024, -.045, -.104], [-.023, .016, -.107]], .004);
    body.path('steel', [[0, .014, -.066], [0, -.014, -.071], [0, -.026, -.063]], .0028);
    body.cylinder('steel', [0, .069, -.139], .0115, .115);
    body.cylinder('black', [0, .069, -.197], .0085, .001);
    boltParts.box('steel', [0, .068, -.078], [.063, .050, .220]);
    boltParts.box('edge', [0, .097, -.085], [.041, .009, .18]);
    boltParts.box('black', [.032, .077, -.070], [.0017, .02, .058], [0, 0, 0], false);
    boltParts.box('brass', [.033, .078, -.05], [.001, .009, .012], [0, 0, 0], false);
    for (const side of [-1, 1]) for (let i = 0; i < 6; i++) boltParts.box('black', [side * .032, .072, -.009 + i * .005], [.002, .032, .002], [0, 0, 0], false);
    boltParts.box('black', [0, .108, -.167], [.009, .017, .012]);
    for (const side of [-1, 1]) {
      boltParts.box('black', [side * .018, .108, .007], [.009, .018, .018]);
      boltParts.box('edge', [side * .018, .11, .017], [.003, .004, .001], [0, 0, 0], false);
    }
    body.box('steel', [-.034, .026, -.017], [.005, .009, .044]);
    body.box('black', [0, .062, .043], [.022, .028, .014], [.18, 0, 0]);
    movingMagazine.box('steel', [0, -.065, .012], [.037, .102, .043], [-.24, 0, 0]);
    movingMagazine.box('black', [0, -.121, .026], [.064, .017, .067], [-.24, 0, 0]);
  }
  body.finish(root, 'receiver'); movingMagazine.finish(magazine, 'detachable-magazine');
  boltParts.finish(bolt, 'charging-and-bolt'); pumpParts.finish(pump, 'sliding-fore-end');
  addMarking(kind === 'pistol' ? bolt : root, kind, kind === 'pistol' ? -.074 : -.105, kind === 'pistol' ? -.0327 : -.0405);
  const muzzle = new THREE.Object3D(); muzzle.name = 'muzzle'; muzzle.position.set(...dimensions[kind].muzzle); root.add(muzzle);
  const eject = new THREE.Object3D(); eject.name = 'eject';
  eject.position.set(kind === 'pistol' ? .042 : .052, kind === 'shotgun' ? .075 : .065, kind === 'smg' ? -.19 : -.075);
  root.add(eject);
  return root;
}

function hand(parent: THREE.Group, side: 'left' | 'right'): THREE.Group {
  const root = namedGroup(parent, `${side}-hand`), b = new Builder(), handed = side === 'left' ? -1 : 1;
  // A padded palm, articulated knuckle guard and short segmented fingers read
  // as a real tactical glove. The fingers stay broad and overlap the grip so
  // the hand does not collapse into separated cartoon tubes at close range.
  b.box('glove', [0, 0, 0], [.068, .045, .085], [0, 0, .08]);
  b.box('rubber', [0, .022, .003], [.052, .012, .060]);
  b.box('edge', [0, .035, -.014], [.056, .006, .014], [0, 0, .08]);
  for (let i = 0; i < 4; i++) {
    const x = -.034 + i * .022;
    const curl = -.035 + Math.abs(i - 1.5) * .006;
    b.cylinder('glove', [x*.82, -.001, -.032], .007, .034, 'z');
    b.cylinder('glove', [x*.82, -.016, -.056], .006, .022, 'z');
    b.box('edge', [x*.82, -.027, -.066], [.010, .004, .009], [curl + .18, 0, handed * (i - 1.5) * .055], false);
  }
  b.box('glove', [side === 'left' ? .033 : -.033, -.005, -.010], [.014, .022, .046], [0, 0, handed * -.22]);
  b.box('glove', [side === 'left' ? .039 : -.039, -.021, -.038], [.012, .014, .024], [.18, 0, handed * -.28]);
  b.cylinder('cloth', [0, -.008, .056], .034, .050);
  b.box('black', [0, .022, .054], [.062, .007, .015]);
  b.finish(root, `${side}-articulated-glove`); return root;
}

function forearm(parent: THREE.Group, side: 'left' | 'right'): THREE.Group {
  const root = namedGroup(parent, `${side}-forearm`), b = new Builder();
  // Bare forearm and rolled sleeve, like a classic tactical viewmodel. A
  // shaped silhouette replaces the old straight tube from wrist to screen edge.
  const sleeve=new THREE.LatheGeometry([
    new THREE.Vector2(.028,0),new THREE.Vector2(.032,.09),
    new THREE.Vector2(.039,.30),new THREE.Vector2(.047,.58),
    new THREE.Vector2(.044,.79),new THREE.Vector2(.043,1),
  ],18);
  b.add('cloth',sleeve,[0,0,0],[0,0,0],[1,1,.82]);sleeve.dispose();
  b.cylinder('cloth', [0, .075, 0], .034, .12, 'y', .037);
  b.cylinder('cloth', [0, .16, 0], .043, .075, 'y', .043);
  b.box('glove', [0, .30, -.030], [.036, .062, .008]);
  b.cylinder('rubber', [0, .035, 0], .027, .060, 'y');
  b.box('black', [0, .045, -.028], [.030, .030, .006]);
  b.finish(root, `${side}-sleeve`); return root;
}

interface ViewRig {
  kind: WeaponKind; pivot: THREE.Group; magazine: THREE.Object3D; bolt: THREE.Object3D; pump: THREE.Object3D;
  left: THREE.Group; right: THREE.Group; leftForearm?: THREE.Group; rightForearm?: THREE.Group; shell: THREE.Group;
  motion: number; swayX: number; swayY: number; lastYaw: number; lastPitch: number; loading: boolean; loadCount: number;
  lastTime: number | null; view: boolean;
}

/** Grip sockets target the anatomical wrist, not the middle of the palm.
 * In socket space -Z points from wrist toward fingers, +Y is the back of the
 * hand (palm normal -Y), and +X points toward the left-hand thumb/right pinky.
 * A character wrist therefore needs its bind-pose palm basis mapped to these
 * axes; blindly copying a Mixamo bone quaternion uses a different local basis. */
function gripSockets(root: THREE.Group, left: THREE.Group, right: THREE.Group): void {
  const leftSocket = namedGroup(left, 'gripLeft'), rightSocket = namedGroup(right, 'gripRight');
  leftSocket.position.set(0, -.006, .055); rightSocket.position.set(0, -.006, .055);
  root.userData.grips = { left: leftSocket, right: rightSocket };
}

function loadingShell(parent: THREE.Group): THREE.Group {
  const shell = namedGroup(parent, 'reload-shell'), b = new Builder();
  b.cylinder('shell', [0, 0, 0], .0075, .034); b.cylinder('brass', [0, 0, .019], .008, .007);
  b.finish(shell, 'shell'); shell.visible = false; return shell;
}

export function createViewWeapon(kind: WeaponKind): THREE.Group {
  if (!assemblyTemplates.has(kind)) assemblyTemplates.set(kind, buildAssembly(kind));
  const root = new THREE.Group(); root.name = `viewmodel:${kind}`;
  const pivot = namedGroup(root, 'weapon-pivot');
  const gun=kind==='pistol'&&berettaAsset?berettaAssembly():kind==='rifle'&&akAsset?akAssembly():assemblyTemplates.get(kind)!.clone(true); pivot.add(gun);
  const left = hand(pivot, 'left'), right = hand(pivot, 'right');
  const leftForearm = forearm(pivot, 'left'), rightForearm = forearm(pivot, 'right');
  const shell = loadingShell(pivot);
  root.userData.rig = { kind, pivot, magazine: gun.getObjectByName('magazine')!, bolt: gun.getObjectByName('bolt')!, pump: gun.getObjectByName('pump')!,
    left, right, leftForearm, rightForearm, shell, motion: 0, swayX: 0, swayY: 0, lastYaw: 0, lastPitch: 0, loading: false, loadCount: 1, lastTime: null, view: true } as ViewRig;
  root.userData.muzzle = root.getObjectByName('muzzle');
  root.userData.pose = { phase: 'ready', progress: 0, magazineOffset: 0, boltTravel: 0, weapon: kind };
  left.position.set(...supportSocket(kind)); right.position.set(...primaryGripSocket(kind));
  gripSockets(root, left, right);
  positionForearm(leftForearm, left.position, [-.22, -.29, .34]);
  positionForearm(rightForearm, right.position, [.19, -.30, .36]);
  return root;
}

function berettaAssembly():THREE.Group{
  const gun=berettaAsset!.clone(true);gun.name='beretta-apx-a1';
  // Sockets are authored against the normalized model and keep muzzle flash,
  // casing ejection and reload choreography compatible with every weapon rig.
  const magazine=namedGroup(gun,'magazine'),bolt=namedGroup(gun,'bolt'),pump=namedGroup(gun,'pump');
  magazine.position.set(0,-.09,.035);bolt.position.set(0,.035,-.055);
  const muzzle=new THREE.Object3D();muzzle.name='muzzle';muzzle.position.set(0,.063,-.115);gun.add(muzzle);
  const eject=new THREE.Object3D();eject.name='eject';eject.position.set(.047,.037,-.055);gun.add(eject);
  return gun;
}

function importedSockets(gun:THREE.Group, muzzle:V3, eject:V3):THREE.Group{
  // Imported exports often name the complete receiver "Magazine_Low.*".
  // Keep that mesh static and use dedicated empty sockets for animation.
  const magazine=gun.getObjectByName('magazine')??namedGroup(gun,'magazine');
  magazine.name='magazine';
  if(!gun.getObjectByName('bolt'))namedGroup(gun,'bolt');
  if(!gun.getObjectByName('pump'))namedGroup(gun,'pump');
  const muzzleNode=new THREE.Object3D();muzzleNode.name='muzzle';muzzleNode.position.set(...muzzle);gun.add(muzzleNode);
  const ejectNode=new THREE.Object3D();ejectNode.name='eject';ejectNode.position.set(...eject);gun.add(ejectNode);
  return gun;
}

function akAssembly():THREE.Group{
  const gun=akAsset!.clone(true);gun.name='ss2-v5-a1';
  // The asset contains three exported LOD/variant bodies. Keep the detailed
  // first body and hide the duplicate variants so the viewmodel is singular.
  const rootNode=gun.getObjectByName('RootNode');
  if(rootNode){
    const variants=rootNode.children.filter(o=>/Magazine_Low/i.test(o.name));
    variants.slice(1).forEach(o=>o.visible=false);
  }
  // Keep the original mesh names for socket inspection; the parent visibility
  // filter above removes the duplicate exported bodies.
  // Normalized dimensions: muzzle at roughly -Z, magazine and trigger near
  // the origin. These sockets are also used by third-person arm IK.
  const result=importedSockets(gun,[0,.030,-.385],[.052,.030,-.055]);

  // Viewmodel-only wrist targets. They live in the same pivot space as the
  // hands, so the palm and forearm can follow the receiver without guessing
  // from the imported mesh's nested FBX transforms.
  const support=new THREE.Object3D();support.name='grip-support';support.position.set(-.030,-.065,-.165);result.add(support);
  const primary=new THREE.Object3D();primary.name='grip-primary';primary.position.set(.024,-.086,.092);result.add(primary);
  return result;
}

/** Third-person model shares immutable geometry/materials, while owning its
 * moving magazine, bolt, pump and grip guides. No hand/arm meshes are included. */
export function createHeldWeapon(kind: WeaponKind): THREE.Group {
  if (!assemblyTemplates.has(kind)) assemblyTemplates.set(kind, buildAssembly(kind));
  const root = new THREE.Group(); root.name = `held:${kind}`;
  const pivot = namedGroup(root, 'weapon-pivot'), gun = kind==='rifle'&&akAsset?akAssembly():assemblyTemplates.get(kind)!.clone(true); pivot.add(gun);
  const left = namedGroup(pivot, 'left-grip-pose'), right = namedGroup(pivot, 'right-grip-pose');
  const shell = kind === 'shotgun' ? loadingShell(pivot) : namedGroup(pivot, 'reload-shell');
  root.userData.rig = { kind, pivot, magazine: gun.getObjectByName('magazine')!, bolt: gun.getObjectByName('bolt')!, pump: gun.getObjectByName('pump')!,
    left, right, shell, motion: 0, swayX: 0, swayY: 0, lastYaw: 0, lastPitch: 0, loading: false, loadCount: 1, lastTime: null, view: false } as ViewRig;
  left.position.set(...supportSocket(kind)); right.position.set(...primaryGripSocket(kind));
  gripSockets(root, left, right);
  root.userData.muzzle = root.getObjectByName('muzzle');
  root.userData.pose = { phase: 'ready', progress: 0, magazineOffset: 0, boltTravel: 0, weapon: kind };
  return root;
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));
function ease(from: number, to: number, value: number): number { const n = clamp((value - from) / (to - from)); return n * n * (3 - 2 * n); }
function lerpPose(target: THREE.Vector3, start: V3, end: V3, value: number): void {
  target.set(start[0] + (end[0] - start[0]) * value, start[1] + (end[1] - start[1]) * value, start[2] + (end[2] - start[2]) * value);
}
function positionForearm(arm: THREE.Group, wrist: THREE.Vector3, elbow: V3): void {
  arm.position.copy(wrist); scratchA.set(...elbow).sub(wrist); arm.quaternion.setFromUnitVectors(UP, scratchB.copy(scratchA).normalize()); arm.scale.y = scratchA.length();
}

/** Animation is entirely inside weapon-pivot. The caller owns the root transform.
 * Reload stages derive from simulation reloadLeft so pausing/captures stay exact. */
function updateWeaponRig(group: THREE.Group, actor: Actor, time: number, delta: number): void {
  const r = group.userData.rig as ViewRig;
  if (!r) return;
  if (r.lastTime === null || time < r.lastTime) {
    r.lastYaw = actor.yaw; r.lastPitch = actor.pitch; r.motion = r.swayX = r.swayY = 0; r.loading = false;
  }
  r.lastTime = time;
  const kind = r.kind, gun = actor.guns[kind], duration = WEAPONS[kind].reload;
  const loading = gun.reloadLeft > 0, p = loading ? clamp(1 - gun.reloadLeft / duration) : 0;
  if (loading && !r.loading) r.loadCount = Math.max(1, Math.min(6, WEAPONS[kind].magazine - gun.ammo));
  r.loading = loading;
  const dt = Math.min(.1, Math.max(0, delta));
  r.motion = THREE.MathUtils.damp(r.motion, actor.moving ? 1 : 0, 10, dt);
  const yawDelta = Math.atan2(Math.sin(actor.yaw - r.lastYaw), Math.cos(actor.yaw - r.lastYaw));
  r.swayX = THREE.MathUtils.damp(r.swayX, THREE.MathUtils.clamp(yawDelta * 1.8, -.035, .035), 10, dt);
  r.swayY = THREE.MathUtils.damp(r.swayY, THREE.MathUtils.clamp((actor.pitch - r.lastPitch) * 1.4, -.022, .022), 10, dt);
  r.lastYaw = actor.yaw; r.lastPitch = actor.pitch;
  const age = time - actor.shotTime, firing = age >= 0 && age < .7 && !loading && actor.weapon === kind;
  // A fast impulse followed by a soft return reads as a mechanical cycle,
  // instead of a linear animation that simply slides the whole gun backward.
  const kick = firing ? Math.exp(-age * 24) * (1 - Math.exp(-age * 155)) : 0;
  const settle = firing ? Math.sin(Math.min(age, .24) * 42) * Math.exp(-age * 18) : 0;
  const lift = loading ? ease(0, .15, p) * (1 - ease(.88, 1, p)) : 0;
  const stride = time * (actor.crouched ? 8 : 11), motion = r.motion * (loading ? .2 : 1);
  const presentation = WEAPON_PRESENTATION[kind];
  const importedRifle=kind==='rifle'&&akAsset&&r.view;
  r.pivot.position.set(Math.sin(stride) * .006 * motion - r.swayX - lift * .05, Math.abs(Math.cos(stride)) * .009 * motion + lift * (r.view ? .12 : .12) + r.swayY, kick * presentation.recoilDistance - lift * (r.view ? .04 : 0) + settle * .004);
  r.pivot.rotation.set(kick * presentation.recoilPitch + lift * .11, (r.view ? .19 : 0) + r.swayX * 1.7 + lift * (r.view ? .16 : -.19), Math.sin(stride) * .009 * motion - lift * (kind === 'pistol' ? .42 : .32) + kick * presentation.recoilYaw + settle * .012);
  r.magazine.position.set(0, 0, 0); r.magazine.rotation.set(0, 0, 0); r.bolt.position.z = kick * (kind === 'pistol' ? .039 : .023);
  if(importedRifle)r.magazine.visible=true;
  const pumpCycle = firing && kind === 'shotgun' ? ease(.09, .21, age) * (1 - ease(.34, .48, age)) : 0;
  r.pump.position.z = pumpCycle * .112;
  r.left.position.set(...supportSocket(kind)); r.left.position.z += r.pump.position.z;
  // Palm faces up/inward; curled fingers wrap across the fore-end, rather
  // than presenting the dorsal glove pad to the underside of the barrel.
  r.left.rotation.set(kind === 'pistol' ? .30 : importedRifle ? 0 : .12, kind === 'pistol' ? -.06 : importedRifle ? 0 : -Math.PI/2 + .08, kind === 'pistol' ? Math.PI/2 : importedRifle ? Math.PI/2 : Math.PI * .91);
  r.right.position.set(...primaryGripSocket(kind)); r.right.rotation.set(importedRifle ? .10 : .08, importedRifle ? .06 : .12, .025); r.shell.visible = false;
  if(importedRifle&&!loading){
    const support=group.getObjectByName('grip-support'),primary=group.getObjectByName('grip-primary');
    if(support)r.left.position.copy(support.position);
    if(primary)r.right.position.copy(primary.position);
  }
  let phase = firing && kick > .01 ? 'recoil' : pumpCycle > 0 ? 'pump-cycle' : 'ready';
  if (loading && kind === 'shotgun') {
    phase = p < .15 ? 'tilt-for-loading' : p < .83 ? 'insert-shell' : 'pump-and-settle';
    if (p < .15) lerpPose(r.left.position, supportSocket(kind), [-.15, -.19, .00], ease(0, .15, p));
    else if (p < .83) {
      const cycle = clamp((p - .15) / .68) * r.loadCount, local = cycle % 1;
      const insert = Math.sin(local * Math.PI);
      lerpPose(r.left.position, [-.15, -.22, .025], [-.018, -.066, -.065], insert);
      r.left.rotation.z = -.6 * insert; r.shell.visible = local > .08 && local < .78;
      r.shell.position.copy(r.left.position).add(scratchA.set(.02, .022, -.027)); r.shell.rotation.set(0, -.2, .25);
      phase = `insert-shell-${Math.min(r.loadCount, Math.floor(cycle) + 1)}`;
    } else {
      lerpPose(r.left.position, [-.018, -.066, -.065], supportSocket(kind), ease(.83, .9, p));
      r.pump.position.z = .11 * ease(.88, .93, p) * (1 - ease(.95, 1, p)); r.left.position.z += r.pump.position.z;
    }
    r.bolt.position.z = r.pump.position.z * .55;
  } else if (loading) {
    const magY = kind === 'pistol' ? -.074 : -.136, magZ = kind === 'pistol' ? .015 : -.12;
    const grasp: V3 = importedRifle ? [-.008,-.108,-.040] : [-.052, magY, magZ];
    const lowered: V3 = importedRifle ? [-.008,-.353,.087] : [-.07, magY - .225, magZ + .12];
    const rackGrip: V3 = importedRifle ? [.062,.030,-.045] : kind === 'pistol' ? [-.038, .092, -.03] : kind === 'smg' ? [-.05, .108, -.293] : [.054, .085, -.036];
    const out = ease(.18, .38, p) * (1 - ease(.53, .73, p));
    r.magazine.position.y = -.245 * out; r.magazine.position.z = .10 * out;
    r.magazine.rotation.x = -.25 * out;
    const supportPose:V3=importedRifle?[-.030,-.065,-.165]:supportSocket(kind);
    if (p < .18) { phase = 'grasp-magazine'; lerpPose(r.left.position, supportPose, grasp, ease(0, .18, p));  }
    else if (p < .38) { phase = 'magazine-out'; lerpPose(r.left.position, grasp, lowered, ease(.18, .38, p));  }
    else if (p < .53) { phase = 'retrieve-magazine'; r.left.position.set(...lowered); r.left.position.x -= Math.sin(ease(.38, .53, p) * Math.PI) * .065; }
    else if (p < .73) { phase = 'insert-magazine'; lerpPose(r.left.position, lowered, grasp, ease(.53, .73, p)); }
    else if (p < .8) { phase = 'seat-magazine'; r.left.position.set(...grasp); r.left.position.y += Math.sin((p - .73) / .07 * Math.PI) * .018; }
    else if (p < .93) {
      phase = 'rack-bolt'; lerpPose(r.left.position, grasp, rackGrip, ease(.8, .85, p));
      r.bolt.position.z = (kind === 'pistol' ? .047 : .075) * ease(.83, .88, p) * (1 - ease(.89, .93, p)); r.left.position.z += r.bolt.position.z;
    } else { phase = 'return-to-ready'; lerpPose(r.left.position, rackGrip, supportPose, ease(.93, 1, p)); }
    const gripMix=ease(0,.16,p)*(1-ease(.93,1,p));
    if(kind!=='pistol'){r.left.rotation.y=THREE.MathUtils.lerp(importedRifle?0:-Math.PI/2,-.15,gripMix);r.left.rotation.z=THREE.MathUtils.lerp(importedRifle?Math.PI/2:Math.PI,-.25,gripMix);}
    r.left.rotation.z -= out * .45;
    if(importedRifle && p >= .18 && p < .8){
      // A single magazine-local contact drives the supporting wrist throughout extraction/insertion.
      r.left.position.set(...grasp).applyEuler(r.magazine.rotation).add(r.magazine.position);
    }
  }
  // Elbows stay below the first-person frame while the wrists follow the raised gun.
  // Otherwise the open sleeve caps float visibly in the middle of a reload.
  if (r.leftForearm) {wristSocket.set(0,-.006,.055).applyEuler(r.left.rotation).add(r.left.position);positionForearm(r.leftForearm,wristSocket,[-.22,-.29-lift*.48,.34+lift*.12]);}
  if (r.rightForearm) {wristSocket.set(0,-.006,.055).applyEuler(r.right.rotation).add(r.right.position);positionForearm(r.rightForearm,wristSocket,[.19,-.30-lift*.48,.36+lift*.12]);}
  const pose = group.userData.pose;
  pose.phase = phase; pose.progress = p; pose.magazineOffset = r.magazine.position.y; pose.boltTravel = r.bolt.position.z;
  pose.pumpTravel = r.pump.position.z; pose.recoil = +kick.toFixed(3); pose.leftHand = { x: r.left.position.x, y: r.left.position.y, z: r.left.position.z };
}

export function updateViewWeapon(group: THREE.Group, actor: Actor, time: number, delta: number): void {
  updateWeaponRig(group, actor, time, delta);
}

/** Called before solving the character hands. A stationary simulation clock
 * yields zero animation delta, so pausing cannot drift the grip or reload pose. */
export function updateHeldWeapon(group: THREE.Group, actor: Actor, time: number): void {
  const r = group.userData.rig as ViewRig;
  const delta = r.lastTime === null ? 0 : Math.max(0, Math.min(.1, time - r.lastTime));
  updateWeaponRig(group, actor, time, delta);
}
