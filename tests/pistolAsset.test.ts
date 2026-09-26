import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {loadCPU} from './loadCharacterFixture';
import {normalizePistol} from '../src/render/pistolAsset';
test('real Beretta is centered after rotation and has a realistic 21cm length',async()=>{
 const gltf=await loadCPU('public/assets/weapons/beretta_apx_a1_full_size_standard.glb');
 const gun=normalizePistol(gltf.scene),box=new THREE.Box3().setFromObject(gun);
 assert.ok(box.getCenter(new THREE.Vector3()).length()<1e-6);
 assert.ok(Math.abs(box.getSize(new THREE.Vector3()).z-.21)<1e-6);
 assert.ok(box.getSize(new THREE.Vector3()).y<.16);
});
