/**
 * Page entry point.
 *
 * Everything happens here in the browser: the file is read with the File API,
 * analysed in this tab, and rendered. Nothing is uploaded, because there is
 * nowhere to upload it to.
 */

import './style.css';
import { analyse } from './core/index.ts';
import type { Analysis } from './core/index.ts';
import { clear, h } from './ui/dom.ts';
import { dropzone } from './ui/dropzone.ts';
import { barogram, barogramCaption } from './ui/barogram.ts';
import { phasePanel, qualityPanel, summaryPanel } from './ui/summary.ts';
import { loadUnits } from './ui/units.ts';

const app = document.getElementById('app')!;
clear(app);
loadUnits();

const results = h('div', { id: 'results' });

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
      'It is read in this tab and analysed here. There is no server, no upload ' +
        'and no analytics. Once this page has loaded you can turn the network off ' +
        'and it will still work.',
    ),
  ),
  dropzone({ onFile: run, onError: showError }),
  results,
);

function showError(message: string): void {
  clear(results);
  results.append(
    h(
      'section',
      { class: 'panel error' },
      h('h2', {}, 'That did not work'),
      h('p', { class: 'lede' }, message),
    ),
  );
}

function run(name: string, text: string): void {
  let analysis: Analysis;
  try {
    analysis = analyse(text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    showError(
      `${name}: ${msg} ` +
        'This tool reads IGC B records only. Most flight software will export ' +
        'IGC directly; .cup, .gpx, .kml and SeeYou files are not IGC.',
    );
    return;
  }
  render(name, analysis);
}

function render(name: string, a: Analysis): void {
  clear(results);
  const baro = barogram(a);

  results.append(
    h('p', { class: 'caption' }, `Analysing ${name}`),
    // Quality first: it governs how hard the rest of the page can be read.
    qualityPanel(a),
    summaryPanel(a),
    h(
      'figure',
      { class: 'figure' },
      h('h2', {}, 'Barogram'),
      h('div', { class: 'figure-scroll' }, baro.svg),
      h(
        'p',
        { class: 'legend' },
        h('span', {}, h('i', { class: 'swatch-circling' }), 'circling'),
        h('span', {}, h('i', { class: 'swatch-straight' }), 'straight flight'),
      ),
      h('figcaption', { class: 'caption' }, barogramCaption(a)),
    ),
    phasePanel(a),
  );
}
