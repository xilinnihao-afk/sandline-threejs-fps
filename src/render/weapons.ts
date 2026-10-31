import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { WEAPONS } from '../game/simulation';
import { FIREARM_KINDS,isHandgun, type Actor, type WeaponKind } from '../game/types';
import {createKnifeModel,knifeAssetSource} from './knifeModel';
import {MELEE_ATTACKS} from '../game/melee';
import {weaponRackPose} from '../game/weaponSwitch';
import {prepareSmgChargingHandle} from './smgChargingHandle';
import {createClassicAkView,updateClassicAkView} from './classicAk';
import {CLASSIC_VIEW_CONTACTS} from './classicHandContacts';
import {sampleKnifeMotion,KNIFE_VIEW_GRIP_ROTATION,KNIFE_ACTION_GRIP_ROTATION,KNIFE_VIEW_READY_ADJUSTMENT} from './knifeMotion';

// Original, articulated weapon models. Metres, +Y up, -Z forward; the trigger
// is close to the origin. Static details are merged by material, not drawn singly.
type Surface = 'steel' | 'edge' | 'black' | 'wood' | 'rubber' | 'cloth' | 'glove' | 'skin' | 'brass' | 'shell';
type V3 = readonly [number, number, number];
const geometryCache = new Map<string, THREE.BufferGeometry>();
let surfaces: Record<Surface, THREE.MeshStandardMaterial> | undefined;
let markingMaterial: THREE.MeshBasicMaterial | undefined;
const assemblyTemplates = new Map<WeaponKind, THREE.Group>();
const importedAssets = new Map<WeaponKind, THREE.Group>();
let importedAssetLoad: Promise<void> | undefined;
function activeAsset(kind: WeaponKind): THREE.Group | undefined {
  return importedAssets.get(kind);
}
export function weaponAssetSource(kind: WeaponKind): string {
  return kind==='knife'?knifeAssetSource():activeAsset(kind)?.userData.assetSource ?? 'procedural';
}
const scratchA = new THREE.Vector3();
// Independent left-hand guard: back of glove visible, index above thumb.
const knifeSupportInverse=new THREE.Quaternion(),knifeSupportRotation=new THREE.Quaternion().setFromEuler(new THREE.Euler(1.4818965,-.5430672,-1.5936480));
// Close the guard ten degrees toward the knife hand in the body frame,
// exposing a little more of the finger pads while keeping the palm open.
const knifeViewSupportRotation=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),-Math.PI/18)
 .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(1.28578,-.280016,-1.939283)))
 // Supinate gently about the forearm's elbow-to-wrist direction so the
 // staggered finger pads stay readable beside the back of the glove.
 .premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(.60,.50,-.70).normalize(),Math.PI*2/15));
const knifeStrokeGrip=new THREE.Quaternion(),knifeViewGripInverse=KNIFE_VIEW_GRIP_ROTATION.clone().invert(),knifeReadyAdjustment=new THREE.Quaternion();
const dimensions: Record<WeaponKind, { muzzle: V3; support: V3; label: string; row: number }> = {
  knife: {muzzle:[.014,.281,0],support:[-.3087,-.0048,-.0346],label:'FIELD KNIFE',row:6},
  m4: { muzzle: [0, .061, -.646], support: [-.033, .016, -.30], label: 'M4 / 5.56', row: 4 },
  sniper: { muzzle: [0, .061, -.876], support: [-.036, -.012, -.365], label: 'AWP / .338', row: 5 },
  rifle: { muzzle: [0, .066, -.686], support: [-.044, -.014, -.324], label: 'AK-47 / 7.62', row: 0 },
  smg: { muzzle: [0, .061, -.501], support: [-.043, -.013, -.303], label: 'MP5 / 9×19', row: 1 },
  shotgun: { muzzle: [0, .076, -.788], support: [-.045, -.001, -.398], label: 'NOVA / 12 GA', row: 2 },
  deagle: {muzzle:[0,.069,-.225],support:[-.039,-.015,-.030],label:'DEAGLE / .50 AE',row:3},
  pistol: { muzzle: [0, .069, -.199], support: [-.047, -.071, -.044], label: 'USP / .45', row: 3 },
};
// Presentation contacts measured on the imported gun fore-ends. These are palm
// centres; gripSockets adds the anatomical wrist offset in the rotated basis.
const importedSupport: Record<WeaponKind,V3> = {
  knife:[-.3087,-.0048,-.0346],
  rifle: [-.015,-.023,-.405], sniper: [-.010,-.055,-.380],
  m4: [-.012,.012,-.330], smg: [-.012,-.010,-.315],
  deagle: [-.039,-.015,-.030],
  shotgun: [-.010,.004,-.430], pistol: [-.039,-.015,-.030],
};
function supportSocket(kind:WeaponKind,view=false):V3 {
  if(view&&CLASSIC_VIEW_CONTACTS[kind])return CLASSIC_VIEW_CONTACTS[kind]!.left;
  if (weaponAssetSource(kind)==='sketchfab') return importedSupport[kind];
  return activeAsset(kind)?.userData.weaponSockets?.support ?? dimensions[kind].support;
}
function primaryGripSocket(kind:WeaponKind,view=false):V3 {
  if(view&&CLASSIC_VIEW_CONTACTS[kind])return CLASSIC_VIEW_CONTACTS[kind]!.right;
  if(kind==='knife')return [.018,-.009,.012];
  // These imported grips differ from the authored models. Calibrate the palm
  // against actual grip triangles rather than reusing the old generic anchor.
  if(weaponAssetSource(kind)==='sketchfab'){
    if(kind==='rifle')return [.038,-.060,-.020];
    if(kind==='smg')return [.038,-.065,-.090];
    if(kind==='deagle')return [.014762,-.023001,-.011958];
    if(isHandgun(kind))return [.020,-.025,.000];
  }
  return activeAsset(kind)?.userData.weaponSockets?.primaryGrip ?? (isHandgun(kind) ? [.024,-.070,.024] : [.024,-.095,.032]);
}

