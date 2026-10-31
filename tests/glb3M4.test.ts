import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {setActiveMap} from '../src/game/map';
import {Simulation, WEAPONS} from '../src/game/simulation';
import {createGroundWeapon, createHeldWeapon, loadImportedWeaponAssets, updateHeldWeapon} from '../src/render/weapons';

const project = new URL('../', import.meta.url);
const report = JSON.parse(fs.readFileSync(new URL('artifacts/glb3-replacement-20261023/m4-preparation.json', project), 'utf8'));
function readGlb(path: string) {
  const bytes = fs.readFileSync(new URL(path, project));
  assert.equal(bytes.readUInt32LE(0), 0x46546c67);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const length = bytes.readUInt32LE(12);
  const doc = JSON.parse(bytes.subarray(20, 20 + length).toString());
  const binary = bytes.subarray(28 + length);
  return {bytes, doc, binary};
}
function values(glb: ReturnType<typeof readGlb>, index: number): number[][] {
  const a = glb.doc.accessors[index], view = glb.doc.bufferViews[a.bufferView];
  const components = ({SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4} as Record<string, number>)[a.type];
  const width = a.componentType === 5126 || a.componentType === 5125 ? 4 : 2;
  return Array.from({length: a.count}, (_, i) => Array.from({length: components}, (_, c) => {
    const offset = (view.byteOffset ?? 0) + (a.byteOffset ?? 0) + i * (view.byteStride ?? components * width) + c * width;
    return a.componentType === 5126 ? glb.binary.readFloatLE(offset) : a.componentType === 5125 ? glb.binary.readUInt32LE(offset) : glb.binary.readUInt16LE(offset);
  }));
}
async function parseGeometry(kind: string): Promise<THREE.Group> {
  const {doc, binary} = readGlb(`public/assets/runtime/${kind}.glb`);
  doc.buffers[0].uri = 'data:application/octet-stream;base64,' + binary.toString('base64');
  doc.materials = doc.materials.map(() => ({}));
  delete doc.images; delete doc.textures; delete doc.extensionsRequired; delete doc.extensionsUsed;
  (globalThis as any).ProgressEvent ??= class {};
  return (await new GLTFLoader().parseAsync(JSON.stringify(doc), '')).scene;
}

test('replacement M4 retains the supplied model and PBR roles without obsolete rig downloads', () => {
  const source = readGlb(report.source), output = readGlb('public/assets/runtime/m4.glb');
  assert.equal(createHash('sha256').update(source.bytes).digest('hex'), report.sourceSha256);
  assert.equal(createHash('sha256').update(output.bytes).digest('hex'), report.sha256);
  assert.equal(output.bytes.length, report.after);
  assert.ok(output.bytes.length < 4 * 1024 * 1024, 'M4 exceeds mobile transfer budget');
  assert.deepEqual(output.doc.asset.extras, source.doc.asset.extras);
  assert.equal(output.doc.animations, undefined);
  assert.equal(output.doc.skins, undefined);
  assert.equal(output.doc.meshes.length, 3);
  assert.equal(output.doc.images.length, 3);
  assert.equal(output.doc.nodes[0].extras.assetRevision, 'glb3-cs2-m4a1');
  assert.deepEqual(output.doc.nodes[0].extras.movingParts, {magazine: true, bolt: true, pump: false});
  assert.equal(output.doc.nodes[0].extras.boltMechanism, 'nonreciprocating-charging-handle');
  for (const [i, image] of output.doc.images.entries()) {
    const view = output.doc.bufferViews[image.bufferView], offset = view.byteOffset ?? 0;
    assert.equal(image.uri, undefined);
    assert.equal(image.mimeType, 'image/webp');
    assert.equal(output.binary.subarray(offset, offset + 4).toString(), 'RIFF');
    assert.equal(output.binary.subarray(offset + 8, offset + 12).toString(), 'WEBP');
    assert.equal(output.doc.textures[i].extensions.EXT_texture_webp.source, i);
  }
  const material = output.doc.materials[0];
  assert.equal(material.pbrMetallicRoughness.baseColorTexture.index, 0);
  assert.equal(material.pbrMetallicRoughness.metallicRoughnessTexture.index, 1);
  assert.equal(material.occlusionTexture.index, 1);
  assert.equal(material.normalTexture.index, 2);
  assert.deepEqual(material.extensions, source.doc.materials[0].extensions);
});

