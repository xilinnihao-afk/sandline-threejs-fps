import * as THREE from 'three';

export interface EnvironmentAssetStatus { requested: number; loaded: number; failed: string[]; textureBytes: number; }
export function createEnvironmentMaterials() {
  let state = 982371;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const status: EnvironmentAssetStatus = { requested: 0, loaded: 0, failed: [], textureBytes: 1435305 };
  const pending: Promise<void>[] = [];
  const loader = new THREE.TextureLoader();
  const base = new URL('assets/environment/', new URL(import.meta.env?.BASE_URL ?? './', document.baseURI));
  const load = (file: string, color = false) => {
    status.requested++;
    let done!: () => void;
    pending.push(new Promise<void>(resolve => { done = resolve; }));
    const map = loader.load(new URL(file, base).href, () => { status.loaded++; done(); }, undefined, () => { status.failed.push(file); done(); });
    map.name = `environment/${file}`; map.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping; map.anisotropy = 4;
    return map;
  };
  const canvas = (width: number, height: number, paint: (ctx: CanvasRenderingContext2D) => void) => {
    const c = document.createElement('canvas'); c.width = width; c.height = height;
    paint(c.getContext('2d')!);
    const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping; map.anisotropy = 4; return map;
  };
  const pbr = (name: string, color: string, normalScale: number) => {
    const material = new THREE.MeshStandardMaterial({
      color, map: load(`${name}-diff.jpg`, true), normalMap: load(`${name}-nor_gl.jpg`),
      roughnessMap: load(`${name}-rough.jpg`), roughness: 1, metalness: 0,
      vertexColors: true, normalScale: new THREE.Vector2(normalScale, normalScale),
    });
    material.name = `CC0 ${name}`; return material;
  };
  const corrugated = canvas(512, 512, ctx => {
    ctx.fillStyle = '#a5afac'; ctx.fillRect(0, 0, 512, 512);
    for (let x = 0; x < 512; x += 32) {
      const grad = ctx.createLinearGradient(x, 0, x + 32, 0);
      grad.addColorStop(0, '#5b6966'); grad.addColorStop(.2, '#c0c7ba'); grad.addColorStop(.4, '#a8b3ac'); grad.addColorStop(.85, '#9aa7a0'); grad.addColorStop(1, '#64736c');
      ctx.fillStyle = grad; ctx.fillRect(x, 0, 32, 512);
    }
    for (let i = 0; i < 6000; i++) {
      const y = random() * 512, lower = Math.max(0, (y - 370) / 142);
      ctx.fillStyle = random() < .28 + lower * .6 ? `rgba(88,49,29,${.06 + lower * .22})` : 'rgba(227,222,197,.16)';
      ctx.fillRect(random() * 512, y, 1 + random() * 4, 1 + random() * 15);
    }
    ctx.fillStyle = 'rgba(97,58,35,.25)'; ctx.fillRect(0, 495, 512, 17);
  });
  const clothMap = canvas(128, 128, ctx => {
    ctx.fillStyle = '#d7c8a2'; ctx.fillRect(0, 0, 128, 128);
    for (let x = 0; x < 128; x += 2) { ctx.fillStyle = x % 4 ? '#b8ad90' : '#e0d5b7'; ctx.fillRect(x, 0, 1, 128); }
    for (let y = 0; y < 128; y += 2) { ctx.fillStyle = 'rgba(66,57,41,.13)'; ctx.fillRect(0, y, 128, 1); }
    for (let x = 0; x < 128; x += 32) { ctx.fillStyle = 'rgba(82,90,73,.24)'; ctx.fillRect(x, 0, 14, 128); }
  });
  const brickMap = canvas(512, 512, ctx => {
    ctx.fillStyle = '#9a8f7c'; ctx.fillRect(0, 0, 512, 512);
    for (let row = 0; row < 8; row++) for (let col = -1; col < 5; col++) {
      const x = col * 128 + row % 2 * 64, y = row * 64;
      ctx.fillStyle = ['#a57f60', '#b08d6a', '#baa081', '#96775a', '#b69875'][Math.floor(random() * 5)];
      ctx.fillRect(x + 3, y + 3, 122, 57);
      ctx.fillStyle = 'rgba(230,213,179,.19)'; ctx.fillRect(x + 4, y + 4, 120, 3);
      ctx.fillStyle = 'rgba(59,46,30,.16)'; ctx.fillRect(x + 4, y + 54, 120, 5);
    }
    for (let i = 0; i < 28000; i++) {
      ctx.fillStyle = random() > .5 ? 'rgba(51,39,23,.12)' : 'rgba(233,221,193,.15)';
      ctx.fillRect(random() * 512, random() * 512, 1 + random() * 3, 1 + random() * 2);
    }
  });
  const grimeMap = canvas(1024, 1024, ctx => {
    // Top row: rain, dust, cracked plaster, chipped edge. Lower row: broad road wear.
    for (let type = 0; type < 4; type++) {
      const x0 = type * 256;
      if (type === 0) {
        for (let i = 0; i < 64; i++) {
          const x = x0 + 8 + random() * 240, top = random() * 50, h = 90 + random() * 420;
          const g = ctx.createLinearGradient(0, top, 0, top + h); g.addColorStop(0, 'rgba(58,46,29,.2)'); g.addColorStop(.3, 'rgba(54,47,33,.13)'); g.addColorStop(1, 'rgba(64,49,30,0)');
          ctx.fillStyle = g; ctx.fillRect(x, top, 2 + random() * 12, h);
        }
      } else if (type === 1) {
        for (let i = 0; i < 500; i++) {
          const x = x0 + random() * 256, y = random() * 512;
          const distance = Math.hypot((x - x0 - 128) / 128, (y - 256) / 256);
          if (distance > 1) continue;
          ctx.fillStyle = `rgba(187,151,98,${(.035 + random() * .06) * (1 - distance)})`;
          ctx.beginPath(); ctx.ellipse(x, y, 8 + random() * 38, 12 + random() * 30, random(), 0, Math.PI * 2); ctx.fill();
        }
      } else if (type === 2) {
        ctx.strokeStyle = 'rgba(47,42,32,.45)'; ctx.lineWidth = 1.5;
        for (let i = 0; i < 6; i++) {
          let x = x0 + 40 + random() * 176, y = 20 + random() * 190; ctx.beginPath(); ctx.moveTo(x, y);
          for (let j = 0; j < 13; j++) { x += random() * 24 - 12; y += random() * 22; ctx.lineTo(x, y); } ctx.stroke();
        }
      } else {
        for (let i = 0; i < 2200; i++) {
          const x = x0 + random() * 256, y = random() * 512, strength = Math.pow(1 - y / 512, 3);
          ctx.fillStyle = `rgba(75,59,34,${strength * (.03 + random() * .11)})`;
          ctx.fillRect(x, y, 1 + random() * 11, 1 + random() * 9);
        }
      }
    }
    // Large, low-frequency marks give the dirt direction and scale. The tire
    // grooves are broad fading curves, rather than a carpet of small tread marks.
    ctx.save(); ctx.beginPath(); ctx.rect(0, 512, 256, 512); ctx.clip();
    const tireFade = ctx.createLinearGradient(0, 518, 0, 1018);
    tireFade.addColorStop(0, 'rgba(51,46,34,0)'); tireFade.addColorStop(.15, 'rgba(51,46,34,.19)');
    tireFade.addColorStop(.55, 'rgba(51,46,34,.24)'); tireFade.addColorStop(.85, 'rgba(51,46,34,.15)'); tireFade.addColorStop(1, 'rgba(51,46,34,0)');
    ctx.strokeStyle = tireFade; ctx.lineCap = 'round';
    for (const x of [58, 198]) {
      ctx.lineWidth = 20; ctx.beginPath(); ctx.moveTo(x + 13, 526); ctx.bezierCurveTo(x - 17, 694, x - 4, 843, x + 8, 1007); ctx.stroke();
      ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(x + 5, 532); ctx.bezierCurveTo(x - 25, 699, x - 12, 843, x, 1001); ctx.stroke();
    }
    ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.rect(256, 512, 256, 512); ctx.clip();
    const dustFade = ctx.createLinearGradient(256, 512, 512, 1014);
    dustFade.addColorStop(0, 'rgba(221,199,156,0)'); dustFade.addColorStop(.22, 'rgba(221,199,156,.05)');
    dustFade.addColorStop(.48, 'rgba(221,199,156,.25)'); dustFade.addColorStop(.71, 'rgba(221,199,156,.17)'); dustFade.addColorStop(1, 'rgba(221,199,156,0)');
    ctx.strokeStyle = dustFade; ctx.lineCap = 'round';
    for (const [x, width] of [[318, 62], [369, 90], [422, 59]]) {
      ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(x - 22, 535); ctx.bezierCurveTo(x + 4, 691, x + 27, 829, x + 2, 1005); ctx.stroke();
    }
    ctx.restore();
  });
  const signsMap = canvas(1024, 512, ctx => {
    const labels = [
      ['SANDLINE', 'TRANSPORT & STORAGE', '#27434a'], ['WAREHOUSE 04', 'SEALED · NO ACCESS', '#44534b'],
      ['WEST COURT', '02  ←  SERVICE LANE', '#344f5b'], ['EAST COURT', 'SERVICE LANE  →  03', '#795338'],
      ['RESTRICTED', 'AUTHORIZED PERSONNEL', '#774831'], ['SL / 0608', 'FREIGHT · KEEP DRY ↑↑', '#566050'],
      ['DEPOT 16', 'NORTH TRANSIT YARD', '#544938'], ['STORE 05', 'CLOSED FOR TRANSIT', '#4e5c56'],
    ];
    labels.forEach(([title, subtitle, bg], i) => {
      const x = i % 4 * 256, y = Math.floor(i / 4) * 256;
      ctx.fillStyle = bg; ctx.fillRect(x, y, 256, 256);
      ctx.strokeStyle = '#acaa8e'; ctx.lineWidth = 2; ctx.strokeRect(x + 12, y + 20, 232, 216);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#e1d5b1';
      ctx.font = `700 ${title.length > 10 ? 25 : 31}px monospace`; ctx.fillText(title, x + 128, y + 105, 221);
      ctx.font = '600 13px monospace'; ctx.fillText(subtitle, x + 128, y + 160, 220);
      for (let j = 0; j < 1100; j++) { ctx.fillStyle = random() > .45 ? 'rgba(202,170,124,.16)' : 'rgba(20,27,23,.25)'; ctx.fillRect(x + random() * 256, y + random() * 256, random() * 4, 1); }
      for (const dx of [20, 235]) for (const dy of [29, 229]) { ctx.fillStyle = '#302f26'; ctx.beginPath(); ctx.arc(x + dx, y + dy, 3, 0, Math.PI * 2); ctx.fill(); }
    });
  });
  const plain = (name: string, color: string, roughness = .9, metalness = 0) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, vertexColors: true }); m.name = name; return m;
  };
  const plaster = pbr('plaster', '#fff6e7', .56);
  const stone = pbr('sandstone', '#f0debf', .62);
  const paving = pbr('paving', '#e9deca', .58);
  const dirt = pbr('dirt', '#e2c897', .31);
  const brick = new THREE.MeshStandardMaterial({ map: brickMap, bumpMap: brickMap, bumpScale: .016, color: '#e3d2b2', roughness: 1, vertexColors: true }); brick.name = 'original exposed clay masonry';
  const wood = new THREE.MeshStandardMaterial({ map: load('wood-diff.jpg', true), color: '#dcc69e', roughness: .94, vertexColors: true }); wood.name = 'CC0 weathered freight timber';
  const metal = new THREE.MeshStandardMaterial({ map: corrugated, color: '#c5c5ad', roughness: .76, metalness: .23, vertexColors: true }); metal.name = 'distressed corrugated steel';
  const cloth = new THREE.MeshStandardMaterial({ map: clothMap, color: '#bbb28f', roughness: 1, side: THREE.DoubleSide, vertexColors: true }); cloth.name = 'woven warehouse awning';
  const glass = plain('dusty opaque windows', '#ffffff', .23, .28);
  const grime = new THREE.MeshStandardMaterial({ map: grimeMap, transparent: true, depthWrite: false, roughness: 1, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }); grime.name = 'rain dust cracks atlas';
  const signs = new THREE.MeshStandardMaterial({ map: signsMap, roughness: .9, metalness: .1, vertexColors: true }); signs.name = 'original depot signs';
  const materials = {
    plaster, stone, paving, dirt, brick, wood, metal, cloth, glass, grime, signs,
    trim: plain('limestone coping', '#e5d5b7'), hardware: plain('utility hardware', '#ffffff', .69, .32),
    dark: plain('deep recesses', '#ffffff', .98), paint: plain('worn depot paint', '#ffffff', .95),
    roof: plain('dusty terracotta roof', '#ffffff', .94),
  };
  return { materials, status, ready: Promise.all(pending).then(() => status) };
}
export type EnvironmentMaterials = ReturnType<typeof createEnvironmentMaterials>['materials'];
export type EnvironmentMaterialKey = keyof EnvironmentMaterials;
