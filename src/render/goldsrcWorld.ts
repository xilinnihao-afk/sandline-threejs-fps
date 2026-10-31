import * as THREE from 'three';

interface GoldSrcMeshGroup {
  name: string;
  texture: string;
  vertexOffset: number;
  vertexCount: number;
  indexOffset: number;
  indexCount: number;
  transparent: boolean;
  opacity?: number;
}

interface GoldSrcManifest {
  format: string;
  geometry: string;
  lightmap: string;
  sky: string[];
  triangles: number;
  groups: GoldSrcMeshGroup[];
}

/** Original CS 1.6 BSP geometry, texture pixels and baked radiosity. */
export function createGoldSrcWorld(mapId: 'dust2' | 'assault' | 'bloodstrike', sourceName: string): THREE.Group {
  const root = new THREE.Group();
  root.name = `Sandline / CS 1.6 ${sourceName}`;
  root.userData.mapId = mapId;
  root.userData.bakedLighting = true;
  root.userData.assetsReady = loadGoldSrc(root, mapId, sourceName);
  return root;
}

async function loadGoldSrc(root: THREE.Group, mapId: string, sourceName: string): Promise<void> {
  const assetRoot = `${import.meta.env.BASE_URL}assets/maps/${mapId}/`;
  const response = await fetch(`${assetRoot}manifest.json`);
  if (!response.ok) throw new Error(`${sourceName} manifest: HTTP ${response.status}`);
  const manifest = await response.json() as GoldSrcManifest;
  if (manifest.format !== 'sandline-goldsrc-mesh-v1') throw new Error(`Unsupported ${sourceName} geometry`);
  const loader = new THREE.TextureLoader();
  const resources: Array<THREE.BufferGeometry | THREE.Material | THREE.Texture> = [];
  try {
    const [geometryResponse, lightmap, sky] = await Promise.all([
      fetch(`${assetRoot}${manifest.geometry}`),
      loader.loadAsync(`${assetRoot}${manifest.lightmap}`),
      manifest.sky.length === 6 ? new THREE.CubeTextureLoader().loadAsync(manifest.sky.map(filename => `${assetRoot}${filename}`)) : Promise.resolve(null),
    ]);
    resources.push(lightmap);
    if (sky) {
      resources.push(sky);
      sky.name = `${sourceName} / original sky`;
      sky.colorSpace = THREE.SRGBColorSpace;
    }
    if (!geometryResponse.ok) throw new Error(`${sourceName} geometry: HTTP ${geometryResponse.status}`);
    const binary = await geometryResponse.arrayBuffer();
    lightmap.name = `${sourceName} / original BSP radiosity`;
    lightmap.flipY = false;
    lightmap.channel = 1;
    lightmap.colorSpace = THREE.NoColorSpace;
    lightmap.minFilter = THREE.LinearFilter;
    lightmap.magFilter = THREE.LinearFilter;
    lightmap.generateMipmaps = false;
    const textureResults = await Promise.allSettled(manifest.groups.map(async group => {
      const texture = await loader.loadAsync(`${assetRoot}${group.texture}`);
      resources.push(texture);
      texture.name = `${sourceName} / ${group.name}`;
      texture.flipY = false;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = 4;
      return texture;
    }));
    const textureFailure = textureResults.find(result => result.status === 'rejected');
    if (textureFailure?.status === 'rejected') throw textureFailure.reason;
    manifest.groups.forEach((group, index) => {
      const texture = (textureResults[index] as PromiseFulfilledResult<THREE.Texture>).value;
      const buffer = new THREE.InterleavedBuffer(new Float32Array(binary, group.vertexOffset, group.vertexCount * 7), 7);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(buffer, 3, 0));
      geometry.setAttribute('uv', new THREE.InterleavedBufferAttribute(buffer, 2, 3));
      geometry.setAttribute('uv1', new THREE.InterleavedBufferAttribute(buffer, 2, 5));
      geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(binary, group.indexOffset, group.indexCount), 1));
      geometry.computeBoundingSphere();
      resources.push(geometry);
      const material = new THREE.MeshBasicMaterial({
        name: `${sourceName} / ${group.name}`,
        map: texture,
        lightMap: lightmap,
        // GoldSrc stores a baked color multiplier. MeshBasicMaterial divides
        // irradiance by PI, so compensate once to preserve its full range.
        lightMapIntensity: Math.PI,
        toneMapped: false,
        fog: false,
        alphaTest: group.transparent ? .5 : 0,
        opacity: group.opacity ?? 1,
        transparent: (group.opacity ?? 1) < 1,
        depthWrite: (group.opacity ?? 1) >= 1,
      });
      material.onBeforeCompile = shader => {
        // A small fill lifts unlit passages while retaining the baked contrast.
        // Apply before albedo and the single sRGB output conversion; white
        // light stays white, so bright walls retain their texture detail.
        shader.fragmentShader = shader.fragmentShader.replace(
          'vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );',
          `vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
          lightMapTexel.rgb = mix( vec3( 0.08 ), lightMapTexel.rgb, 0.92 );`,
        );
      };
      material.customProgramCacheKey = () => 'goldsrc-readable-light-v1';
      resources.push(material);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `${sourceName} / ${group.name}`;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      root.add(mesh);
    });
    root.userData.triangles = manifest.triangles;
    root.userData.sky = sky;
    root.userData.assetsLoaded = true;
  } catch (error) {
    root.clear();
    resources.forEach(resource => resource.dispose());
    throw error;
  }
}
