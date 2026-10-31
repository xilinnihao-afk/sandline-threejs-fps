import * as THREE from 'three';
import { MODEL_SCRIPTS } from '../generated/model-index';

/** These are authored scene definitions, not binary GLB payloads or strings. */
export interface OfflineDefinition {
  offlineFormat: 1;
  asset?: Record<string, unknown>;
  scene?: number;
  scenes?: any[];
  nodes?: any[];
  meshes?: any[];
  materials?: any[];
  textures?: any[];
  images?: any[];
  samplers?: any[];
  skins?: any[];
  animations?: any[];
  accessors: any[];
}

export interface GLTF {
  scene: THREE.Group;
  scenes: THREE.Group[];
  animations: THREE.AnimationClip[];
  cameras: THREE.Camera[];
  asset: Record<string, unknown>;
  userData: Record<string, unknown>;
  parser: any;
}

declare global {
  interface Window { __sandlineModels?: Record<string, OfflineDefinition>; }
}

const pendingDefinitions = new Map<string, Promise<OfflineDefinition>>();
const widths: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const attributes: Record<string, string> = { POSITION: 'position', NORMAL: 'normal', TANGENT: 'tangent',
  TEXCOORD_0: 'uv', TEXCOORD_1: 'uv1', COLOR_0: 'color', JOINTS_0: 'skinIndex', WEIGHTS_0: 'skinWeight' };
const constructors: Record<number, any> = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array,
  5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };

function modelKey(url: string): string {
  const clean = url.split('?')[0].split('#')[0];
  const start = clean.indexOf('assets/');
  const key = start < 0 ? clean : clean.slice(start);
  if (!Object.prototype.hasOwnProperty.call(MODEL_SCRIPTS, key)) throw new Error('离线模型不存在：' + key);
  return key;
}

/** Only classic scripts from the built-in manifest can be loaded. */
export function loadOfflineDefinition(url: string): Promise<OfflineDefinition> {
  const key = modelKey(url);
  const available = window.__sandlineModels && window.__sandlineModels[key];
  if (available) return Promise.resolve(available);
  const prior = pendingDefinitions.get(key);
  if (prior) return prior;
  const promise = new Promise<OfflineDefinition>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = MODEL_SCRIPTS[key];
    script.async = true;
    script.onload = () => {
      script.remove();
      const definition = window.__sandlineModels && window.__sandlineModels[key];
      if (!definition || definition.offlineFormat !== 1) reject(new Error('离线模型数据未注册：' + key));
      else resolve(definition);
    };
    script.onerror = () => { script.remove(); pendingDefinitions.delete(key); reject(new Error('离线模型读取失败：' + key)); };
    document.head.appendChild(script);
  });
  pendingDefinitions.set(key, promise);
  return promise;
}

function infoFor(doc: OfflineDefinition) {
  let triangles = 0, skinnedPrimitives = 0;
  for (const mesh of doc.meshes || []) for (const primitive of mesh.primitives) {
    triangles += doc.accessors[primitive.indices === undefined ? primitive.attributes.POSITION : primitive.indices].count / 3;
  }
  for (const node of doc.nodes || []) {
    if (node.skin === undefined || node.mesh === undefined) continue;
    for (const primitive of (doc.meshes || [])[node.mesh].primitives) {
      if (primitive.attributes.JOINTS_0 !== undefined && primitive.attributes.WEIGHTS_0 !== undefined) skinnedPrimitives++;
    }
  }
  const materials = doc.materials || [];
  return { skins: (doc.skins || []).length, skinnedPrimitives, triangles,
    clips: (doc.animations || []).map((clip: any) => clip.name || '(未命名动画)'), materials: materials.length,
    normalMaterials: materials.filter((material: any) => material.normalTexture).length,
    roughnessMaterials: materials.filter((material: any) => material.pbrMetallicRoughness && material.pbrMetallicRoughness.metallicRoughnessTexture).length };
}

export async function inspectOfflineModel(url: string) { return infoFor(await loadOfflineDefinition(url)); }