test('every replacement M4 triangle belongs to its source mechanical joint with exact shape, normals and UVs', () => {
  const source = readGlb(report.source), output = readGlb('public/assets/runtime/m4.glb');
  const primitive = source.doc.meshes[0].primitives[0];
  const originalPositions = values(source, primitive.attributes.POSITION);
  const originalNormals = values(source, primitive.attributes.NORMAL);
  const originalUvs = values(source, primitive.attributes.TEXCOORD_0);
  const originalJoints = values(source, primitive.attributes.JOINTS_0).map(v => v[0]);
  const originalIndices = values(source, primitive.indices).map(v => v[0]);
  let total = 0;
  for (const [part, allowed] of [['body', [1, 3]], ['magazine', [2]], ['bolt', [4]]] as const) {
    const selected: number[] = [];
    for (let i = 0; i < originalIndices.length; i += 3) {
      if ((allowed as readonly number[]).includes(originalJoints[originalIndices[i]])) selected.push(...originalIndices.slice(i, i + 3));
    }
    const originalVertexIds = [...new Set(selected)].sort((a, b) => a - b);
    const mesh = output.doc.meshes.find((m: any) => m.name === `m4-${part}`).primitives[0];
    assert.deepEqual(Object.keys(mesh.attributes).sort(), ['NORMAL', 'POSITION', 'TANGENT', 'TEXCOORD_0']);
    const positions = values(output, mesh.attributes.POSITION), normals = values(output, mesh.attributes.NORMAL);
    const uvs = values(output, mesh.attributes.TEXCOORD_0), indices = values(output, mesh.indices).map(v => v[0]);
    assert.equal(positions.length, originalVertexIds.length);
    assert.equal(indices.length, selected.length);
    total += indices.length / 3;
    indices.forEach((vertex, i) => assert.equal(originalVertexIds[vertex], selected[i], `${part}: topology changed`));
    originalVertexIds.forEach((original, i) => {
      for (let axis = 0; axis < 3; axis++) {
        const sign = axis === 1 ? 1 : -1;
        const expected = originalPositions[original][axis] * sign * report.normalization.scale + report.normalization.translation[axis];
        assert.ok(Math.abs(positions[i][axis] - expected) < 1e-7, `${part}: altered source shape`);
        assert.ok(Math.abs(normals[i][axis] - originalNormals[original][axis] * sign) < 1e-7, `${part}: altered source normal`);
      }
      assert.deepEqual(uvs[i], originalUvs[original], `${part}: altered texture UV`);
    });
  }
  assert.equal(total, 43258);
});

test('runtime M4 held and ground clones use the replacement and real independently moving magazine', async t => {
  const cache = new Map<string, Promise<THREE.Group>>();
  const loader = t.mock.method(GLTFLoader.prototype, 'loadAsync', async (url: string) => {
    const kind = url.split('/').at(-1)!.split('?')[0].replace('.glb', '');
    if (!cache.has(kind)) cache.set(kind, parseGeometry(kind));
    return {scene: (await cache.get(kind)!).clone(true)};
  });
  await loadImportedWeaponAssets();
  loader.mock.restore();
  setActiveMap('snow');
  try {
    const actor = new Simulation(472).state.player;
    actor.weapon = 'm4'; actor.shotTime = -10; actor.moving = false; actor.guns.m4.ammo = 0;
    const held = createHeldWeapon('m4'), ground = createGroundWeapon('m4');
    const rig = held.userData.rig;
    assert.equal(held.getObjectByName('sketchfab-m4')!.userData.assetRevision, 'glb3-cs2-m4a1');
    assert.equal(ground.getObjectByName('sketchfab-m4')!.userData.assetRevision, 'glb3-cs2-m4a1');
    assert.notEqual(rig.magazine, ground.getObjectByName('magazine'));
    const points = (object: THREE.Object3D) => {
      held.updateMatrixWorld(true);
      const result: THREE.Vector3[] = [];
      object.traverse(node => {
        if (node instanceof THREE.Mesh) {
          const p = node.geometry.getAttribute('position');
          for (let i = 0; i < p.count; i++) result.push(rig.pivot.worldToLocal(node.localToWorld(new THREE.Vector3().fromBufferAttribute(p, i))));
        }
      });
      return result;
    };
    actor.guns.m4.reloadLeft = 0; updateHeldWeapon(held, actor, 20);
    const seated = points(rig.magazine), staticBody = points(held.getObjectByName('body')!);
    assert.equal(seated.length, report.partitions.magazine.vertices);
    let contact: THREE.Vector3 | undefined;
    for (const progress of [.18, .25, .38, .53, .65, .78]) {
      actor.guns.m4.reloadLeft = WEAPONS.m4.reload * (1 - progress); updateHeldWeapon(held, actor, 20 + progress);
      points(rig.magazine).forEach((point, i) => assert.ok(point.sub(seated[i]).distanceTo(rig.magazine.position) < 1e-6));
      points(held.getObjectByName('body')!).forEach((point, i) => assert.ok(point.distanceTo(staticBody[i]) < 1e-6));
      const local = rig.left.position.clone().sub(rig.magazine.position);
      contact ??= local.clone();
      assert.ok(local.distanceTo(contact) < 1e-6, 'reload contact slides off source magazine');
      if (progress === .38) assert.ok(rig.magazine.position.length() > .2, 'magazine does not leave the well');
      assert.equal(ground.getObjectByName('magazine')!.position.length(), 0);
    }
    actor.guns.m4.reloadLeft = 0; updateHeldWeapon(held, actor, 22);
    points(rig.magazine).forEach((point, i) => assert.ok(point.distanceTo(seated[i]) < 1e-7, 'magazine does not reseat'));
  } finally {setActiveMap('desert');}
});
