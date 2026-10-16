// Smart placement (craftoria:orient custom component): chooses axis / facing like Create does.
import { BlockComponentPlayerPlaceBeforeEvent, BlockPermutation, Direction, Player } from '@minecraft/server';
import { AXIS_DIRS, Axis, DIR_AXIS, Dir, OPPOSITE, V3, dominantDir, dominantHorizontal, offset } from '../util/vec';
import { blockAt, getStates } from '../core/env';
import { ID, KINETIC_DEFS, S_ALT, S_AXIS, S_FACING, sideAxis } from '../kinetics/defs';

export const FACE_DIR: Record<string, Dir> = {
  [Direction.Down]: 'down', [Direction.Up]: 'up', [Direction.North]: 'north',
  [Direction.South]: 'south', [Direction.West]: 'west', [Direction.East]: 'east',
};

/** Blocks whose facing equals the clicked face (they attach to the block clicked). */
const ATTACH_TO_FACE = new Set([ID('hand_crank'), ID('andesite_funnel'), ID('brass_funnel'), ID('sail'), ID('sail_frame')]);
/** Blocks whose facing points toward the player's look direction instead of toward the player. */
const FACE_AWAY = new Set([ID('mechanical_bearing'), ID('windmill_bearing'), ID('mechanical_piston'), ID('encased_fan'), ID('mechanical_drill')]);

function lookDir(p: Player | undefined): V3 {
  try {
    return p ? p.getViewDirection() : { x: 0, y: 0, z: -1 };
  } catch {
    return { x: 0, y: 0, z: -1 };
  }
}

function withState(perm: BlockPermutation, name: string, value: string | boolean): BlockPermutation {
  try {
    return perm.withState(name as never, value as never);
  } catch {
    return perm;
  }
}

/** Does the block at `pos` expose a shaft on face `d`? */
function hasShaftTowards(dimId: string, pos: V3, d: Dir, getDim: (id: string) => import('@minecraft/server').Dimension): boolean {
  const b = blockAt(getDim(dimId), pos);
  if (!b) return false;
  const def = KINETIC_DEFS[b.typeId];
  if (!def) return false;
  try {
    return def.spec(getStates(b)).nodes.some((n) => n.shafts.includes(d));
  } catch {
    return false;
  }
}

export function beforePlace(e: BlockComponentPlayerPlaceBeforeEvent, mode: string): void {
  const face = FACE_DIR[e.face] ?? 'up';
  const player = e.player;
  const sneaking = !!player?.isSneaking;
  const look = lookDir(player);
  let perm = e.permutationToPlace;
  const typeId = perm.type.id;
  const pos = e.block.location;
  const dim = e.block.dimension;
  const against = offset(pos, OPPOSITE[face]);
  const getDim = () => dim;

  switch (mode) {
    case 'axis3': {
      let axis: Axis = DIR_AXIS[face];
      if (sneaking) axis = DIR_AXIS[dominantDir(look)];
      // cogs placed beside another cog copy its axis (meshing), like Create
      const ab = blockAt(dim, against);
      if (ab && (typeId === ID('cogwheel') || typeId === ID('large_cogwheel'))) {
        if (ab.typeId === ID('cogwheel') || ab.typeId === ID('large_cogwheel')) {
          const a = getStates(ab)[S_AXIS] as Axis | undefined;
          if (a && a !== DIR_AXIS[face]) axis = a;
        }
      }
      perm = withState(perm, S_AXIS, axis);
      break;
    }
    case 'haxis':
    case 'belt': {
      let axis: Axis;
      if (face === 'up' || face === 'down') {
        const h = dominantHorizontal(look);
        axis = DIR_AXIS[h] === 'x' ? 'z' : 'x'; // shaft runs left-right as seen by the player
      } else axis = DIR_AXIS[face];
      if (sneaking) axis = axis === 'x' ? 'z' : 'x';
      perm = withState(perm, S_AXIS, axis);
      break;
    }
    case 'facing6': {
      let f: Dir;
      if (ATTACH_TO_FACE.has(typeId)) f = face;
      else {
        f = OPPOSITE[dominantDir(look)];
        if (FACE_AWAY.has(typeId)) f = dominantDir(look);
        // smart: back side towards an adjacent shaft end (power input)
        const def = KINETIC_DEFS[typeId];
        if (def && !sneaking) {
          for (const d of ['down', 'up', 'north', 'south', 'west', 'east'] as Dir[]) {
            if (hasShaftTowards(dim.id, offset(pos, d), OPPOSITE[d], getDim)) {
              const candidate = OPPOSITE[d];
              const shafts = def.spec({ [S_FACING]: candidate }).nodes.flatMap((n) => n.shafts);
              if (shafts.includes(d)) {
                f = candidate;
                break;
              }
            }
          }
        }
        if (sneaking) f = OPPOSITE[f];
      }
      perm = withState(perm, S_FACING, f);
      // side-axis machines: choose alt so the side shafts line up with an adjacent shaft
      if (typeId === ID('mechanical_saw') || typeId === ID('deployer') || typeId === ID('mechanical_piston')) {
        for (const alt of [false, true]) {
          const a = sideAxis(f, alt);
          if (AXIS_DIRS[a].some((d) => hasShaftTowards(dim.id, offset(pos, d), OPPOSITE[d], getDim))) {
            perm = withState(perm, S_ALT, alt);
            break;
          }
        }
      }
      break;
    }
    case 'facing4': {
      const h = dominantHorizontal(look);
      perm = withState(perm, S_FACING, OPPOSITE[h]);
      break;
    }
    default:
  }
  e.permutationToPlace = perm;
}
