/** Shared shapes for the analysis. All distances metres, times seconds UTC. */

/** A single B-record fix, plus everything derived from it. */
export interface Fix {
  /** Seconds since midnight UTC, with a day added after a rollover. */
  t: number;
  lat: number;
  lon: number;
  /** Pressure altitude, metres, as logged. */
  palt: number;
  /** GNSS altitude, metres, as logged. */
  galt: number;
  /** True for a 3D fix ('A'), false for position-only ('V'). */
  valid: boolean;

  /** The altitude channel actually used, chosen once per flight. */
  alt: number;

  /** Local equirectangular projection about the trace centroid. */
  x: number;
  y: number;
  /** Seconds to the next fix; 0 at the last fix. */
  dt: number;
  dx: number;
  dy: number;
  /** Ground distance to the next fix. */
  step: number;
  vx: number;
  vy: number;
  /** Ground speed, m/s. */
  gs: number;
  /** Vertical rate to the next fix, m/s. */
  vz: number;
  /** dt is positive and short enough to differentiate across. */
  good: boolean;
  /** Track over the ground, degrees; null at the two end fixes. */
  trk: number | null;
  /** Turn rate, deg/s; null where it cannot be formed. */
  tr: number | null;
  /** Turn rate smoothed over a +/-10 s window. */
  trs: number;
  /** Classified as circling rather than straight flight. */
  circ: boolean;
}

export interface Header {
  date?: string;
  glider_type?: string;
  glider_id?: string;
  competition_id?: string;
  pilot?: string;
  crew2?: string;
  logger?: string;
  gps?: string;
  timezone?: string;
  logger_id?: string;
}

/**
 * What a `C` record is in the declaration.
 *
 * An IGC declaration is take-off, start, the turnpoints, finish, landing - in
 * that order and nothing else. Only start, turn and finish are the task; the
 * other two are where the glider was expected to leave and arrive, and adding
 * them to the distance inflates a 300 km triangle by however far the launch
 * point is from the start.
 */
export type TaskRole = 'takeoff' | 'start' | 'turn' | 'finish' | 'landing';

export interface TaskPoint {
  lat: number;
  lon: number;
  name: string;
  /** Absent where the C block was too irregular to assign roles by position. */
  role?: TaskRole;
}

/** The header that opens a `C` block: what was declared, and when. */
export interface TaskDeclaration {
  /** Free text after the fixed fields. Often the task name, often empty. */
  description: string;
  /** When the declaration was made, `YYYY-MM-DD`, where the header carries it. */
  declared_date?: string;
  /** Time of declaration, seconds since midnight UTC. */
  declared_time_s?: number;
  /** Turnpoints the header says the task has, excluding start and finish. */
  turnpoints?: number;
}

export interface ParsedIgc {
  header: Header;
  fixes: Fix[];
  task: TaskPoint[];
  /** Null when the file declares no task, or opens the block with no header. */
  declaration: TaskDeclaration | null;
  warnings: string[];
}

/** A maximal stretch of fixes sharing one phase. `b` is inclusive. */
export interface Run {
  a: number;
  b: number;
  circ: boolean;
}

export interface Launch {
  /** Index of the take-off fix. */
  takeoff: number;
  /** Index of the release fix; an estimate unless `confident`. */
  release: number;
  type: string;
  note: string;
  /** False when release is the top of the initial climb, not a speed change. */
  confident: boolean;
}
