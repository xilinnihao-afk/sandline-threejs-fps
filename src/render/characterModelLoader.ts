import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

export type CharacterModelId = 'A' | 'B';
// 【修改模型文件名的位置】文件放在 public/assets/characters/，浏览器不能读取 /Users/... 路径。
export const CHARACTER_MODEL_FILES = {
  A: 'spetsnaz_gru_operator__high-poly_3d_character.glb',
  B: 'modern_tactical_female_character.glb',
} as const;
export interface CharacterAssetInfo {
  skins: number; skinnedPrimitives: number; triangles: number;
  clips: string[]; materials: number; normalMaterials: number; roughnessMaterials: number;
}

/** 解码 GLB 的元数据，在解压大贴图之前发现“静态模型被误标为 rigged”的问题。 */
export function inspectCharacterGLB(buffer: ArrayBuffer): CharacterAssetInfo {
  const view = new DataView(buffer);
  if (buffer.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2
    || view.getUint32(8, true) !== buffer.byteLength || view.getUint32(16, true) !== 0x4e4f534a) {
    throw new Error('人物文件不是有效的 GLB 2.0');
  }
  const length = view.getUint32(12, true);
  if (20 + length > buffer.byteLength) throw new Error('人物 GLB 文件未下载完整');
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, length)));
  const materials = json.materials ?? [];
  let triangles = 0, skinnedPrimitives = 0;
  for (const node of json.nodes ?? []) {
    for (const primitive of json.meshes?.[node.mesh]?.primitives ?? []) {
      if (node.skin !== undefined && json.skins?.[node.skin]?.joints?.length
        && primitive.attributes.JOINTS_0 !== undefined && primitive.attributes.WEIGHTS_0 !== undefined) skinnedPrimitives++;
    }
  }
  for (const mesh of json.meshes ?? []) for (const primitive of mesh.primitives) {
    const count = json.accessors[primitive.indices ?? primitive.attributes.POSITION].count;
    if (primitive.mode === undefined || primitive.mode === 4) triangles += count / 3;
  }
  return {
    skins: json.skins?.length ?? 0, skinnedPrimitives, triangles,
    clips: (json.animations ?? []).map((a: { name?: string }) => a.name ?? '(未命名动画)'),
    materials: materials.length,
    normalMaterials: materials.filter((m: { normalTexture?: unknown }) => m.normalTexture).length,
    roughnessMaterials: materials.filter((m: { pbrMetallicRoughness?: { metallicRoughnessTexture?: unknown } }) => m.pbrMetallicRoughness?.metallicRoughnessTexture).length,
  };
}

export function assertAnimatedCharacter(info: CharacterAssetInfo): void {
  if (!info.skins || !info.skinnedPrimitives) throw new Error('人物 GLB 缺少骨骼蒙皮（skins / JOINTS_0 / WEIGHTS_0），不能用于现有握枪 IK 和步行动画。');
  if (!info.clips.length) throw new Error('人物 GLB 有骨骼，但不包含动画；请提供匹配该骨架的 idle / walk 动画。');
}

export interface CharacterLoadOptions {
  url?: string;
  /** 非标准动画名在这里显式指定，避免误把开火、死亡动画当作走路。 */
  idleClip?: string; walkClip?: string;
  height?: number;
  maxTextureSize?: number;
  /** 仅用于查看静态资产；不能把这个选项用于替代游戏的可动画角色。 */
  staticPreview?: boolean;
}

const templates = new Map<string, Promise<{ gltf: GLTF; info: CharacterAssetInfo }>>();

/** 保留作者法线、UV 和切线，不焊接硬边、不重新生成已有法线。 */
export function prepareCharacterMaterials(scene: THREE.Object3D, maxTextureSize = 2048): void {
  const materials = new Map<THREE.Material, THREE.MeshStandardMaterial>();
  const textures = new Set<THREE.Texture>();
  const capTexture = (texture: THREE.Texture | null, color: boolean) => {
    if (!texture || textures.has(texture)) return;
    textures.add(texture);
    texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.anisotropy = 2;
    const image = texture.image;
    if (image?.width && image?.height && Math.max(image.width, image.height) > maxTextureSize) {
      // 仅缩小 GPU 上传尺寸；不会生成缺失的法线/粗糙度信息，也不会减少模型三角形。
      const scale = maxTextureSize / Math.max(image.width, image.height);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext('2d');
      if (context) { context.drawImage(image, 0, 0, canvas.width, canvas.height); texture.image = canvas; }
    }
    // GLTFLoader 已处理 flipY / ImageBitmap 方向，不能在这里一律翻转。
    texture.needsUpdate = true;
  };
  scene.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    if (!object.geometry.hasAttribute('normal')) object.geometry.computeVertexNormals();
    object.castShadow = false; // 手机不额外增加人物实时阴影通道，沿用现有接地阴影。
    object.receiveShadow = true;
    // 蒙皮动画可能超出静态包围盒，避免行走时身体部件突然消失。
    if (object instanceof THREE.SkinnedMesh) object.frustumCulled = false;
    const convert = (source: THREE.Material) => {
      const cached = materials.get(source); if (cached) return cached;
      let target: THREE.MeshStandardMaterial;
      if (source instanceof THREE.MeshStandardMaterial) target = source.clone();
      else {
        const original = source as THREE.MeshBasicMaterial;
        target = new THREE.MeshStandardMaterial({
          color: original.color ?? 0xffffff, map: original.map ?? null,
          alphaMap: original.alphaMap ?? null, transparent: source.transparent,
          opacity: source.opacity, alphaTest: source.alphaTest, side: source.side,
          depthWrite: source.depthWrite, roughness: .8, metalness: 0,
        });
      }
      target.name = source.name; target.flatShading = false;
      capTexture(target.map, true); capTexture(target.emissiveMap, true);
      capTexture(target.normalMap, false); capTexture(target.roughnessMap, false);
      capTexture(target.metalnessMap, false); capTexture(target.aoMap, false); capTexture(target.alphaMap, false);
      materials.set(source, target); return target;
    };
    object.material = Array.isArray(object.material) ? object.material.map(convert) : convert(object.material);
  });
}

