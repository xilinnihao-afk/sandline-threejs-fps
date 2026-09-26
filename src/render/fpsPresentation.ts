import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

export interface PlayerArmsOptions {
  url?: string;
  position?: THREE.Vector3 | THREE.Vector3Tuple;
  rotation?: THREE.Euler | THREE.EulerTuple;
  scale?: number | THREE.Vector3;
  /** Normalize authoring units (often centimetres) to a target arm span. */
  normalize?: boolean;
  targetSpan?: number;
  rightHandNames?: string[];
}

export interface PlayerArmsRig {
  group: THREE.Group;
  model: THREE.Object3D;
  gltf: GLTF;
  rightHand: THREE.Object3D | null;
  mixer: THREE.AnimationMixer;
}

const BASE = () => import.meta.env.BASE_URL;

function copyMapProperties(from: THREE.Material, to: THREE.MeshPhysicalMaterial): void {
  const source = from as THREE.MeshStandardMaterial & {
    diffuseMap?: THREE.Texture;
    glossinessMap?: THREE.Texture;
    specularGlossinessMap?: THREE.Texture;
  };
  const aliases: Record<string, string[]> = {
    map: ['map', 'diffuseMap'],
    normalMap: ['normalMap'],
    roughnessMap: ['roughnessMap'],
    metalnessMap: ['metalnessMap'],
    aoMap: ['aoMap'],
    emissiveMap: ['emissiveMap'],
    bumpMap: ['bumpMap'],
    displacementMap: ['displacementMap'],
    alphaMap: ['alphaMap'],
    lightMap: ['lightMap'],
  };
  for (const [target, candidates] of Object.entries(aliases)) {
    const value = candidates.map(key => source[key as keyof typeof source]).find(Boolean) as THREE.Texture | undefined;
    if (value) (to as any)[target] = value;
  }
  if (source.normalScale) to.normalScale.copy(source.normalScale);
  if (source.bumpScale !== undefined) to.bumpScale = source.bumpScale;
  if (source.displacementScale !== undefined) to.displacementScale = source.displacementScale;
  if (source.displacementBias !== undefined) to.displacementBias = source.displacementBias;
  if (source.emissive) to.emissive.copy(source.emissive);
  if (source.emissiveIntensity !== undefined) to.emissiveIntensity = source.emissiveIntensity;
  if (source.transparent !== undefined) to.transparent = source.transparent;
  if (source.opacity !== undefined) to.opacity = source.opacity;
  if (source.side !== undefined) to.side = source.side;
  if (source.alphaTest !== undefined) to.alphaTest = source.alphaTest;
}

/** Convert imported GLTF materials to a consistent PBR identity. GLTFLoader
 * already resolves embedded texture channels; this preserves those channels
 * while adding physical clearcoat/specular response for close-up arms. */
export function toPhysicalMaterial(material: THREE.Material): THREE.MeshPhysicalMaterial {
  if (material instanceof THREE.MeshPhysicalMaterial) {
    const copy = material.clone();
    // KHR_materials_pbrSpecularGlossiness exposes the diffuse channel as
    // `diffuseMap` on some Three.js revisions; clone() does not promote it to
    // the standard `map` slot, so copy the aliases explicitly.
    copyMapProperties(material, copy);
    copy.envMapIntensity = Math.max(copy.envMapIntensity, .8);
    return copy;
  }
  const source = material as THREE.MeshStandardMaterial;
  const result = new THREE.MeshPhysicalMaterial({
    color: source.color?.clone() ?? new THREE.Color(0xffffff),
    roughness: source.roughness ?? .72,
    metalness: source.metalness ?? 0,
  });
  copyMapProperties(material, result);
  result.envMapIntensity = .85;
  result.clearcoat = .08;
  result.clearcoatRoughness = .35;
  result.name = `${material.name || 'arms'}:physical`;
  material.dispose();
  return result;
}

function normalizedName(value: string): string { return value.replace(/[^a-z0-9]/gi, '').toLowerCase(); }

function findRightHand(root: THREE.Object3D, names: string[] = []): THREE.Object3D | null {
  const wanted = [...names, 'mixamorig:RightHand', 'mixamorigRightHand', 'RightHand', 'R_wrist_025', 'R_wrist'];
  const exact = new Map(wanted.map(name => [normalizedName(name), true]));
  let result: THREE.Object3D | null = null;
  root.traverse(object => {
    const normalized = normalizedName(object.name);
    if (exact.has(normalized)) result ??= object;
  });
  if (result) return result;
  root.traverse(object => {
    const normalized = normalizedName(object.name);
    if (/^(mixamorig)?right(hand|wrist)$/.test(normalized) || /^rwrist/.test(normalized)) result ??= object;
  });
  return result;
}

