/**
 * Data-quality warnings and the flight summary.
 *
 * The honesty rules from `interpretation.md` are structural here, not
 * footnotes: what the trace cannot show is stated once, plainly, above the
 * figures it affects, and no airmass number is shown anywhere without the
 * polar it depends on named alongside it.
 */

import type { Analysis } from '../core/index.ts';
import { h } from './dom.ts';
import {
  distance, duration, height, hms, percent, windSpeed, climb, fmt,
} from './units.ts';

/**
 * What this trace cannot tell you. Rendered above everything derived from it,
 * because a soft number presented as a hard one is worse than no number.
 */
export function qualityPanel(a: Analysis): HTMLElement {
  const r = a.result;
  const q = r.trace.quality;
  const items: HTMLElement[] = [];

  for (const w of r.warnings) {
    items.push(h('li', { class: 'warn' }, w));
  }

  const longGaps = q.largest_gap_s >= 60;
  if (q.coarse || longGaps) {
    const why = q.coarse
      ? `The median gap between fixes is ${q.median_interval_s} s`
      : `This trace has gaps of up to ${duration(q.largest_gap_s)}`;
    items.push(
      h(
        'li',
        { class: 'warn' },
        `${why}. Circle geometry below - circle time, bank, radius - is an ` +
          `average across each climb rather than a measurement, and where the ` +
          `lift sat inside a circle cannot be seen at all. Read the climb rates, ` +
          `not the centring.`,
      ),
    );
  }

  if (q.gaps_over_20s > 0 && !longGaps) {
    items.push(
      h(
        'li',
        { class: 'note' },
        `${q.gaps_over_20s} gap${q.gaps_over_20s === 1 ? '' : 's'} over 20 s, ` +
          `totalling ${duration(q.gap_total_s)} (${percent(q.gap_total_s / Math.max(1, r.trace.duration_s))} ` +
          `of the trace). Long gaps are excluded from rates but still counted in distance.`,
      ),
    );
  }

  items.push(
    h(
      'li',
      { class: 'note' },
      r.altitude_source === 'pressure'
        ? 'Heights are pressure altitude, as logged. Smoother than GNSS, and not a datum for airspace.'
        : 'Heights are GNSS altitude: the pressure channel in this file is dead. ' +
            'GNSS is noisier, which inflates short-window climb rates slightly, and it is not a datum for airspace.',
    ),
  );

  items.push(
    h(
      'li',
      { class: r.polar.matched ? 'note' : 'warn' },
      `${capitalise(r.polar.note)}. ` +
        (r.polar.best_ld !== null
          ? `That assumes best glide near ${fmt(r.polar.best_ld, 0)}:1. `
          : '') +
        `Every airmass and L/D figure below depends on it: a glider flying wet, ` +
        `heavy or buggy will read low.`,
    ),
  );

  if (!r.launch.release_confident && !r.launch.type.startsWith('no launch')) {
    items.push(
      h(
        'li',
        { class: 'warn' },
        `The release time is an estimate: no clean drop below tow speed was found, ` +
          `so the top of the initial climb is used. It is often wrong when the tow ` +
          `ran through lift. Everything below is measured from it.`,
      ),
    );
  }

  if (r.wind?.unreliable) {
    items.push(
      h(
        'li',
        { class: 'warn' },
        `The per-climb wind estimates disagree by ${windSpeed(r.wind.spread_ms)}. ` +
          `That is either too few complete circles or genuinely variable wind. ` +
          `Do not build an argument on the wind figure.`,
      ),
    );
  }

  if (items.length === 0) {
    items.push(h('li', { class: 'ok' }, 'Clean trace, no significant gaps.'));
  }

  return h(
    'section',
    { class: 'panel quality', 'aria-labelledby': 'quality-h' },
    h('h2', { id: 'quality-h' }, 'What this trace can and cannot show'),
    h('ul', { class: 'quality-list' }, ...items),
  );
}

