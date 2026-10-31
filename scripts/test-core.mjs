import {readFileSync,readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
// Explicit fixture inventory: the public release omits binary media and local authoring archives.
const fixtureSuites=new Set(JSON.parse(readFileSync(new URL('./asset-dependent-tests.json',import.meta.url),'utf8')));
const files=readdirSync('tests').filter(name=>name.endsWith('.test.ts')&&!fixtureSuites.has(name)).sort();
console.log(`Running ${files.length} asset-independent suites; ${fixtureSuites.size} fixture-dependent suites are listed in scripts/asset-dependent-tests.json. npm test runs everything.`);
const result=spawnSync(process.execPath,['--import','tsx','--test',...files.map(name=>'tests/'+name)],{stdio:'inherit'});
if(result.error)throw result.error;
process.exit(result.status??1);
