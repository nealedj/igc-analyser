/**
 * Minimal SVG construction helpers.
 *
 * Both figures have to survive being pulled out of the page and dropped into
 * a static flight page, so they are built as plain SVG with no scripts, no
 * external references and colours that come from CSS custom properties.
 */

export const SVG_NS = 'http://www.w3.org/2000/svg';

export function el<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number> = {},
  ...children: (Node | string)[]
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  for (const c of children) node.append(c);
  return node;
}

/** A linear scale from a data range onto a pixel range. */
export function scale(d0: number, d1: number, r0: number, r1: number): (v: number) => number {
  const span = d1 - d0 || 1;
  return (v) => r0 + ((v - d0) / span) * (r1 - r0);
}

/**
 * Tick values at a round interval covering [lo, hi], aiming for about
 * `target` of them. Round means 1, 2, 2.5 or 5 times a power of ten.
 */
export function ticks(lo: number, hi: number, target = 6): number[] {
  const span = hi - lo;
  if (!(span > 0)) return [lo];
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm >= 7.5 ? 10 : norm >= 3.5 ? 5 : norm >= 1.5 ? 2 : 1) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) {
    out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  }
  return out;
}

/** Time ticks on a round number of minutes, which read better than seconds. */
export function timeTicks(lo: number, hi: number, target = 7): number[] {
  const steps = [60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600];
  const raw = (hi - lo) / target;
  const step = steps.find((s) => s >= raw) ?? steps[steps.length - 1];
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v);
  return out;
}