/** Load the mobile derivatives once, for both maps before creating any weapon views.
 * Originals remain in assets-source; the browser never requests those 500 MiB. */
export function loadImportedWeaponAssets(maxTextureAnisotropy = 1): Promise<void> {
  return importedAssetLoad ??= (async () => {
    const loaded = await Promise.all(FIREARM_KINDS.map(async kind => {
      const gltf = await new GLTFLoader().loadAsync(`${(import.meta.env?.BASE_URL ?? "/")}assets/runtime/${kind}.glb?v=glb3-20261023`);
      const source = gltf.scene;
      if(kind==='smg')prepareSmgChargingHandle(source);
      // glTF scene extras and the authored root node's extras are separate.
      const metadata = source.getObjectByName(`sketchfab-${kind}`)?.userData;
      if (metadata) Object.assign(source.userData, metadata);
      source.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        object.castShadow = object.receiveShadow = true;
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          if (!(material instanceof THREE.MeshStandardMaterial)) continue;
          for (const texture of [material.map, material.normalMap, material.roughnessMap, material.metalnessMap, material.aoMap]) {
            if (texture) texture.anisotropy = Math.max(1, Math.min(4, maxTextureAnisotropy));
          }
        }
      });
      source.name = `sketchfab:${kind}`;
      source.userData.assetSource = 'sketchfab';
      source.userData.assetKind = kind;
      return [kind, source] as const;
    }));
    for (const [kind, source] of loaded) importedAssets.set(kind, source);
  })().catch(error => { importedAssetLoad = undefined; throw error; });
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
  knife: {recoilDistance:0,recoilPitch:0,recoilYaw:0,cameraKick:.008,flashScale:0,tracerChance:0},
  m4: { recoilDistance: .045, recoilPitch: .063, recoilYaw: .010, cameraKick: .025, flashScale: .14, tracerChance: .62 },
  sniper: { recoilDistance: .115, recoilPitch: .145, recoilYaw: .018, cameraKick: .080, flashScale: .24, tracerChance: 1 },
  rifle: { recoilDistance: .054, recoilPitch: .072, recoilYaw: .012, cameraKick: .030, flashScale: .16, tracerChance: .62 },
  smg: { recoilDistance: .030, recoilPitch: .045, recoilYaw: .018, cameraKick: .020, flashScale: .14, tracerChance: .56 },
  deagle: {recoilDistance:.090,recoilPitch:.155,recoilYaw:.018,cameraKick:.062,flashScale:.20,tracerChance:.85},
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
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 512;
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
  for (let i = 0; i < uv.count; i++) uv.setY(i, (uv.getY(i) + 7 - dimensions[kind].row) / 8);
  const mark = new THREE.Mesh(plane, markingMaterial); mark.name = 'engraved-calibre-and-serial';
  mark.position.set(x, .041, z); mark.rotation.y = -Math.PI / 2; parent.add(mark);
}

