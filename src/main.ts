/**
 * Page entry point.
 *
 * Everything happens here in the browser: the file is read with the File API,
 * analysed in this tab, and rendered. Nothing is uploaded, because there is
 * nowhere to upload it to. The one exception is the import-by-link control,
 * which is opt-in and says so.
 */

import './style.css';
import { analyse } from './core/index.ts';
import type { Analysis, PolarDb } from './core/index.ts';
import polarsDb from './data/polars.json' with { type: 'json' };
import { clear, h } from './ui/dom.ts';
import { dropzone } from './ui/dropzone.ts';
import { barogram, barogramCaption } from './ui/barogram.ts';
import { climbBandLabels, trace } from './ui/trace.ts';
import type { TraceColouring } from './ui/trace.ts';
import { phasePanel, qualityPanel, summaryPanel, taskPanel } from './ui/summary.ts';
import { climbTable, legTable, perCirclePanel, windPanel } from './ui/tables.ts';
import { controls, importBar } from './ui/controls.ts';
import { linkFigures } from './ui/interact.ts';
import type { Span } from './ui/interact.ts';
import { duration, hms, loadUnits } from './ui/units.ts';
import { buildBundle, bundleName, saveBlob } from './ui/export.ts';

const DB = polarsDb as PolarDb;

const app = document.getElementById('app')!;
clear(app);
loadUnits();

const results = h('div', { id: 'results' });

/** Everything that survives a re-render. */
const state: {
  name: string;
  text: string;
  colourBy: TraceColouring;
  polarForce: string | undefined;
  selection: Span | null;
} = { name: '', text: '', colourBy: 'phase', polarForce: undefined, selection: null };

app.append(
  h(
    'header',
    { class: 'masthead' },
    h('h1', {}, 'IGC Analyser'),
    h(
      'p',
      {},
      'Drop a glider flight log in and get a soaring debrief: the phase split, ' +
        'the climbs and their circle geometry, the wind, and what the air was ' +
        'doing on the straight legs.',
    ),
    h(
      'p',
      { class: 'privacy' },
      h('strong', {}, 'Your file stays on your machine. '),
      'It is read in this tab and analysed here. There is no server and no analytics. ' +
        'Once this page has loaded you can turn the network off and it will still work.',
    ),
  ),
  dropzone({ onFile: load, onError: (m) => showError(m) }),
  importBar(load, showError),
  results,
);

function showError(message: string, hint?: string): void {
  clear(results);
  results.append(
    h(
      'section',
      { class: 'panel error' },
      h('h2', {}, 'That did not work'),
      h('p', { class: 'lede' }, message),
      hint ? h('p', { class: 'caption' }, hint) : null,
    ),
  );
}

function load(name: string, text: string): void {
  state.name = name;
  state.text = text;
  state.selection = null;
  state.polarForce = undefined;
  render();
}

function render(): void {
  let a: Analysis;
  try {
    a = analyse(state.text, {
      polarDb: DB,
      polar: state.polarForce ? { force: state.polarForce } : {},
    });
  } catch (e) {
    showError(
      `${state.name}: ${e instanceof Error ? e.message : String(e)}`,
      'This tool reads IGC B records only. Most flight software exports IGC directly; ' +
        '.cup, .gpx, .kml and SeeYou files are not IGC.',
    );
    return;
  }

  clear(results);

  const baro = barogram(a);
  const trc = trace(a, { colourBy: state.colourBy });
  const tables = h('div', { id: 'tables' });

  const link = linkFigures(a, baro, trc, (span) => {
    state.selection = span;
    renderTables(a, tables, span, link);
  });

  const exportPanel = buildExportPanel(a, { trace: trc.svg, barogram: baro.svg });

  results.append(
    h(
      'div',
      { class: 'file-line' },
      h('span', {}, state.name),
      h(
        'span',
        { class: 'file-meta' },
        `${a.result.trace.quality.fixes.toLocaleString('en-GB')} fixes, ` +
          `${hms(a.result.trace.start)} to ${hms(a.result.trace.end)} UTC`,
      ),
    ),
    controls(DB, { colourBy: state.colourBy, polarForce: state.polarForce }, {
      onUnits: () => render(),
      onColourBy: (c) => {
        state.colourBy = c;
        render();
      },
      onPolar: (p) => {
        state.polarForce = p;
        render();
      },
    }),
    qualityPanel(a),
    summaryPanel(a),
    taskPanel(a),
    figure('Barogram', baro.svg, barogramCaption(a), phaseLegend()),
    phasePanel(a),
    figure(
      'Track',
      trc.svg,
      'Plan view, north up, equirectangular with the aspect corrected for latitude. ' +
        'No basemap: this is the trace and the declared task, nothing else. ' +
        'Drag on the barogram to highlight a stretch here.',
      state.colourBy === 'phase' ? phaseLegend() : climbLegend(),
    ),
    tables,
    exportPanel,
  );

  renderTables(a, tables, state.selection, link);
  if (state.selection) link.setSelection(state.selection);
}

