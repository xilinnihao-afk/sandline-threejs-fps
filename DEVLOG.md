# SANDLINE development journal

These notes describe problems encountered while building the demo and the implementation choices used to address them. They are engineering notes, not claims that every device or asset combination is supported.

## 1. GLB models: preview quality is not animation readiness

### The false start

Two early tactical-character GLBs rendered as plausible soldiers, but inspecting their data found **zero skins, no joint/weight attributes, and no animation clips**. One had roughly 41,000 vertices and 12 PBR materials; the other had roughly 177,000 vertices and a single unlit material. Neither could be treated as an animated character just because its filename or preview suggested one.

The loader now distinguishes static previews from animation-ready models. Authored normals and UVs must be preserved. Converting an unlit material to a standard material does not create the missing normal, roughness, or metalness maps.

A 2K texture upload cap helps GPU texture memory, but it does **not** reduce the original download size or mesh complexity. Those are separate optimization jobs.

### Getting a rigged character moving

The eventual soldier has approximately 17,117 vertices, one skin, and 65 joints. It includes one `mixamo.com` clip rather than a complete idle/walk/run library. Simply renaming animation tracks or copying local joint rotations from an older skeleton is insufficient when the bind poses differ.

The integration retargets reference locomotion clips using world-space bind-pose differences and bakes the result once at 30 Hz. Each actor has its own skeleton and animation mixer while sharing geometry and materials. Legacy specular-glossiness data also needed its diffuse contribution restored and gloss alpha translated into roughness.

Validation checks finite joint transforms, bone lengths, root placement, and stable death poses at 30/60/120 Hz. The lesson is to inspect the asset first, establish a neutral-pose baseline, then verify animation mathematically as well as visually.

## 2. Mobile aiming: tiny gestures must survive the frame loop

### The symptom

Touch aiming could feel inconsistent when small pointer events were filtered independently. A quick fire tap could also begin and end between simulation ticks. Movement, look, and fire fingers need separate ownership rather than competing for one shared pointer state.

### The fix

Accumulate movement until a 5 px gesture threshold is crossed, subtract that initial slop only once, then retain the remaining displacement. Smooth pending motion with a frame-time-based fraction:

```text
alpha = 1 - exp(-dt / 0.025)
```

The integration caps `dt` at 0.1 seconds, consumes only a fraction each tick, and keeps the remainder. This preserves total swipe rotation across 30/60/120 Hz rather than dropping small moves. Pointer release ends the gesture but keeps pending turn displacement; pointer cancellation clears movement and queued shots. A quick fire tap remains pending until a simulation tick consumes it.

The fire button can also own an aiming gesture unless another look pointer already owns aiming. This lets a player move, shoot, and adjust aim at the same time.

A mobile viewport check at 844×390 confirmed a pistol shot consumed one round and fire-drag changed yaw. Synthetic multi-touch checks supplement the automated tests; they do not replace physical-device testing.

### Browser behavior is part of input design

Applying touch rules only to the canvas was insufficient because HUD elements also receive touches. Gesture suppression covers the gameplay surface and controls while preserving scrolling and long-press behavior in appropriate dialogs. Fullscreen uses capability checks and fallback guidance when the browser rejects or lacks the API.

## 3. Explosions: more impact without unbounded particles

### Building the effect

A single flash does not communicate the whole event. The explosion uses layers with different timing:

| Layer | Count per explosion | Approximate lifetime |
| --- | ---: | --- |
| Flash sprite | 1 | 75 ms |
| Noisy fireballs | 4 | 0.56 s |
| Expanding ring | 1 | 0.42 s |
| Staggered smoke | 10 | 1 s |
| Debris | 6 | Short-lived |
| Sparks | 12 | Short-lived |

That is 34 visual elements per explosion, limited to two active effects (68 elements), plus one non-shadow-casting point light per explosion. Up to two procedural 64×64 textures are generated per effect; no external effect textures or post-processing are needed. Debris and sparks use instancing.

### The traps

The effect must copy the real detonation position instead of holding a mutable position reference. Camera shake is applied as a render-only offset after restoring the base camera: it must never accumulate into player position or input yaw/pitch. Otherwise repeated blasts can leave the view permanently displaced.

New effects replace the oldest when the concurrency cap is reached. Expired effects and reset/dispose paths release resources. Tests cover origin placement, bounded element counts, cleanup, and camera drift.

Damage is handled separately with distance falloff and cover/occlusion checks. Smoke, sparks, and debris do not determine gameplay damage. Stronger feedback comes from the timing and scale of the layers, not an unlimited particle count.

## 4. Bots: pushing apart is not passing each other

Two bots walking toward each other could remain stuck even with collision separation: separation removes overlap but does not choose a way around the other actor. The update adds proactive local avoidance, a persistent side preference with hysteresis, wall-aware steering alternatives, and path recalculation when movement stalls. This reduces head-on deadlocks without making collision response responsible for route planning.

## 5. Voice feedback: timing and browser policy matter

Short English callouts cover combat and objective/result events. The current bundle contains ten synthesized lines, about 381 KB in total. Announcements use priorities and a queue, temporarily lower ambience/music, and respect mute, pause, and background state.

Browsers may block audio until a trusted user gesture. The audio system therefore unlocks on interaction and avoids replaying stale queued lines when the player returns to the tab. A late objective callout can be more confusing than no callout.

## 6. Loading and verification

Loading feedback tracks actual initialization stages rather than claiming a precise byte percentage without byte totals. Mobile guidance explains browser limitations before players mistake them for game failures.

The latest project validation included a successful production build and 67 automated tests across gameplay and related systems. Release checks also verified deployed resources. The screenshots in this repository use fixed in-engine scenes for repeatability; neither screenshots nor synthetic input tests establish real-phone frame rates.

## What this repository includes

This repository now includes the game implementation, build configuration, asset tooling, and original tests alongside the demo link, screenshots, and these notes. Model, texture, and audio files are excluded from the source release. See [ASSETS.md](ASSETS.md) for setup and [NOTICE.md](NOTICE.md) for distribution context.

## Audio update: quieter combat and English callouts

Combat now uses only a quiet wind loop, with no city or tension bed. Menu music is approximately 9.7 dB quieter; footsteps are about 2.6 dB louder. Ten short English tactical lines replace the original Mandarin recordings. Voice ducking leaves footsteps and gunfire unchanged and restores the quieter background levels. The local full-asset project passes 68 tests; synthetic playback tests do not replace listening on a real phone.
