/** Deterministic Foley and shot mastering shared by the web asset build and
 * the offline mini-tool. These functions run once per sound, never per frame. */
const TAU=2*Math.PI;
function randomStream(seed:number){return ()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296*2-1;};}
function lowpass(data:Float32Array,hz:number,rate:number){
 const out=new Float32Array(data.length),a=1-Math.exp(-TAU*hz/rate);let low=0;
 for(let i=0;i<data.length;i++){low+=a*(data[i]-low);out[i]=low;}return out;
}
function master(data:Float32Array,rate:number,ceiling:number,fadeIn:number,fadeOut:number){
 let mean=0;for(const x of data)mean+=x;mean/=data.length;let peak=0;
 for(let i=0;i<data.length;i++){data[i]=(data[i]-mean)*Math.min(1,i/(rate*fadeIn),(data.length-1-i)/(rate*fadeOut));peak=Math.max(peak,Math.abs(data[i]));}
 const gain=ceiling/Math.max(peak,.001);for(let i=0;i<data.length;i++)data[i]*=gain;return data;
}
export function renderSnowStep(variant:number,rate:number):Float32Array{
 const v=((variant%4)+4)%4,length=.30+v*.012,data=new Float32Array(Math.ceil(length*rate)),random=randomStream(280910+v*73);
 const burst=(start:number,duration:number,gain:number,lo:number,hi:number,attack:number)=>{
  const a=1-Math.exp(-TAU*lo/rate),b=1-Math.exp(-TAU*hi/rate),offset=Math.round(start*rate);let top=0,bottom=0;
  for(let i=0;i<Math.ceil(duration*rate)&&i+offset<data.length;i++){
   const t=i/rate;top+=a*(random()-top);bottom+=b*(top-bottom);
   const env=Math.min(1,t/attack)*Math.exp(-t/(duration*.30))*Math.min(1,(duration-t)/.012);
   data[i+offset]+=(top-bottom)*gain*env;
  }
 };
 // Heel sinks into powder, followed by a dense, irregular crust compression.
 for(let i=0;i<Math.floor(rate*.14);i++){const t=i/rate;data[i]+=.20*Math.sin(TAU*(94+v*5)*t)*Math.exp(-t/.026)*Math.min(1,t/.004);}
 burst(.005,.17,.80,2300+v*150,180,.006);
 burst(.052,.18,.52,3900-v*140,650,.018);
 for(let i=0;i<24;i++){
  const start=.018+(random()+1)*.092,duration=.009+(random()+1)*.008;
  burst(start,duration,.12+(random()+1)*.09,5400,1400,.0015);
 }
 // The sole lifts with a shorter powder scrape, not a hard stone click.
 burst(.172+v*.006,.11,.26,4300,950,.012);
 return master(data,rate,.74,.002,.025);
}
export function enhanceSniperShot(dry:Float32Array,rate:number):Float32Array{
 const data=new Float32Array(Math.ceil(rate*3.2)),bass=lowpass(dry,300,rate);
 const add=(source:Float32Array,gain:number,delay=0)=>{const offset=Math.round(delay*rate);for(let i=0;i<source.length&&i+offset<data.length;i++)data[i+offset]+=source[i]*gain;};
 add(dry,1);add(bass,.70);
 let phase=0,rumble=0;const random=randomStream(281028),a=1-Math.exp(-TAU*420/rate);
 for(let i=0;i<data.length;i++){
  const t=i/rate;phase+=TAU*(68+115*Math.exp(-t/ .065))/rate;rumble+=a*(random()-rumble);
  const pressure=Math.sin(phase)+.42*Math.sin(phase*2)+.18*Math.sin(phase*3);
  data[i]+=.24*pressure*Math.min(1,t/.003)*Math.exp(-t/.21);
  data[i]+=.58*rumble*Math.min(1,t/.018)*Math.exp(-t/.75);
 }
 // Increasing gaps and darker returns read as distant outdoor reflections.
 // One baked voice keeps the whole decay under pause/mute/source-pool control.
 for(const [delay,gain,hz] of [[.14,.28,3300],[.33,.24,2600],[.59,.19,2100],[.94,.15,1600],[1.37,.10,1200]])add(lowpass(dry,hz,rate),gain,delay);
 for(let i=0;i<data.length;i++)data[i]=Math.tanh(data[i]*1.55);
 return master(data,rate,.78,.001,.10);
}