function buildAssembly(kind: WeaponKind): THREE.Group {
  const root = new THREE.Group(); root.name = `weapon-assembly:${kind}`;
  const body = new Builder(), movingMagazine = new Builder(), boltParts = new Builder(), pumpParts = new Builder();
  const magazine = namedGroup(root, 'magazine'), bolt = namedGroup(root, 'bolt'), pump = namedGroup(root, 'pump');
  if (kind === 'm4' || kind === 'sniper') {
    const sniper = kind === 'sniper', barrelY = sniper ? .076 : .066;
    body.profile('steel', [[.04, -.014], [-.245, -.014], [-.26, .060], [-.225, .102], [.035, .096]], .070);
    body.cylinder('steel', [0, barrelY, sniper ? -.575 : -.49], sniper ? .015 : .010, sniper ? .64 : .40);
    body.cylinder('black', [0, barrelY, sniper ? -.875 : -.675], .019, .048);
    body.ring('edge', [0, barrelY, sniper ? -.90 : -.70], .012, .003);
    body.profile(sniper ? 'rubber' : 'black', [[-.25,.013],[-.48,.013],[-.49,.061],[-.27,.075]], .075);
    body.box('rubber', [0,-.080,.016], [.050,.125,.062], [-.26,0,0]);
    body.cylinder('steel', [0,.034,.125], .019,.20);
    body.profile('rubber', [[.055,.05],[.252,.048],[.262,-.118],[.214,-.129],[.083,-.017]], .065);
    body.box('rubber',[0,-.037,.258],[.075,.180,.021]);
    body.box('black',[0,.112,-.125],[.05,.013,.25]);
    for(let i=0;i<10;i++)body.box('edge',[0,.120,-.016-i*.024],[.051,.004,.008], [0,0,0],false);
    if(sniper){
      // Scope rings share the receiver rail datum, supporting the full optic.
      for(const z of [-.075,-.235]){
        body.box('black',[0,.145,z],[.045,.05,.025]);
        body.ring('steel',[0,.178,z],.028,.005);
      }
      body.cylinder('black',[0,.178,-.16],.024,.32);
      body.cylinder('black',[0,.178,-.342],.038,.068,'z',.026);
      body.cylinder('black',[0,.178,.014],.030,.035);
      body.cylinder('edge',[0,.178,-.377],.031,.002);
      body.cylinder('black',[0,.218,-.15],.017,.034,'y');
      boltParts.cylinder('steel',[0,.080,-.066],.023,.16);
      boltParts.cylinder('steel',[.052,.070,.004],.006,.10,'x');
      boltParts.cylinder('black',[.098,.057,.004],.014,.025,'y');
      movingMagazine.profile('steel',[[-.191,-.012],[-.10,-.012],[-.10,-.122],[-.191,-.122]],.054);
      body.box('rubber',[0,.071,.166],[.068,.053,.13]);
    }else{
      body.profile('black',[[-.215,.123],[-.215,.178],[-.047,.178],[-.047,.123]],.016);
      body.box('black',[0,.18,-.132],[.044,.017,.195]);
      body.box('steel',[0,.110,-.552],[.02,.095,.018]);
      body.ring('black',[0,.156,-.552],.016,.004);
      for(let i=0;i<9;i++)body.box('black',[0,.08,-.279-i*.023],[.073,.016,.010]);
      movingMagazine.profile('steel',[[-.20,-.012],[-.126,-.012],[-.105,-.207],[-.181,-.216]],.048);
      for(const x of [-.025,.025])for(let i=0;i<3;i++)movingMagazine.box('black',[x,-.116,-.184+i*.018],[.002,.157,.004]);
      boltParts.box('edge',[.038,.065,-.10],[.010,.026,.10]);
    }
    receiverDetails(body,-.11,.17);
  } else if (kind === 'rifle') {
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
  addMarking(isHandgun(kind) ? bolt : root, kind, isHandgun(kind) ? -.074 : -.105, isHandgun(kind) ? -.0327 : -.0405);
  const muzzle = new THREE.Object3D(); muzzle.name = 'muzzle'; muzzle.position.set(...dimensions[kind].muzzle); root.add(muzzle);
  const eject = new THREE.Object3D(); eject.name = 'eject';
  eject.position.set(isHandgun(kind) ? .042 : .052, kind === 'shotgun' ? .075 : .065, kind === 'smg' ? -.19 : -.075);
  root.add(eject);
  return root;
}

interface ViewRig {
  kind: WeaponKind; pivot: THREE.Group; magazine: THREE.Object3D; bolt: THREE.Object3D; pump: THREE.Object3D;
  left: THREE.Group; right: THREE.Group; shell: THREE.Group;
  motion: number; swayX: number; swayY: number; lastYaw: number; lastPitch: number; loading: boolean; loadCount: number;
  lastTime: number | null; view: boolean; stridePhase?: number;
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
  // 12-gauge loaded shell: 58 mm overall, brass head toward the loading hand.
  b.cylinder('shell', [0, 0, -.004], .0095, .050); b.cylinder('brass', [0, 0, .024], .0102, .010);
  b.finish(shell, 'shell'); shell.visible = false; return shell;
}

export function createViewWeapon(kind: WeaponKind): THREE.Group {
  if(kind==='rifle'){const classic=createClassicAkView();if(classic)return classic;}
  const root = new THREE.Group(); root.name = `viewmodel:${kind}`;
  const pivot = namedGroup(root, 'weapon-pivot');
  const gun = weaponAssembly(kind); pivot.add(gun);
  root.userData.assetSource = gun.userData.assetSource; root.userData.assetKind = kind;
  const left = namedGroup(pivot, 'left-grip-pose'), right = namedGroup(pivot, 'right-grip-pose');
  const shell = loadingShell(pivot);
  root.userData.rig = { kind, pivot, magazine: gun.getObjectByName('magazine')!, bolt: gun.getObjectByName('bolt')!, pump: gun.getObjectByName('pump')!,
    left, right, shell, motion: 0, swayX: 0, swayY: 0, lastYaw: 0, lastPitch: 0, loading: false, loadCount: 1, lastTime: null, view: true } as ViewRig;
  root.userData.muzzle = root.getObjectByName('muzzle');
  root.userData.pose = { phase: 'ready', progress: 0, magazineOffset: 0, boltTravel: 0, weapon: kind };
  left.position.set(...supportSocket(kind,true)); right.position.set(...primaryGripSocket(kind,true));
  gripSockets(root, left, right);
  return root;
}

function importedSockets(gun:THREE.Group, muzzle:V3, eject:V3):THREE.Group {
  for (const name of ['magazine', 'bolt', 'pump']) if (!gun.getObjectByName(name)) namedGroup(gun, name);
  if (!gun.getObjectByName('muzzle')) {const node=new THREE.Object3D();node.name='muzzle';node.position.set(...muzzle);gun.add(node);}
  if (!gun.getObjectByName('eject')) {const node=new THREE.Object3D();node.name='eject';node.position.set(...eject);gun.add(node);}
  return gun;
}

/** Animation owns zero-origin wrappers; exported mesh bind transforms stay intact. */
function animationWrappers(gun: THREE.Group): THREE.Group {
  for (const name of ['magazine', 'bolt', 'pump']) {
    const part = gun.getObjectByName(name);
    if (!part) { namedGroup(gun, name); continue; }
    const parent = part.parent!;
    part.name = `${name}-bind`;
    const wrapper = namedGroup(parent as THREE.Group, name);
    wrapper.add(part);
  }
  return gun;
}

function weaponAssembly(kind: WeaponKind): THREE.Group {
  if(kind==='knife')return animationWrappers(createKnifeModel());
  let gun: THREE.Group;
  const source = activeAsset(kind);
  if (source) {
    gun = source.clone(true);
    importedSockets(gun, dimensions[kind].muzzle, [.052, .075, -.075]);
    gun.userData.assetSource = source.userData.assetSource;
  } else {
    if (!assemblyTemplates.has(kind)) assemblyTemplates.set(kind, buildAssembly(kind));
    gun = assemblyTemplates.get(kind)!.clone(true);
    gun.userData.assetSource = 'procedural';
  }
  gun.userData.assetKind = kind;
  return animationWrappers(gun);
}

/** Bare gun for floor pickups: caller owns ground pose and height. Geometry and
 * materials are shared, but transforms are independent from held/view rigs. */
export function createGroundWeapon(kind: WeaponKind): THREE.Group {
  const gun = weaponAssembly(kind);
  gun.name = `ground-weapon:${kind}`;
  gun.userData.weapon = kind;
  return gun;
}

/** Third-person model shares immutable geometry/materials, while owning its
 * moving magazine, bolt, pump and grip guides. No hand/arm meshes are included. */
export function createHeldWeapon(kind: WeaponKind): THREE.Group {
  const root = new THREE.Group(); root.name = `held:${kind}`;
  const pivot = namedGroup(root, 'weapon-pivot'), gun = weaponAssembly(kind); pivot.add(gun);
  root.userData.assetSource = gun.userData.assetSource; root.userData.assetKind = kind;
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


// Measured in each imported model's seated frame. The contact is the palm
// anchor; the same rigid transform drives both the magazine and the hand.
const SNOW_RELOAD:Partial<Record<WeaponKind,{contact:V3;travel:V3;rotation:V3;rack:V3}>>={
  deagle:{contact:[-.002,-.065,.010],travel:[0,-.17,.043],rotation:[0,0,Math.PI],rack:[-.026,.078,.009]},
  pistol:{contact:[-.002,-.093,.008],travel:[0,-.17,.043],rotation:[0,0,Math.PI],rack:[-.033,.083,.006]},
  smg:{contact:[-.028,-.115,-.250],travel:[0,-.21,-.018],rotation:[0,0,Math.PI/2],rack:[-.034,.078,-.356]},
  m4:{contact:[-.024,-.090,-.120],travel:[0,-.23,-.025],rotation:[0,0,Math.PI/2],rack:[-.030,.083,.040]},
  sniper:{contact:[-.029,-.023,-.012],travel:[0,-.17,0],rotation:[0,0,Math.PI/2],rack:[.065,.060,.015]},
};
const reloadQuaternion=new THREE.Quaternion();
function blendHandRotation(hand:THREE.Group,rotation:V3,mix:number):void {
  reloadQuaternion.setFromEuler(new THREE.Euler(...rotation));
  hand.quaternion.slerp(reloadQuaternion,mix);
}
function snowMagazineReload(r:ViewRig,p:number):string {
  const cfg=SNOW_RELOAD[r.kind]!,support=supportSocket(r.kind,r.view);
  const out=ease(.18,.38,p)*(1-ease(.53,.73,p));
  r.magazine.position.set(...cfg.travel).multiplyScalar(out);
  // The magazine remains in the grasp during the brief low ready exchange.
  r.magazine.position.x=-.035*Math.sin(Math.PI*ease(.38,.53,p));
  if(p>=.53)r.magazine.position.x=0;
  const contact=scratchA.set(...cfg.contact).add(r.magazine.position);
  if(p<.18)lerpPose(r.left.position,support,cfg.contact,ease(0,.18,p));
  else if(p<.80)r.left.position.copy(contact);
  else if(p<.93){
    lerpPose(r.left.position,cfg.contact,cfg.rack,ease(.8,.85,p));
    // USP slide / AWP bolt are actual moving source pieces. Other guns use
    // the release/charging control without pretending an empty node is a bolt.
    const travel=(isHandgun(r.kind)?.037:r.kind==='sniper'?.095:r.kind==='m4'?.06:0)*ease(.85,.89,p)*(1-ease(.9,.93,p));
    r.bolt.position.z=travel;r.left.position.z+=travel;
    if(r.kind==='sniper')r.bolt.rotation.z=-.55*ease(.81,.85,p)*(1-ease(.9,.93,p));
  }else lerpPose(r.left.position,cfg.rack,support,ease(.93,1,p));
  blendHandRotation(r.left,cfg.rotation,ease(0,.18,p)*(1-ease(.8,1,p)));
  return p<.18?'grasp-magazine':p<.38?'magazine-out':p<.53?'retrieve-magazine':p<.73?'insert-magazine':p<.8?'seat-magazine':p<.93?'rack-bolt':'return-to-ready';
}
function snowShellReload(r:ViewRig,p:number,pose:Record<string,any>):string {
  const support=supportSocket('shotgun',r.view);
  const fetch:V3=[-.045,-.135,-.095],align:V3=[0,-.012,-.129],raised:V3=[0,.043,-.129],seated:V3=[0,.043,-.202];
  // Palm cradles the shell from the side; fingers point along its axis. The
  // final push uses the thumb at the brass head while the palm clears the lip.
  const palmOffset:V3=[-.027,-.010,.018];
  const handAt=(pos:V3):V3=>[pos[0]+palmOffset[0],pos[1]+palmOffset[1],pos[2]+palmOffset[2]];
  blendHandRotation(r.left,[0,0,Math.PI/2],ease(0,.15,p)*(1-ease(.83,.94,p)));
  const gate=r.pivot.getObjectByName('loading-gate');
  let phase='tilt-for-loading';
  if(p<.15)lerpPose(r.left.position,support,handAt(fetch),ease(0,.15,p));
  else if(p<.83){
    const cycle=(p-.15)/.68*r.loadCount,t=cycle%1;
    r.shell.rotation.set(0,0,0);r.shell.visible=t>=.04&&t<.78;
    if(t<.38)lerpPose(r.shell.position,fetch,align,ease(.04,.38,t));
    else if(t<.54)lerpPose(r.shell.position,align,raised,ease(.38,.54,t));
    else lerpPose(r.shell.position,raised,seated,ease(.54,.78,t));
    if(gate)gate.position.y=.025*ease(.34,.50,t)*(1-ease(.84,.94,t));
    r.left.position.copy(r.shell.position).add(scratchA.set(...palmOffset));
    pose.shellPush=ease(.45,.62,t)*(1-ease(.88,1,t));
    if(t>=.78){
      const end=handAt(seated),clear:V3=[end[0],end[1]-.10,end[2]];
      if(t<.88)lerpPose(r.left.position,end,clear,ease(.78,.88,t));
      else lerpPose(r.left.position,clear,handAt(fetch),ease(.88,1,t));
    }
    phase=`${t<.38?'align-shell':t<.78?'insert-shell':'withdraw-hand'}-${Math.floor(cycle)+1}`;
  }else{
    lerpPose(r.left.position,handAt(fetch),support,ease(.83,.92,p));
    r.pump.position.z=.11*ease(.92,.955,p)*(1-ease(.97,1,p));r.left.position.z+=r.pump.position.z;
    phase='pump-and-settle';
  }
  return phase;
}

/** Animation is entirely inside weapon-pivot. The caller owns the root transform.
 * Reload stages derive from simulation reloadLeft so pausing/captures stay exact. */
function updateWeaponRig(group: THREE.Group, actor: Actor, time: number, delta: number): void {
  if(group.userData.embeddedArms){updateClassicAkView(group,actor,time,delta);return;}
  const r = group.userData.rig as ViewRig;
  if (!r) return;
  if(r.kind==='knife'){updateKnifeRig(group,actor,time,delta);return;}
  if (r.lastTime === null || time < r.lastTime) {
    r.lastYaw = actor.yaw; r.lastPitch = actor.pitch; r.motion = r.swayX = r.swayY = 0; r.loading = false;
    r.stridePhase = 0;
  }
  r.lastTime = time;
  const kind = r.kind, gun = actor.guns[kind], duration = WEAPONS[kind].reload;
  const loading = gun.reloadLeft > 0, p = loading ? clamp(1 - gun.reloadLeft / duration) : 0;
  if (loading && !r.loading) r.loadCount = Math.max(1, Math.min(gun.reserve, WEAPONS[kind].magazine - gun.ammo));
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
  const quietPistol = r.view && isHandgun(kind);
  // Integrate the pistol stride: changing crouch/speed cannot jump its phase.
  if(quietPistol)r.stridePhase=(r.stridePhase??0)+dt*(actor.crouched?6:8)*r.motion;
  const stride = quietPistol ? r.stridePhase! : time * (actor.crouched ? 8 : 11);
  // First-person travel is owned by FirstPersonMotion on the shared root.
  const motion = r.view ? 0 : r.motion * (loading ? .2 : 1);
  const stepLift = quietPistol ? .5-.5*Math.cos(stride*2) : Math.abs(Math.cos(stride));
  const presentation = WEAPON_PRESENTATION[kind];
  const authoredRifle=kind==='rifle' && weaponAssetSource(kind)==='blender';
  // Keep the view reload close to the shoulder; raising every gun 12 cm
  // exposed both forearm ends and made the short MP5 reach look detached.
  const reloadLift=r.view?(kind==='shotgun'?.035:.055):.12;
  r.pivot.position.set(Math.sin(stride) * .006 * motion - r.swayX - lift * .05, stepLift * .009 * motion + lift * reloadLift + r.swayY, kick * presentation.recoilDistance - lift * (r.view ? .04 : 0) + settle * .004);
  r.pivot.rotation.set(kick * presentation.recoilPitch + lift * .11, (r.view ? .19 : 0) + r.swayX * 1.7 + lift * (r.view ? .16 : -.19), Math.sin(stride) * .009 * motion - lift * (isHandgun(kind) ? .42 : .32) + kick * presentation.recoilYaw + settle * .012);
  r.magazine.position.set(0, 0, 0); r.magazine.rotation.set(0, 0, 0); r.bolt.position.set(0,0,kick * (isHandgun(kind) ? .039 : kind === 'sniper' || kind === 'm4' ? 0 : .023)); r.bolt.rotation.z = 0;
  r.magazine.visible=true;
  const boltCycle = firing && kind === 'sniper' ? ease(.13, .28, age) * (1 - ease(.44, .65, age)) : 0;
  if (kind === 'sniper') { r.bolt.position.z = boltCycle * .105; r.bolt.rotation.z = -.55 * ease(.10,.19,age) * (1-ease(.56,.68,age)) * (firing ? 1 : 0); }
  const pumpCycle = firing && kind === 'shotgun' ? ease(.09, .21, age) * (1 - ease(.34, .48, age)) : 0;
  r.pump.position.z = pumpCycle * .112;
  r.left.position.set(...supportSocket(kind,r.view)); r.left.position.z += r.pump.position.z;
  // Palm faces up/inward; curled fingers wrap across the fore-end, rather
  // than presenting the dorsal glove pad to the underside of the barrel.
  r.left.rotation.set(isHandgun(kind) ? .30 : .15, isHandgun(kind) ? -.06 : -1.10, isHandgun(kind) ? Math.PI/2 : Math.PI * .98);
  r.right.position.set(...primaryGripSocket(kind,r.view)); r.right.rotation.set(.08, .12, .025); r.shell.visible = false;
  const gate=r.pivot.getObjectByName('loading-gate');if(gate)gate.position.y=0;
  group.userData.pose.shellPush=0;
  if (boltCycle > 0) {
    lerpPose(r.right.position, primaryGripSocket(kind,r.view), [.098, .057, .004 + r.bolt.position.z], Math.min(1, boltCycle * 2));
  }
  let phase = boltCycle > 0 ? 'bolt-cycle' : firing && kick > .01 ? 'recoil' : pumpCycle > 0 ? 'pump-cycle' : 'ready';
  if(loading&&group.userData.assetSource==='sketchfab'&&kind==='shotgun'){
    // A restrained cant exposes the port while the stock stays at the shoulder.
    r.pivot.rotation.z-=lift*(r.view?.62:1.38);
    if(r.view)r.pivot.rotation.y+=lift*.20;
    phase=snowShellReload(r,p,group.userData.pose);
  } else if(loading&&group.userData.assetSource==='sketchfab'&&SNOW_RELOAD[kind]){
    phase=snowMagazineReload(r,p);
  } else if (loading && kind === 'shotgun') {
    phase = p < .15 ? 'tilt-for-loading' : p < .83 ? 'insert-shell' : 'pump-and-settle';
    if (p < .15) lerpPose(r.left.position, supportSocket(kind,r.view), [-.15, -.19, .00], ease(0, .15, p));
    else if (p < .83) {
      const cycle = clamp((p - .15) / .68) * r.loadCount, local = cycle % 1;
      const insert = Math.sin(local * Math.PI);
      lerpPose(r.left.position, [-.15, -.22, .025], [-.018, -.066, -.065], insert);
      r.left.rotation.z = -.6 * insert; r.shell.visible = local > .08 && local < .78;
      r.shell.position.copy(r.left.position).add(scratchA.set(.02, .022, -.027)); r.shell.rotation.set(0, -.2, .25);
      phase = `insert-shell-${Math.min(r.loadCount, Math.floor(cycle) + 1)}`;
    } else {
      lerpPose(r.left.position, [-.018, -.066, -.065], supportSocket(kind,r.view), ease(.83, .9, p));
      r.pump.position.z = .11 * ease(.88, .93, p) * (1 - ease(.95, 1, p)); r.left.position.z += r.pump.position.z;
    }
    r.bolt.position.z = r.pump.position.z * .55;
  } else if (loading) {
    const magY = isHandgun(kind) ? -.074 : -.136, magZ = isHandgun(kind) ? .015 : -.12;
    const grasp: V3 = authoredRifle ? [-.032,-.133,-.180] : [-.052, magY, magZ];
    const lowered: V3 = authoredRifle ? [-.055,-.358,-.060] : [-.07, magY - .225, magZ + .12];
    const rackGrip: V3 = authoredRifle ? [.066,.066,-.020] : isHandgun(kind) ? [-.038, .092, -.03] : kind === 'smg' ? [-.05, .108, -.293] : [.054, .085, -.036];
    const out = ease(.18, .38, p) * (1 - ease(.53, .73, p));
    r.magazine.position.y = -.245 * out; r.magazine.position.z = .10 * out;
    r.magazine.rotation.x = -.25 * out;
    const supportPose:V3=supportSocket(kind,r.view);
    if (p < .18) { phase = 'grasp-magazine'; lerpPose(r.left.position, supportPose, grasp, ease(0, .18, p));  }
    else if (p < .38) { phase = 'magazine-out'; lerpPose(r.left.position, grasp, lowered, ease(.18, .38, p));  }
    else if (p < .53) { phase = 'retrieve-magazine'; r.left.position.set(...lowered); r.left.position.x -= Math.sin(ease(.38, .53, p) * Math.PI) * .065; }
    else if (p < .73) { phase = 'insert-magazine'; lerpPose(r.left.position, lowered, grasp, ease(.53, .73, p)); }
    else if (p < .8) { phase = 'seat-magazine'; r.left.position.set(...grasp); r.left.position.y += Math.sin((p - .73) / .07 * Math.PI) * .018; }
    else if (p < .93) {
      phase = 'rack-bolt'; lerpPose(r.left.position, grasp, rackGrip, ease(.8, .85, p));
      r.bolt.position.z = (isHandgun(kind) ? .047 : kind === 'sniper' ? .105 : .075) * ease(.83, .88, p) * (1 - ease(.89, .93, p)); r.left.position.z += r.bolt.position.z;
      if (kind === 'sniper') r.bolt.rotation.z = -.55 * ease(.80,.85,p) * (1-ease(.90,.93,p));
    } else { phase = 'return-to-ready'; lerpPose(r.left.position, rackGrip, supportPose, ease(.93, 1, p)); }
    const gripMix=ease(0,.16,p)*(1-ease(.93,1,p));
    if(!isHandgun(kind)){r.left.rotation.y=THREE.MathUtils.lerp(r.left.rotation.y,-.15,gripMix);r.left.rotation.z=THREE.MathUtils.lerp(r.left.rotation.z,-.25,gripMix);}
    r.left.rotation.z -= out * .45;
    if(authoredRifle && p >= .18 && p < .8){
      // A single magazine-local contact drives the supporting wrist throughout extraction/insertion.
      r.left.position.set(...grasp).applyEuler(r.magazine.rotation).add(r.magazine.position);
    }
  }

  const rack=r.view?weaponRackPose(actor,kind):null;
  if(rack?.active&&!loading){
    const {reach,pull,turn}=rack;
    const travel=pull*(isHandgun(kind)?.040:kind==='sniper'?.095:kind==='shotgun'?.105:kind==='m4'?.060:.075);
    r.pivot.position.x-=reach*.025;r.pivot.position.y+=reach*.025;
    r.pivot.rotation.z-=reach*(isHandgun(kind)?.24:kind==='sniper'?.10:.16);
    if(kind==='shotgun'){
      r.pump.position.z=travel;r.left.position.z+=travel;
    }else{
      r.bolt.position.z=travel;
      const target=kind==='smg'?[-.032,.088,-.376]:SNOW_RELOAD[kind]?.rack??[.054,.085,-.036];
      const hand=kind==='sniper'?r.right:r.left;
      scratchA.set(target[0],target[1],target[2]+travel);
      if(kind==='sniper'){
        // Unlock upward around the receiver axis, then pull straight back.
        const angle=.8*turn;r.bolt.rotation.z=angle;
        r.bolt.position.x=.061*Math.sin(angle);r.bolt.position.y=.061*(1-Math.cos(angle));
        scratchA.set(.052,.052-.061,.037).applyAxisAngle(new THREE.Vector3(0,0,1),angle);scratchA.y+=.061;scratchA.z+=travel;
      }
      hand.position.lerp(scratchA,reach);
    }
    phase=rack.phase;
  }
  const pose = group.userData.pose;
  pose.phase = phase; pose.progress = p;pose.equipProgress=rack?.progress??0;pose.equipReach=rack?.reach??0;pose.equipHand=kind==='sniper'?'right':kind==='shotgun'?'pump':'left';
  pose.magazineOffset = r.magazine.position.y; pose.boltTravel = r.bolt.position.z;
  pose.rightHand = {x:r.right.position.x,y:r.right.position.y,z:r.right.position.z};
  pose.pumpTravel = r.pump.position.z; pose.recoil = +kick.toFixed(3); pose.leftHand = { x: r.left.position.x, y: r.left.position.y, z: r.left.position.z };
}

function updateKnifeRig(group:THREE.Group,actor:Actor,time:number,delta:number):void {
  const r=group.userData.rig as ViewRig;
  const attack=actor.meleeAttack??'slash',spec=MELEE_ATTACKS[attack];
  const age=time-actor.shotTime,active=age>=0&&age<spec.interval;
  const dt=Math.max(0,Math.min(.1,delta));
  if(r.lastTime===null||time<r.lastTime)r.motion=0;
  r.motion=THREE.MathUtils.damp(r.motion,actor.moving?1:0,10,dt);r.lastTime=time;
  const bob=r.view?0:Math.sin(time*10)*.006*r.motion;
  sampleKnifeMotion(attack,active?age:-1,r.pivot.position,r.pivot.quaternion);
  r.pivot.position.y+=bob;
  r.right.position.set(...primaryGripSocket('knife',r.view));
  if(r.view){
    // The more open palm presentation turns the wrist away from the camera.
    // Bring the complete knife grip back toward the body; the guarding hand
    // below stays in its existing body-space frame.
    r.pivot.position.z+=.027;
    // Pronate the blade and closed hand together. The stroke keeps its
    // forearm-safe wrist path, while the handle cannot rotate inside the fist.
    const turn=active?ease(0,spec.contactDelay*.8,age)*(1-ease(spec.interval*.65,spec.interval-.025,age)):0;
    knifeStrokeGrip.slerpQuaternions(KNIFE_VIEW_GRIP_ROTATION,KNIFE_ACTION_GRIP_ROTATION,turn);
    r.pivot.quaternion.multiply(knifeStrokeGrip).multiply(knifeViewGripInverse);
    r.pivot.quaternion.premultiply(knifeReadyAdjustment.identity().slerp(KNIFE_VIEW_READY_ADJUSTMENT,1-turn));
    r.right.quaternion.copy(KNIFE_VIEW_GRIP_ROTATION);
  }
  else r.right.rotation.set(.08,.12,.025);
  // The free hand guards the torso and yields space to the cutting arc. It
  // stays in the body frame while the gripping hand and blade move together.
  const guard=active?ease(0,spec.contactDelay,age)*(1-ease(spec.contactDelay+.1,spec.interval-.025,age)):0;
  knifeSupportInverse.copy(r.pivot.quaternion).invert();
  r.left.position.set(...(r.view?CLASSIC_VIEW_CONTACTS.knife!.left:dimensions.knife.support));
  // Put the relaxed hand ahead of the knife hand. This independent body-space
  // offset leaves the right-hand grip and third-person sockets untouched.
  if(r.view)r.left.position.add(scratchA.set(-.018,.010,-.130));
  r.left.position.x-=guard*(attack==='slash'?.045:.02);
  r.left.position.y-=guard*(attack==='slash'?.075:.035);
  r.left.position.z+=guard*(attack==='slash'?.07:.035);
  r.left.position.sub(r.pivot.position).applyQuaternion(knifeSupportInverse);
  r.left.quaternion.copy(knifeSupportInverse).multiply(r.view?knifeViewSupportRotation:knifeSupportRotation);r.shell.visible=false;

  Object.assign(group.userData.pose,{attack,supportTime:time,phase:active?(age<spec.contactDelay?'windup':age<spec.contactDelay+.10?attack:'recover'):'ready',progress:active?age/spec.interval:0,magazineOffset:0,boltTravel:0,pumpTravel:0,recoil:0,leftHand:{x:r.left.position.x,y:r.left.position.y,z:r.left.position.z},rightHand:{x:r.right.position.x,y:r.right.position.y,z:r.right.position.z}});
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