/** Decode semantic arrays directly; no byte streams, binary decoder or request API. */
export async function parseOfflineDefinition(doc: OfflineDefinition, options: { textures?: boolean } = {}): Promise<GLTF> {
  if (doc.offlineFormat !== 1) throw new Error('不支持的离线模型版本');
  const accessorCache = new Map<number, THREE.BufferAttribute>();
  const readAccessor = (index: number): THREE.BufferAttribute => {
    const cached = accessorCache.get(index); if (cached) return cached;
    const entry = doc.accessors[index], width = widths[entry.type];
    const ArrayType = constructors[entry.componentType];
    const data = new ArrayType(entry.data.length);
    if (entry.scale) {
      for (let i = 0; i < entry.data.length; i++) data[i] = entry.data[i] * entry.scale[i % width] + entry.offset[i % width];
    } else data.set(entry.data);
    const attribute = new THREE.BufferAttribute(data, width, !!entry.normalized);
    accessorCache.set(index, attribute); return attribute;
  };

  const imageCache = new Map<number, Promise<HTMLImageElement>>();
  const readImage = (index: number): Promise<HTMLImageElement> => {
    let pending = imageCache.get(index); if (pending) return pending;
    pending = new Promise((resolve, reject) => {
      const source = (doc.images || [])[index];
      if (!source || !/^\.\/assets\/model-textures\/[a-z0-9-]+\.webp$/.test(source.uri)) {
        reject(new Error('离线纹理路径无效')); return;
      }
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('离线纹理读取失败：' + source.uri));
      image.src = source.uri;
    });
    imageCache.set(index, pending); return pending;
  };
  const textureCache = new Map<string, Promise<THREE.Texture | null>>();
  const readTexture = (definition: any, color = false): Promise<THREE.Texture | null> => {
    if (!definition || options.textures === false) return Promise.resolve(null);
    const key = definition.index + ':' + color + ':' + (definition.texCoord || 0);
    const cached = textureCache.get(key); if (cached) return cached;
    const promise = (async () => {
      const source = (doc.textures || [])[definition.index];
      const image = await readImage(source.source);
      const texture = new THREE.Texture(image), sampler = (doc.samplers || [])[source.sampler] || {};
      texture.name = source.name || (doc.images || [])[source.source].name || '';
      texture.flipY = false; texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.channel = definition.texCoord || 0;
      texture.wrapS = sampler.wrapS === 33071 ? THREE.ClampToEdgeWrapping : sampler.wrapS === 33648 ? THREE.MirroredRepeatWrapping : THREE.RepeatWrapping;
      texture.wrapT = sampler.wrapT === 33071 ? THREE.ClampToEdgeWrapping : sampler.wrapT === 33648 ? THREE.MirroredRepeatWrapping : THREE.RepeatWrapping;
      texture.magFilter = sampler.magFilter === 9728 ? THREE.NearestFilter : THREE.LinearFilter;
      const filters: Record<number, THREE.MinificationTextureFilter> = { 9728: THREE.NearestFilter, 9729: THREE.LinearFilter, 9984: THREE.NearestMipmapNearestFilter,
        9985: THREE.LinearMipmapNearestFilter, 9986: THREE.NearestMipmapLinearFilter, 9987: THREE.LinearMipmapLinearFilter };
      texture.minFilter = filters[sampler.minFilter] || THREE.LinearMipmapLinearFilter;
      const transform = definition.extensions && definition.extensions.KHR_texture_transform;
      if (transform) {
        if (transform.offset) texture.offset.fromArray(transform.offset);
        if (transform.scale) texture.repeat.fromArray(transform.scale);
        if (transform.rotation) texture.rotation = transform.rotation;
        if (transform.texCoord !== undefined) texture.channel = transform.texCoord;
      }
      texture.needsUpdate = true; return texture;
    })();
    textureCache.set(key, promise); return promise;
  };

  const materials: THREE.MeshStandardMaterial[] = [];
  for (const definition of doc.materials || []) {
    const legacy = definition.extensions && definition.extensions.KHR_materials_pbrSpecularGlossiness;
    const pbr = legacy ? { baseColorFactor: legacy.diffuseFactor, baseColorTexture: legacy.diffuseTexture,
      metallicFactor: 0, roughnessFactor: 1 - (legacy.glossinessFactor === undefined ? 1 : legacy.glossinessFactor) } : definition.pbrMetallicRoughness || {};
    const specular = definition.extensions && definition.extensions.KHR_materials_specular;
    const material = specular ? new THREE.MeshPhysicalMaterial() : new THREE.MeshStandardMaterial();
    if (specular && material instanceof THREE.MeshPhysicalMaterial) {
      material.specularIntensity = specular.specularFactor === undefined ? 1 : specular.specularFactor;
      if (specular.specularColorFactor) material.specularColor.fromArray(specular.specularColorFactor);
    }
    material.name = definition.name || '';
    const color = pbr.baseColorFactor || [1, 1, 1, 1];
    material.color.setRGB(color[0], color[1], color[2], THREE.LinearSRGBColorSpace); material.opacity = color[3];
    material.metalness = pbr.metallicFactor === undefined ? 1 : pbr.metallicFactor;
    material.roughness = pbr.roughnessFactor === undefined ? 1 : pbr.roughnessFactor;
    material.side = definition.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
    material.transparent = definition.alphaMode === 'BLEND';
    material.depthWrite = !material.transparent;
    material.alphaTest = definition.alphaMode === 'MASK' ? (definition.alphaCutoff === undefined ? .5 : definition.alphaCutoff) : 0;
    if (definition.emissiveFactor) material.emissive.fromArray(definition.emissiveFactor);
    const maps = await Promise.all([readTexture(pbr.baseColorTexture, true), readTexture(pbr.metallicRoughnessTexture),
      readTexture(definition.normalTexture), readTexture(definition.occlusionTexture), readTexture(definition.emissiveTexture, true)]);
    material.map = maps[0]; material.roughnessMap = maps[1]; material.metalnessMap = maps[1];
    material.normalMap = maps[2]; material.aoMap = maps[3]; material.emissiveMap = maps[4];
    if (definition.normalTexture && definition.normalTexture.scale !== undefined) material.normalScale.setScalar(definition.normalTexture.scale);
    if (definition.occlusionTexture && definition.occlusionTexture.strength !== undefined) material.aoMapIntensity = definition.occlusionTexture.strength;
    Object.assign(material.userData, definition.extras || {}); materials.push(material);
  }
  const defaultMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 1 });
  const boneIndices = new Set<number>();
  for (const skin of doc.skins || []) for (const joint of skin.joints) boneIndices.add(joint);
  const usedNames = new Map<string, number>();
  const uniqueName = (raw: string) => {
    const name = THREE.PropertyBinding.sanitizeNodeName(raw || '');
    const prior = usedNames.get(name);
    if (prior === undefined) { usedNames.set(name, 0); return name; }
    usedNames.set(name, prior + 1); return name + '_' + (prior + 1);
  };
  // Reserve node names before mesh names, matching the GLTFLoader ownership rule.
  const nodeNames = (doc.nodes || []).map((node: any) => node.name ? uniqueName(node.name) : '');
  const geometries = new Map<string, THREE.BufferGeometry>();
  const meshForNode = (nodeDefinition: any): THREE.Object3D | undefined => {
    if (nodeDefinition.mesh === undefined) return undefined;
    const meshDefinition = (doc.meshes || [])[nodeDefinition.mesh];
    const meshes = meshDefinition.primitives.map((primitive: any, primitiveIndex: number) => {
      const key = nodeDefinition.mesh + ':' + primitiveIndex;
      let geometry = geometries.get(key);
      if (!geometry) {
        geometry = new THREE.BufferGeometry();
        for (const name of Object.keys(primitive.attributes)) {
          if (attributes[name]) geometry.setAttribute(attributes[name], readAccessor(primitive.attributes[name]));
        }
        if (primitive.indices !== undefined) geometry.setIndex(readAccessor(primitive.indices));
        if (primitive.extras && primitive.extras.offlineLodIndices) {
          geometry.userData.offlineLodIndices = new Uint32Array(primitive.extras.offlineLodIndices);
          geometry.userData.offlineLodError = primitive.extras.offlineLodError;
        }
        if (primitive.extras && primitive.extras.offlineWorldProxy) geometry.userData.offlineWorldProxy = primitive.extras.offlineWorldProxy;
        if (primitive.extras && primitive.extras.offlineCharacterLodIndices) geometry.userData.offlineCharacterLodIndices = new Uint32Array(primitive.extras.offlineCharacterLodIndices);
        if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
        geometry.computeBoundingBox(); geometry.computeBoundingSphere(); geometries.set(key, geometry);
      }
      const material = primitive.material === undefined ? defaultMaterial : materials[primitive.material];
      if (geometry.getAttribute('color')) material.vertexColors = true;
      const mesh = nodeDefinition.skin === undefined ? new THREE.Mesh(geometry, material) : new THREE.SkinnedMesh(geometry, material);
      if (mesh instanceof THREE.SkinnedMesh) { mesh.normalizeSkinWeights(); mesh.frustumCulled = false; }
      mesh.name = uniqueName(meshDefinition.name || 'mesh_' + nodeDefinition.mesh);
      Object.assign(mesh.userData, meshDefinition.extras || {});
      for (const field of Object.keys(primitive.extras || {})) {
        if (field !== 'offlineLodIndices' && field !== 'offlineLodError' && field !== 'offlineWorldProxy' && field !== 'offlineCharacterLodIndices') mesh.userData[field] = primitive.extras[field];
      }
      return mesh;
    });
    if (meshes.length === 1) return meshes[0];
    const group = new THREE.Group(); group.add(...meshes); return group;
  };
  const nodes = (doc.nodes || []).map((definition: any, index: number) => {
    const mesh = meshForNode(definition);
    const node: THREE.Object3D = boneIndices.has(index) ? new THREE.Bone() : mesh || new THREE.Object3D();
    if (mesh && node !== mesh) node.add(mesh);
    if (definition.name) { node.name = nodeNames[index]; node.userData.name = definition.name; }
    Object.assign(node.userData, definition.extras || {});
    if (definition.matrix) node.applyMatrix4(new THREE.Matrix4().fromArray(definition.matrix));
    else {
      if (definition.translation) node.position.fromArray(definition.translation);
      if (definition.rotation) node.quaternion.fromArray(definition.rotation);
      if (definition.scale) node.scale.fromArray(definition.scale);
    }
    return node;
  });
  const skeletons = (doc.skins || []).map((definition: any) => {
    const inverses: THREE.Matrix4[] = [];
    const attribute = definition.inverseBindMatrices === undefined ? undefined : readAccessor(definition.inverseBindMatrices);
    for (let i = 0; i < definition.joints.length; i++) inverses.push(attribute ? new THREE.Matrix4().fromArray(attribute.array, i * 16) : new THREE.Matrix4());
    return new THREE.Skeleton(definition.joints.map((index: number) => nodes[index] as THREE.Bone), inverses);
  });
  // Bind before adding child nodes so one skin never captures a child's mesh.
  for (let i = 0; i < nodes.length; i++) {
    const definition = (doc.nodes || [])[i];
    if (definition.skin !== undefined) nodes[i].traverse(object => { if (object instanceof THREE.SkinnedMesh) object.bind(skeletons[definition.skin], new THREE.Matrix4()); });
  }
  for (let i = 0; i < nodes.length; i++) for (const child of (doc.nodes || [])[i].children || []) nodes[i].add(nodes[child]);
  const scenes = (doc.scenes || [{ nodes: [] }]).map((definition: any) => {
    const scene = new THREE.Group(); scene.name = definition.name ? uniqueName(definition.name) : '';
    Object.assign(scene.userData, definition.extras || {});
    for (const index of definition.nodes || []) scene.add(nodes[index]);
    scene.updateMatrixWorld(true); return scene;
  });
  const animations = (doc.animations || []).map((definition: any, animationIndex: number) => {
    const tracks: THREE.KeyframeTrack[] = [];
    for (const channel of definition.channels) {
      const sampler = definition.samplers[channel.sampler], target = nodes[channel.target.node];
      const input = readAccessor(sampler.input), output = readAccessor(sampler.output);
      const interpolation = sampler.interpolation === 'STEP' ? THREE.InterpolateDiscrete : THREE.InterpolateLinear;
      if (sampler.interpolation && sampler.interpolation !== 'LINEAR' && sampler.interpolation !== 'STEP') throw new Error('离线动画插值类型不受支持');
      const property = channel.target.path === 'translation' ? 'position' : channel.target.path === 'rotation' ? 'quaternion' : channel.target.path;
      const Track = property === 'quaternion' ? THREE.QuaternionKeyframeTrack : THREE.VectorKeyframeTrack;
      tracks.push(new Track((target.name || target.uuid) + '.' + property, input.array, output.array, interpolation));
    }
    return new THREE.AnimationClip(definition.name || 'animation_' + animationIndex, -1, tracks);
  });
  const scene = scenes[doc.scene || 0];
  return { scene, scenes, animations, cameras: [], asset: doc.asset || {}, userData: { offlineModel: true },
    parser: { json: doc, getDependency(kind: string, index: number) {
      if (kind === 'material') return Promise.resolve(materials[index]);
      if (kind === 'texture') return readTexture({ index });
      if (kind === 'node') return Promise.resolve(nodes[index]);
      if (kind === 'accessor') return Promise.resolve(readAccessor(index));
      return Promise.reject(new Error('未支持的离线依赖：' + kind));
    } } };
}