/**
 * The tables are the part that responds to a brush, so they are re-rendered on
 * selection change while the figures keep their DOM and just repaint.
 */
function renderTables(
  a: Analysis,
  host: HTMLElement,
  span: Span | null,
  link: ReturnType<typeof linkFigures>,
): void {
  clear(host);

  const filtered: Analysis = span
    ? {
        ...a,
        result: {
          ...a.result,
          climbs: a.result.climbs.filter((c) => c.end >= span.start && c.start <= span.end),
          legs: a.result.legs.filter((l) => l.end >= span.start && l.start <= span.end),
        },
      }
    : a;

  if (span) {
    const clearBtn = h('button', { type: 'button', class: 'clear-brush' }, 'Show the whole flight');
    clearBtn.addEventListener('click', () => link.setSelection(null));
    host.append(
      h(
        'div',
        { class: 'brush-note' },
        h(
          'span',
          {},
          `Showing ${hms(span.start)} to ${hms(span.end)} UTC ` +
            `(${duration(span.end - span.start)}): ` +
            `${filtered.result.climbs.length} climb${filtered.result.climbs.length === 1 ? '' : 's'}, ` +
            `${filtered.result.legs.length} leg${filtered.result.legs.length === 1 ? '' : 's'}.`,
        ),
        clearBtn,
      ),
    );
  }

  const onSelect = (s: Span | null) => link.setSelection(s);
  host.append(
    climbTable(filtered, { onSelect }),
    perCirclePanel(filtered) ?? h('div', { class: 'nothing' }),
    windPanel(filtered) ?? h('div', { class: 'nothing' }),
    legTable(filtered, { onSelect }),
  );
}

/**
 * The export. A published file format rather than a convenience: it is the only
 * interface between this app and anything that publishes a flight page, and it
 * is specified in docs/export-format.md.
 */
function buildExportPanel(a: Analysis, figures: { trace: SVGSVGElement; barogram: SVGSVGElement }): HTMLElement {
  const status = h('span', { class: 'export-status' });
  const button = h('button', { type: 'button', class: 'export-go' }, 'Download flight page bundle') as HTMLButtonElement;

  button.addEventListener('click', () => {
    void (async () => {
      button.disabled = true;
      status.textContent = 'Building...';
      try {
        const blob = await buildBundle(a, figures, { filename: state.name });
        const name = `${bundleName(a)}.zip`;
        saveBlob(blob, name);
        status.textContent = `${name}, ${(blob.size / 1024).toFixed(0)} kB`;
      } catch (e) {
        status.textContent = `Could not build the bundle: ${e instanceof Error ? e.message : String(e)}`;
      } finally {
        button.disabled = false;
      }
    })();
  });

  return h(
    'section',
    { class: 'panel export', 'aria-labelledby': 'export-h' },
    h('h2', { id: 'export-h' }, 'Export'),
    h(
      'p',
      { class: 'lede' },
      'A zip containing flight.json, trace.svg and barogram.svg: everything on this ' +
        'page in a form a flight page can consume. The SVGs are static, carry no ' +
        'scripts or external references, and take their colours from CSS custom ' +
        'properties so they can be themed where they are embedded. Every number in ' +
        'flight.json is SI, whatever this page is currently showing.',
    ),
    h('div', { class: 'export-row' }, button, status),
    h(
      'p',
      { class: 'caption' },
      'The format is versioned and documented in docs/export-format.md. ' +
        'It is built here in your browser, like everything else.',
    ),
  );
}

function figure(title: string, svg: SVGSVGElement, caption: string, legend: HTMLElement): HTMLElement {
  return h(
    'figure',
    { class: 'figure' },
    h('h2', {}, title),
    h('div', { class: 'figure-scroll' }, svg),
    legend,
    h('figcaption', { class: 'caption' }, caption),
  );
}

const phaseLegend = (): HTMLElement =>
  h(
    'p',
    { class: 'legend' },
    h('span', {}, h('i', { class: 'swatch-circling' }), 'circling'),
    h('span', {}, h('i', { class: 'swatch-straight' }), 'straight flight'),
  );

const climbLegend = (): HTMLElement =>
  h(
    'p',
    { class: 'legend' },
    ...climbBandLabels().map((b) =>
      h('span', {}, h('i', { class: `swatch ${b.cls}` }), `${b.label} m/s`),
    ),
  );
