import {spawnSync,spawn} from 'node:child_process';
import {dirname} from 'node:path';
import {writeFileSync,readdirSync} from 'node:fs';
import {deflateSync} from 'node:zlib';
process.env.PATH=dirname(process.execPath)+':'+(process.env.PATH||'');
function run(args){const p=spawnSync(process.execPath,args,{stdio:'inherit'});if(p.status!==0)process.exit(p.status||1);}
function icons(){
 const crc=b=>{let c=0xffffffff;for(const n of b){c^=n;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;};
 const chunk=(name,data)=>{const n=Buffer.from(name),len=Buffer.alloc(4),check=Buffer.alloc(4);len.writeUInt32BE(data.length);check.writeUInt32BE(crc(Buffer.concat([n,data])));return Buffer.concat([len,n,data,check]);};
 const inside=(x,y,points)=>{let hit=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const [xi,yi]=points[i],[xj,yj]=points[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)hit=!hit;}return hit;};
 for(const size of [192,512]){const pixels=Buffer.alloc(size*(size*4+1));for(let y=0;y<size;y++)for(let x=0;x<size;x++){const xx=x*512/size,yy=y*512/size;const gold=inside(xx,yy,[[120,330],[213,151],[279,151],[185,330]])||inside(xx,yy,[[228,361],[309,205],[378,205],[297,361]]);const trim=yy>375&&yy<383&&xx>124&&xx<388;const color=gold?[233,181,93]:trim?[141,150,126]:[23,28,27];const p=y*(size*4+1)+1+x*4;pixels[p]=color[0];pixels[p+1]=color[1];pixels[p+2]=color[2];pixels[p+3]=255;}
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(size);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=6;writeFileSync('public/icon-'+size+'.png',Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]));}
}
switch(process.argv[2]){
 case 'build': icons();run(['node_modules/typescript/bin/tsc','--noEmit']);run(['node_modules/vite/bin/vite.js','build']);run(['scripts/build-sw.mjs']);break;
 case 'test':run(['--import','tsx','--test',...readdirSync('tests').filter(f=>f.endsWith('.test.ts')).map(f=>'tests/'+f)]);break;
 case 'serve':{const port=process.argv[3]||'5190';const p=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','0.0.0.0','--port',port,'--strictPort'],{stdio:'inherit'});process.on('SIGTERM',()=>p.kill('SIGTERM'));process.on('SIGINT',()=>p.kill('SIGINT'));p.on('exit',code=>process.exit(code||0));break;}
 default:console.error('Usage: node scripts/project.mjs build|test|serve');process.exit(1);
}
