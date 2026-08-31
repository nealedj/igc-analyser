/**
 * Places where the TypeScript port deliberately differs from the Python
 * oracle, and therefore where a golden-fixture mismatch is expected.
 *
 * Every entry here must have a matching section in DIVERGENCE.md explaining
 * why. Nothing else is allowed to differ: silent divergence is a defect.
 */

export interface Divergence {
  /** Section heading in DIVERGENCE.md. */
  reason: string;
  /** Fixture basenames this applies to, without the extension. */
  fixtures: string[];
  /**
   * Dotted paths into the oracle's JSON that may differ. A path matches
   * itself and everything beneath it; `[]` stands in for any array index.
   */
  paths: string[];
}

export const DIVERGENCES: Divergence[] = [
  {
    reason: 'C-record declaration header parsed as a task point',
    fixtures: ['thermal-day', 'declared-300k'],
    paths: ['task'],
  },
  {
    reason: 'Polar matched by first key rather than longest',
    fixtures: ['wave'],
    // Only the airmass columns move: the polar changes, nothing else does.
    paths: ['legs'],
  },
  {
    reason: 'Midnight rollover defeated by sorting before unwrapping',
    fixtures: ['midnight-rollover'],
    // The whole analysis moves, because every fix time moves.
    paths: ['launch', 'phase', 'wind', 'climbs', 'legs', 'profile', 'track_distance_m'],
  },
];

/** True when `path` is a sanctioned divergence for `fixture`. */
export function isDivergent(fixture: string, path: string): boolean {
  const norm = path.replace(/\[\d+\]/g, '[]');
  return DIVERGENCES.some(
    (d) =>
      d.fixtures.includes(fixture) &&
      d.paths.some((p) => norm === p || norm.startsWith(`${p}.`) || norm.startsWith(`${p}[`)),
  );
}
