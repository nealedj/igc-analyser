/**
 * The climb and leg tables, and the circle-by-circle breakdown.
 *
 * Rows carry their time range so the page can scrub the figures to them, and
 * the climb table is preceded by the geometry caveat when the trace is too
 * coarse for the geometry columns to mean anything.
 */

import type { Analysis, Climb } from '../core/index.ts';
import type { Leg } from '../core/index.ts';
import { h } from './dom.ts';
import {
  airspeed, climb as climbFmt, climbUnit, distance, duration, fmt, height, hms, percent, windSpeed,
} from './units.ts';

export interface TableHandlers {
  /** Called when a row is chosen, to scrub the figures to that span. */
  onSelect?: (span: { start: number; end: number } | null) => void;
}

function row(cells: (string | Node)[], attrs: Record<string, string> = {}): HTMLElement {
  return h('tr', attrs, ...cells.map((c) => h('td', {}, c)));
}

function table(head: string[], rows: HTMLElement[], cls = ''): HTMLElement {
  return h(
    'div',
    { class: 'table-scroll' },
    h(
      'table',
      { class: `data ${cls}` },
      h('thead', {}, h('tr', {}, ...head.map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', {}, ...rows),
    ),
  );
}

/** Climbs, worst-case caveat attached when the trace cannot support geometry. */
export function climbTable(a: Analysis, on: TableHandlers = {}): HTMLElement {
  const climbs = a.result.climbs;
  if (climbs.length === 0) {
    return h(
      'section',
      { class: 'panel' },
      h('h2', {}, 'Climbs'),
      h('p', { class: 'lede' }, 'No circling climbs after release. For a ridge or wave flight that is the finding, not a gap.'),
    );
  }

  const coarse = a.result.trace.quality.coarse;
  const rows = climbs.map((c, i) => {
    const geometry = c.circles >= 1.5;
    const cells: (string | Node)[] = [
      String(i + 1),
      hms(c.start),
      duration(c.duration_s),
      height(c.gain_m),
      climbFmt(c.avg_climb_ms),
      c.best_30s_ms === null ? '-' : climbFmt(c.best_30s_ms),
      fmt(c.circles, 1),
      c.direction,
      // Below about 1.5 circles the glider was S-turning, not circling: the
      // geometry columns describe something that did not happen.
      geometry && c.circle_time_s !== null ? `${fmt(c.circle_time_s, 0)} s` : '-',
      geometry && c.bank_deg !== null ? `${fmt(c.bank_deg, 0)}°` : '-',
      geometry && c.radius_m !== null ? `${fmt(c.radius_m, 0)} m` : '-',
      airspeed(c.airspeed_kmh / 3.6),
    ];
    const tr = row(cells, { class: geometry ? 'clickable' : 'clickable thin', tabindex: '0' });
    const select = () => on.onSelect?.({ start: c.start, end: c.end });
    tr.addEventListener('click', select);
    tr.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') select();
    });
    return tr;
  });

  const thin = climbs.filter((c) => c.circles < 1.5).length;

  return h(
    'section',
    { class: 'panel', 'aria-labelledby': 'climbs-h' },
    h('h2', { id: 'climbs-h' }, 'Climbs'),
    coarse
      ? h(
          'p',
          { class: 'caveat' },
          'This trace is too coarse for the geometry columns to be a measurement. ' +
            'Circle time, bank and radius below are averages across each whole climb. ' +
            'Read the rates, not the shape.',
        )
      : null,
    thin > 0
      ? h(
          'p',
          { class: 'caveat' },
          `${thin} row${thin === 1 ? '' : 's'} below turned less than 1.5 circles. ` +
            'That is S-turning or a single correction, not circling; the geometry columns are left blank.',
        )
      : null,
    table(
      ['#', 'Time', 'Dur', 'Gain', 'Avg', 'Best 30s', 'Circles', 'Dir', 't/360', 'Bank', 'Radius', 'IAS'],
      rows,
    ),
    h('p', { class: 'caption' }, 'Click a climb to scrub both figures to it. Click again to clear.'),
  );
}

/** Circle by circle, where there are enough circles for the sequence to read. */
export function perCirclePanel(a: Analysis): HTMLElement | null {
  const detail = a.result.climbs
    .map((c, i) => ({ c, i: i + 1 }))
    .filter((d) => d.c.per_circle.length >= 2);
  if (detail.length === 0) return null;

  const wind = a.result.wind;
  const blocks = detail.map(({ c, i }) => {
    const rows = c.per_circle.map((p, k) => {
      const prev = k > 0 ? c.per_circle[k - 1] : null;
      let drift = '-';
      if (prev) {
        const dx = p.cx - prev.cx;
        const dy = p.cy - prev.cy;
        const dt = Math.max(1, p.ct - prev.ct);
        drift = `${fmt(Math.hypot(dx, dy), 0)} m (${windSpeed(Math.hypot(dx, dy) / dt)})`;
      }
      return row([String(k + 1), `${p.duration_s} s`, climbFmt(p.climb_ms), height(p.alt_m), drift]);
    });
    // Collapsed by default: a good day is a hundred circles, and unrolling all
    // of them buries the tables that come after.
    return h(
      'details',
      { class: 'circle-block' },
      h(
        'summary',
        {},
        `Climb ${i} at ${hms(c.start)} - ${c.per_circle.length} circles, ${trend(c)}`,
      ),
      table(['#', 'Dur', 'Climb', 'From', 'Centre moved'], rows, 'compact'),
    );
  });

  return h(
    'section',
    { class: 'panel', 'aria-labelledby': 'circles-h' },
    h('h2', { id: 'circles-h' }, 'Circle by circle'),
    h(
      'p',
      { class: 'lede' },
      'A sequence that improves is good centring. One that decays near the top of the ' +
        'band usually means the thermal is dying, not that the pilot lost it. One that ' +
        'oscillates suggests the core was never found.' +
        (wind
          ? ` Drift matching the ${windSpeed(wind.speed_ms)} wind is drifting with the thermal, which is correct; much more than that is the circle being moved deliberately.`
          : ''),
    ),
    ...blocks,
  );
}

