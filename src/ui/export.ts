/**
 * The flight-page export bundle.
 *
 * This is the only interface between this app and anything that publishes a
 * flight page, so it is a published file format rather than an implementation
 * detail. It is specified in `docs/export-format.md`, and changes to it are
 * breaking. See that document before changing anything here.
 *
 * The bundle is a zip of:
 *   flight.json    every figure, versioned with schemaVersion
 *   trace.svg      plan view, static and themeable
 *   barogram.svg   altitude against time, static and themeable
 */

import type { Analysis, TaskPoint } from '../core/index.ts';
import { zip } from './zip.ts';
import { heightUnit, units } from './units.ts';

/** Bump on any breaking change to the shape of `flight.json`. */
export const SCHEMA_VERSION = 1;

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Seconds since midnight UTC to `HH:MM:SSZ`. */
function z(t: number): string {
  const s = Math.floor(t) % 86400;
  return (
    `${String(Math.floor(s / 3600)).padStart(2, '0')}:` +
    `${String(Math.floor(s / 60) % 60).padStart(2, '0')}:` +
    `${String(s % 60).padStart(2, '0')}Z`
  );
}

/** A date and a seconds-since-midnight to a full ISO instant, where possible. */
function iso(date: string | undefined, t: number): string | null {
  if (!date) return null;
  const days = Math.floor(t / 86400);
  const base = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(base)) return null;
  return new Date(base + (t % 86400) * 1000 + days * 86400000).toISOString().replace('.000', '');
}

const round = (x: number | null | undefined, dp = 3): number | null =>
  x === null || x === undefined || !Number.isFinite(x) ? null : Number(x.toFixed(dp));

/**
 * The trace checked against the declaration.
 *
 * `complete` is the flag a consumer must read before quoting `speedKmh`: the
 * speed is over the declared distance, so it only means anything when every
 * point was actually reached, in order. `zone` and `radiusM` are the
 * assumption the whole block rests on, and travel with it.
 */
function flown(a: Analysis): Record<string, unknown> | null {
  const t = a.result.task_flight;
  if (!t) return null;
  return {
    zone: t.zone,
    radiusM: t.radius_m,
    complete: t.complete,
    note: t.note,
    // True means no start crossing was found after release and the clock runs
    // from release itself, so `durationS` is an upper bound and `speedMs` a
    // lower one. Publish the speed with this or not at all.
    startAssumed: t.start_assumed,
    startTime: t.start === null ? null : z(t.start),
    finishTime: t.finish === null ? null : z(t.finish),
    durationS: t.duration_s === null ? null : Math.round(t.duration_s),
    speedMs: round(t.speed_ms, 3),
    turnpointsRounded: t.turnpoints_rounded,
    turnpointsDeclared: t.turnpoints_declared,
    points: t.points.map((p) => ({
      name: p.name,
      role: p.role,
      zone: p.zone,
      time: p.time === null ? null : z(p.time),
      closestM: round(p.closest_m, 1),
      closestAt: z(p.closest_at),
    })),
  };
}

/** A declared point, or null where the file did not carry one. */
const point = (p: TaskPoint | null): Record<string, unknown> | null =>
  p === null ? null : { name: p.name || null, lat: p.lat, lon: p.lon };

export interface ExportOptions {
  /** Original filename, recorded for provenance. */
  filename?: string;
  /** Include the per-fix profile. Large; off by default. */
  includeProfile?: boolean;
  generatedAt?: Date;
}

