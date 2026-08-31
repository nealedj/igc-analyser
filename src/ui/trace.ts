/**
 * Plan view of the track: equirectangular, north up, latitude-corrected.
 *
 * No basemap. There is nothing to attribute, nothing to fetch at runtime, and
 * the figure stays readable when it is pulled out into a static flight page.
 * A scale bar carries the distance instead of a tile grid.
 */

import type { Analysis } from '../core/index.ts';
import { el } from './svg.ts';
import { fmt } from './units.ts';

export type TraceColouring = 'phase' | 'climb';

export interface TraceOptions {
  width?: number;
  height?: number;
  colourBy?: TraceColouring;
}

export interface Trace {
  svg: SVGSVGElement;
  /** Projected position of a fix index, for overlays. */
  at: (i: number) => { x: number; y: number };
}

const M = 18;
/** Vertical climb-rate bands, m/s, for the climb colouring. */
const BANDS = [-2.5, -1, 0, 1, 2, 3];

export function trace(analysis: Analysis, opts: TraceOptions = {}): Trace {
  const W = opts.width ?? 900;
  const colourBy = opts.colourBy ?? 'phase';
  const F = analysis.fixes;

  let latMin = Infinity, latMax = -Infinity, lonMin = Infinity, lonMax = -Infinity;
  for (const f of F) {
    if (f.lat < latMin) latMin = f.lat;
    if (f.lat > latMax) latMax = f.lat;
    if (f.lon < lonMin) lonMin = f.lon;
    if (f.lon > lonMax) lonMax = f.lon;
  }
  // Include the task, so a declared task is never drawn off the edge. Only the
  // scoring points: the declared take-off and landing are where the glider was
  // expected to be on the ground, not part of the course.
  const taskPoints = analysis.result.task_summary?.points ?? [];
  for (const t of taskPoints) {
    latMin = Math.min(latMin, t.lat); latMax = Math.max(latMax, t.lat);
    lonMin = Math.min(lonMin, t.lon); lonMax = Math.max(lonMax, t.lon);
  }

  // Equirectangular with the aspect corrected for latitude, so a circle in the
  // air is a circle on the page rather than an ellipse.
  const latMid = (latMin + latMax) / 2;
  const kx = Math.cos((latMid * Math.PI) / 180);
  const spanX = Math.max(1e-6, (lonMax - lonMin) * kx);
  const spanY = Math.max(1e-6, latMax - latMin);
  const pad = 0.04;

  // The figure takes its aspect from the flight rather than the other way
  // round. Fitting a tall out-and-back into a fixed landscape box wastes most
  // of the width and shrinks the scale for nothing, so the scale is chosen
  // first, against generous bounds, and the viewBox is then cut to the
  // content. Floors keep a local soaring flight from becoming a sliver.
  const maxW = W - 2 * M;
  const maxH = (opts.height ?? 620) - 2 * M;
  const s = Math.min(maxW / (spanX * (1 + pad)), maxH / (spanY * (1 + pad)));
  const drawnW = Math.max(240, spanX * s);
  const drawnH = Math.max(200, spanY * s);
  const W_ = Math.round(drawnW + 2 * M);
  const H = Math.round(drawnH + 2 * M);
  const offX = M + (drawnW - spanX * s) / 2;
  const offY = M + (drawnH - spanY * s) / 2;

  const px = (lon: number) => offX + (lon - lonMin) * kx * s;
  // North up: latitude increases upwards, so the y axis is inverted.
  const py = (lat: number) => offY + (latMax - lat) * s;

  const svg = el('svg', {
    viewBox: `0 0 ${W_} ${H}`,
    width: W_,
    height: H,
    class: 'fig trace',
    role: 'img',
    'aria-label': 'Plan view of the flight track, north up',
    xmlns: 'http://www.w3.org/2000/svg',
    preserveAspectRatio: 'xMidYMid meet',
  });

  // ------------------------------------------------------- declared task
  const task = taskPoints;
  if (task.length >= 2) {
    const g = el('g', { class: 'task' });
    let d = '';
    task.forEach((t, i) => {
      d += `${i === 0 ? 'M' : 'L'}${px(t.lon).toFixed(1)} ${py(t.lat).toFixed(1)}`;
    });
    g.append(el('path', { d, class: 'task-line', fill: 'none' }));
    for (const t of task) {
      g.append(el('circle', { cx: px(t.lon), cy: py(t.lat), r: 4, class: 'task-point' }));
      if (t.name) {
        // The viewBox is cut to the track, so a label on a turnpoint near the
        // right edge would be clipped. Hang it off the inside instead.
        const flip = px(t.lon) > W_ * 0.6;
        g.append(
          el(
            'text',
            {
              x: px(t.lon) + (flip ? -7 : 7),
              y: py(t.lat) - 7,
              class: 'task-label',
              'text-anchor': flip ? 'end' : 'start',
            },
            t.name,
          ),
        );
      }
    }
    svg.append(g);
  }

  // ------------------------------------------------------------ the track
  const g = el('g', { class: 'track' });
  if (colourBy === 'phase') {
    for (const r of analysis.runs) {
      const to = Math.min(r.b + 1, F.length - 1);
      let d = '';
      for (let i = r.a; i <= to; i++) {
        d += `${i === r.a ? 'M' : 'L'}${px(F[i].lon).toFixed(1)} ${py(F[i].lat).toFixed(1)}`;
      }
      g.append(el('path', { d, class: r.circ ? 'trk-circling' : 'trk-straight', fill: 'none' }));
    }
  } else {
    // One path per climb-rate band, so the whole track is at most seven paths
    // rather than one per fix. Vertical rate is smoothed over the step either
    // side; a raw single-step rate on a 1 Hz trace is mostly noise.
    const buckets: string[][] = BANDS.map(() => []).concat([[]]);
    let cur = -1;
    let d = '';
    for (let i = 0; i < F.length - 1; i++) {
      const vz = smoothVz(F, i);
      let band = 0;
      while (band < BANDS.length && vz > BANDS[band]) band++;
      if (band !== cur) {
        if (d && cur >= 0) buckets[cur].push(d);
        cur = band;
        d = `M${px(F[i].lon).toFixed(1)} ${py(F[i].lat).toFixed(1)}`;
      }
      d += `L${px(F[i + 1].lon).toFixed(1)} ${py(F[i + 1].lat).toFixed(1)}`;
    }
    if (d && cur >= 0) buckets[cur].push(d);
    buckets.forEach((paths, band) => {
      if (paths.length) {
        g.append(el('path', { d: paths.join(' '), class: `vz-band-${band}`, fill: 'none' }));
      }
    });
  }
  svg.append(g);

  // ------------------------------------------------- launch, release, land
  const rel = F.find((f) => f.t >= analysis.result.launch.release);
  const marks = el('g', { class: 'trace-marks' });
  marks.append(el('circle', { cx: px(F[0].lon), cy: py(F[0].lat), r: 4, class: 'mark-start' }));
  if (rel) marks.append(el('circle', { cx: px(rel.lon), cy: py(rel.lat), r: 3.5, class: 'mark-release' }));
  const last = F[F.length - 1];
  marks.append(el('rect', { x: px(last.lon) - 3.5, y: py(last.lat) - 3.5, width: 7, height: 7, class: 'mark-end' }));
  svg.append(marks);

  // ----------------------------------------------------- north and scale
  const nx = W_ - M - 12;
  const ny = M + 8;
  svg.append(
    el('path', { d: `M${nx} ${ny + 18}L${nx} ${ny}M${nx - 4} ${ny + 5}L${nx} ${ny}L${nx + 4} ${ny + 5}`, class: 'north' }),
    el('text', { x: nx, y: ny + 30, class: 'axis-label', 'text-anchor': 'middle' }, 'N'),
  );
  svg.append(scaleBar(s, latMid, M, H - M - 6));

  return {
    svg,
    at: (i: number) => ({ x: px(F[i].lon), y: py(F[i].lat) }),
  };
}

