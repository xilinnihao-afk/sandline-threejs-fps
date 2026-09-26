import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Actor, Team, WeaponKind } from '../game/types';

// One vertex-color material shared by every articulated part keeps mobile draws low.
const surface = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .78, metalness: .16 });
surface.name = 'Sandline character and weapon palette';
const flashMaterial = new THREE.MeshBasicMaterial({ color: '#ffe6a0', transparent: true, opacity: .9, depthWrite: false, toneMapped: false });
const baseBox = new THREE.BoxGeometry(1, 1, 1);
const baseSphere = new THREE.SphereGeometry(1, 12, 8);
const baseCylinder = new THREE.CylinderGeometry(1, 1, 1, 10);
const tint = new THREE.Color();
const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3(), position = new THREE.Vector3(), euler = new THREE.Euler();
type Parts = THREE.BufferGeometry[];
function part(parts: Parts, source: THREE.BufferGeometry, x: number, y: number, z: number, sx: number, sy: number, sz: number, color: string, rx = 0, ry = 0, rz = 0) {
  const g = source.index ? source.toNonIndexed() : source.clone();
  tint.set(color); const colors = new Float32Array(g.getAttribute('position').count * 3);
  for (let i = 0; i < colors.length; i += 3) { colors[i] = tint.r; colors[i + 1] = tint.g; colors[i + 2] = tint.b; }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  rotation.setFromEuler(euler.set(rx, ry, rz)); matrix.compose(position.set(x, y, z), rotation, scale.set(sx, sy, sz)); g.applyMatrix4(matrix); parts.push(g);
}
function cube(parts: Parts, x: number, y: number, z: number, w: number, h: number, d: number, color: string, rx = 0, ry = 0, rz = 0) { part(parts, baseBox, x, y, z, w, h, d, color, rx, ry, rz); }
function ellipsoid(parts: Parts, x: number, y: number, z: number, rx: number, ry: number, rz: number, color: string) { part(parts, baseSphere, x, y, z, rx, ry, rz, color); }
function tube(parts: Parts, x: number, y: number, z: number, radius: number, length: number, color: string, forward = false) { part(parts, baseCylinder, x, y, z, radius, length, radius, color, forward ? Math.PI / 2 : 0); }
function merged(parts: Parts, name: string): THREE.Mesh {
  const geometry = mergeGeometries(parts, false)!;
  for (const piece of parts) piece.dispose();
  geometry.computeBoundingSphere(); const mesh = new THREE.Mesh(geometry, surface); mesh.name = name; mesh.castShadow = true; mesh.receiveShadow = true; return mesh;
}

