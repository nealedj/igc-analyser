/**
 * The controls bar: units, track colouring, the release time, the polar
 * override, and import by link.
 *
 * The polar override matters more than it looks. Every airmass figure depends
 * on the polar, and the glider-type header is routinely missing, misspelled or
 * describing a different glider from the one that flew.
 *
 * The release override is the same kind of thing for time rather than sink.
 * Release detection is a heuristic and is often wrong when the tow ran through
 * lift, and everything after release - the phase split, the climbs, the legs,
 * the soaring time - is measured from it. The pilot knows when they pulled the
 * bung; this is where they say so.
 */

import type { PolarDb } from '../core/index.ts';
import { h } from './dom.ts';
import type { TraceColouring } from './trace.ts';
import { hms, setUnits, units } from './units.ts';
import type { UnitSystem } from './units.ts';
import { ImportError, fetchTrace, parseTarget } from './import.ts';

export interface ControlState {
  colourBy: TraceColouring;
  polarForce: string | undefined;
  /** Operator's release time, seconds since midnight UTC, or unset. */
  releaseTime: number | undefined;
  /** The release the analysis is currently using, for the hint next to it. */
  release: { time: number; confident: boolean };
}

export interface ControlHandlers {
  onUnits: (u: UnitSystem) => void;
  onColourBy: (c: TraceColouring) => void;
  onPolar: (name: string | undefined) => void;
  onRelease: (seconds: number | undefined) => void;
}

function segmented<T extends string>(
  label: string,
  options: { value: T; label: string }[],
  current: T,
  onPick: (v: T) => void,
): HTMLElement {
  const group = h('div', { class: 'seg', role: 'group', 'aria-label': label });
  for (const o of options) {
    const b = h(
      'button',
      { type: 'button', class: o.value === current ? 'on' : '', 'aria-pressed': String(o.value === current) },
      o.label,
    );
    b.addEventListener('click', () => onPick(o.value));
    group.append(b);
  }
  return h('div', { class: 'control' }, h('span', { class: 'control-label' }, label), group);
}

export function controls(db: PolarDb, state: ControlState, on: ControlHandlers): HTMLElement {
  const unitToggle = segmented<UnitSystem>(
    'Units',
    [
      { value: 'imperial', label: 'ft / kt' },
      { value: 'metric', label: 'm / m/s' },
    ],
    units(),
    (u) => {
      setUnits(u);
      on.onUnits(u);
    },
  );

  const colourToggle = segmented<TraceColouring>(
    'Colour track by',
    [
      { value: 'phase', label: 'phase' },
      { value: 'climb', label: 'climb rate' },
    ],
    state.colourBy,
    on.onColourBy,
  );

  const select = h('select', { class: 'polar-select', 'aria-label': 'Polar' }) as HTMLSelectElement;
  select.append(h('option', { value: '' }, 'from the file header'));
  for (const g of db.gliders) select.append(h('option', { value: g.name }, g.name));
  select.append(h('option', { value: 'none' }, 'none - hide airmass figures'));
  select.value = state.polarForce ?? '';
  select.addEventListener('change', () => on.onPolar(select.value || undefined));

  return h(
    'section',
    { class: 'controls' },
    unitToggle,
    colourToggle,
    releaseControl(state, on.onRelease),
    h('div', { class: 'control' }, h('span', { class: 'control-label' }, 'Polar'), select),
  );
}

/**
 * The release time.
 *
 * Empty means "whatever the trace says", which is the honest default: the tool
 * should not pretend the pilot has told it something they have not. So the box
 * starts blank with the detected time beside it, rather than pre-filled with a
 * guess that would then look like it had been confirmed.
 */
function releaseControl(
  state: ControlState,
  onRelease: (seconds: number | undefined) => void,
): HTMLElement {
  const input = h('input', {
    type: 'time',
    step: '1',
    class: 'release-input',
    'aria-label': 'Release time, UTC',
    value: state.releaseTime === undefined ? '' : hms(state.releaseTime),
  }) as HTMLInputElement;

  input.addEventListener('change', () => onRelease(secondsOf(input.value)));

  return h(
    'div',
    { class: 'control' },
    h('span', { class: 'control-label' }, 'Release'),
    input,
    h(
      'span',
      { class: `release-hint${state.release.confident ? '' : ' release-estimated'}` },
      state.releaseTime === undefined
        ? `${hms(state.release.time)} from the trace${state.release.confident ? '' : ', estimated'}`
        : 'overriding the trace',
    ),
  );
}

/** `HH:MM` or `HH:MM:SS` to seconds since midnight; empty or unreadable is unset. */
function secondsOf(value: string): number | undefined {
  const m = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!m) return undefined;
  const [hh, mm, ss] = [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
  if (hh > 23 || mm > 59 || ss > 59) return undefined;
  return hh * 3600 + mm * 60 + ss;
}

/**
 * Import by link. Kept visually secondary to the drop zone, because dropping a
 * file is the private path and this one is not.
 */
export function importBar(
  onLoaded: (name: string, text: string) => void,
  onError: (message: string, hint?: string) => void,
): HTMLElement {
  const input = h('input', {
    type: 'text',
    class: 'import-input',
    placeholder: 'bgaladder.net/FlightInfo?FlightID=100000, or a link to any .igc',
    'aria-label': 'Flight link or IGC file URL',
    spellcheck: 'false',
  }) as HTMLInputElement;

  const button = h('button', { type: 'button', class: 'import-go' }, 'Fetch') as HTMLButtonElement;

  async function go(): Promise<void> {
    const target = parseTarget(input.value);
    if (!target) {
      onError(
        'That does not look like a flight link.',
        'Paste a BGA Ladder or WeGlide flight link, a bare BGA flight number, or a ' +
          'direct link to an .igc file anywhere.',
      );
      return;
    }
    button.disabled = true;
    button.textContent = 'Fetching...';
    try {
      const { name, text } = await fetchTrace(target);
      onLoaded(name, text);
    } catch (e) {
      if (e instanceof ImportError) onError(e.message, e.hint);
      else onError(e instanceof Error ? e.message : String(e));
    } finally {
      button.disabled = false;
      button.textContent = 'Fetch';
    }
  }

  button.addEventListener('click', () => void go());
  input.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') void go();
  });

  return h(
    'details',
    { class: 'import' },
    h('summary', {}, 'Or fetch one by link'),
    h(
      'p',
      { class: 'import-note' },
      'A BGA Ladder or WeGlide flight link, a bare BGA flight number, or a direct ' +
        'link to an .igc file anywhere. Your browser fetches it straight from that ' +
        'site - nothing passes through a server here. This is the only thing on the ' +
        'page that uses the network, and only when you press Fetch.',
    ),
    h(
      'p',
      { class: 'import-note' },
      'Whether it works is up to the site being asked: a site has to opt in before ' +
        'another page may read its files. The BGA Ladder does. Where one does not, ' +
        'downloading the file and dropping it here always works.',
    ),
    h('div', { class: 'import-row' }, input, button),
  );
}