export async function loadPlayerArms(camera: THREE.Camera, scene: THREE.Scene, options: PlayerArmsOptions = {}): Promise<PlayerArmsRig> {
  const url = options.url ?? `${BASE()}assets/player/fps_arms.glb`;
  const gltf = await new GLTFLoader().loadAsync(url);
  const group = new THREE.Group();
  group.name = 'fps-arms-rig';
  group.userData.presentationLayer = true;
  const model = gltf.scene;
  model.name = 'fps-arms-model';
  model.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = true;
    object.receiveShadow = true;
    object.frustumCulled = false;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const converted = materials.map(toPhysicalMaterial);
    object.material = Array.isArray(object.material) ? converted : converted[0];
  });
  // Three r180 no longer decodes the legacy KHR_materials_pbrSpecularGlossiness
  // extension used by this arm asset. The GLB still contains the four source
  // images, so the release build exposes them beside the model and binds them
  // explicitly. This keeps the imported mesh from falling back to flat white.
  if (options.url === undefined || url.endsWith('/fps_arms.glb')) {
    const textureLoader = new THREE.TextureLoader();
    const root = url.slice(0, url.lastIndexOf('/') + 1);
    try {
      const [albedo, normal, ao] = await Promise.all([
        textureLoader.loadAsync(`${root}fps_arms_albedo.png`),
        textureLoader.loadAsync(`${root}fps_arms_normal.png`),
        textureLoader.loadAsync(`${root}fps_arms_ao.png`),
      ]);
      albedo.colorSpace = THREE.SRGBColorSpace;
      for(const texture of [albedo,normal,ao]){texture.flipY=false;texture.needsUpdate=true;}
      model.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          const physical = material as THREE.MeshPhysicalMaterial;
          physical.map ??= albedo;
          physical.normalMap ??= normal;
          // The source channel is glossiness (the inverse of roughness), so
          // binding it directly would create chrome-like fabric highlights.
          // Keep the authored normal/occlusion detail and use a stable cloth
          // roughness until a channel-inverted texture is generated.
          physical.aoMap ??= ao;
          physical.roughness = Math.max(.68, physical.roughness ?? .72);
          physical.metalness = Math.min(.18, physical.metalness ?? .04);
          physical.envMapIntensity = .72;
          physical.needsUpdate = true;
        }
      });
    } catch (error) {
      console.warn('FPS arms external texture bind skipped', error);
    }
  }
  // Marketplace arm rigs frequently arrive in centimetres or arbitrary FBX
  // units. Normalize the authored span once so the camera-local layer stays
  // stable across assets and never clips the near plane because of scale.
  if (options.normalize !== false) {
    model.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.y, size.z, 1e-4);
    const target = options.targetSpan ?? .72;
    const unitScale = target / span;
    const center = bounds.getCenter(new THREE.Vector3());
    model.scale.multiplyScalar(unitScale);
    model.position.addScaledVector(center, -unitScale);
  }
  group.add(model);
  if (options.position instanceof THREE.Vector3) group.position.copy(options.position);
  else if (options.position) group.position.fromArray(options.position);
  if (options.rotation instanceof THREE.Euler) group.rotation.copy(options.rotation);
  else if (options.rotation) group.rotation.fromArray(options.rotation);
  if (typeof options.scale === 'number') group.scale.setScalar(options.scale);
  else if (options.scale) group.scale.copy(options.scale);
  camera.add(group);
  scene.userData.playerArms = group;
  group.updateWorldMatrix(true, true);
  return { group, model, gltf, rightHand: findRightHand(model, options.rightHandNames), mixer: new THREE.AnimationMixer(model) };
}

export interface LightingOptions {
  hdrUrl?: string;
  renderer?: THREE.WebGLRenderer;
  sunPosition?: THREE.Vector3;
  exposure?: number;
}

export interface LightingRig {
  environment: THREE.Texture;
  hemisphere: THREE.HemisphereLight;
  sun: THREE.DirectionalLight;
}

