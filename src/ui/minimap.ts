import {getActiveMap, MAP_BOXES, MAP_SIZE} from '../game/map';
import type {GameSnapshot} from '../game/types';

/** North-up tactical map: static geometry, objectives and living friendlies. */
export class Minimap {
  private context: CanvasRenderingContext2D;
  private terrain = document.createElement('canvas');
  private mapId = '';
  private lastDraw = -Infinity;
  private scale = 1;
  private centerX=0;
  private centerZ=0;
  private readonly size = 300;
  constructor(private canvas: HTMLCanvasElement) {
    this.context = canvas.getContext('2d')!;
    this.terrain.width = this.terrain.height = this.size;
  }
  private point(x: number, z: number): [number, number] {
    return [this.size / 2 + (x-this.centerX) * this.scale, this.size / 2 + (z-this.centerZ) * this.scale];
  }
  private rebuild(): void {
    this.mapId = getActiveMap().id;
    // Fit the actual outside edges, not the diagonal of a circular radar.
    const extentX = Math.max(MAP_SIZE.width, ...MAP_BOXES.map(box => 2 * Math.abs(box.x) + box.w));
    const extentZ = Math.max(MAP_SIZE.depth, ...MAP_BOXES.map(box => 2 * Math.abs(box.z) + box.d));
    this.scale = 258 / Math.max(extentX, extentZ);
    const c = this.terrain.getContext('2d')!;
    c.clearRect(0, 0, this.size, this.size);
    c.fillStyle = '#11191e';
    c.fillRect(0, 0, this.size, this.size);
    this.centerX=this.centerZ=0;
    const points=getActiveMap().geometry?.navigation?.points;
    if(points?.length){
      const xs=points.map(p=>p.x),zs=points.map(p=>p.z),minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs);
      this.centerX=(minX+maxX)/2;this.centerZ=(minZ+maxZ)/2;this.scale=258/Math.max(maxX-minX,maxZ-minZ);
      for(const p of points){const [x,z]=this.point(p.x,p.z);c.fillStyle=p.y>0?'#b6a888':'#807761';c.fillRect(x-this.scale*.44,z-this.scale*.44,this.scale*.88,this.scale*.88);}
      return;
    }
    const [left, top] = this.point(-MAP_SIZE.width / 2, -MAP_SIZE.depth / 2);
    c.fillStyle = '#26343c';
    c.fillRect(left, top, MAP_SIZE.width * this.scale, MAP_SIZE.depth * this.scale);

