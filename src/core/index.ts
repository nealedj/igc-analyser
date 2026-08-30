/**
 * Public library surface.
 *
 * Everything here is pure: no DOM, no I/O, no third-party dependencies, so it
 * runs unchanged in Node, in a worker, or in the page.
 */

export { analyse } from './analyse.ts';
export type { Analysis, AnalyseOptions, ProfilePoint, Result, TraceQuality } from './analyse.ts';
export { parseIgc, parseB, dm, chooseAltitude } from './parse.ts';
export { addKinematics, wrap, R_EARTH, G, KT, FT } from './kinematics.ts';
export { segment, runs } from './segment.ts';
export { findLaunch } from './launch.ts';
export type { Fix, Header, Launch, ParsedIgc, Run, TaskPoint } from './types.ts';