export async function setupRealisticLighting(scene: THREE.Scene, options: LightingOptions = {}): Promise<LightingRig> {
  const renderer = options.renderer;
  if (renderer) {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = options.exposure ?? 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }
  const hdr = await new RGBELoader().loadAsync(options.hdrUrl ?? `${BASE()}assets/environment/freight_station_4k.hdr`);
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  let environment: THREE.Texture = hdr;
  if (renderer) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    environment = pmrem.fromEquirectangular(hdr).texture;
    pmrem.dispose();
    hdr.dispose();
  }
  scene.environment = environment;
  const hemisphere = new THREE.HemisphereLight(0x9ebbd4, 0x9a7654, 1.15);
  hemisphere.name = 'realistic-sky-ground';
  scene.add(hemisphere);
  const sun = new THREE.DirectionalLight(0xffe1b0, 3.1);
  sun.name = 'realistic-soft-sun';
  sun.position.copy(options.sunPosition ?? new THREE.Vector3(-18, 28, 12));
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = .5;
  sun.shadow.camera.far = 90;
  sun.shadow.camera.left = -32;
  sun.shadow.camera.right = 32;
  sun.shadow.camera.top = 32;
  sun.shadow.camera.bottom = -32;
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = .025;
  scene.add(sun);
  return { environment, hemisphere, sun };
}

export interface WeaponSwayOptions {
  idleAmplitude?: number;
  moveAmplitude?: number;
  recoilDistance?: number;
  recoilPitch?: number;
  spring?: number;
  gripPointName?: string;
}

const tmpVelocity = new THREE.Vector3();
const tmpPosition = new THREE.Vector3();
const tmpQuaternion = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const tmpHandWorld = new THREE.Matrix4();
const tmpGripLocal = new THREE.Matrix4();
const tmpWeaponWorld = new THREE.Matrix4();
const tmpParentInverse = new THREE.Matrix4();

/** First-person animation layer. It only owns local transforms on armsGroup,
 * so it can be inserted above an existing simulation and weapon system. */
export class WeaponSwayController {
  readonly camera: THREE.Camera;
  readonly armsGroup: THREE.Group;
  private readonly restPosition: THREE.Vector3;
  private readonly restRotation: THREE.Euler;
  private readonly currentPosition = new THREE.Vector3();
  private readonly currentRotation = new THREE.Euler();
  private readonly alignmentOffset = new THREE.Vector3();
  private readonly options: Required<WeaponSwayOptions>;
  private elapsed = 0;
  private recoilAge = Infinity;
  private recoilStrength = 0;
  private weapon: THREE.Object3D | null = null;
  private gripPoint: THREE.Object3D | null = null;
  private rightHand: THREE.Object3D | null = null;

  constructor(camera: THREE.Camera, armsGroup: THREE.Group, options: WeaponSwayOptions = {}) {
    this.camera = camera;
    this.armsGroup = armsGroup;
    this.restPosition = armsGroup.position.clone();
    this.restRotation = armsGroup.rotation.clone();
    this.currentPosition.copy(this.restPosition);
    this.currentRotation.copy(this.restRotation);
    this.options = {
      idleAmplitude: options.idleAmplitude ?? .006,
      moveAmplitude: options.moveAmplitude ?? .022,
      recoilDistance: options.recoilDistance ?? .065,
      recoilPitch: options.recoilPitch ?? .09,
      spring: options.spring ?? 18,
      gripPointName: options.gripPointName ?? 'gripPoint',
    };
  }

  /** Parent a weapon under the arms layer and align its gripPoint to the
   * imported right-hand bone. The gripPoint should be a child of the weapon. */
  attachWeapon(weapon: THREE.Object3D, rightHand?: THREE.Object3D | null): void {
    this.weapon?.removeFromParent();
    this.weapon = weapon;
    this.armsGroup.add(weapon);
    this.gripPoint = weapon.getObjectByName(this.options.gripPointName) ?? null;
    this.rightHand = rightHand ?? this.findRightHand(this.armsGroup);
    if (!this.gripPoint) console.warn(`WeaponSwayController: missing ${this.options.gripPointName}; grip IK disabled`);
    if (!this.rightHand) console.warn('WeaponSwayController: right hand bone not found; grip IK disabled');
  }

  shoot(strength = 1): void {
    this.recoilAge = 0;
    this.recoilStrength = Math.min(1.6, this.recoilStrength + Math.max(0, strength));
  }

