/**
 * Linking the two figures.
 *
 * Brushing a time range on the barogram filters the tables and highlights that
 * stretch of the trace; hovering either figure marks the same moment on the
 * other. Clicking a table row scrubs both.
 *
 * All of it is added after the figures are built, so the exported SVG stays
 * static markup with no scripts in it.
 */

import type { Analysis } from '../core/index.ts';
import type { Barogram } from './barogram.ts';
import type { Trace } from './trace.ts';
import { el } from './svg.ts';
import { height, hms } from './units.ts';

export interface Span {
  start: number;
  end: number;
}

export interface Link {
  /** Set or clear the brushed range without a pointer. */
  setSelection: (span: Span | null) => void;
}

export function linkFigures(
  analysis: Analysis,
  baro: Barogram,
  trc: Trace | null,
  onSelect: (span: Span | null) => void,
): Link {
  const F = analysis.fixes;
  const t0 = F[0].t;
  const t1 = F[F.length - 1].t;

  // ---------------------------------------------------------- overlay layers
  const brush = el('rect', {
    class: 'brush', x: 0, y: baro.plot.top, width: 0,
    height: baro.plot.bottom - baro.plot.top, visibility: 'hidden',
  });
  const cursor = el('line', {
    class: 'cursor', x1: 0, x2: 0, y1: baro.plot.top, y2: baro.plot.bottom, visibility: 'hidden',
  });
  const readout = el('text', { class: 'readout', x: 0, y: baro.plot.top - 2, visibility: 'hidden' });
  baro.svg.append(brush, cursor, readout);

  const traceHi = trc ? el('path', { class: 'trk-highlight', fill: 'none', d: '' }) : null;
  const traceDot = trc ? el('circle', { class: 'trace-cursor', r: 4, visibility: 'hidden' }) : null;
  if (trc && traceHi && traceDot) trc.svg.append(traceHi, traceDot);

  // -------------------------------------------------------------- geometry
  /** Client x to the barogram's own coordinate system. */
  function localX(svg: SVGSVGElement, clientX: number): number {
    const r = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal.width || r.width;
    return ((clientX - r.left) / r.width) * vb;
  }

  /** First fix at or after `t`. The profile is sorted, so bisect. */
  function indexAt(t: number): number {
    let lo = 0;
    let hi = F.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (F[mid].t < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  const clampT = (t: number) => Math.min(t1, Math.max(t0, t));

  // ------------------------------------------------------------ rendering
  let selection: Span | null = null;

  function paint(): void {
    if (!selection) {
      brush.setAttribute('visibility', 'hidden');
      if (traceHi) traceHi.setAttribute('d', '');
      return;
    }
    const x1 = baro.xOf(selection.start);
    const x2 = baro.xOf(selection.end);
    brush.setAttribute('x', String(Math.min(x1, x2)));
    brush.setAttribute('width', String(Math.max(1, Math.abs(x2 - x1))));
    brush.setAttribute('visibility', 'visible');

    if (trc && traceHi) {
      const a = indexAt(selection.start);
      const b = indexAt(selection.end);
      let d = '';
      for (let i = a; i <= b; i++) {
        const p = trc.at(i);
        d += `${i === a ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
      }
      traceHi.setAttribute('d', d);
    }
  }

  function showCursor(t: number | null): void {
    if (t === null) {
      cursor.setAttribute('visibility', 'hidden');
      readout.setAttribute('visibility', 'hidden');
      traceDot?.setAttribute('visibility', 'hidden');
      return;
    }
    const x = baro.xOf(t);
    cursor.setAttribute('x1', String(x));
    cursor.setAttribute('x2', String(x));
    cursor.setAttribute('visibility', 'visible');

    const i = indexAt(t);
    readout.textContent = `${hms(F[i].t)}  ${height(F[i].alt)}`;
    // Flip the label to the other side near the right edge so it stays inside.
    const flip = x > (baro.plot.left + baro.plot.right) / 2;
    readout.setAttribute('x', String(x + (flip ? -6 : 6)));
    readout.setAttribute('text-anchor', flip ? 'end' : 'start');
    readout.setAttribute('visibility', 'visible');

    if (trc && traceDot) {
      const p = trc.at(i);
      traceDot.setAttribute('cx', String(p.x));
      traceDot.setAttribute('cy', String(p.y));
      traceDot.setAttribute('visibility', 'visible');
    }
  }

  // ------------------------------------------------------------- pointers
  let dragFrom: number | null = null;
  let dragged = false;

  baro.svg.addEventListener('pointerdown', (e) => {
    const pe = e as PointerEvent;
    if (pe.button !== 0) return;
    dragFrom = clampT(baro.tOf(localX(baro.svg, pe.clientX)));
    dragged = false;
    baro.svg.setPointerCapture(pe.pointerId);
  });

  baro.svg.addEventListener('pointermove', (e) => {
    const pe = e as PointerEvent;
    const t = clampT(baro.tOf(localX(baro.svg, pe.clientX)));
    showCursor(t);
    if (dragFrom === null) return;
    if (Math.abs(baro.xOf(t) - baro.xOf(dragFrom)) > 3) dragged = true;
    if (dragged) {
      selection = { start: Math.min(dragFrom, t), end: Math.max(dragFrom, t) };
      paint();
    }
  });

  function endDrag(e: Event): void {
    const pe = e as PointerEvent;
    if (dragFrom === null) return;
    if (baro.svg.hasPointerCapture?.(pe.pointerId)) baro.svg.releasePointerCapture(pe.pointerId);
    // A click without a drag clears the selection: the obvious way out.
    if (!dragged) {
      selection = null;
      paint();
    }
    dragFrom = null;
    onSelect(selection);
  }

  baro.svg.addEventListener('pointerup', endDrag);
  baro.svg.addEventListener('pointercancel', endDrag);
  baro.svg.addEventListener('pointerleave', () => {
    if (dragFrom === null) showCursor(null);
  });

  return {
    setSelection(span) {
      selection = span;
      paint();
      onSelect(span);
    },
  };
}