/** Gun points down -Z. The trigger is approximately at the group's origin. */
function weaponGeometry(kind: WeaponKind, hands: boolean): THREE.BufferGeometry {
  const p: Parts = [], gunmetal = '#353c3d', graphite = '#23292b', edge = '#66716d', steel = '#85918a', grip = '#5c5b4d';
  if (kind === 'rifle') {
    // A fictional compact service rifle: beveled receiver, handguard, irons, stock.
    cube(p, 0, .045, -.125, .072, .082, .23, gunmetal);
    cube(p, 0, .099, -.123, .055, .031, .244, edge);
    cube(p, .039, .057, -.105, .008, .035, .069, graphite); // ejection port
    cube(p, .044, .025, -.056, .014, .015, .051, steel);
    cube(p, -.04, .072, -.074, .014, .012, .055, steel); // charging handle
    cube(p, 0, .052, -.299, .074, .071, .13, grip);
    cube(p, 0, .017, -.3, .067, .025, .142, graphite);
    for (let i = 0; i < 7; i++) {
      cube(p, 0, .115, -.045 - i * .039, .065, .008, .012, graphite);
      for (const x of [-.039, .039]) cube(p, x, .052, -.247 - i * .015, .007, .025, .006, graphite);
    }
    tube(p, 0, .054, -.408, .012, .15, gunmetal, true);
    tube(p, 0, .054, -.482, .018, .045, edge, true);
    tube(p, 0, .054, -.507, .01, .007, '#101717', true);
    cube(p, 0, .092, -.369, .039, .087, .018, graphite);
    cube(p, 0, .142, -.369, .012, .033, .013, steel);
    for (const x of [-.018, .018]) cube(p, x, .14, -.036, .009, .05, .031, graphite);
    cube(p, 0, .002, .044, .046, .036, .11, graphite);
    cube(p, 0, -.012, .124, .058, .11, .095, grip, -.12);
    cube(p, 0, -.003, .174, .067, .137, .018, graphite);
    cube(p, 0, -.065, -.002, .052, .124, .048, grip, -.23);
    cube(p, 0, -.028, -.067, .043, .014, .05, graphite);
    cube(p, 0, -.053, -.09, .04, .052, .009, graphite);
    cube(p, 0, -.079, -.063, .04, .012, .055, graphite);
    cube(p, 0, -.119, -.151, .05, .19, .062, gunmetal, -.16);
    cube(p, 0, -.216, -.136, .063, .021, .068, graphite);
    for (const x of [-.026, .026]) for (const z of [-.132, -.153, -.174]) cube(p, x, -.12, z, .003, .11, .003, edge, -.16);
    cube(p, -.041, .012, -.025, .005, .018, .019, '#bea268');
    if (hands) {
      ellipsoid(p, .008, -.098, .007, .044, .067, .045, '#4b5045');
      cube(p, .024, -.104, -.02, .033, .076, .039, '#6a6d58', -.24);
      ellipsoid(p, -.019, -.011, -.29, .045, .052, .065, '#4b5045');
      cube(p, -.044, -.013, -.304, .028, .065, .076, '#676b57', -.15);
      ellipsoid(p, -.07, -.058, -.198, .056, .071, .14, '#657269');
      ellipsoid(p, .052, -.176, .055, .059, .1, .076, '#657269');
      for (let i = 0; i < 3; i++) cube(p, -.043, .001, -.282 + i * .016, .027, .035, .011, '#777b66');
    }
  } else {
    cube(p, 0, .051, -.076, .064, .067, .194, gunmetal);
    cube(p, 0, .089, -.076, .06, .012, .19, edge);
    cube(p, 0, .014, -.045, .059, .024, .137, graphite);
    cube(p, 0, -.065, .01, .059, .136, .062, grip, -.18);
    cube(p, 0, -.137, .025, .068, .016, .067, graphite, -.18);
    cube(p, 0, -.055, -.066, .041, .012, .055, graphite);
    cube(p, 0, -.031, -.091, .041, .055, .012, graphite);
    cube(p, 0, .047, -.176, .054, .052, .012, edge);
    tube(p, 0, .046, -.183, .016, .008, '#101718', true);
    cube(p, 0, .104, -.153, .012, .018, .019, graphite);
    for (const x of [-.023, .023]) cube(p, x, .104, .002, .012, .02, .02, graphite);
    for (const x of [-.033, .033]) for (let i = 0; i < 5; i++) cube(p, x, .059, -.022 + i * .008, .003, .035, .003, steel);
    cube(p, .033, .055, -.067, .004, .023, .034, graphite);
    if (hands) {
      ellipsoid(p, .008, -.086, .017, .047, .064, .052, '#545a4b');
      ellipsoid(p, -.033, -.077, -.02, .043, .066, .052, '#686e59');
      ellipsoid(p, .045, -.17, .073, .054, .097, .069, '#657269');
      ellipsoid(p, -.061, -.151, .049, .052, .075, .08, '#657269');
      for (let i = 0; i < 3; i++) cube(p, -.029, -.047 - i * .019, -.059, .061, .013, .02, '#7c816a');
    }
  }
  const geometry = mergeGeometries(p, false)!; for (const g of p) g.dispose(); return geometry;
}
const weaponCache = new Map<string, THREE.BufferGeometry>();
function sharedWeapon(kind: WeaponKind, hands: boolean) {
  const key = `${kind}:${hands}`;
  if (!weaponCache.has(key)) weaponCache.set(key, weaponGeometry(kind, hands));
  return weaponCache.get(key)!;
}

export function createWeapon(kind: WeaponKind): THREE.Group {
  const root = new THREE.Group(); root.name = `viewmodel:${kind}`;
  const mesh = new THREE.Mesh(sharedWeapon(kind, true), surface); mesh.name = 'weaponAndGlovedHands'; root.add(mesh);
  const muzzle = new THREE.Object3D(); muzzle.name = 'muzzle'; muzzle.position.set(0, .054, kind === 'rifle' ? -.52 : -.192); root.add(muzzle);
  root.userData.muzzle = muzzle;
  return root;
}