/** Build the `flight.json` object. Documented in docs/export-format.md. */
export function buildFlightJson(a: Analysis, opts: ExportOptions = {}): Record<string, unknown> {
  const r = a.result;
  const h = r.header;
  const q = r.trace.quality;
  const ts = r.task_summary;

  return {
    schemaVersion: SCHEMA_VERSION,
    generator: {
      name: 'igc-analyser',
      url: 'https://nealedj.github.io/igc-analyser/',
      generatedAt: (opts.generatedAt ?? new Date()).toISOString().replace(/\.\d+Z$/, 'Z'),
    },
    source: {
      filename: opts.filename ?? null,
      loggerId: h.logger_id ?? null,
      logger: h.logger ?? null,
      gps: h.gps ?? null,
      // The analysis is derived from positions and times only; the altitude
      // channel is the one input choice that changes every height on the page.
      altitudeSource: r.altitude_source,
    },
    flight: {
      date: h.date ?? null,
      glider: {
        type: h.glider_type ?? null,
        registration: h.glider_id ?? null,
        competitionId: h.competition_id || null,
      },
      pilot: h.pilot || null,
      crew2: h.crew2 || null,
      startTime: z(r.trace.start),
      endTime: z(r.trace.end),
      startInstant: iso(h.date, r.trace.start),
      endInstant: iso(h.date, r.trace.end),
      durationS: r.trace.duration_s,
      trackDistanceM: round(r.track_distance_m, 1),
      maxAltitudeM: r.trace.max_alt_m,
      landed: r.trace.landed,
    },
    launch: {
      takeoffTime: z(r.launch.takeoff),
      releaseTime: z(r.launch.release),
      type: r.launch.type,
      note: r.launch.note,
      // False means the release is the top of the initial climb, not a
      // detected speed change. Everything after release is measured from it,
      // so a page that quotes soaring time should say when this is an estimate.
      releaseConfident: r.launch.release_confident,
      // True means a person supplied the release time rather than the trace
      // yielding it. `releaseConfident` is true in that case too and cannot
      // tell the two apart, and they are different claims.
      releaseOverridden: r.launch.release_override,
    },
    task: ts
      ? {
          declared: true,
          shape: ts.shape,
          closed: ts.closed,
          // Start, turnpoints and finish only. The declared take-off and
          // landing are carried separately: adding them to the distance turns
          // a 300 km triangle into a four-leg task of some other length.
          distanceM: round(ts.distance_m, 1),
          turnpoints: ts.turnpoints,
          points: ts.points.map((p) => ({
            name: p.name || null,
            lat: p.lat,
            lon: p.lon,
            role: p.role ?? null,
          })),
          legs: ts.legs.map((l) => ({
            from: l.from,
            to: l.to,
            distanceM: round(l.distance_m, 1),
            bearingDeg: round(l.bearing_deg, 1),
          })),
          takeoff: point(ts.takeoff),
          landing: point(ts.landing),
          // What the trace did about the declaration, under the observation
          // zone the page was set to. Not a score: see docs/export-format.md.
          flown: flown(a),
          declaration: ts.declaration
            ? {
                description: ts.declaration.description || null,
                declaredDate: ts.declaration.declared_date ?? null,
                declaredTime:
                  ts.declaration.declared_time_s === undefined
                    ? null
                    : z(ts.declaration.declared_time_s),
                turnpoints: ts.declaration.turnpoints ?? null,
              }
            : null,
        }
      : {
          declared: false,
          shape: null,
          closed: null,
          distanceM: null,
          turnpoints: null,
          points: [],
          legs: [],
          takeoff: null,
          landing: null,
          flown: null,
          declaration: null,
        },
    phase: {
      circlingS: r.phase.circling_s,
      straightS: r.phase.straight_s,
      soaringS: r.phase.soaring_s,
      circlingFraction: round(r.phase.circling_fraction, 4),
      gainCirclingM: r.phase.gain_circling_m,
      meanCirclingRateMs: round(r.phase.mean_circling_rate_ms),
      workingBand: r.phase.working_band
        ? { bottomM: r.phase.working_band.bottom_m, topM: r.phase.working_band.top_m }
        : null,
      risingAirFraction: round(r.rising_air_fraction, 4),
    },
    wind: r.wind
      ? {
          speedMs: round(r.wind.speed_ms),
          fromDeg: round(r.wind.from_deg, 1),
          spreadMs: round(r.wind.spread_ms),
          // True when the per-climb estimates disagree by more than 8 kt. A
          // page quoting the wind should not quote it without this.
          unreliable: r.wind.unreliable,
          perClimb: r.wind.per_climb.map((w) => ({
            time: z(w.time),
            speedMs: round(w.speed_ms),
            fromDeg: round(w.from_deg, 1),
            circles: round(w.circles, 2),
          })),
        }
      : null,
    climbs: r.climbs.map((c, i) => ({
      index: i + 1,
      startTime: z(c.start),
      endTime: z(c.end),
      durationS: c.duration_s,
      gainM: c.gain_m,
      altBottomM: c.alt_bottom_m,
      altTopM: c.alt_top_m,
      avgClimbMs: round(c.avg_climb_ms),
      best30sMs: round(c.best_30s_ms),
      circles: round(c.circles, 2),
      direction: c.direction,
      // Null below about 1.5 circles: the glider was S-turning, and the
      // geometry describes something that did not happen.
      circleTimeS: c.circles >= 1.5 ? round(c.circle_time_s, 1) : null,
      radiusM: c.circles >= 1.5 ? round(c.radius_m, 1) : null,
      bankDeg: c.circles >= 1.5 ? round(c.bank_deg, 1) : null,
      airspeedKmh: round(c.airspeed_kmh, 1),
      perCircle: c.per_circle.map((p, k) => ({
        index: k + 1,
        startTime: z(p.start),
        durationS: p.duration_s,
        gainM: p.gain_m,
        climbMs: round(p.climb_ms),
        altM: p.alt_m,
      })),
    })),
    legs: r.legs.map((l) => ({
      startTime: z(l.start),
      endTime: z(l.end),
      durationS: l.duration_s,
      distanceM: round(l.distance_m, 1),
      heightChangeM: l.dh_m,
      altStartM: l.alt_start_m,
      altEndM: l.alt_end_m,
      /** Not wind-corrected. */
      ldOverGround: round(l.ld_over_ground, 1),
      meanIasKmh: round(l.mean_ias_kmh, 1),
      sdIasKmh: round(l.sd_ias_kmh, 1),
      /** Depends entirely on `polar` below. Never publish one without the other. */
      meanAirmassMs: round(l.mean_airmass_ms ?? null),
      fracRisingAir: round(l.frac_rising_air ?? null, 4),
      /** 'cruise', 'final glide' or 'circuit'. An open set: match, or default. */
      kind: l.kind ?? 'cruise',
      circuit: Boolean(l.circuit),
    })),
    polar: {
      name: r.polar.name,
      // How the polar was arrived at, in words. Any page showing an airmass
      // figure has to show this alongside it.
      note: r.polar.note,
      /** False means no glider was recognised and a generic was assumed. */
      matched: r.polar.matched,
      bestLd: round(r.polar.best_ld, 1),
      bestLdSpeedMs: round(r.polar.best_ld_speed_ms, 2),
      minSinkMs: round(r.polar.min_sink_ms),
      // The loading the published curve is for, and the loading it was scaled
      // to. `loadingKgM2` null means the curve was used as published; it is
      // the single largest assumption behind every airmass figure here, so it
      // travels with them rather than being inferred from `note`.
      referenceLoadingKgM2: round(r.polar.reference_loading_kg_m2, 1),
      loadingKgM2: round(r.polar.loading_kg_m2, 1),
    },
    quality: {
      fixes: q.fixes,
      medianIntervalS: q.median_interval_s,
      maxGapS: q.max_gap_s,
      gapsOver20s: q.gaps_over_20s,
      gapTotalS: q.gap_total_s,
      // True when the fix rate is too coarse for circle geometry to be a
      // measurement rather than an average.
      coarse: q.coarse,
      warnings: r.warnings,
    },
    figures: {
      trace: 'trace.svg',
      barogram: 'barogram.svg',
      // The figures are rendered in whatever the app was showing. Every number
      // in this file is SI regardless: metres, seconds, m/s, degrees.
      renderedUnits: units(),
      barogramHeightUnit: heightUnit(),
    },
    ...(opts.includeProfile
      ? {
          profile: r.profile.map((p) => [p.t, p.alt_m, p.lat, p.lon, p.circling ? 1 : 0]),
          profileColumns: ['t', 'altM', 'lat', 'lon', 'circling'],
        }
      : {}),
  };
}

