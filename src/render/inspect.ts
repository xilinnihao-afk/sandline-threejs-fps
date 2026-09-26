/** Debug-only back-buffer sampling, after both scene and viewmodel have rendered.
 * No DOM overlays are included. A sparse 160 px-wide grid bounds analysis cost. */
export function inspectCanvas(gl:WebGLRenderingContext|WebGL2RenderingContext){
 const width=gl.drawingBufferWidth,height=gl.drawingBufferHeight,pixels=new Uint8Array(width*height*4);
 gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
 const stride=Math.max(1,Math.floor(width/160)),hist=new Map<number,number>(),lum:number[]=[],gray=new Map<number,number>();let edges=0,pairs=0;
 for(let y=0;y<height;y+=stride)for(let x=0;x<width;x+=stride){const i=(y*width+x)*4,r=pixels[i],g=pixels[i+1],b=pixels[i+2],key=(r>>5)*64+(g>>5)*8+(b>>5);hist.set(key,(hist.get(key)||0)+1);const l=.2126*r+.7152*g+.0722*b;lum.push(l);gray.set(y*width+x,l);if(x>=stride){pairs++;if(Math.abs(l-(gray.get(y*width+x-stride)||0))>24)edges++;}}
 const n=lum.length,mean=lum.reduce((a,b)=>a+b,0)/n,sd=Math.sqrt(lum.reduce((a,b)=>a+(b-mean)**2,0)/n);lum.sort((a,b)=>a-b);
 let entropy=0,dominant=0;for(const count of hist.values()){const p=count/n;entropy-=p*Math.log2(p);dominant=Math.max(dominant,p);}
 return {source:'WebGL readPixels after world + viewmodel render, excludes DOM HUD',width,height,samples:n,colorEntropyBits:+entropy.toFixed(3),dominantColorShare:+dominant.toFixed(3),edgeDensity:+(edges/Math.max(1,pairs)).toFixed(3),luminance:{mean:+mean.toFixed(2),standardDeviation:+sd.toFixed(2),contrast:+(lum[Math.floor(n*.95)]-lum[Math.floor(n*.05)]).toFixed(2)}};
}