/** The shape of the flight, in the order a pilot would ask about it. */
export function summaryPanel(a: Analysis): HTMLElement {
  const r = a.result;
  const hdr = r.header;
  const rows: [string, string][] = [];

  const glider = [hdr.glider_type, hdr.glider_id].filter(Boolean).join(' ');
  rows.push(['Date', hdr.date ?? 'not in the file']);
  rows.push(['Glider', glider || 'not in the file']);
  if (hdr.pilot) rows.push(['Pilot', hdr.pilot + (hdr.crew2 ? ` with ${hdr.crew2}` : '')]);
  rows.push([
    'Trace',
    `${hms(r.trace.start)} to ${hms(r.trace.end)} UTC, ${duration(r.trace.duration_s)}`,
  ]);
  rows.push(['Launch', `${hms(r.launch.takeoff)} - ${r.launch.type}`]);
  rows.push([
    'Release',
    `${hms(r.launch.release)}${r.launch.release_confident ? '' : ' (estimated)'}`,
  ]);
  rows.push(['Max height', height(r.trace.max_alt_m)]);
  rows.push(['Track distance', distance(r.track_distance_m)]);
  rows.push([
    r.trace.landed ? 'Landed' : 'Trace ends',
    `${hms(r.trace.end)}${r.trace.landed ? '' : ' - still flying, so this is a partial log'}`,
  ]);

  return h(
    'section',
    { class: 'panel', 'aria-labelledby': 'flight-h' },
    h('h2', { id: 'flight-h' }, 'The flight'),
    h('dl', { class: 'kv' }, ...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
  );
}

/**
 * The phase split, which decides what kind of debrief the flight deserves.
 * Stated in words as well as numbers, following `interpretation.md` section 1.
 */
export function phasePanel(a: Analysis): HTMLElement {
  const r = a.result;
  const p = r.phase;
  const frac = p.circling_fraction;

  const character =
    frac > 0.35
      ? 'A thermal day: climb rates, centring and circle geometry are the story.'
      : frac >= 0.1
        ? 'Streets, convergence or energy lines rather than a thermalling day. The story ' +
          'is route choice and when not to circle; the few climbs in isolation will miss it.'
        : 'Very little circling. Ridge or wave: check the wind estimate and the shape of ' +
          'the climbs before reading this as a thermalling flight.';

  const rows: [string, string][] = [
    ['Circling', `${duration(p.circling_s)} (${percent(frac)}) in ${r.climbs.length} climb${r.climbs.length === 1 ? '' : 's'}`],
    ['Straight', `${duration(p.straight_s)} (${percent(1 - frac)})`],
    ['Height gained circling', height(p.gain_circling_m)],
  ];
  if (p.mean_circling_rate_ms !== null) {
    rows.push([
      'Average while circling',
      `${climb(p.mean_circling_rate_ms)} (includes entry and centring losses)`,
    ]);
  }
  if (p.working_band) {
    rows.push([
      'Working band',
      `${height(p.working_band.bottom_m)} to ${height(p.working_band.top_m)}`,
    ]);
  }
  if (r.wind) {
    rows.push([
      'Wind from circle drift',
      `${windSpeed(r.wind.speed_ms)} from ${Math.round(r.wind.from_deg)}°` +
        (r.wind.unreliable ? ' - estimates disagree, see above' : ''),
    ]);
  }
  if (r.rising_air_fraction !== null) {
    rows.push([
      'Straight flight in rising air',
      `${percent(r.rising_air_fraction)} of the time (assumes the polar above)`,
    ]);
  }

  return h(
    'section',
    { class: 'panel', 'aria-labelledby': 'phase-h' },
    h('h2', { id: 'phase-h' }, 'Phase split, after release'),
    h('p', { class: 'lede' }, character),
    h('dl', { class: 'kv' }, ...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
  );
}

const capitalise = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
