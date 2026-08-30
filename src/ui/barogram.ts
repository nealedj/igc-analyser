/**
 * Time against altitude, with circling picked out from straight flight.
 *
 * This is the most informative graphic in the tool: the phase split is far
 * easier to see than to read. Circling shows as a distinct stroke, so a
 * thermal day and a wave flight look different at a glance.
 *
 * Emitted as static SVG with no scripts, so the same markup can be exported
 * for a flight page. Interaction is attached afterwards, by the page.
 */

import type { Analysis } from '../core/index.ts';
import { el, scale, ticks, timeTicks } from './svg.ts';
import { climbUnit, height, heightUnit, heightValue, hm, units } from './units.ts';

export interface FigureOptions {
  width?: number;
  height?: number;
  /** Omit the interactive layer, for export. */
  static?: boolean;
}

export interface Barogram {
  svg: SVGSVGElement;
  /** Pixel x for a time, so callers can position their own overlays. */
  xOf: (t: number) => number;
  /** Time for a pixel x, for hit-testing a pointer. */
  tOf: (x: number) => number;
  plot: { left: number; right: number; top: number; bottom: number };
}

const M = { top: 14, right: 16, bottom: 30, left: 54 };

export function barogram(analysis: Analysis, opts: FigureOptions = {}): Barogram {
  const W = opts.width ?? 900;
  const H = opts.height ?? 280;
  const F = analysis.fixes;
  const t0 = F[0].t;
  const t1 = F[F.length - 1].t;

  let aMin = Infinity;
  let aMax = -Infinity;
  for (const f of F) {
    if (f.alt < aMin) aMin = f.alt;
    if (f.alt > aMax) aMax = f.alt;
  }
  // A little air above and below so the trace is not welded to the frame.
  const pad = Math.max(30, (aMax - aMin) * 0.06);
  aMin -= pad;
  aMax += pad;

  const x = scale(t0, t1, M.left, W - M.right);
  const y = scale(heightValue(aMin), heightValue(aMax), H - M.bottom, M.top);
  const yA = (m: number) => y(heightValue(m));

  const svg = el('svg', {
    viewBox: `0 0 ${W} ${H}`,
    width: W,
    height: H,
    class: 'fig barogram',
    role: 'img',
    'aria-label': 'Barogram: altitude against time, with circling distinguished from straight flight',
    xmlns: 'http://www.w3.org/2000/svg',
    preserveAspectRatio: 'xMidYMid meet',
  });

  // ------------------------------------------------------------------ axes
  const grid = el('g', { class: 'grid' });
  for (const v of ticks(heightValue(aMin), heightValue(aMax), 5)) {
    const yy = y(v);
    if (yy < M.top - 1 || yy > H - M.bottom + 1) continue;
    grid.append(el('line', { x1: M.left, x2: W - M.right, y1: yy, y2: yy }));
    grid.append(
      el(
        'text',
        { x: M.left - 8, y: yy + 4, class: 'axis-label', 'text-anchor': 'end' },
        Math.round(v).toLocaleString('en-GB'),
      ),
    );
  }
  for (const v of timeTicks(t0, t1)) {
    const xx = x(v);
    grid.append(el('line', { x1: xx, x2: xx, y1: M.top, y2: H - M.bottom, class: 'grid-v' }));
    grid.append(
      el('text', { x: xx, y: H - M.bottom + 16, class: 'axis-label', 'text-anchor': 'middle' }, hm(v)),
    );
  }
  svg.append(grid);
  svg.append(
    el(
      'text',
      { x: M.left - 8, y: M.top - 3, class: 'axis-unit', 'text-anchor': 'end' },
      heightUnit(),
    ),
  );
  svg.append(
    el(
      'text',
      { x: W - M.right, y: H - 6, class: 'axis-unit', 'text-anchor': 'end' },
      'time UTC',
    ),
  );

  // ------------------------------------------------------------ the trace
  // One path per run, so circling and straight flight are separately styled
  // and separately hoverable, and so the export carries the same structure.
  const traceG = el('g', { class: 'trace-lines' });
  for (const r of analysis.runs) {
    // Runs share an endpoint so the line does not break between phases.
    const from = r.a;
    const to = Math.min(r.b + 1, F.length - 1);
    let d = '';
    for (let i = from; i <= to; i++) {
      d += `${i === from ? 'M' : 'L'}${x(F[i].t).toFixed(1)} ${yA(F[i].alt).toFixed(1)}`;
    }
    traceG.append(
      el('path', {
        d,
        class: r.circ ? 'baro-circling' : 'baro-straight',
        fill: 'none',
      }),
    );
  }
  svg.append(traceG);

  // Release marker: the point everything after is measured from.
  const rel = analysis.result.launch.release;
  const relFix = F.find((f) => f.t >= rel);
  if (relFix) {
    svg.append(
      el('line', {
        x1: x(relFix.t), x2: x(relFix.t), y1: M.top, y2: H - M.bottom,
        class: 'marker-release',
      }),
    );
    svg.append(
      el(
        'text',
        { x: x(relFix.t) + 4, y: M.top + 10, class: 'marker-text' },
        analysis.result.launch.release_confident ? 'release' : 'release (est)',
      ),
    );
  }

  return {
    svg,
    xOf: x,
    tOf: (px: number) => t0 + ((px - M.left) / (W - M.right - M.left)) * (t1 - t0),
    plot: { left: M.left, right: W - M.right, top: M.top, bottom: H - M.bottom },
  };
}

/** A one-line caption stating what the figure shows and in what units. */
export function barogramCaption(analysis: Analysis): string {
  const q = analysis.result.trace.quality;
  const src = analysis.result.altitude_source === 'pressure' ? 'pressure altitude' : 'GNSS altitude';
  return (
    `${src}, ${units() === 'imperial' ? 'feet' : 'metres'}, against time UTC. ` +
    `Circling is drawn heavier than straight flight. ` +
    `${q.fixes.toLocaleString('en-GB')} fixes at a median of ${q.median_interval_s} s. ` +
    `Climb rates elsewhere on this page are in ${climbUnit()}.`
  );
}

/** Height as a string, re-exported so callers need one import for the figure. */
export { height };
