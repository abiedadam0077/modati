# Testing report

No Minecraft client or Bedrock Dedicated Server was available in the development environment (the official
download hosts are not reachable from it). Everything below is what *was* verified; nothing here claims in-game testing.

## 1. Static validation (runs on every `node tools/build.mjs`)

| Check | Result |
|---|---|
| JSON syntax of every generated file | pass |
| Block/item components against **Mojang's official JSON schemas for 1.26.0** (`bedrock-samples` tag v1.26.0.2) — 197 component sets incl. permutations | pass (found and fixed: `map_color` must be an object, tags need a namespace) |
| Cross references: geometry ids, bone names in `bone_visibility`, material textures in `terrain_texture.json`, flipbook tiles, item icons, client-entity geometry/texture/animation/render-controller references, render-controller array entries, sounds ↔ files, script sound ids, played animation ids, loot tables, feature rules, lang keys for every block/item/entity | pass |
| Vanilla texture paths used by moving-block rendering exist in the 1.26 vanilla pack (file list in `tools/data`) | pass |
| Recipe items exist (custom ids in the packs, vanilla ids in `@minecraft/vanilla-data`), pattern keys complete | pass |
| Collision/selection boxes within the engine limits; selection box single box; ≤16 collision boxes; permutation counts | pass |
| UVs inside texture bounds for every cube face | pass |
| **Molang lint**: balanced parentheses, `query.*`/`math.*` names against Mojang's official query list, variables read but never assigned, temp variables crossing expressions | pass (found and fixed: temp variables used across separate `pre_animation` entries) |
| TypeScript type check of all scripts against the official `@minecraft/server` 2.5.0 / `@minecraft/server-ui` 2.0.0 typings | pass |

## 2. Automated tests (`npm test`, 51 tests, all passing)

The tests bundle the **real runtime scripts** with a simulated `@minecraft/server` whose block types, states,
custom components and tick intervals are loaded from the generated behavior pack.

* `kinetics.test.ts` (12): shafts, perpendicular isolation, cog meshing, 2:1 ratios, bevel gearbox signs (matches Create),
  inconsistent loops → conflict without destruction, opposing sources, dominant faster source, overstress, overspeed, clutch/gearshift, belts, large↔large cogs.
* `integration.test.ts` (11): network + rotor spawning/orientation/phase, break propagation, press on depot (+ animation trigger),
  mixer (speed requirement + heat requirement → brass), millstone, belt → chest (+ texture motion state), drill, crushing wheels,
  bearing door mode (90° about +Y), pump direction, track curves, persistence round-trip (incl. >30 kB global values).
* `integration2.test.ts` (12): deployer item application, spout filling, fan washing, chute, funnel insert/extract,
  mechanical arm, hand crank, clutch with redstone, water wheel from flowing water, upward saw, rope-pulley elevator with contacts,
  mechanical piston with poles, train assembly + movement through a curve.
* `units.test.ts` (10): orientation matrices, side-axis rotor roll for every facing, side-shaft model/axis consistency for every facing,
  arm inverse kinematics (forward check), inward crushing rule, Create timing formulas, recipes, hardness, content consistency (runtime ↔ packs).
* `placement.test.ts` (4): smart placement — face-based axes, cog axis copying, drills facing away from power, `alt` selection, press axis, crank attachment.
* `perf.test.ts` (2): see below.

Bugs found by the tests/review and fixed during development: belt tick crash from a shadowed variable, side-shaft axis mismatch for east/west facings, Molang temp variables across expressions, schema issues (`map_color`, tag namespaces), test-harness power handling.

## 3. Performance measurements (Node.js 22 / V8, simulated world)

| Scenario | Cost |
|---|---|
| Rediscover + solve a 750-node network (500 shafts + branches) | ≈ 6–8 ms, only when topology changes |
| 20 loaded belts × 5 items, everything else idle | ≈ 0.9 ms per tick in total (belt task ≈ 0.3 ms) |

Minecraft's script engine is slower than V8, so expect several times these numbers in game. Mitigations built in:
visual LOD (rotors only within 40 blocks of players), cap of 600 item displays, contraption size cap (256, configurable),
incremental network solving, belt info cache, entity queries throttled, `/craftoria:settings rotors 0` for low-end devices,
`/craftoria:debug` for live per-task timings.

## 4. Visual QA

Every block and rotor model is rendered by `tools/lib/render.mjs`, which re-imports the exported Bedrock JSON with the
inverse of the export conventions (derived from Blockbench's Bedrock codec). Contact sheets are in `docs/images`.

## 5. Not tested (requires the game)

* In-game rendering of item displays (orientation/scale of held items), exact animation feel, sound mix.
* Android devices, frame rate and memory on real hardware.
* Multiplayer with several clients (the design is server-authoritative; visuals are client-side and synchronized by
  entity properties, so it is expected to work, but it was not verified).