export async function loadOfflineGLTF(url: string): Promise<GLTF> {
  return parseOfflineDefinition(await loadOfflineDefinition(url));
}

const worldProxyGeometries = new Map<string, THREE.BufferGeometry>();
const characterLodGeometries = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();

/** Index-only reduction: all original joint indices/weights and UVs survive. */
export function applyOfflineCharacterLod(root: THREE.Object3D): void {
  root.traverse(object => {
    if (!(object instanceof THREE.SkinnedMesh)) return;
    const original = object.geometry, indices = original.userData.offlineCharacterLodIndices;
    if (!indices || original.userData.offlineCharacterLodApplied) return;
    let geometry = characterLodGeometries.get(original);
    if (!geometry) {
      const created = original.clone() as THREE.BufferGeometry; created.setIndex(new THREE.BufferAttribute(indices, 1));
      created.userData = { ...original.userData };
      created.userData.offlineCharacterLodApplied = true; characterLodGeometries.set(original, created); geometry = created;
    }
    object.geometry = geometry;
  });
}

const worldProxyMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, color: 0xffffff,
  roughness: .72, metalness: .15, side: THREE.DoubleSide });
worldProxyMaterial.name = 'offline-world-weapon-baked-albedo';

/** Replace only a held/ground clone. Original view geometry/materials stay shared
 * and unchanged. Each rigid part gets one draw, keeping magazine/bolt/pump rigs. */