/** Vertical rate over the neighbouring steps: a single step is mostly noise. */
function smoothVz(F: Analysis['fixes'], i: number): number {
  const lo = Math.max(0, i - 2);
  const hi = Math.min(F.length - 1, i + 3);
  const dt = F[hi].t - F[lo].t;
  return dt > 0 ? (F[hi].alt - F[lo].alt) / dt : 0;
}

/** A bar of a round number of kilometres, sized to about a fifth of the width. */
function scaleBar(s: number, latMid: number, x: number, y: number): SVGGElement {
  // s is pixels per degree of latitude; 1 degree is about 111.32 km.
  const pxPerKm = s / 111.32;
  const target = 150 / pxPerKm;
  const mag = 10 ** Math.floor(Math.log10(Math.max(target, 1e-6)));
  const norm = target / mag;
  const km = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
  const w = km * pxPerKm;
  void latMid;
  const g = el('g', { class: 'scale-bar' });
  g.append(el('line', { x1: x, x2: x + w, y1: y, y2: y }));
  g.append(el('line', { x1: x, x2: x, y1: y - 4, y2: y + 4 }));
  g.append(el('line', { x1: x + w, x2: x + w, y1: y - 4, y2: y + 4 }));
  g.append(
    el('text', { x: x + w / 2, y: y - 7, class: 'axis-label', 'text-anchor': 'middle' },
      `${fmt(km, km < 1 ? 1 : 0)} km`),
  );
  return g;
}

/** Legend entries for the climb-rate colouring, low to high. */
export function climbBandLabels(): { cls: string; label: string }[] {
  const out: { cls: string; label: string }[] = [];
  for (let i = 0; i <= BANDS.length; i++) {
    const lo = i === 0 ? null : BANDS[i - 1];
    const hi = i === BANDS.length ? null : BANDS[i];
    out.push({
      cls: `vz-band-${i}`,
      label: lo === null ? `below ${hi}` : hi === null ? `above ${lo}` : `${lo} to ${hi}`,
    });
  }
  return out;
}

export { BANDS };
