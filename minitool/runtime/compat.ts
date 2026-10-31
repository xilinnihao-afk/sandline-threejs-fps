// Only APIs used by this game and its renderer; the bundle targets Chrome 61.
export function installCompatibility(): void {
  if (typeof globalThis === 'undefined') (window as any).globalThis = window;
  if (!Object.fromEntries) Object.fromEntries = function (entries: any) {
    const out: any = {}; for (const pair of entries) out[pair[0]] = pair[1]; return out;
  };
  if (!Object.hasOwn) Object.hasOwn = (value: any, key: PropertyKey) => Object.prototype.hasOwnProperty.call(value, key);
  if (!Array.prototype.flatMap) Object.defineProperty(Array.prototype, 'flatMap', {configurable:true,writable:true,value:function(callback:any,thisArg:any){
    const result:any[]=[]; for(let i=0;i<this.length;i++)if(i in this){const value=callback.call(thisArg,this[i],i,this);if(Array.isArray(value)){for(let j=0;j<value.length;j++)if(j in value)result.push(value[j]);}else result.push(value);}return result;
  }});
  if (!Promise.prototype.finally) (Promise.prototype as any).finally = function(callback:()=>unknown){
    return this.then((value:unknown)=>Promise.resolve(callback()).then(()=>value),(error:unknown)=>Promise.resolve(callback()).then(()=>{throw error;}));
  };
  if (!Array.prototype.at) Object.defineProperty(Array.prototype, 'at', {configurable: true, writable: true, value: function (index: number) {
    let n = Math.trunc(Number(index) || 0); if (n < 0) n += this.length; return this[n];
  }});
  if (!Promise.allSettled) (Promise as any).allSettled = (values: any[]) => Promise.all(Array.from(values, value => Promise.resolve(value).then(
    result => ({status: 'fulfilled', value: result}), reason => ({status: 'rejected', reason}))));
  if (!String.prototype.matchAll) Object.defineProperty(String.prototype, 'matchAll', {configurable: true, writable: true, value: function (pattern: RegExp) {
    const expression = new RegExp(pattern.source, pattern.flags.indexOf('g') < 0 ? pattern.flags + 'g' : pattern.flags);
    const matches: RegExpExecArray[] = []; let match: RegExpExecArray | null;
    while ((match = expression.exec(String(this)))) { matches.push(match); if (!match[0]) expression.lastIndex++; }
    return matches[Symbol.iterator]();
  }});
}
// Run before dependency modules with top-level map/roster initialization.
installCompatibility();
