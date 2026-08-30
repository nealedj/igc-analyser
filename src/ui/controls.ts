/**
 * The controls bar: units, track colouring, polar override, and import by link.
 *
 * The polar override matters more than it looks. Every airmass figure depends
 * on the polar, and the glider-type header is routinely missing, misspelled or
 * describing a different glider from the one that flew.
 */

import type { PolarDb } from '../core/index.ts';
import { h } from './dom.ts';
import type { TraceColouring } from './trace.ts';
import { setUnits, units } from './units.ts';
import type { UnitSystem } from './units.ts';
import { ImportError, fetchTrace, parseTarget } from './import.ts';

export interface ControlState {
  colourBy: TraceColouring;
  polarForce: string | undefined;
}

export interface ControlHandlers {
  onUnits: (u: UnitSystem) => void;
  onColourBy: (c: TraceColouring) => void;
  onPolar: (name: string | undefined) => void;
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
    h('div', { class: 'control' }, h('span', { class: 'control-label' }, 'Polar'), select),
  );
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
    placeholder: 'bgaladder.net/FlightInfo?FlightID=100000',
    'aria-label': 'BGA Ladder or WeGlide flight link',
    spellcheck: 'false',
  }) as HTMLInputElement;

  const button = h('button', { type: 'button', class: 'import-go' }, 'Fetch') as HTMLButtonElement;

  async function go(): Promise<void> {
    const target = parseTarget(input.value);
    if (!target) {
      onError(
        'That does not look like a flight link.',
        'Paste a BGA Ladder flight link, a WeGlide flight link, or a bare BGA flight number.',
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
    h('summary', {}, 'Or fetch one from the BGA Ladder'),
    h(
      'p',
      { class: 'import-note' },
      'This is the only thing here that uses the network, and only when you press ' +
        'Fetch. WeGlide links are recognised too, but WeGlide only lets its own site ' +
        'read its API from a browser, so those have to be downloaded and dropped in.',
    ),
    h('div', { class: 'import-row' }, input, button),
  );
}
