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

  if (r.launch.release_override) {
    items.push(
      h(
        'li',
        { class: 'note' },
        `The release time is set to ${hms(r.launch.release)} by hand, not read from ` +
          `the trace. Everything below is measured from it. Clear the Release box ` +
          `above to go back to what the trace says.`,
      ),
    );
  } else if (!r.launch.release_confident && !r.launch.type.startsWith('no launch')) {
    items.push(
      h(
        'li',
        { class: 'warn' },
        `The release time is an estimate: no clean drop below tow speed was found, ` +
          `so the top of the initial climb is used. It is often wrong when the tow ` +
          `ran through lift. Everything below is measured from it. If you know when ` +
          `you released, put it in the Release box above and the whole debrief is ` +
          `recomputed from that.`,
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
    `${hms(r.launch.release)}` +
      (r.launch.release_override ? ' (set by hand)' : r.launch.release_confident ? '' : ' (estimated)'),
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
 * The declared task, from the file's C records.
 *
 * Shown because it is the thing the flight was flown against: a debrief that
 * says "303 km triangle, declared at 09:41" is answering a different question
 * from one that only counts thermals. Take-off and landing records are not in
 * the distance - they are where the glider left from, not part of the task.
 *
 * This is the declaration, not a claim. Nothing here checks the trace against
 * it: no start line, no observation zones, no finish ring, and no scored
 * distance. That is a scoring program's job and it is stated rather than
 * implied, because a number that looks like a badge distance and is not one is
 * worse than no number.
 */
export function taskPanel(a: Analysis): HTMLElement {
  const t = a.result.task_summary;

  if (!t) {
    return h(
      'section',
      { class: 'panel', 'aria-labelledby': 'task-h' },
      h('h2', { id: 'task-h' }, 'Declared task'),
      h(
        'p',
        { class: 'lede' },
        a.result.task.length === 1
          ? 'One declared point, which is not a task. Nothing to measure against.'
          : 'No task declared in this file. Many loggers only write a declaration ' +
              'when one was entered before flight, so this says nothing about what ' +
              'was flown.',
      ),
    );
  }

  const rows: [string, string][] = [];
  rows.push([
    'Task',
    `${distance(t.distance_m, 1)} ${t.shape}` +
      (t.turnpoints ? `, ${t.turnpoints} turnpoint${t.turnpoints === 1 ? '' : 's'}` : ''),
  ]);
  const d = t.declaration;
  if (d?.declared_date || d?.declared_time_s !== undefined) {
    rows.push([
      'Declared',
      [d.declared_date, d.declared_time_s !== undefined ? `${hms(d.declared_time_s)} UTC` : null]
        .filter(Boolean)
        .join(' at '),
    ]);
  }
  if (d?.description) rows.push(['Described as', d.description]);
  if (t.takeoff) rows.push(['Take-off declared', t.takeoff.name || pointLabel(t.takeoff)]);
  if (t.landing) rows.push(['Landing declared', t.landing.name || pointLabel(t.landing)]);

  const legRows = t.legs.map((l, i) =>
    h(
      'tr',
      {},
      h('td', {}, String(i + 1)),
      h('td', {}, `${l.from} to ${l.to}`),
      h('td', {}, distance(l.distance_m, 1)),
      h('td', {}, `${fmt(l.bearing_deg, 0)}°`),
    ),
  );

  return h(
    'section',
    { class: 'panel', 'aria-labelledby': 'task-h' },
    h('h2', { id: 'task-h' }, 'Declared task'),
    h(
      'p',
      { class: 'lede' },
      `${distance(t.distance_m, 1)} ${t.shape}: ` +
        t.points.map((p) => p.name || pointLabel(p)).join(' - ') +
        '.',
    ),
    h('dl', { class: 'kv' }, ...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
    h(
      'div',
      { class: 'table-scroll' },
      h(
        'table',
        { class: 'data compact' },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            h('th', { scope: 'col' }, '#'),
            h('th', { scope: 'col' }, 'Leg'),
            h('th', { scope: 'col' }, 'Distance'),
            h('th', { scope: 'col' }, 'Track'),
          ),
        ),
        h('tbody', {}, ...legRows),
      ),
    ),
    h(
      'p',
      { class: 'caveat' },
      'This is what was declared, not what was scored. The distance is the ' +
        'great-circle sum of the legs between the declared points; there is no start ' +
        'line, no observation zone and no finish ring here, and the trace is not ' +
        'checked against the declaration. A badge or ladder claim needs a scoring ' +
        'program.',
    ),
  );
}

const pointLabel = (p: { lat: number; lon: number }): string =>
  `${p.lat.toFixed(3)}, ${p.lon.toFixed(3)}`;

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