interface SoldierRig {
  body: THREE.Group; head: THREE.Group; leftArm: THREE.Group; rightArm: THREE.Group;
  leftLeg: THREE.Group; rightLeg: THREE.Group; leftShin: THREE.Group; rightShin: THREE.Group;
  gun: THREE.Mesh; flash: THREE.Mesh; weapon: WeaponKind;
}
const soldierTemplates = new Map<Team, THREE.Group>();
function buildSoldier(team: Team): THREE.Group {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body); body.position.y = .89;
  body.name = 'body';
  const cloth = team === 'blue' ? '#536e82' : '#a8613e';
  const clothDark = team === 'blue' ? '#354c5b' : '#774632';
  const armor = team === 'blue' ? '#293f49' : '#604b3b';
  const accent = team === 'blue' ? '#a8d0d5' : '#e5b388';
  const trousers = team === 'blue' ? '#65747b' : '#8b7962';
  const boot = '#2d322f', skin = '#b79677', glove = '#4c5044';
  const torso: Parts = [];
  ellipsoid(torso, 0, .27, 0, .255, .33, .16, cloth);
  cube(torso, 0, .28, -.135, .4, .4, .075, armor);
  cube(torso, 0, .31, .14, .36, .36, .09, armor);
  cube(torso, 0, .33, .207, .25, .26, .06, clothDark); // compact hydration pouch
  cube(torso, 0, .02, 0, .38, .16, .25, trousers);
  cube(torso, 0, .052, -.01, .405, .065, .28, boot);
  cube(torso, 0, .052, -.158, .082, .056, .022, '#8e917b');
  for (const x of [-.148, .148]) {
    cube(torso, x, .38, -.171, .045, .3, .025, '#78816e');
    cube(torso, x, .188, -.195, .095, .14, .055, armor);
    cube(torso, x, .273, -.227, .092, .018, .012, '#7b8471');
    cube(torso, x, .039, .148, .105, .095, .07, glove);
  }
  cube(torso, 0, .445, -.179, .16, .05, .008, accent);
  // Chest mark is geometric so team readability survives low texture resolution.
  cube(torso, 0, .445, -.185, .027, .032, .006, armor);
  cube(torso, -.194, .105, -.02, .06, .14, .095, glove);
  tube(torso, -.194, .21, -.02, .014, .09, '#303c36');
  tube(torso, 0, .58, 0, .072, .1, skin);
  body.add(merged(torso, 'torsoAndEquipment'));
  const head = new THREE.Group(); head.name = 'head'; head.position.set(0, .71, -.008); body.add(head);
  const hp: Parts = [];
  ellipsoid(hp, 0, .006, 0, .12, .148, .115, skin);
  ellipsoid(hp, 0, .057, .018, .141, .126, .138, armor);
  cube(hp, 0, .038, -.112, .223, .066, .03, '#293a3c');
  cube(hp, -.059, .042, -.131, .089, .036, .012, '#687e7a');
  cube(hp, .059, .042, -.131, .089, .036, .012, '#687e7a');
  cube(hp, 0, -.061, -.105, .162, .071, .046, clothDark);
  cube(hp, 0, .112, -.034, .055, .026, .16, clothDark);
  for (const x of [-.133, .133]) ellipsoid(hp, x, -.013, .014, .027, .064, .051, boot);
  cube(hp, -.137, -.071, -.059, .013, .014, .106, boot);
  head.add(merged(hp, 'helmetGogglesAndFace'));
  const arms: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Group(); arm.name = side < 0 ? 'leftArm' : 'rightArm'; arm.position.set(side * .25, .435, 0); body.add(arm); arms.push(arm);
    const ap: Parts = [];
    ellipsoid(ap, 0, -.071, .004, .093, .127, .097, cloth);
    ellipsoid(ap, side * .019, -.196, -.025, .072, .143, .077, clothDark);
    ellipsoid(ap, side * .013, -.293, -.13, .072, .071, .156, cloth);
    ellipsoid(ap, 0, -.273, -.258, .059, .066, .07, glove);
    cube(ap, side * .076, -.04, -.004, .019, .09, .077, accent);
    cube(ap, side * .02, -.242, .012, .092, .089, .027, armor);
    arm.add(merged(ap, 'sleeveElbowAndGlove'));
  }
  const legs: THREE.Group[] = [], shins: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const leg = new THREE.Group(); leg.name = side < 0 ? 'leftLeg' : 'rightLeg'; leg.position.set(side * .11, -.055, 0); body.add(leg); legs.push(leg);
    const lp: Parts = [];
    ellipsoid(lp, 0, -.16, .013, .105, .215, .12, trousers);
    cube(lp, side * .085, -.162, .025, .068, .156, .137, clothDark);
    ellipsoid(lp, 0, -.355, -.045, .088, .1, .087, armor);
    leg.add(merged(lp, 'thighCargoAndKnee'));
    const shin = new THREE.Group(); shin.name = side < 0 ? 'leftShin' : 'rightShin'; shin.position.y = -.36; leg.add(shin); shins.push(shin);
    const sp: Parts = [];
    ellipsoid(sp, 0, -.164, .015, .073, .179, .086, trousers);
    cube(sp, 0, -.302, .012, .14, .19, .157, boot);
    ellipsoid(sp, 0, -.358, -.07, .077, .075, .143, boot);
    cube(sp, 0, -.431, -.045, .155, .068, .255, '#242b29');
    for (let i = 0; i < 3; i++) cube(sp, 0, -.26 - i * .035, -.071, .06, .012, .013, '#737969');
    shin.add(merged(sp, 'shinAndCombatBoot'));
  }
  const gun = new THREE.Mesh(sharedWeapon('rifle', false), surface); gun.name = 'heldWeapon'; gun.castShadow = true; gun.position.set(.065, .42, -.31); body.add(gun);
  const flash = new THREE.Mesh(new THREE.ConeGeometry(.07, .17, 5), flashMaterial); flash.name = 'muzzleFlash'; flash.rotation.x = -Math.PI / 2; flash.position.set(.065, .474, -.85); flash.visible = false; body.add(flash);
  root.name = `soldier:${team}`;
  return root;
}

