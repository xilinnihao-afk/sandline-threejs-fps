/** Small synthesis recipes, not encoded media. Build once per audio context;
 * the offline ZIP contains no recordings, network loader or runtime decoder. */
import {enhanceSniperShot,renderSnowStep} from '../../src/render/combatSoundDesign';
export const SOUND_IDS=[
 'rifle','m4','smg','pistol','deagle','shotgun','sniper','tail','mechanism','shell',
 'magOut','magIn','bolt','pump','gear','slash','stab','step1','step2','step3','step4',
 'snow1','snow2','snow3','snow4',
 'body','hurt','metal','wall','wood','ricochet','grenade','bomb','pin','tick',
 'confirm','cancel','hit','kill','round','objective','wind','menu',
] as const;
export type SoundId=typeof SOUND_IDS[number];
export const LOOP_IDS=new Set<SoundId>(['wind','menu']);
export const BANK_SAMPLE_RATE=22050;
const TAU=2*Math.PI;
const gunSpecs={
 rifle:[.44,148,96,1850,.092,.62],m4:[.38,170,115,2100,.076,.50],
 smg:[.28,200,143,2500,.055,.40],pistol:[.32,215,151,2800,.066,.52],
 deagle:[.60,130,79,1700,.128,.85],shotgun:[.72,110,68,1900,.155,.92],sniper:[.90,94,57,1600,.165,1.0],
} as const;
const duration:Record<SoundId,number>={
 rifle:.44,m4:.38,smg:.28,pistol:.32,deagle:.60,shotgun:.72,sniper:.90,tail:.45,mechanism:.12,shell:.36,
 magOut:.19,magIn:.22,bolt:.29,pump:.38,gear:.24,slash:.24,stab:.17,
 step1:.29,step2:.30,step3:.28,step4:.31,body:.18,hurt:.25,metal:.26,wall:.15,wood:.20,ricochet:.28,
 snow1:.30,snow2:.312,snow3:.324,snow4:.336,
 grenade:1.35,bomb:2.15,pin:.28,tick:.12,confirm:.18,cancel:.19,hit:.07,kill:.36,round:.75,objective:.42,wind:4,menu:8,
};
/** Two gentle low-pass stages tame brittle phone-speaker transients without
 * removing the useful midrange body. Runs only when a bank buffer is built. */