export function applyOfflineWorldProxy(root: THREE.Object3D): void {
  if (root.userData.offlineWorldProxyApplied) return;
  const groups = new Map<THREE.Object3D, THREE.Mesh[]>();
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.SkinnedMesh || !object.geometry.userData.offlineWorldProxy
      || !Array.isArray(object.geometry.userData.offlineWorldProxy.position) || !object.parent) return;
    const group = groups.get(object.parent) || []; group.push(object); groups.set(object.parent, group);
  });
  for (const [parent, meshes] of groups) {
    for (const mesh of meshes) mesh.updateMatrix();
    const key = meshes.map(mesh => mesh.geometry.uuid + ':' + mesh.matrix.elements.join(',')).join('|');
    let geometry = worldProxyGeometries.get(key);
    if (!geometry) {
      const positions: number[] = [], colors: number[] = [], indices: number[] = [];
      const point = new THREE.Vector3();
      for (const mesh of meshes) {
        const source = mesh.geometry.userData.offlineWorldProxy;
        const base = positions.length / 3;
        for (let vertex = 0; vertex < source.position.length / 3; vertex++) {
          point.fromArray(source.position, vertex * 3).applyMatrix4(mesh.matrix);
          positions.push(point.x, point.y, point.z);
          colors.push(source.color[vertex * 3], source.color[vertex * 3 + 1], source.color[vertex * 3 + 2]);
        }
        const flip = mesh.matrix.determinant() < 0;
        for (let triangle = 0; triangle < source.index.length; triangle += 3) {
          indices.push(base + source.index[triangle], base + source.index[triangle + (flip ? 2 : 1)], base + source.index[triangle + (flip ? 1 : 2)]);
        }
      }
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.Uint8BufferAttribute(colors, 3, true));
      geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      geometry.userData.offlineWorldProxy = true;
      worldProxyGeometries.set(key, geometry);
    }
    // Keep source-named nodes for diagnostics and inherited animated wrappers.
    for (const mesh of meshes) mesh.visible = false;
    const proxy = new THREE.Mesh(geometry, worldProxyMaterial);
    proxy.name = 'offline-world-proxy:' + parent.name; proxy.receiveShadow = true; proxy.castShadow = false;
    parent.add(proxy);
  }
  root.userData.offlineWorldProxyApplied = true;
}

/** Drop-in import alias for existing game loaders; no networking implementation. */
export class GLTFLoader {
  private callbacks: Array<(parser: any) => any> = [];
  constructor(_manager?: THREE.LoadingManager) {}
  register(callback: (parser: any) => any) { this.callbacks.push(callback); return this; }
  async loadAsync(url: string, _progress?: (event: ProgressEvent) => void): Promise<GLTF> {
    const result = await loadOfflineGLTF(url);
    // Existing game code registers its legacy-material adapter; all supplied
    // derivatives already have modern PBR materials, but afterRoot stays usable.
    for (const callback of this.callbacks) {
      const plugin = callback(result.parser);
      if (plugin && plugin.afterRoot) await plugin.afterRoot(result);
    }
    return result;
  }
  load(url: string, onLoad: (result: GLTF) => void, onProgress?: (event: ProgressEvent) => void, onError?: (error: unknown) => void) {
    this.loadAsync(url, onProgress).then(onLoad, onError);
  }
}
