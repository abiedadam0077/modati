// Kinetic node specification types (pure).
import type { Axis, Dir } from '../util/vec';

/** One rotating rigid body inside a block. Speeds are signed RPM about +axis. */
export interface KNodeSpec {
  /** sub-node id ('' for single-body blocks, 'a'/'b' for split blocks such as clutch / gearshift) */
  sub: string;
  /** reference axis for the sign of this node's speed */
  axis: Axis;
  /** faces carrying a shaft connection */
  shafts: Dir[];
  /** speed of the shaft part on a face, about +axis(face), = factor * nodeSpeed (default 1) */
  faceFactor?: Partial<Record<Dir, number>>;
  /** cog meshing behaviour (cog axis = node axis) */
  cog?: 'small' | 'large';
  /** belt segment: joins neighbouring belt segments along the run axis */
  beltRun?: Axis;
  /** stress impact in SU per RPM when this node turns */
  impact: number;
  /** stress capacity in SU per RPM when this node generates */
  capacity: number;
}

export interface KBlockSpec {
  nodes: KNodeSpec[];
  /** fixed internal links between sub-nodes, ratio = speed(b)/speed(a); omitted link = disconnected */
  internal?: { a: string; b: string; ratio: number }[];
}

export interface KEdge {
  to: string; // node key
  ratio: number; // speed(to) = speed(from) * ratio
}

export type NetStatus = 'stopped' | 'running' | 'overstressed' | 'conflict' | 'overspeed' | 'too_large';

export interface GeneratorInput {
  /** signed RPM about the node axis */
  speed: number;
  /** SU per RPM */
  capacity: number;
}

export interface SolveResult {
  status: NetStatus;
  speeds: Map<string, number>;
  capacity: number;
  impact: number;
  /** key of a node involved in a conflict (for particles / goggles) */
  faultAt?: string;
  /** root source key */
  root?: string;
}