  update(dt: number, velocity: THREE.Vector3 = tmpVelocity.set(0, 0, 0)): void {
    const delta = Math.min(.05, Math.max(0, dt));
    this.elapsed += delta;
    const speed = Math.min(1, velocity.length() / 4);
    const stride = this.elapsed * (7 + speed * 5);
    const idle = this.options.idleAmplitude;
    const move = this.options.moveAmplitude * speed;
    const targetX = this.restPosition.x + this.alignmentOffset.x + Math.sin(stride * .5) * idle + velocity.x * -.004;
    const targetY = this.restPosition.y + this.alignmentOffset.y + Math.sin(stride) * idle * .65 + Math.abs(Math.cos(stride)) * move;
    const targetZ = this.restPosition.z + this.alignmentOffset.z + velocity.z * -.006;
    const recoil = this.recoilAge < .22 ? Math.sin(Math.min(1, this.recoilAge / .1) * Math.PI) * Math.exp(-this.recoilAge * 12) * this.recoilStrength : 0;
    const targetPitch = this.restRotation.x - recoil * this.options.recoilPitch;
    const targetYaw = this.restRotation.y + velocity.x * .012;
    const targetRoll = this.restRotation.z - velocity.x * .018;
    const smoothing = 1 - Math.exp(-this.options.spring * delta);
    this.currentPosition.lerp(tmpPosition.set(targetX, targetY, targetZ - recoil * this.options.recoilDistance), smoothing);
    this.currentRotation.x = THREE.MathUtils.lerp(this.currentRotation.x, targetPitch, smoothing);
    this.currentRotation.y = THREE.MathUtils.lerp(this.currentRotation.y, targetYaw, smoothing);
    this.currentRotation.z = THREE.MathUtils.lerp(this.currentRotation.z, targetRoll, smoothing);
    this.armsGroup.position.copy(this.currentPosition);
    this.armsGroup.rotation.copy(this.currentRotation);
    if (this.recoilAge < Infinity) {
      this.recoilAge += delta;
      this.recoilStrength *= Math.exp(-delta * 20);
      if (this.recoilAge > .32 && this.recoilStrength < .005) this.recoilAge = Infinity;
    }
    this.solveGripIK();
  }

  /** Keep the imported wrist on the authored weapon socket without changing
   * the hand skeleton every frame. A damped rig translation avoids the
   * one-frame corrections that create visible jitter during recoil/reload. */
  alignHandTo(target: THREE.Object3D, hand: THREE.Object3D | null = this.rightHand, dt = 1 / 60): void {
    if (!hand || !target) return;
    const targetWorld = target.getWorldPosition(new THREE.Vector3());
    const handWorld = hand.getWorldPosition(new THREE.Vector3());
    const parent = this.armsGroup.parent;
    if (parent) {
      parent.worldToLocal(targetWorld);
      parent.worldToLocal(handWorld);
    }
    const blend = 1 - Math.exp(-24 * Math.min(.05, Math.max(0, dt)));
    this.alignmentOffset.addScaledVector(targetWorld.sub(handWorld), blend);
    this.alignmentOffset.x = THREE.MathUtils.clamp(this.alignmentOffset.x, -.24, .24);
    this.alignmentOffset.y = THREE.MathUtils.clamp(this.alignmentOffset.y, -.22, .22);
    this.alignmentOffset.z = THREE.MathUtils.clamp(this.alignmentOffset.z, -.22, .22);
  }

  private solveGripIK(): void {
    if (!this.weapon || !this.gripPoint || !this.rightHand) return;
    this.armsGroup.updateWorldMatrix(true, true);
    this.rightHand.updateWorldMatrix(true, true);
    this.gripPoint.updateWorldMatrix(true, true);
    tmpHandWorld.copy(this.rightHand.matrixWorld);
    tmpGripLocal.copy(this.weapon.matrixWorld).invert().multiply(this.gripPoint.matrixWorld).invert();
    tmpWeaponWorld.copy(tmpHandWorld).multiply(tmpGripLocal);
    tmpParentInverse.identity();
    if (this.weapon.parent) tmpParentInverse.copy(this.weapon.parent.matrixWorld).invert();
    tmpWeaponWorld.premultiply(tmpParentInverse);
    tmpWeaponWorld.decompose(tmpPosition, tmpQuaternion, tmpScale);
    this.weapon.position.copy(tmpPosition);
    this.weapon.quaternion.copy(tmpQuaternion);
    this.weapon.scale.copy(tmpScale);
  }

  private findRightHand(root: THREE.Object3D): THREE.Object3D | null { return findRightHand(root); }
}