export class CharacterLocomotion {
  private current: THREE.AnimationAction | null = null;
  private walking = false;
  constructor(readonly mixer: THREE.AnimationMixer, readonly idle: THREE.AnimationAction | null,
    readonly walk: THREE.AnimationAction | null) {
    this.current = idle; idle?.reset().play();
  }
  /** 由现有渲染层传入速度；不修改 Actor、碰撞体或玩家位置。 */
  update(deltaSeconds: number, speed: number): void {
    const magnitude = Number.isFinite(speed) ? Math.abs(speed) : 0;
    // 起停阈值分离，防止速度接近零时反复 crossFade 导致姿态闪烁。
    const walking = this.walking ? magnitude > .08 : magnitude > .16;
    const next = walking ? this.walk : this.idle;
    if (next && next !== this.current) {
      next.reset().setEffectiveWeight(1).setEffectiveTimeScale(1).play();
      this.current?.crossFadeTo(next, .18, false);
      this.current = next;
    }
    this.walking = walking;
    this.walk?.setEffectiveTimeScale(THREE.MathUtils.clamp(magnitude / 1.5, .5, 1.8));
    this.mixer.update(THREE.MathUtils.clamp(Number.isFinite(deltaSeconds) ? deltaSeconds : 0, 0, .1));
  }
}

export async function loadCharacterModel(id: CharacterModelId, options: CharacterLoadOptions = {}) {
  const url = options.url ?? `${import.meta.env.BASE_URL}assets/characters/${CHARACTER_MODEL_FILES[id]}`;
  const maxSize = Math.min(2048, Math.max(256, options.maxTextureSize ?? 2048));
  const key = `${url}:${maxSize}:${!!options.staticPreview}`;
  let template = templates.get(key);
  if (!template) {
    template = (async () => {
      const response = await fetch(url); if (!response.ok) throw new Error(`人物 ${id} 加载失败：HTTP ${response.status}`);
      const data = await response.arrayBuffer(), info = inspectCharacterGLB(data);
      if (!options.staticPreview) assertAnimatedCharacter(info);
      const resourcePath = new URL('.', new URL(url, location.href)).href;
      const gltf = await new GLTFLoader().parseAsync(data, resourcePath);
      prepareCharacterMaterials(gltf.scene, maxSize);
      return { gltf, info };
    })();
    templates.set(key, template);
    template.catch(() => templates.delete(key)); // 失败后允许重新下载修正的资产。
  }
  const { gltf, info } = await template;
  const model = clone(gltf.scene), group = new THREE.Group(); group.add(model);
  const bounds = new THREE.Box3().setFromObject(model), size = bounds.getSize(new THREE.Vector3());
  if (size.y < .001) throw new Error('人物高度无效，无法归一化');
  const height = options.height ?? 1.78;
  if (!Number.isFinite(height) || height <= 0) throw new Error('人物目标高度必须大于零');
  const scale = height / size.y, center = bounds.getCenter(new THREE.Vector3());
  model.scale.multiplyScalar(scale); model.position.add(new THREE.Vector3(-center.x, -bounds.min.y, -center.z).multiplyScalar(scale));
  const select = (name: string | undefined, pattern: RegExp) => gltf.animations.find(c => name ? c.name === name : pattern.test(c.name));
  const idleClip = select(options.idleClip, /(^|[\s_\-|])idle($|[\s_\-|])/i);
  const walkClip = select(options.walkClip, /(^|[\s_\-|])walk(ing)?($|[\s_\-|])/i);
  if (!options.staticPreview && (!idleClip || !walkClip)) throw new Error(`人物 ${id} 未找到 idle / walk；可用动画：${info.clips.join(', ')}。请指定 idleClip / walkClip。`);
  const mixer = new THREE.AnimationMixer(model);
  const inPlace = (source: THREE.AnimationClip) => {
    const clip = source.clone();
    // 根位移归现有游戏逻辑所有；保留骨盆上下步态，移除骨盆 X/Z 的动画位移。
    for (const track of clip.tracks) if (/(hips|pelvis|root)\.position$/i.test(track.name)) {
      for (let i = 0; i < track.values.length; i += 3) { track.values[i] = track.values[0]; track.values[i + 2] = track.values[2]; }
    }
    return clip;
  };
  const locomotion = new CharacterLocomotion(mixer, idleClip ? mixer.clipAction(inPlace(idleClip)) : null, walkClip ? mixer.clipAction(inPlace(walkClip)) : null);
  group.name = `character-model-${id}`;
  return { group, model, mixer, locomotion, info, animated: !!idleClip && !!walkClip && info.skinnedPrimitives > 0,
    // 克隆角色共享 GPU 几何/材质/贴图，销毁单个实例时不能释放共享资产。
    dispose() { mixer.stopAllAction(); mixer.uncacheRoot(model); group.removeFromParent(); },
  };
}

/** 模型 A：GRU 男性角色。 */
export const loadModelA = (options: CharacterLoadOptions = {}) => loadCharacterModel('A', options);
/** 模型 B：女性战术角色。 */
export const loadModelB = (options: CharacterLoadOptions = {}) => loadCharacterModel('B', options);