export function createSoldier(team: Team): THREE.Group {
  if (!soldierTemplates.has(team)) soldierTemplates.set(team, buildSoldier(team));
  // The clone shares immutable geometry and materials, but owns all animation joints.
  const root = soldierTemplates.get(team)!.clone(true);
  const named = (name: string) => root.getObjectByName(name)!;
  root.userData.rig = {
    body: named('body'), head: named('head'), leftArm: named('leftArm'), rightArm: named('rightArm'),
    leftLeg: named('leftLeg'), rightLeg: named('rightLeg'), leftShin: named('leftShin'), rightShin: named('rightShin'),
    gun: named('heldWeapon'), flash: named('muzzleFlash'), weapon: 'rifle',
  } as SoldierRig;
  return root;
}

/** Updates position/yaw and articulated pose without allocating per frame. */
export function updateSoldier(group: THREE.Group, actor: Actor, time: number): void {
  const rig = group.userData.rig as SoldierRig;
  const dead = actor.health <= 0, crouch = actor.crouched && !dead;
  const gait = actor.moving && !dead ? Math.sin(time * (crouch ? 9 : 12) + actor.id * 1.7) : 0;
  const recoil = Math.max(0, 1 - (time - actor.shotTime) / .12);
  group.position.set(actor.x, 0, actor.z); group.rotation.set(0, actor.yaw, 0);
  rig.body.position.set(0, dead ? .19 : crouch ? .585 : .89 + Math.abs(gait) * .017, 0);
  // Duck the neck to keep the eyes aligned with the 1.08 m crouched sightline.
  rig.head.position.y = crouch ? .44 : .71;
  rig.body.rotation.set(dead ? -Math.PI / 2 : 0, 0, dead ? .13 : 0);
  rig.head.rotation.x = dead ? .1 : -actor.pitch * .35;
  rig.leftLeg.rotation.x = dead ? .1 : crouch ? 1.1 + gait * .16 : gait * .43;
  rig.rightLeg.rotation.x = dead ? -.1 : crouch ? 1.1 - gait * .16 : -gait * .43;
  rig.leftShin.rotation.x = dead ? .16 : crouch ? -2.2 : Math.max(0, -gait) * .65;
  rig.rightShin.rotation.x = dead ? .22 : crouch ? -2.2 : Math.max(0, gait) * .65;
  rig.leftArm.position.y = rig.rightArm.position.y = crouch ? .365 : .435;
  rig.leftArm.rotation.set(dead ? -.25 : .7 + recoil * .04, dead ? -.35 : -.6, dead ? .65 : -.08);
  rig.rightArm.rotation.set(dead ? -.15 : .8 + recoil * .09, dead ? .25 : .5, dead ? -.45 : .05);
  if (rig.weapon !== actor.weapon) {
    rig.gun.geometry = sharedWeapon(actor.weapon, false); rig.weapon = actor.weapon;
    rig.flash.position.z = actor.weapon === 'rifle' ? -.85 : -.55;
  }
  rig.gun.position.z = -.31 + recoil * .023;
  rig.gun.rotation.x = -actor.pitch * .4 + recoil * .045;
  rig.flash.visible = !dead && actor.shotTime > 0 && time - actor.shotTime >= 0 && time - actor.shotTime < .055;
}