/** Whether the per-circle rates improved, decayed or wandered. */
function trend(c: Climb): string {
  const r = c.per_circle.map((p) => p.climb_ms);
  if (r.length < 3) return `${fmt(r.length, 0)} circles`;
  const firstHalf = r.slice(0, Math.floor(r.length / 2));
  const lastHalf = r.slice(Math.ceil(r.length / 2));
  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const delta = avg(lastHalf) - avg(firstHalf);
  const swing = Math.max(...r) - Math.min(...r);
  if (Math.abs(delta) < 0.15 && swing > 0.9) return 'rates oscillate';
  if (delta > 0.2) return 'rates improve';
  if (delta < -0.2) return 'rates decay';
  return 'rates steady';
}

/** Straight legs and their airmass balance. */
export function legTable(a: Analysis, on: TableHandlers = {}): HTMLElement {
  const legs = a.result.legs;
  const polar = a.result.polar;

  if (legs.length === 0) {
    return h(
      'section',
      { class: 'panel' },
      h('h2', {}, 'Straight legs'),
      h('p', { class: 'lede' }, 'No straight legs over a minute after release.'),
    );
  }

  const rows = legs.map((l: Leg) => {
    const cells: (string | Node)[] = [
      `${hms(l.start)}-${hms(l.end).slice(3)}`,
      duration(l.duration_s),
      distance(l.distance_m, 1),
      height(l.dh_m),
      l.ld_over_ground === null ? '-' : `${fmt(l.ld_over_ground, 0)}:1`,
      l.mean_ias_kmh === null ? '-' : `${fmt(l.mean_ias_kmh, 0)}`,
      l.sd_ias_kmh === null ? '-' : fmt(l.sd_ias_kmh, 0),
      l.mean_airmass_ms === undefined ? '-' : climbFmt(l.mean_airmass_ms),
      l.frac_rising_air === undefined ? '-' : percent(l.frac_rising_air),
      l.kind && l.kind !== 'cruise' ? l.kind : '',
    ];
    const tr = row(cells, { class: `clickable${l.circuit ? ' muted' : ''}`, tabindex: '0' });
    const select = () => on.onSelect?.({ start: l.start, end: l.end });
    tr.addEventListener('click', select);
    tr.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') select();
    });
    return tr;
  });

  return h(
    'section',
    { class: 'panel', 'aria-labelledby': 'legs-h' },
    h('h2', { id: 'legs-h' }, 'Straight legs'),
    h(
      'p',
      { class: 'caveat' },
      `Airmass is the vertical motion of the air the glider flew through, after ` +
        `subtracting polar sink. It assumes ${polar.name ?? 'no polar'}` +
        (polar.matched ? '' : ', which is a guess') +
        (polar.best_ld !== null ? ` at ${fmt(polar.best_ld, 0)}:1` : '') +
        `, and the flight-mean wind. Crosswind legs are worst affected. ` +
        `L/D over the ground is not wind-corrected.`,
    ),
    table(
      ['Time', 'Dur', 'Distance', 'Height', 'L/D gnd', 'IAS km/h', 'sd', `Airmass ${climbUnit()}`, 'Rising', ''],
      rows,
    ),
    legs.some((l) => l.kind === 'final glide')
      ? h(
          'p',
          { class: 'caption' },
          'The final glide and the circuit are separate rows. The run from the top of ' +
            'the glide to the ground is one stretch of straight flight in the trace, ' +
            'and reported whole it reads as a very long landing; it is cut where the ' +
            'glider settled below 1,000 ft above the field. Only the circuit is ' +
            'excluded from the rising-air figure - a final glide samples the day like ' +
            'any other leg.',
        )
      : null,
    a.result.rising_air_fraction !== null
      ? h(
          'p',
          { class: 'caption' },
          `Straight flight was in rising air ${percent(a.result.rising_air_fraction)} of the time` +
            `${legs.some((l) => l.circuit) ? ', circuit legs excluded' : ''}. ` +
            `A small sd (under about 10 km/h) is a steady cruise; a large one is either ` +
            `dolphin flying or inattention, and the rising column says which.`,
        )
      : null,
  );
}

/** Per-climb wind estimates, with the circle count that backs each one. */
export function windPanel(a: Analysis): HTMLElement | null {
  const w = a.result.wind;
  if (!w) return null;
  const rows = w.per_climb.map((e) =>
    row([hms(e.time), windSpeed(e.speed_ms), `${fmt(e.from_deg, 0)}°`, fmt(e.circles, 1)]),
  );
  return h(
    'section',
    { class: 'panel', 'aria-labelledby': 'wind-h' },
    h('h2', { id: 'wind-h' }, 'Wind from circle drift'),
    h(
      'p',
      { class: 'lede' },
      `Mean ${windSpeed(w.speed_ms)} from ${fmt(w.from_deg, 0)}°, weighted by whole circles.` +
        (w.unreliable
          ? ` The estimates below disagree by ${windSpeed(w.spread_ms)}, which is noise: either too few complete circles or genuinely variable wind.`
          : ''),
    ),
    table(['Time', 'Speed', 'From', 'Circles'], rows, 'compact'),
  );
}
