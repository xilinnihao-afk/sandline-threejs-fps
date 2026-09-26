import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
// These original integration suites read binary model/audio fixtures.
const assetSuites = new Set([
  'characterModelLoader.test.ts', 'riggedSoldier.test.ts',
  'characterDeath.test.ts', 'viewArmsIK.test.ts',
  'rifleMagazine.test.ts', 'pistolAsset.test.ts', 'voiceCues.test.ts',
]);
const files = readdirSync('tests').filter(name => name.endsWith('.test.ts') && !assetSuites.has(name)).sort();
console.log(`Running ${files.length} asset-independent test files. Run npm test with assets for the full suite.`);
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...files.map(name => `tests/${name}`)], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