/**
 * The figure styles, inlined into the exported SVG.
 *
 * Every colour is a custom property with a fallback, and nothing sets those
 * properties inside the SVG. So the file renders correctly on its own, and a
 * host page that defines `--igc-circling` on any ancestor themes it without
 * editing the markup.
 */
const FIGURE_CSS = `
.fig text { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.grid line { stroke: var(--igc-rule, #e2ded7); stroke-width: 1; }
.grid .grid-v { stroke: var(--igc-rule, #e2ded7); stroke-dasharray: 2 4; }
.axis-label { fill: var(--igc-faint, #8a867e); font-size: 10px; }
.axis-unit { fill: var(--igc-faint, #8a867e); font-size: 10px; font-style: italic; }
.baro-straight { stroke: var(--igc-straight, #2f6f8f); stroke-width: 1.4; fill: none; stroke-linejoin: round; }
.baro-circling { stroke: var(--igc-circling, #c2571a); stroke-width: 2.6; fill: none; stroke-linejoin: round; }
.trk-straight { stroke: var(--igc-straight, #2f6f8f); stroke-width: 1.2; fill: none; stroke-linejoin: round; }
.trk-circling { stroke: var(--igc-circling, #c2571a); stroke-width: 1.8; fill: none; stroke-linejoin: round; }
.vz-band-0 { stroke: var(--igc-vz-0, #6b1f1f); stroke-width: 1.3; fill: none; }
.vz-band-1 { stroke: var(--igc-vz-1, #b4534b); stroke-width: 1.3; fill: none; }
.vz-band-2 { stroke: var(--igc-vz-2, #d9a441); stroke-width: 1.3; fill: none; }
.vz-band-3 { stroke: var(--igc-vz-3, #a9bf4a); stroke-width: 1.3; fill: none; }
.vz-band-4 { stroke: var(--igc-vz-4, #58a55c); stroke-width: 1.5; fill: none; }
.vz-band-5 { stroke: var(--igc-vz-5, #2f8f6b); stroke-width: 1.7; fill: none; }
.vz-band-6 { stroke: var(--igc-vz-6, #16607f); stroke-width: 2; fill: none; }
.marker-release { stroke: var(--igc-faint, #8a867e); stroke-width: 1; stroke-dasharray: 3 3; }
.marker-text { fill: var(--igc-faint, #8a867e); font-size: 10px; }
.task-line { stroke: var(--igc-faint, #8a867e); stroke-width: 1.2; stroke-dasharray: 6 4; fill: none; }
.task-point { fill: none; stroke: var(--igc-faint, #8a867e); stroke-width: 1.4; }
.task-label { fill: var(--igc-faint, #8a867e); font-size: 10px; }
.mark-start { fill: var(--igc-ok, #2c6b45); }
.mark-release { fill: var(--igc-bg, #ffffff); stroke: var(--igc-fg, #1c1b19); stroke-width: 1.4; }
.mark-end { fill: var(--igc-sink, #a33a3a); }
.north { stroke: var(--igc-faint, #8a867e); stroke-width: 1.2; fill: none; }
.scale-bar line { stroke: var(--igc-dim, #5d5a54); stroke-width: 1.2; }
`.trim();

