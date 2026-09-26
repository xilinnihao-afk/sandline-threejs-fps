# Local asset setup

The source is buildable and its core tests run without binary game assets. The default game startup requires character files, so **a fresh clone alone will not start a playable match**. Use the [hosted demo](http://39.105.40.112/) to play immediately.

[ASSET-MANIFEST.json](ASSET-MANIFEST.json) lists the original demo's asset paths, sizes, and SHA-256 checksums. It is a reference inventory, not a download script or a license. Obtain authorized copies from the relevant rights holders or use your own licensed replacements. Do not assume a filename or availability on a website establishes redistribution rights.

## Required character assets

Place the following under `public/assets/characters/`:

- `soldier.gltf`, `soldier.bin`, and the referenced `soldier-texture-0.jpg` and `soldier-texture-1.jpg`: donor rig and Idle/Walk/Run reference clips.
- `soldier_fully_rigged_character.glb`: the default target character rig.
- `ct-uniform.jpg` and `insurgent-uniform.jpg`: needed when using the optional `?character=legacy` mode.

The reference animation source is the Three.js Soldier example / Mixamo. Consult the [Mixamo FAQ](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html) and the relevant model licenses. This repository does not redistribute those files or assert that standalone redistribution is permitted.

Replacement models may need changes to `src/render/riggedSoldier.ts`, `characters.ts`, `operators.ts`, and the IK setup. Matching only the filename is insufficient: joint names, bind poses, materials, and animation clips must also match the loader's assumptions.

## Other assets

| Directory | Purpose |
| --- | --- |
| `public/assets/environment/` | Surface textures and optional HDR environment |
| `public/assets/weapons/` | Imported rifle and pistol; procedural weapon fallbacks exist |
| `public/assets/player/` | First-person arm GLB and texture maps; legacy arm fallback exists |
| `public/assets/audio/` | Combat, ambience, music, and UI sounds |
| `public/assets/audio/voice/` | Short voice WAV files and their provenance manifest |

Consult the inventory for exact filenames. Environment, audio, and optional model omissions can produce missing-resource warnings or reduced presentation even after the required character assets are supplied. To reproduce the hosted demo, supply the complete authorized asset set.

## Tests

```sh
npm run typecheck
npm run test:core
npm run build
```

These commands require no binary asset fixtures. The core runner explicitly omits seven original test files that load models or voice recordings. Those files remain in the repository unchanged.

```sh
npm test
```

The full suite requires the inventory's model and audio fixtures, including the two static character candidates used by `characterModelLoader.test.ts`. Some integration tests assert original geometry, skeleton properties, or audio checksums, so replacing files with different assets also requires updating the relevant expectations. Missing fixtures are reported as failures rather than silently passed tests.

## Asset tools

- `scripts/prepare-character.py`: inspect and unpack an authorized Soldier GLB (Python and Pillow; create `artifacts/v02/` first).
- `scripts/prepare-uniforms.py`: generate team texture variants from the supplied donor texture (Python and Pillow).
- `scripts/inspect-rig.mjs`: inspect the supplied donor rig.
- `scripts/generate-audio*.py`: offline audio processing; inspect each script's imports and source URLs before use. Downloaded recordings retain their own licenses.
- `scripts/generate-voice.py`: optional macOS `say` / `afconvert` workflow with an installed Daniel voice. Output terms depend on the voice/system license.

None of these asset-generation tools run during `npm ci` or `npm run build`. Review rights before distributing generated or transformed media.
