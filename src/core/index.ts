/**
 * Public library surface.
 *
 * Everything here is pure: no DOM, no I/O, no third-party dependencies, so it
 * runs unchanged in Node, in a worker, or in the page.
 */

export { analyse } from './analyse.ts';
export type {
  Analysis,
  AnalyseOptions,
  Climb,
  ProfilePoint,
  Result,
  TraceQuality,
} from './analyse.ts';
export { parseIgc, parseB, dm, chooseAltitude, parseDeclaration, assignRoles } from './parse.ts';
export { addKinematics, wrap, R_EARTH, G, KT, FT } from './kinematics.ts';
export { segment, runs } from './segment.ts';
export { findLaunch } from './launch.ts';
export { circleStats, perCircle, bestWindow } from './climbs.ts';
export type { CircleStats, PerCircle } from './climbs.ts';
export { estimateWind } from './wind.ts';
export type { Wind, WindEstimate } from './wind.ts';
export { Polar, loadPolar, solve3, solveN, sigma } from './polar.ts';
export type {
  PolarDb,
  PolarEntry,
  PolarMatch,
  PolarPoints,
  PublishedPolar,
  LoadPolarOptions,
} from './polar.ts';
export { analyseLeg, circuitEntry, CIRCUIT_M } from './legs.ts';
export { summariseTask, scoringPoints, haversine, bearing } from './task.ts';
export type { TaskLeg, TaskSummary } from './task.ts';
export type { Leg, LegKind } from './legs.ts';
export type {
  Fix,
  Header,
  Launch,
  ParsedIgc,
  Run,
  TaskDeclaration,
  TaskPoint,
  TaskRole,
} from './types.ts';