/** Elements the page adds for interaction, which have no place in the export. */
const INTERACTIVE = '.brush, .cursor, .readout, .trk-highlight, .trace-cursor';

/**
 * Serialise a figure as a standalone SVG: no scripts, no external references,
 * dimensions and viewBox set, and styles inlined.
 */
export function exportSvg(svg: SVGSVGElement, title: string, desc: string): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  for (const n of Array.from(clone.querySelectorAll(INTERACTIVE))) n.remove();
  for (const n of Array.from(clone.querySelectorAll('script'))) n.remove();
  // Interaction hooks and page-layout classes are meaningless in the file.
  clone.removeAttribute('style');
  clone.setAttribute('xmlns', SVG_NS);
  clone.setAttribute('role', 'img');

  const style = document.createElementNS(SVG_NS, 'style');
  style.textContent = FIGURE_CSS;
  const titleEl = document.createElementNS(SVG_NS, 'title');
  titleEl.textContent = title;
  const descEl = document.createElementNS(SVG_NS, 'desc');
  descEl.textContent = desc;
  clone.prepend(style);
  clone.prepend(descEl);
  clone.prepend(titleEl);

  const xml = new XMLSerializer().serializeToString(clone);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${xml}\n`;
}

export interface Figures {
  trace: SVGSVGElement;
  barogram: SVGSVGElement;
}

/** A filename stem: the date and glider, or the source file's own name. */
export function bundleName(a: Analysis): string {
  const h = a.result.header;
  const parts = [h.date, h.glider_id || h.glider_type].filter(Boolean);
  const stem = parts.length ? parts.join('-') : 'flight';
  return `${stem.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '')}-igc-analysis`;
}

export async function buildBundle(
  a: Analysis,
  figures: Figures,
  opts: ExportOptions = {},
): Promise<Blob> {
  const enc = new TextEncoder();
  const flight = buildFlightJson(a, opts);
  const glider = [a.result.header.glider_type, a.result.header.glider_id]
    .filter(Boolean)
    .join(' ');
  const when = a.result.header.date ?? 'an undated flight';

  return zip([
    { name: 'flight.json', data: enc.encode(`${JSON.stringify(flight, null, 2)}\n`) },
    {
      name: 'trace.svg',
      data: enc.encode(
        exportSvg(
          figures.trace,
          `Flight track, ${when}`,
          `Plan view of the flight track${glider ? ` of ${glider}` : ''} on ${when}, north up, ` +
            `equirectangular with the aspect corrected for latitude. Circling is drawn ` +
            `distinctly from straight flight. The declared task, where present, is dashed.`,
        ),
      ),
    },
    {
      name: 'barogram.svg',
      data: enc.encode(
        exportSvg(
          figures.barogram,
          `Barogram, ${when}`,
          `${a.result.altitude_source === 'pressure' ? 'Pressure' : 'GNSS'} altitude in ` +
            `${heightUnit() === 'ft' ? 'feet' : 'metres'} against time UTC` +
            `${glider ? ` for ${glider}` : ''} on ${when}. Circling is drawn heavier than ` +
            `straight flight.`,
        ),
      ),
    },
  ]);
}

/** Hand the bundle to the browser as a download. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