    // Restrained 5 m grid is cached along with the floor and cover.
    c.strokeStyle = '#afc5d00d';
    c.lineWidth = 1;
    c.beginPath();
    for (let x = -20; x <= 20; x += 5) {
      const [px] = this.point(x, 0);
      c.moveTo(px, top); c.lineTo(px, this.size - top);
    }
    for (let z = -20; z <= 20; z += 5) {
      const [, py] = this.point(0, z);
      c.moveTo(left, py); c.lineTo(this.size - left, py);
    }
    c.stroke();
    const snow = this.mapId === 'snow';
    for (const box of MAP_BOXES) {
      const [x, y] = this.point(box.x - box.w / 2, box.z - box.d / 2);
      const width = box.w * this.scale, depth = box.d * this.scale;
      c.fillStyle = box.kind === 'wall' ? (snow ? '#748993' : '#827f72') : '#baa785';
      c.fillRect(x, y, width, depth);
      c.strokeStyle = box.kind === 'wall' ? (snow ? '#c4d6de80' : '#dfd4b480') : '#efdab47a';
      c.lineWidth = 1.3;
      c.strokeRect(x, y, width, depth);
      // Inset top/left edge gives large ice blocks a legible footprint.
      if (width > 12 && depth > 12) {
        c.strokeStyle = '#e3eef02e';
        c.beginPath(); c.moveTo(x + 3, y + depth - 3); c.lineTo(x + 3, y + 3); c.lineTo(x + width - 3, y + 3); c.stroke();
      }
    }
    c.strokeStyle = '#afc5d03a';
    c.lineWidth = 1;
    c.strokeRect(9.5, 9.5, 281, 281);
    c.strokeStyle = '#d0dee37a';
    c.lineWidth = 2;
    for (const [x, y, dx, dy] of [[9, 9, 1, 1], [291, 9, -1, 1], [9, 291, 1, -1], [291, 291, -1, -1]]) {
      c.beginPath(); c.moveTo(x, y + dy * 14); c.lineTo(x, y); c.lineTo(x + dx * 14, y); c.stroke();
    }
  }
  update(snapshot: GameSnapshot): void {
    const now = performance.now();
    if (now - this.lastDraw < 66 && this.mapId === getActiveMap().id) return;
    this.lastDraw = now;
    if (this.mapId !== getActiveMap().id) this.rebuild();
    const c = this.context;
    const player = snapshot.spectating ?? snapshot.player;
    c.clearRect(0, 0, this.size, this.size);
    c.drawImage(this.terrain, 0, 0);
    if (snapshot.mode === 'demolition') {
      c.font = 'bold 20px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle';
      for (const site of snapshot.sites) {
        const [x, y] = this.point(site.x, site.z);
        c.fillStyle = '#1b242ae8'; c.strokeStyle = '#e2c78e99'; c.lineWidth = 1.5;
        c.beginPath(); c.roundRect(x - 13, y - 13, 26, 26, 3); c.fill(); c.stroke();
        c.fillStyle = '#f1d49c'; c.fillText(site.id, x, y + 1);
      }
    }
    if(snapshot.mode==='defense'&&snapshot.defense){
      const d=snapshot.defense,[x,y]=this.point(d.site.x,d.site.z);
      c.strokeStyle=d.attackers?'#ff8264':'#f1d49c';c.fillStyle='#e6b86538';c.lineWidth=2;
      c.beginPath();c.arc(x,y,Math.max(9,d.site.radius*this.scale),0,Math.PI*2);c.fill();c.stroke();
      c.font='bold 14px Arial';c.textAlign='center';c.fillStyle='#fff0c9';c.fillText('守',x,y+5);
    }
    if(snapshot.mode==='hostageRescue'&&snapshot.rescue){
      c.textAlign='center';c.textBaseline='middle';
      for(const zone of snapshot.rescue.zones){
        const [x,y]=this.point(zone.x,zone.z),radius=Math.max(12,zone.radius*this.scale);
        c.fillStyle='#66db9b30';c.strokeStyle='#8fefb9';c.lineWidth=2;
        c.beginPath();c.arc(x,y,radius,0,Math.PI*2);c.fill();c.stroke();
        c.font='bold 15px Arial';c.fillStyle='#ceffdf';c.fillText('救',x,y);
      }
      for(const hostage of snapshot.rescue.hostages){
        if(hostage.status==='rescued')continue;
        const [x,y]=this.point(hostage.x,hostage.z),following=hostage.status==='following';
        c.fillStyle=following?'#bcecf2':'#ffd081';c.strokeStyle='#13212a';c.lineWidth=2;
        c.beginPath();c.arc(x,y-4,3.8,0,Math.PI*2);c.fill();c.stroke();
        c.beginPath();c.roundRect(x-4,y,8,9,2);c.fill();c.stroke();
        if(following){c.strokeStyle='#bcecf2';c.lineWidth=1.5;c.beginPath();c.arc(x,y,11,0,Math.PI*2);c.stroke();}
      }
    }
    if(snapshot.mode==='demolition'){
      const bomb=snapshot.bomb,carrier=snapshot.actors.find(a=>a.id===bomb.carrierId);
      // A hidden enemy carrier must never become a radar tracking marker.
      const visible=bomb.status==='planted'||player.faction==='t'&&(bomb.status==='dropped'||bomb.status==='carried');
      if(visible){
        const [x,y]=this.point(bomb.status==='carried'&&carrier?carrier.x:bomb.x,bomb.status==='carried'&&carrier?carrier.z:bomb.z);
        c.save();c.translate(x,y);c.rotate(Math.PI/4);
        c.fillStyle=bomb.status==='planted'?'#ff8067':'#f6d77e';c.strokeStyle='#18242b';c.lineWidth=2;
        c.fillRect(-6,-6,12,12);c.strokeRect(-6,-6,12,12);c.restore();
        if(bomb.status==='planted'){
          c.strokeStyle='#ffaf94';c.lineWidth=2;c.beginPath();c.arc(x,y,11+Math.sin(snapshot.time*6)*1.5,0,Math.PI*2);c.stroke();
        }
      }
    }
    for (const actor of snapshot.actors) {
      if (snapshot.mode==='armsRace' || actor.id === player.id || actor.team !== player.team || actor.health <= 0) continue;
      const [x, y] = this.point(actor.x, actor.z);
      c.fillStyle = player.team === 'blue' ? '#8ed6ed' : '#f2ab95';
      c.strokeStyle = '#102129'; c.lineWidth = 2.5;
      c.beginPath(); c.arc(x, y, 6, 0, Math.PI * 2); c.fill(); c.stroke();
    }
    if (player.health > 0) {
      const [x, y] = this.point(player.x, player.z);
      c.save(); c.translate(x, y); c.rotate(-player.yaw);
      c.fillStyle = '#f2d39a26';
      c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, 34, -Math.PI * .70, -Math.PI * .30); c.closePath(); c.fill();
      c.strokeStyle = '#e9d8b45c'; c.lineWidth = 1.2;
      c.beginPath(); c.arc(0, 0, 34, -Math.PI * .70, -Math.PI * .30); c.stroke();
      c.fillStyle = '#fff2cf'; c.strokeStyle = '#18252d'; c.lineWidth = 2.5;
      c.beginPath(); c.moveTo(0, -12); c.lineTo(8, 8); c.lineTo(0, 4); c.lineTo(-8, 8); c.closePath(); c.fill(); c.stroke();
      c.restore();
    }
  }
}
