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
export { parseIgc, parseB, dm, chooseAltitude } from './parse.ts';
export { addKinematics, wrap, R_EARTH, G, KT, FT } from './kinematics.ts';
export { segment, runs } from './segment.ts';
export { findLaunch } from './launch.ts';
export { circleStats, perCircle, bestWindow } from './climbs.ts';
export type { CircleStats, PerCircle } from './climbs.ts';
export { estimateWind } from './wind.ts';
export type { Wind, WindEstimate } from './wind.ts';
export { Polar, loadPolar, solve3, sigma } from './polar.ts';
export type { PolarDb, PolarMatch, PolarPoints, LoadPolarOptions } from './polar.ts';
export { analyseLeg } from './legs.ts';
export { summariseTask, haversine } from './task.ts';
export type { TaskLeg, TaskSummary } from './task.ts';
export type { Leg } from './legs.ts';
export type { Fix, Header, Launch, ParsedIgc, Run, TaskPoint } from './types.ts';
