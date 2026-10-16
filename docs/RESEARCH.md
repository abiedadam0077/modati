# Research notes

## Create (Java) — mechanics studied from its MIT-licensed source

Repository: `Creators-of-Create/Create` (code MIT; `src/main/resources/assets` All Rights Reserved — not used).

| Topic | Source | Used in CRAFTORIA |
|---|---|---|
| Rotation propagation and ratios | `content/kinetics/RotationPropagator.java` | `kinetics/connect.ts`: coaxial shafts, small↔small −1, large→small −2, small→large −0.5, large↔large ±1 (sign rule ported), gearbox signs (re-derived from bevel-gear physics, identical to Create) |
| Stress | `KineticNetwork.java`, `infrastructure/config/CStress.java` | capacity = Σ cap × \|generated speed\|, impact = Σ imp × \|speed\|; impacts 8 press/crusher, 4 mixer/millstone/drill/saw/deployer/bearing/pulley/piston/pump, 2 fan/arm; capacities 8 crank, 32 water wheel, 512 windmill, 16384 creative motor |
| Speed limits | `CKinetics.java` | max 256 RPM, mixer needs medium speed (30 RPM) |
| Generators | `HandCrankBlockEntity`, `WaterWheelBlockEntity`, `WindmillBearingBlockEntity`, `CreativeMotorBlockEntity` | crank 32 RPM for a short time per use, water wheel `clamp(flowScore,−1,1) × 8`, windmill `clamp(sails/8, 1, 16)`, motor default 16 RPM |
| Press timing | `press/PressingBehaviour.java` | cycle 240, `(int) lerp(clamp(\|rpm\|/512), 1, 60)` running ticks per tick; head travel 1 (world), 19/16 (belt), 22/16 (basin) |
| Block breaking | `base/BlockBreakingKineticBlockEntity.java` | breakSpeed = \|rpm\|/100, progress steps every hardness/breakSpeed ticks, break at 10 |
| Millstone | `millstone/MillstoneBlockEntity.java` | timer −= clamp(\|rpm\|/16, 1, 512) |
| Belt | `belt/BeltBlockEntity.java`, `BeltShapes.java` | item speed rpm/480 blocks/tick, belt surface at 13/16, max length 20 |
| Recipes | `src/generated/resources/data/create/recipe/*` | structure and several values for milling/crushing/pressing/mixing/compacting/cutting/item application/filling (own recipe tables, vanilla + CRAFTORIA items) |

## Known issues researched

* Create #8051 — mechanical arm desync / forgetting targets after chunk reload → arm targets persisted per position.
* Create #7622 — accessing unloaded chunks causes server hangs → never force-load, all block access guarded.
* Create #5026 — FPS drops with many animated blocks → client-side Molang animation + distance LOD + rotor toggle.
* r/CreateMod discussion on stress through unloaded chunks (possible stress duplication) → unloaded nodes count as absent.
* Reviews of Bedrock Create-style ports reporting machines frozen/powered after reloads → state always re-derived from the world.

## Bedrock platform facts used (verified)

* Stable script modules for 1.26.0: `@minecraft/server` 2.5.0, `@minecraft/server-ui` 2.0.0 (npm publish history; newer
  modules map to 1.26.10–1.26.50). `BlockDynamicPropertiesComponent` / block containers only exist from 2.10.0 (1.26.50) → not used.
* Official block-component schema for 1.26.0 (`bedrock-samples` v1.26.0.2): `minecraft:geometry` with `bone_visibility`
  (Molang on block states), `minecraft:material_instances` (one render method per block), collision box arrays (≤16,
  within −8..8 / 0..24), single selection box, `minecraft:transformation` (RH rotations; verified with wiki orientation tables),
  `minecraft:tick`, `minecraft:movable`, `minecraft:liquid_detection`.
* Custom components V2 (components keyed by name with parameters) — Microsoft Learn "Introducing Custom Components".
* Block geometry limits: 30×30×30 px, at least one pixel inside the unit block (bedrock.dev).
* Flipbook textures on custom blocks via material instances (Microsoft Learn "Create an Animated Block Texture").
* Molang: `query.time_stamp` (level time, used by vanilla fish/piglin animations), `query.frame_alpha`, `query.property`,
  `query.body_y_rotation` (vanilla player sleep animation cancels body yaw with `− query.body_y_rotation`), trig in degrees.
* Model conventions derived from Blockbench's Bedrock codec (`js/formats/bedrock/bedrock.js`): JSON X is mirrored, rotation
  X/Y negated, up/down UVs flipped; entities face −Z in model space (yaw 0 faces south).
* `minecraft:is_collidable` exists but Mojang documents it as unreliable for moving entities → contraption collision is
  provided by disassembling into real blocks at rest and by carrying riders.
* Custom entities render main-hand items through `rightArm`/`rightItem` bones (bedrock.dev "Holding Items").