function soften(data:Float32Array,rate:number,hz:number,attack:number):Float32Array{
 const a=1-Math.exp(-TAU*hz/rate);let one=0,two=0;
 for(let i=0;i<data.length;i++){
  one+=a*(data[i]-one);two+=a*(one-two);
  const edge=Math.min(1,i/(rate*attack),(data.length-1-i)/(rate*.025));
  data[i]=two*Math.max(0,edge);
 }
 return data;
}
export function renderSound(id:SoundId,sampleRate=BANK_SAMPLE_RATE):Float32Array{
 if(id.startsWith('snow')){
  const snow=soften(renderSnowStep(Number(id.slice(-1))-1,sampleRate),sampleRate,2900,.009);
  let peak=0;for(const value of snow)peak=Math.max(peak,Math.abs(value));
  for(let i=0;i<snow.length;i++)snow[i]*=.70/Math.max(.001,peak);
  return snow;
 }
 const data=new Float32Array(Math.ceil(duration[id]*sampleRate));
 let seed=2166136261;for(let i=0;i<id.length;i++)seed=Math.imul(seed^id.charCodeAt(i),16777619);
 const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296*2-1;};
 const noise=(start:number,length:number,gain:number,low:number,high:number,decay:number,attack=.001)=>{
  const a=1-Math.exp(-TAU*Math.min(low,sampleRate*.44)/sampleRate),b=1-Math.exp(-TAU*high/sampleRate);
  let filtered=0,baseline=0;const count=Math.ceil(length*sampleRate),offset=Math.round(start*sampleRate);
  for(let i=0;i<count&&offset+i<data.length;i++){
   filtered+=a*(random()-filtered);baseline+=b*(filtered-baseline);
   const t=i/sampleRate,edge=Math.min(1,t/attack,(length-t)/.014),env=Math.exp(-t/decay)*Math.max(0,edge);
   data[offset+i]+=(filtered-baseline)*gain*env;
  }
 };
 const tone=(start:number,length:number,from:number,to:number,gain:number,decay=length*.35,attack=.002)=>{
  let phase=0;const count=Math.ceil(length*sampleRate),offset=Math.round(start*sampleRate);
  for(let i=0;i<count&&offset+i<data.length;i++){
   const t=i/sampleRate,frequency=to+(from-to)*Math.exp(-t/(length*.16));phase+=TAU*frequency/sampleRate;
   const edge=Math.min(1,t/attack,(length-t)/.012);data[offset+i]+=Math.sin(phase)*gain*Math.exp(-t/decay)*Math.max(0,edge);
  }
 };
 const click=(time:number,gain:number,freq=2200)=>{noise(time,.035,gain,freq*2,500,.008);tone(time,.055,freq,freq*.92,gain*.24,.018);};
 if(id in gunSpecs){
  const [length,from,to,cut,decay,weight]=gunSpecs[id as keyof typeof gunSpecs];
  noise(0,.045,.30,5300,1100,.009,.0035); // short, controlled muzzle onset
  noise(.002,length,1.65,cut,65,decay,.005); // broad pressure, audible on small speakers
  tone(.003,length*.62,from,to,weight*.48,decay,.006);
  tone(.006,length*.48,from*2.07,to*2.07,weight*.18,decay*.76,.008);
  noise(.018,length-.018,.58,950,120,decay*1.55,.014);
  // Soft, spread reflections follow the shot instead of another sharp crack.
  noise(.075,length-.075,.33,1400,170,decay*1.6,.024);
  noise(.145,length-.145,.18,1050,100,decay*1.8,.030);
  if(id==='shotgun')noise(.008,.19,.55,2900,250,.060,.009);
  soften(data,sampleRate,3600,.004);
  if(id==='sniper')return soften(enhanceSniperShot(data,sampleRate),sampleRate,3300,.005);
 }else if(id.startsWith('step')){
  const variant=Number(id.slice(-1))-1;
  tone(0,.17,104+variant*4,78+variant*3,.46,.048,.012); // heel weight
  noise(.006,.20,.96,1200+variant*100,110,.065,.014); // cushioned sole contact
  tone(.047,.16,148+variant*5,113,.20,.048,.018); // heel-to-toe transfer
  noise(.054+variant*.003,.19,.58,1850-variant*110,190,.068,.023);
  noise(.110,.17,.30,2400-variant*140,440,.060,.030); // continuous scuff, no grain clicks
  soften(data,sampleRate,2300,.010);
 }else switch(id){
  case 'tail':noise(0,.45,.45,1900,150,.10,.008);break;
  case 'mechanism':click(0,.65,1600);click(.041,.38,3100);break;
  case 'shell':for(let j=0;j<3;j++){const time=j*.105;noise(time,.023,.22/(j+1),7800,2800,.006);for(const f of [2690,3910,5380])tone(time,.09,f,f,.19/(j+1),.025);}break;
  case 'magOut':noise(0,.15,.45,1300,250,.06,.005);click(.008,.40,1850);click(.112,.23,2900);break;
  case 'magIn':noise(0,.16,.35,1700,180,.06,.008);tone(.074,.12,160,80,.55,.025);click(.082,.8,2100);break;
  case 'bolt':noise(0,.20,.45,2300,480,.08,.008);click(.025,.7,1600);click(.177,.85,2400);break;
  case 'pump':noise(0,.16,.7,1500,160,.07,.006);noise(.18,.16,.7,1800,200,.07,.005);click(.03,.4,1900);click(.27,.9,1350);break;
  case 'gear':noise(0,.24,.7,2400,750,.085,.012);break;
  case 'slash':noise(0,.22,.8,3200,200,.09,.035);noise(.065,.16,.28,7200,2200,.06,.01);break;
  case 'stab':noise(0,.17,.8,2100,180,.055,.018);click(.012,.15,600);break;
  case 'body':tone(0,.14,170,65,.85,.04);noise(.005,.15,.85,1700,100,.04);noise(.03,.12,.3,3200,650,.036);break;
  case 'hurt':tone(0,.22,135,45,.9,.07);noise(0,.25,.85,1300,90,.065);noise(.045,.14,.25,3700,1000,.05);break;
  case 'metal':for(const f of [870,1390,2680,4410])tone(0,.26,f,f,.34,.06);noise(0,.06,.7,8000,900,.013);break;
  case 'wall':noise(0,.14,.85,4100,280,.03);tone(0,.07,310,180,.42,.015);break;
  case 'wood':noise(0,.17,.7,2100,180,.044);tone(0,.15,260,190,.6,.035);click(.037,.16,750);break;
  case 'ricochet':tone(0,.25,2800,760,.5,.055);noise(0,.035,.45,8500,2400,.009);break;
  case 'grenade':case 'bomb':{
   const large=id==='bomb',length=duration[id];noise(0,.05,1.2,8000,600,.012);
   tone(.003,length,large?75:105,large?24:34,1.0,large?.32:.20);
   noise(.004,length,1.3,large?800:1300,30,large?.38:.24);
   noise(.075,length-.075,.6,2600,170,large?.38:.22,.018);
   for(let j=0;j<(large?5:3);j++)noise(.16+j*.15,.32,.35/(j+1),1800,300,.08,.009);break;
  }
  case 'pin':click(0,.6,2700);noise(.055,.21,.65,2000,500,.08,.018);break;
  case 'tick':tone(0,.11,1150,1150,.7,.027);break;
  case 'confirm':tone(0,.10,660,660,.48);tone(.065,.11,990,990,.38);break;
  case 'cancel':tone(0,.16,350,190,.5,.05);break;
  case 'hit':noise(0,.035,.38,6500,1900,.009);tone(0,.055,1120,910,.45,.016);break;
  case 'kill':tone(0,.2,660,660,.45,.07);tone(.09,.24,990,990,.35,.09);break;
  case 'round':for(let j=0;j<3;j++)tone(j*.18,.32,[392,523,784][j],[392,523,784][j],.4,.12);break;
  case 'objective':tone(0,.17,520,520,.45,.06);tone(.12,.28,780,780,.4,.10);break;
  case 'wind':{
   let low=0;for(let i=0;i<data.length;i++){const t=i/sampleRate;low+=.06*(random()-low);data[i]=low*(.60+.25*Math.sin(TAU*t/4)+.15*Math.sin(TAU*t/2));}break;
  }
  case 'menu':{
   const notes=[98,146.832,130.813,110];
   for(let chord=0;chord<4;chord++)for(let note=0;note<3;note++){
    const f=notes[chord]*[1,1.5,2][note];tone(chord*2,2,f,f,.15/(1+note*.4),1.15,.14);
   }
   for(let beat=0;beat<16;beat++){tone(beat*.5,.16,68,41,.11,.045);noise(beat*.5+.25,.09,.06,2800,1100,.025);}
   break;
  }
 }
 // Remove DC, retain headroom, and make loop boundaries quiet without clicks.
 let mean=0;for(const v of data)mean+=v;mean/=data.length;
 let peak=0;for(let i=0;i<data.length;i++){data[i]-=mean;peak=Math.max(peak,Math.abs(data[i]));}
 const target=LOOP_IDS.has(id)?(id==='wind'?.35:.50):id.startsWith('step')?.64:id in gunSpecs?.76:.82,gain=target/Math.max(.001,peak);
 const fade=Math.min(Math.floor(sampleRate*(LOOP_IDS.has(id)?.009:.002)),data.length/2);
 for(let i=0;i<data.length;i++)data[i]*=gain*Math.min(1,i/fade,(data.length-1-i)/fade);
 return data;
}
