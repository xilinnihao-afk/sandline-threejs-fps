import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MAP_BOXES, MAP_SIZE } from '../game/map';
import type { MapBox } from '../game/types';
import { createEnvironmentMaterials, type EnvironmentMaterialKey as Key } from './materials';

/** Original desert old quarter. Playable solid volumes remain exactly MAP_BOXES. */
export function createWorld(): THREE.Group {
  const root = new THREE.Group(); root.name = 'Sandline / gate street v0.3';
  const library = createEnvironmentMaterials(), materials = library.materials;
  const buckets = new Map<Key, THREE.BufferGeometry[]>();
  let seed = 19377, frame = new THREE.Matrix4();
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const matrix = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3(1, 1, 1), euler = new THREE.Euler(), color = new THREE.Color();
  const density: Partial<Record<Key, number>> = { plaster: .27, stone: .39, paving: .62, dirt: .18, brick: .76, wood: .67, metal: .7 };
  let authoredParts = 0;
  const add = (key: Key, geometry: THREE.BufferGeometry, x = 0, y = 0, z = 0, tint: THREE.ColorRepresentation = '#ffffff', rx = 0, ry = 0, rz = 0) => {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (g !== geometry) geometry.dispose();
    q.setFromEuler(euler.set(rx, ry, rz)); matrix.compose(pos.set(x, y, z), q, scl).premultiply(frame); g.applyMatrix4(matrix);
    const p = g.getAttribute('position'), normal = g.getAttribute('normal'), uv = g.getAttribute('uv');
    const colors = new Float32Array(p.count * 3); color.set(tint);
    for (let i = 0; i < p.count; i++) {
      const groundShade = key === 'plaster' || key === 'stone' || key === 'brick' ? .76 + .24 * Math.min(1, Math.max(0, p.getY(i)) / 1.1) : 1;
      const contact = normal.getY(i) < -.5 ? .73 : 1;
      colors[i * 3] = color.r * groundShade * contact; colors[i * 3 + 1] = color.g * groundShade * contact; colors[i * 3 + 2] = color.b * groundShade * contact;
      const tile = density[key];
      if (tile && uv) {
        const nx = Math.abs(normal.getX(i)), ny = Math.abs(normal.getY(i));
        uv.setXY(i, (nx > .5 ? p.getZ(i) : p.getX(i)) * tile, (ny > .5 ? p.getZ(i) : p.getY(i)) * tile);
      }
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    if (!buckets.has(key)) buckets.set(key, []); buckets.get(key)!.push(g); authoredParts++;
  };
  const box = (key: Key, x: number, y: number, z: number, w: number, h: number, d: number, tint: THREE.ColorRepresentation = '#ffffff', ry = 0, rz = 0, rx = 0) =>
    add(key, new THREE.BoxGeometry(w, h, d, 1, key === 'plaster' ? Math.max(1, Math.ceil(h * 1.8)) : 1, 1), x, y, z, tint, rx, ry, rz);
  const within = (x: number, y: number, z: number, yaw: number, fn: () => void) => {
    const previous = frame; frame = new THREE.Matrix4().makeRotationY(yaw); frame.setPosition(x, y, z); frame.premultiply(previous); fn(); frame = previous;
  };
  const cylinder = (key: Key, x: number, y: number, z: number, radius: number, height: number, tint: string, rx = 0, rz = 0, top = radius) =>
    add(key, new THREE.CylinderGeometry(top, radius, height, 10), x, y, z, tint, rx, 0, rz);
  const pipe = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, r = .024, tint = '#56594e') => {
    const direction = new THREE.Vector3(bx - ax, by - ay, bz - az);
    const g = new THREE.CylinderGeometry(r, r, direction.length(), 6); g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
    add('hardware', g, (ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, tint);
  };
  const atlasPlane = (key: 'grime' | 'signs', tile: number, x: number, y: number, z: number, w: number, h: number, yaw = 0, rx = 0) => {
    const g = new THREE.PlaneGeometry(w, h), uv = g.getAttribute('uv'), rows = 2;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (tile % 4 + .005 + uv.getX(i) * .99) / 4, 1 - (Math.floor(tile / 4) + .005 + (1 - uv.getY(i)) * .99) / rows);
    // Ground decals rotate about world up after being laid flat. Euler XYZ would
    // otherwise tilt a yawed road mark into the air.
    if (Math.abs(rx + Math.PI / 2) < .0001) within(x, y, z, yaw, () => add(key, g, 0, 0, 0, '#ffffff', rx));
    else add(key, g, x, y, z, '#ffffff', rx, yaw);
  };
  const stain = (x: number, top: number, z: number, w: number, h: number, tile = 0) => atlasPlane('grime', tile, x, top - h / 2, z, w, h);
  const sign = (id: number, x: number, y: number, z: number, w: number, h: number) => {
    box('hardware', x, y, z - .022, w + .08, h + .07, .04, '#4a4d40');
    atlasPlane('signs', id, x, y, z + .004, w, h);
  };
  const archShape = (radius: number, spring: number) => {
    const s = new THREE.Shape(); s.moveTo(-radius, 0); s.lineTo(radius, 0); s.lineTo(radius, spring); s.absarc(0, spring, radius, 0, Math.PI, false); s.closePath(); return s;
  };
  const archDoor = (width: number, spring: number, tint = '#847b62') => {
    const r = width / 2;
    add('dark', new THREE.ShapeGeometry(archShape(r + .04, spring), 18), 0, 0, .023, '#2a2b24');
    add('wood', new THREE.ShapeGeometry(archShape(r - .04, spring - .03), 18), 0, .045, .047, tint);
    // Separate worn planks read as a heavy gate at mobile viewing distance.
    const planks = Math.ceil(width / .22), step = (width - .1) / planks;
    for (let i = 0; i < planks; i++) {
      const x = -r + .05 + (i + .5) * step;
      const h = spring + Math.sqrt(Math.max(0, (r - .055) ** 2 - x * x)) - .055;
      box('wood', x, h / 2 + .042, .064, step - .01, h, .025, new THREE.Color(tint).multiplyScalar(.90 + (i % 4) * .045));
    }
    box('dark', 0, (spring + r) / 2, .058, .033, spring + r - .08, .015, '#292d27');
    for (const side of [-1, 1]) {
      box('stone', side * (r + .13), spring / 2, .08, .27, spring, .19, '#e7d5b6');
      for (let i = 0; i < 3; i++) {
        box('hardware', side * r * .52, .39 + i * .64, .088, r * .83, .075, .035, '#333b36');
        for (let j = 0; j < 3; j++) cylinder('hardware', side * (r * .23 + j * r * .28), .39 + i * .64, .115, .018, .019, '#94917c', Math.PI / 2);
      }
      add('hardware', new THREE.TorusGeometry(.077, .013, 5, 12), side * .15, 1.03, .105, '#a5a085');
    }
    for (let i = 0; i < 13; i++) {
      const start = i / 13 * Math.PI + .007, end = (i + 1) / 13 * Math.PI - .007;
      const shape = new THREE.Shape(); shape.absarc(0, spring, r + .01, start, end, false); shape.absarc(0, spring, r + .28, end, start, true); shape.closePath();
      add('stone', new THREE.ExtrudeGeometry(shape, { depth: .16, bevelEnabled: false, curveSegments: 2 }), 0, 0, .025, i === 6 ? '#f4e1b8' : i % 3 ? '#e1d0af' : '#cdbb98');
    }
    box('hardware', .08, 1.02, .14, .16, .14, .04, '#6a6c55'); cylinder('hardware', .08, .94, .16, .041, .012, '#a19065', Math.PI / 2);
    stain(0, .58, .19, width + .7, .6, 3);
  };
  const window = (x: number, y: number, width = 1.03, arched = false, closed = false, distant = false) => {
    within(x, y, .025, 0, () => {
      const h = 1.22;
      if (distant) {
        add('dark', new THREE.PlaneGeometry(width + .18, h + .12), 0, h / 2, .001, '#394138');
        add(closed ? 'wood' : 'glass', new THREE.PlaneGeometry(width - .1, h - .1), 0, h / 2, .012, closed ? '#778272' : '#435453');
        box('trim', 0, -.07, .07, width + .28, .12, .19, '#d9c9a8');
        box('trim', 0, h + .02, .024, width + .24, .08, .07, '#cfc0a0');
        box('hardware', 0, h / 2, .038, .035, h, .024, '#3d473c');
        return;
      }
      box('dark', 0, h / 2, 0, width + .16, h + .12, .045, '#343a32');
      if (arched) add('dark', new THREE.ShapeGeometry(archShape(width / 2 + .08, h * .73), 12), 0, 0, .012, '#3b3b2e');
      box(closed ? 'wood' : 'glass', 0, h / 2, .029, width - .09, h - .1, .016, closed ? '#647368' : '#3c4948');
      for (const side of [-1, 1]) {
        box('trim', side * (width / 2 + .09), h / 2, .065, .095, h + .15, .13, '#e4d6ba');
        if (!closed) {
          box('wood', side * (width / 2 + .23), h / 2, .04, .26, h, .05, '#899084', side * .12);
          for (let slat = 0; slat < 8; slat++) box('wood', side * (width / 2 + .23), .12 + slat * .14, .079, .26, .055, .025, '#819084');
        }
      }
      box('trim', 0, -.075, .125, width + .34, .13, .33, '#dac9a5');
      box('trim', 0, h + .06, .065, width + .28, .12, .17, '#cabc9e');
      for (const xx of [-width * .27, 0, width * .27]) box('hardware', xx, h / 2, .10, .018, h - .02, .025, '#343f38');
      box('hardware', 0, h / 2, .1, width, .025, .025, '#43483c');
      stain(0, -.12, .10, width + .5, 1.25);
    });
  };
  const airConditioner = (x: number, y: number) => {
    box('hardware', x, y, .29, .84, .48, .49, '#c9c8af');
    box('dark', x + .19, y, .541, .29, .35, .018, '#4b5550');
    for (let i = 0; i < 7; i++) box('hardware', x + .19, y - .15 + i * .05, .558, .28, .02, .024, '#b7bdac');
    cylinder('dark', x - .2, y, .553, .16, .021, '#414a45', Math.PI / 2);
    add('hardware', new THREE.TorusGeometry(.161, .013, 5, 14), x - .2, y, .573, '#b2b7a6');
    for (let i = 0; i < 4; i++) box('hardware', x - .2, y, .574, .022, .29, .018, '#879487', 0, i * Math.PI / 4);
    for (const side of [-1, 1]) {
      box('hardware', x + side * .30, y - .30, .27, .035, .035, .49, '#586354');
      pipe(x + side * .30, y - .5, .035, x + side * .30, y - .29, .46, .014, '#586354');
    }
    pipe(x + .42, y - .1, .22, x + .55, y - .13, .06, .032, '#d1c9ac');
    pipe(x + .55, y - .13, .06, x + .55, y - 1.28, .06, .032, '#d1c9ac');
    stain(x, y - .3, .065, 1.28, 1.45);
  };
  const patch = (x: number, y: number, w: number, h: number) => {
    const shape = new THREE.Shape();
    for (let i = 0; i < 15; i++) {
      const a = i / 15 * Math.PI * 2, jag = .77 + random() * .23, px = Math.cos(a) * w * .5 * jag, py = Math.sin(a) * h * .5 * jag;
      if (i === 0) shape.moveTo(px, py); else shape.lineTo(px, py);
    }
    shape.closePath();
    add('dark', new THREE.ShapeGeometry(shape), x, y, .027, '#887d63');
    const brick = new THREE.ShapeGeometry(shape); brick.scale(.96, .95, 1);
    add('brick', brick, x, y, .033, '#ddd0b2');
    // A few proud fragments make the plaster break a silhouette instead of a stain.
    for (let i = 0; i < 4; i++) {
      const xx = x + (random() - .5) * w * .61, yy = y + (random() - .5) * h * .58;
      box('brick', xx, yy, .046, .15 + random() * .14, .075 + random() * .045, .035, '#c4a681', 0, (random() - .5) * .18);
    }
  };
  const facade = (width: number, height: number, kind: number) => {
    box('stone', 0, .36, .02, width, .72, .055, '#bcae91');
    box('trim', 0, .76, .045, width, .065, .09, '#d3c4a5');
    for (const side of [-1, 1]) for (let row = 0; row < Math.floor(height / .38); row++) box('stone', side * (width / 2 - .15), .2 + row * .38, .048, row % 2 ? .29 : .44, .36, .115, row % 3 ? '#c6b89b' : '#e0ceb0');
    if (kind === 0) { archDoor(3.45, 2.12, '#a18d68'); sign(7, width * .31, 4.17, .10, 1.32, .44); }
    else {
      box('dark', 0, 1.34, .025, 2.92, 2.68, .04, '#383e33');
      box('metal', 0, 1.34, .07, 2.69, 2.54, .035, '#81938a');
      for (let y = .13; y < 2.6; y += .15) box('hardware', 0, y, .098, 2.66, .021, .018, '#76877a');
      box('hardware', 0, 1.01, .11, .48, .042, .028, '#303c34');
      box('hardware', .12, .94, .13, .078, .14, .043, '#aa9a74');
      sign(1, 0, 3.03, .08, 2.82, .57);
      const awning = new THREE.PlaneGeometry(3.3, .95, 8, 4), pp = awning.getAttribute('position');
      for (let i = 0; i < pp.count; i++) pp.setZ(i, Math.sin((pp.getX(i) + 1.65) * Math.PI / 3.3) * .07);
      add('cloth', awning, 0, 2.72, .49, '#c0ba92', -Math.PI / 2 + .23);
      for (const x of [-1.52, 1.52]) pipe(x, 2.35, .025, x, 2.61, .94, .018, '#525e4f');
      pipe(-1.65, 2.60, .94, 1.65, 2.60, .94, .026, '#626952');
    }
    for (const side of [-1, 1]) {
      if (width > 7) window(side * width * .34, 2.40, .9, kind === 0, side < 0);
      patch(side * width * .31, 1.09 + random() * .5, .6 + random() * .8, .7 + random() * .9);
      stain(side * width * .28, height - .32, .09, 1.3, 2.1);
    }
    stain(0, .77, .091, width, .77, 3); stain(width * .2, height - .18, .078, 1.4, height * .75, 2);
  };
  const roof = (b: MapBox, pitched: boolean) => {
    const h = b.h;
    if (pitched) {
      const rise = 1.23, half = b.w / 2 + .18, slope = Math.atan2(rise, half), span = Math.hypot(half, rise);
      for (const side of [-1, 1]) {
        box('roof', b.x + side * half / 2, h + rise / 2 + .08, b.z, span, .14, b.d + .4, '#8d7051', 0, -side * slope);
        for (let z = -b.d / 2 - .15; z < b.d / 2 + .2; z += .31) for (let j = 0; j < 6; j++) {
          const xx = side * (j + .5) / 6 * half, yy = h + rise * (1 - Math.abs(xx) / half) + .13;
          box('roof', b.x + xx, yy, b.z + z, span / 6 + .035, .10, .255, ['#ac8c65', '#987b59', '#b19771', '#9b8060'][(j + Math.floor((z + 20) * 3)) % 4], 0, -side * slope);
        }
      }
      for (const side of [-1, 1]) {
        const shape = new THREE.Shape(); shape.moveTo(-b.w / 2, 0); shape.lineTo(b.w / 2, 0); shape.lineTo(0, rise); shape.closePath();
        within(b.x, h, b.z + side * b.d / 2, side < 0 ? Math.PI : 0, () => add('plaster', new THREE.ShapeGeometry(shape), 0, 0, .01, '#f5dfb5'));
      }
      pipe(b.x, h + rise + .18, b.z - b.d / 2 - .2, b.x, h + rise + .18, b.z + b.d / 2 + .2, .095, '#9c825c');
    } else {
      box('dark', b.x, h + .02, b.z, b.w - .12, .04, b.d - .12, '#837c63');
      for (const side of [-1, 1]) {
        box('plaster', b.x, h + .22, b.z + side * (b.d / 2 - .12), b.w, .44, .25, '#e6d4ad');
        box('trim', b.x, h + .46, b.z + side * (b.d / 2 - .12), b.w + .08, .08, .33, '#e6d5b6');
        box('plaster', b.x + side * (b.w / 2 - .12), h + .22, b.z, .25, .44, b.d, '#e6d4ad');
      }
      cylinder('hardware', b.x + 1.3, h + .89, b.z - 1.8, .65, 1.65, '#87958e');
      cylinder('hardware', b.x + 1.3, h + 1.75, b.z - 1.8, .69, .075, '#c0c5b5');
      pipe(b.x + 1.92, h + .3, b.z - 1.8, b.x + 2.35, h + .3, b.z - 1.8, .036, '#6f7f6d');
      box('plaster', b.x - 1.1, h + .32, b.z + 2, 1.25, .64, 1.9, '#d5c5a8');
      for (let i = 0; i < 8; i++) box('hardware', b.x - 1.1, h + .2 + i * .055, b.z + 2.97, 1.05, .024, .035, '#67766a');
    }
  };
  const balcony = (x: number, y: number, width: number, tint = '#ddd0ac') => {
    box('trim', x, y, .51, width + .24, .18, 1.11, tint);
    box('dark', x, y - .11, .54, width + .16, .04, 1.02, '#8a8065');
    for (const side of [-1, 1]) {
      box('trim', x + side * width * .38, y - .36, .20, .18, .47, .42, tint);
      pipe(x + side * width * .38, y - .59, .04, x + side * width * .38, y - .12, .90, .035, '#5b604e');
      pipe(x + side * width / 2, y + .17, .1, x + side * width / 2, y + 1.02, .1, .027, '#464e43');
      pipe(x + side * width / 2, y + 1.03, .1, x + side * width / 2, y + 1.03, 1.0, .03, '#464e43');
    }
    for (let i = 0; i <= Math.ceil(width / .19); i++) {
      const xx = x - width / 2 + i / Math.ceil(width / .19) * width;
      pipe(xx, y + .16, 1.0, xx, y + 1.04, 1.0, .019, '#414d43');
    }
    for (const yy of [.18, .78, 1.04]) pipe(x - width / 2, y + yy, 1.0, x + width / 2, y + yy, 1.0, .027, '#505747');
  };
  const upperBlock = (x: number, z: number, w: number, d: number, base: number, height: number, tint: string, variant: number) => {
    const top = base + height;
    box('plaster', x, base + height / 2, z, w, height, d, tint);
    box('trim', x, base + .12, z, w + .14, .16, d + .14, '#d9c6a2');
    for (const side of [-1, 1]) within(x, base, z + side * d / 2, side < 0 ? Math.PI : 0, () => {
      const count = Math.max(1, Math.floor(w / 2.4));
      for (let k = 0; k < count; k++) window((k - (count - 1) / 2) * 2.4, .63, .85 + k % 2 * .17, variant % 2 === 0, k % 3 === 1);
      if (variant % 2 === 0 && w > 5) balcony(.5, .47, 2.9);
      if (variant % 2 === 1) airConditioner(w * .29, .95);
      stain(w * .27, height - .08, .084, 1.7, height * .8, 2);
      patch(-w * .38, height * .43, .6, 1.25);
      pipe(w / 2 - .24, .05, .11, w / 2 - .24, height + .1, .11, .046, '#7f7a60');
    });
    for (const side of [-1, 1]) within(x + side * w / 2, base, z, side * Math.PI / 2, () => {
      const count = Math.max(1, Math.floor(d / 2.7));
      for (let k = 0; k < count; k++) window((k - (count - 1) / 2) * 2.6, .64, .91, variant === 1, k % 3 === 0);
      if (side > 0 && d > 7) airConditioner(-d * .27, 1.1);
      for (const offset of [-d * .3, d * .23]) stain(offset, height - .02, .091, 1.4, height * .88);
    });
    roof({ x, z, w, d, h: top, kind: 'wall' }, false);
    // A broken rhythm of parapet blocks avoids a single rectangular skyline.
    if (variant === 0) {
      box('plaster', x - w * .26, top + 1.12, z - d * .27, w * .38, 2.24, d * .34, '#dbc9a8');
      box('trim', x - w * .26, top + 2.27, z - d * .27, w * .38 + .14, .12, d * .34 + .13, '#cdbb9a');
      within(x - w * .26, top, z - d * .10, 0, () => window(0, .56, .64, true, true));
    }
  };
  const openStreetArch = () => {
    // The columns land inside the existing two building footprints. All new
    // over-route geometry begins at y=3.35, leaving a real 10.5 m clear opening.
    const center = .75, radius = 5.25, spring = 3.35, top = 9.65, depth = 1.7;
    const shape = new THREE.Shape();
    shape.moveTo(-radius - .8, spring); shape.lineTo(-radius - .8, top);
    shape.lineTo(radius + .8, top); shape.lineTo(radius + .8, spring); shape.lineTo(radius, spring);
    shape.absarc(0, spring, radius, 0, Math.PI, false); shape.closePath();
    add('plaster', new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 20 }), center, 0, -.85, '#e9d4ad');
    for (const side of [-1, 1]) {
      const xx = center + side * (radius + .43);
      box('stone', xx, spring / 2, 0, .86, spring, depth, '#d4bd94');
      box('trim', xx, spring - .02, 0, 1.03, .18, depth + .18, '#edddbb');
    }
    for (const side of [-1, 1]) within(center, 0, side * (depth / 2 + .018), side < 0 ? Math.PI : 0, () => {
      for (let i = 0; i < 21; i++) {
        const start = i / 21 * Math.PI + .004, end = (i + 1) / 21 * Math.PI - .004;
        const stone = new THREE.Shape(); stone.absarc(0, spring, radius, start, end, false);
        stone.absarc(0, spring, radius + .39, end, start, true); stone.closePath();
        add('stone', new THREE.ExtrudeGeometry(stone, { depth: .14, bevelEnabled: false, curveSegments: 2 }), 0, 0, .012, ['#eddbb8', '#d3bd95', '#dfcca6'][i % 3]);
      }
      box('trim', 0, top - .14, .01, radius * 2 + 1.92, .21, .22, '#e1ceaa');
      sign(0, 0, 9.2, .12, 2.3, .46);
      for (const edge of [-1, 1]) {
        stain(edge * 4.45, 9.35, .04, 1.35, 3.4);
        patch(edge * 4.9, 6.9, .65, 1.15);
      }
    });
    for (let i = -5; i <= 5; i++) {
      box('plaster', center + i * 1.02, top + .27, 0, .70, .54, depth - .08, '#e7d2aa');
      box('trim', center + i * 1.02, top + .56, 0, .78, .08, depth + .02, '#d6c19c');
    }
  };
  box('dirt', 0, -.115, 0, 120, .22, 120, '#f5dfb8');
  const groundPatch = (x: number, z: number, w: number, d: number, tint = '#ded2b4') => {
    const shape = new THREE.Shape();
    const points: THREE.Vector2[] = [];
    for (let i = 0; i <= 8; i++) points.push(new THREE.Vector2(-w / 2 + i * w / 8, -d / 2 + (random() - .5) * .22));
    for (let i = 0; i <= 8; i++) points.push(new THREE.Vector2(w / 2 + (random() - .5) * .22, -d / 2 + i * d / 8));
    for (let i = 0; i <= 8; i++) points.push(new THREE.Vector2(w / 2 - i * w / 8, d / 2 + (random() - .5) * .22));
    for (let i = 0; i <= 8; i++) points.push(new THREE.Vector2(-w / 2 + (random() - .5) * .22, d / 2 - i * d / 8));
    shape.setFromPoints(points); shape.closePath();
    add('paving', new THREE.ShapeGeometry(shape), x, .001, z, tint, -Math.PI / 2);
  };
  // Dusty main courts, surviving cobbles beside buildings and narrow side lanes.
  groundPatch(-9, 0, 11.5, 15.6, '#ded4bd'); groundPatch(10, 0, 10.4, 14.4, '#e4d7ba');
  groundPatch(-18.3, -4.2, 3.3, 27.9); groundPatch(18.3, 4.2, 3.3, 27.9);
  groundPatch(0, -17.7, 17.3, 3.4, '#d8ccb0'); groundPatch(0, 17.7, 17.3, 3.4, '#d8ccb0');
  groundPatch(.75, 0, 10.45, 3.5, '#c5b79b');
  // Southern freight apron: broken long edges restore a human-sized ground
  // reference beside the central crates without replacing the dusty middle lane.
  const pavingBand = (points: [number, number][], tint: string) => {
    const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, -z))); shape.closePath();
    add('paving', new THREE.ShapeGeometry(shape), 0, .003, 0, tint, -Math.PI / 2);
  };
  pavingBand([
    [1.81, 3.62], [3.17, 3.62], [3.17, 6.82], [3.55, 7.19], [3.55, 8.84],
    [3.32, 8.84], [3.32, 10.16], [3.03, 10.16], [3.03, 12.28], [1.82, 12.28],
    [1.82, 11.32], [2.04, 11.32], [2.04, 7.19], [1.81, 6.92],
  ], '#d8ccb1');
  pavingBand([
    [4.82, 2.78], [5.91, 2.78], [5.91, 7.35], [5.57, 7.68], [5.57, 9.34],
    [5.36, 9.34], [5.36, 11.69], [4.27, 11.69], [4.27, 10.62], [4.49, 10.62],
    [4.49, 7.25], [4.82, 6.88],
  ], '#c5baa1');
  // One flat continuous gutter gives a clean directional edge beside the east
  // paving band without introducing any obstacle volume.
  add('dark', new THREE.PlaneGeometry(.13, 6.42), 5.80, .005, 8.28, '#7d735b', -Math.PI / 2);
  for (const x of [-17, 0, 17]) for (const z of [-15, -6, 6, 15]) atlasPlane('grime', 1, x + random() * 2, .008, z, 8 + random() * 6, 7 + random() * 8, random() * 2, -Math.PI / 2);
  atlasPlane('grime', 4, 3.63, .012, 10.0, 2.72, 10.8, -.055, -Math.PI / 2);
  atlasPlane('grime', 5, -.55, .014, 11.8, 7.4, 5.4, -.28, -Math.PI / 2);
  const smallCrate = (x: number, z: number, base: number, w: number, d: number, h: number, number: number) => {
    box('wood', x, base + h / 2, z, w, h, d, ['#d4c3a1', '#b9ad90', '#c4b48e', '#a8a28a'][number % 4]);
    for (const side of [-1, 1]) {
      for (const dx of [-w * .42, w * .42]) box('wood', x + dx, base + h / 2, z + side * (d / 2 + .017), .10, h, .045, '#b9ad89');
      for (const y of [.085, h - .085]) box('wood', x, base + y, z + side * (d / 2 + .042), w, .115, .055, '#b8ac8d');
      box('wood', x, base + h / 2, z + side * (d / 2 + .047), Math.hypot(w * .67, h * .6), .085, .055, '#b8ac8d', 0, Math.atan2(h * .6, w * .67));
      for (const dx of [-w * .30, w * .30]) {
        box('hardware', x + dx, base + h / 2, z + side * (d / 2 + .023), .04, h, .016, '#586257');
        for (const yy of [.085, h - .085]) cylinder('hardware', x + dx, base + yy, z + side * (d / 2 + .081), .014, .012, '#515647', Math.PI / 2);
      }
    }
    for (const dx of [-w * .30, w * .30]) box('hardware', x + dx, base + h + .007, z, .04, .014, d, '#596458');
    for (const side of [-1, 1]) {
      for (const dz of [-d * .41, d * .41]) box('wood', x + side * (w / 2 + .02), base + h / 2, z + dz, .055, h, .12, '#b7a683');
      for (const yy of [.085, h - .085]) box('wood', x + side * (w / 2 + .046), base + yy, z, .055, .115, d, '#c3af89');
      box('wood', x + side * (w / 2 + .05), base + h / 2, z, .055, .086, Math.hypot(d * .7, h * .6), '#c7b08a', 0, 0, Math.atan2(h * .6, d * .7));
    }
    if (base === 0) for (const dx of [-w * .32, w * .32]) box('dark', x + dx, .033, z, .16, .065, d - .08, '#534b38');
    atlasPlane('signs', 5, x + w * .16, base + h * .57, z + d / 2 + .08, Math.min(.53, w * .42), .28);
  };
  const crate = (b: MapBox, index: number) => {
    const cols = b.w > 3 ? 2 : 1, rows = b.d > 3 ? 2 : 1, levels = b.h > 1.7 ? 2 : 1;
    for (let a = 0; a < cols; a++) for (let c = 0; c < rows; c++) for (let layer = 0; layer < levels; layer++)
      smallCrate(b.x - b.w / 2 + (a + .5) * b.w / cols, b.z - b.d / 2 + (c + .5) * b.d / rows, layer * b.h / levels, b.w / cols - .018, b.d / rows - .018, b.h / levels - .01, index + a + c + layer);
  };
  const container = (b: MapBox, index: number) => {
    const tint = index % 2 ? '#a78765' : '#809d96';
    box('metal', b.x, b.h / 2, b.z, b.w, b.h, b.d, tint);
    for (const side of [-1, 1]) within(b.x, 0, b.z + side * b.d / 2, side < 0 ? Math.PI : 0, () => {
      for (const y of [.065, b.h - .065]) box('hardware', 0, y, .02, b.w, .13, .08, '#596d63');
      for (let x = -b.w / 2 + .25; x < b.w / 2; x += .24) box('metal', x, b.h / 2, .035, .035, b.h - .23, .065, tint);
      for (const x of [-b.w / 2 + .06, b.w / 2 - .06]) box('hardware', x, b.h / 2, .028, .13, b.h, .09, '#748071');
      sign(5, .8, 1.65, .106, 1.23, .38); stain(0, .65, .125, b.w, .65, 3);
    });
    within(b.x + b.w / 2 + .015, 0, b.z, Math.PI / 2, () => {
      for (const side of [-1, 1]) {
        box('metal', side * b.d * .245, b.h / 2, .025, b.d * .48, b.h - .13, .055, tint);
        for (const dx of [-.23, .23]) pipe(side * b.d * .245 + dx, .16, .105, side * b.d * .245 + dx, b.h - .15, .105, .018, '#b3b9a5');
        for (const yy of [.38, b.h - .38]) box('hardware', side * b.d * .44, yy, .075, .19, .12, .065, '#59685d');
        box('hardware', side * b.d * .24, .98, .14, .31, .04, .042, '#4b5c50');
      }
    });
  };
  MAP_BOXES.forEach((b, index) => {
    if (b.kind === 'crate') { crate(b, index); return; }
    if (b.kind === 'container') { container(b, index); return; }
    box('plaster', b.x, b.h / 2, b.z, b.w, b.h, b.d, index % 2 ? '#e6d4b5' : '#f6e6c5');
    if (index >= 4) {
      for (const side of [-1, 1]) within(b.x, 0, b.z + side * b.d / 2, side < 0 ? Math.PI : 0, () => facade(b.w, b.h, index % 2));
      for (const side of [-1, 1]) within(b.x + side * b.w / 2, 0, b.z, side * Math.PI / 2, () => {
        box('stone', 0, .43, .027, b.d, .86, .075, '#d0bfa1'); box('trim', 0, .89, .056, b.d, .065, .09, '#cfc0a5');
        for (let k = 0; k < 3; k++) window(-b.d * .32 + k * b.d * .32, 2.28 + (k % 2) * .12, 1.02, index % 2 === 0, k === 1);
        airConditioner(b.d * .10, 3.08);
        for (const offset of [-b.d * .3, b.d * .3]) patch(offset, 1.34, 1.5, 1.25);
        pipe(b.d / 2 - .34, .15, .11, b.d / 2 - .34, b.h - .18, .11, .045, '#777e66');
        for (const yy of [.4, 1.6, 2.8, 4]) if (yy < b.h) box('hardware', b.d / 2 - .34, yy, .07, .17, .05, .08, '#666c58');
        const cable = new THREE.CatmullRomCurve3([new THREE.Vector3(-b.d / 2, b.h - .52, .12), new THREE.Vector3(0, b.h - .76, .17), new THREE.Vector3(b.d / 2, b.h - .5, .12)]);
        add('hardware', new THREE.TubeGeometry(cable, 16, .023, 5, false), 0, 0, 0, '#4c5546'); stain(0, .89, .125, b.d, .88, 3);
      });
      box('trim', b.x, b.h - .10, b.z, b.w + .17, .17, b.d + .17, '#e0ceb0'); roof(b, false);
    } else {
      const length = Math.max(b.w, b.d);
      box('stone', b.x, .57, b.z, b.w + .026, 1.14, b.d + .026, '#bcad91');
      box('trim', b.x, b.h, b.z, b.w + .17, .16, b.d + .17, '#c9b899');
      const inwardYaw = index === 0 ? Math.PI / 2 : index === 1 ? -Math.PI / 2 : index === 2 ? 0 : Math.PI;
      within(b.x + (index === 0 ? .5 : index === 1 ? -.5 : 0), 0, b.z + (index === 2 ? .5 : index === 3 ? -.5 : 0), inwardYaw, () => {
        for (let x = -length / 2 + 2.4; x < length / 2; x += 5.4) {
          box('stone', x, b.h / 2, .04, .40, b.h, .15, '#c0b193'); box('trim', x, b.h + .1, .04, .62, .19, .31, '#d1bf9f');
          patch(x + 1.55, 1.7 + random(), 1.4, 1.7); stain(x + 1.4, 4.6, .13, 1.5, 3.2);
          if (Math.abs(x) > 5 && index < 2) window(x + 2, 2.75, .83, false, true);
        }
        if (index >= 2) {
          archDoor(4.2, 2.05, index === 2 ? '#8b8e78' : '#aaa080');
          sign(index === 2 ? 0 : 6, 0, 4.73, .19, 3.25, .52);
          sign(index === 2 ? 2 : 3, -16.6, 3.03, .20, 2.62, .70);
        } else sign(4, -3, 2.55, .17, 1.7, .56);
        stain(0, 1.2, .20, length, 1.2, 3);
      });
    }
  });
  // Asymmetric attached houses: a tall west residence, a lower east terrace and
  // a narrow rear tower. Their foundations remain inside the two original solids.
  upperBlock(-9, 1, 9, 11, 5.3, 3.45, '#e6d2af', 0);
  upperBlock(12.2, 0, 3.6, 12, 4.5, 4.1, '#d4b796', 1);
  upperBlock(8.2, -3.2, 4.4, 5.6, 4.5, 2.55, '#e5d5b7', 2);
  within(10, 4.55, 6.015, 0, () => {
    // Terrace screen and a roof-level striped sunshade, safely above actors.
    for (let k = 0; k < 9; k++) box('brick', -3.6 + k * .38, .36, .025, .23, .58, .12, '#bbaa89');
    const awning = new THREE.PlaneGeometry(3.7, 2.1, 10, 6), vertices = awning.getAttribute('position');
    for (let k = 0; k < vertices.count; k++) vertices.setZ(k, -.14 * Math.sin((vertices.getX(k) + 1.85) / 3.7 * Math.PI));
    add('cloth', awning, -1.83, 2.04, -.80, '#cdac7b', -Math.PI / 2 + .09);
    for (const xx of [-3.64, -.05]) pipe(xx, .24, -.02, xx, 2.2, -.02, .029, '#4c5141');
    pipe(-3.7, 2.0, .20, -.01, 2.0, .20, .03, '#4c5141');
  });
  openStreetArch();
  // Laundry, sagging wiring and shielded lamps are placed above eye level.
  const streetWire = new THREE.CatmullRomCurve3([new THREE.Vector3(-4.42, 7.35, 4.8), new THREE.Vector3(.7, 6.60, 5.2), new THREE.Vector3(6.08, 6.72, 4.8)]);
  add('hardware', new THREE.TubeGeometry(streetWire, 20, .016, 4, false), 0, 0, 0, '#3c443d');
  for (let i = 0; i < 4; i++) {
    const p = streetWire.getPoint(.34 + i * .11);
    box('cloth', p.x, p.y - .36, p.z, .5, .72, .024, ['#b9b396', '#7d8983', '#b09272', '#dbceb4'][i], .15 + i * .07, (i % 2 ? .05 : -.035));
  }
  for (const b of MAP_BOXES.filter(item => item.kind === 'wall').slice(4)) {
    for (const side of [-1, 1]) within(b.x + side * b.w / 2, 0, b.z, side * Math.PI / 2, () => {
      pipe(-b.d * .33, 3.62, .04, -b.d * .33, 3.87, .64, .035, '#474f40');
      add('hardware', new THREE.ConeGeometry(.22, .15, 12, 1, true), -b.d * .33, 3.83, .67, '#687061');
      cylinder('trim', -b.d * .33, 3.77, .67, .14, .035, '#f2ddad');
      // Small fragments hug existing wall edges; no waist-height phantom cover.
      for (let i = 0; i < 12; i++) {
        const x = (random() - .5) * (b.d - .5), z = .07 + random() * .09;
        box(i % 3 ? 'stone' : 'brick', x, .025 + random() * .022, z, .08 + random() * .17, .05 + random() * .045, .08 + random() * .09, '#bdac89', random() * Math.PI, random() * .3);
      }
    });
  }
  // Ground dressing is flat: no invisible collision props are added to routes.
  for (const x of [-20.9, 20.9]) for (let z = -17; z <= 17; z += 8.5) {
    box('dark', x, .003, z, .32, .009, 1.35, '#6b6c56');
    for (let k = 0; k < 12; k++) box('hardware', x, .013, z - .60 + k * .11, .28, .012, .027, '#8f947b');
  }
  for (let i = 0; i < 54; i++) box('paint', (random() > .5 ? 1 : -1) * (20.75 + random() * .48), .013, random() * 36 - 18, .06 + random() * .13, .01, .04 + random() * .18, random() > .5 ? '#b3aa90' : '#888771', random() * Math.PI);
  for (const z of [-11, 10]) {
    for (let strand = 0; strand < 2; strand++) {
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(-21.5, 7.1, z + strand * .25), new THREE.Vector3(-8, 6.5, z + .4), new THREE.Vector3(7, 6.2, z + .55), new THREE.Vector3(21.5, 7.0, z)]);
      add('hardware', new THREE.TubeGeometry(curve, 28, .014, 4, false), 0, 0, 0, '#404d45');
    }
    for (const x of [-21.5, 21.5]) { pipe(x, 4.9, z, x, 7.4, z, .065, '#747a61'); pipe(x, 7.08, z - .48, x, 7.08, z + .55, .036, '#657361'); }
  }
  // Neighbouring streets and rooflines sit completely beyond the arena boundary.
  for (let i = 0; i < 18; i++) {
    const side = i % 4, band = Math.floor(i / 4), w = 5.4 + random() * 5.5, d = 5.5 + random() * 3.5, h = 6 + random() * 5.2;
    const x = side === 0 ? -28.5 - random() * 5 : side === 1 ? 29 + random() * 4 : -29 + band * 14;
    const z = side === 2 ? -28.5 - random() * 5 : side === 3 ? 29 + random() * 5 : -27 + band * 14;
    box('plaster', x, h / 2, z, w, h, d, ['#decaab', '#ced0bf', '#d4b797', '#e2d4b8'][i % 4]);
    box('stone', x, 1.25, z, w + .02, 2.5, d + .02, '#acaa8c');
    for (const direction of [-1, 1]) within(x, 0, z + direction * d / 2, direction < 0 ? Math.PI : 0, () => {
      for (let row = 0; row < 2; row++) for (let col = 0; col < 3; col++) window(-w * .3 + col * w * .3, h - 1.6 - row * 2.45, .71, false, col % 2 === 0, true);
      if (i % 3 === 0) airConditioner(-w * .29, h - 3.2);
    });
    for (const direction of [-1, 1]) {
      box('plaster', x, h + .25, z + direction * (d / 2 - .12), w, .5, .25, '#cfbea2');
      box('trim', x, h + .51, z + direction * (d / 2 - .12), w + .12, .07, .34, '#d5c6a8');
    }
    if (i % 3 === 0) {
      cylinder('hardware', x + 1.2, h + .95, z, .75, 1.9, '#a8b1a0'); cylinder('hardware', x + 1.2, h + 1.95, z, .79, .1, '#c7c9b3');
      pipe(x - 1.4, h, z, x - 1.4, h + 3.3, z, .025, '#4c6051');
      for (let j = 0; j < 3; j++) pipe(x - 2.1, h + 2.9 - j * .28, z, x - .7, h + 2.9 - j * .28, z, .016, '#4c6051');
    }
    if (i === 2 || i === 9) {
      add('roof', new THREE.SphereGeometry(1.9, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), x, h + .22, z, '#a7a286');
      cylinder('plaster', x, h + .16, z, 1.94, .32, '#dfd0ad');
    }
  }
  box('plaster', -27, 8.4, -30, 3.1, 16.8, 3.1, '#d5c6a7');
  for (const y of [11.1, 15.2, 16.8]) box('trim', -27, y, -30, 3.5, .18, 3.5, '#c1b79b');
  within(-27, 0, -28.42, 0, () => window(0, 13.15, 1.08, true));
  cylinder('roof', -27, 17.35, -30, 1.75, 1.1, '#999c80', 0, 0, .35);
  // Original demolition pads: flat visual markers only; collision stays in MAP_BOXES.
  for (const [label, x] of [['A', -10], ['B', 10]] as const) {
    cylinder('paint', x, .018, -5, 2.45, .018, label === 'A' ? '#a98352' : '#6f8b85', 0, 0, 2.45);
    box('hardware', x, .035, -7.32, 2.4, .022, .035, label === 'A' ? '#d4a96c' : '#9ec0b4');
    box('hardware', x, .035, -2.68, 2.4, .022, .035, label === 'A' ? '#d4a96c' : '#9ec0b4');
  }
  for (const [key, geometries] of buckets) {
    const geometry = mergeGeometries(geometries, false)!; geometries.forEach(g => g.dispose()); geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, materials[key]); mesh.name = 'old-quarter:' + key;
    mesh.castShadow = !['paving', 'dirt', 'grime', 'signs', 'paint', 'glass', 'dark'].includes(key); mesh.receiveShadow = key !== 'grime';
    if (key === 'grime') mesh.renderOrder = 2; root.add(mesh);
  }
  let triangles = 0; root.traverse(node => { if (node instanceof THREE.Mesh) triangles += (node.geometry.index?.count ?? node.geometry.getAttribute('position').count) / 3; });
  root.userData = { bounds: MAP_SIZE, materialBatches: buckets.size, triangles, authoredParts, textureStatus: library.status, assetsReady: library.ready, art: 'Original Sandline desert gate street / licensed CC0 PBR surfaces', landmarks: ['open street arch', 'west residence', 'east roof terrace', 'rear tower'], openArch: { width: 10.5, springHeight: 3.35, centerClearance: 8.6 } };
  return root;
}
