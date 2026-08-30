/**
 * IGC B-record parsing.
 *
 * Logger extension fields (GSP/TRT/VAT) are deliberately ignored for the
 * maths, because their declared column offsets are frequently wrong. They are
 * only cross-checked, to raise a warning when the I record disagrees with the
 * records it describes.
 *
 * Port of `parse_igc`, `parse_b`, `dm` and `choose_altitude`.
 */

import type { Fix, Header, ParsedIgc, TaskPoint } from './types.ts';
import { ValueError, pyFloat, pyInt } from './pyutil.ts';

/** IGC `DDMMmmm` / `DDDMMmmm` to signed decimal degrees. */
export function dm(s: string, ddigits: number, hemi: string): number {
  const deg = pyInt(s.slice(0, ddigits));
  const minutes = pyFloat(`${s.slice(ddigits, ddigits + 2)}.${s.slice(ddigits + 2, ddigits + 5)}`);
  const v = deg + minutes / 60;
  return hemi === 'S' || hemi === 'W' ? -v : v;
}

/** One B record, or null if it is too short, malformed or at the null island. */
export function parseB(line: string): Fix | null {
  if (line.length < 35) return null;
  let t: number, lat: number, lon: number, palt: number, galt: number;
  try {
    t = pyInt(line.slice(1, 3)) * 3600 + pyInt(line.slice(3, 5)) * 60 + pyInt(line.slice(5, 7));
    lat = dm(line.slice(7, 14), 2, line[14]);
    lon = dm(line.slice(15, 23), 3, line[23]);
    palt = pyInt(line.slice(25, 30));
    galt = pyInt(line.slice(30, 35));
  } catch (e) {
    if (e instanceof ValueError) return null;
    throw e;
  }
  if (Math.abs(lat) < 0.0001 && Math.abs(lon) < 0.0001) return null;
  return { t, lat, lon, palt, galt, valid: line[24].toUpperCase() === 'A' } as Fix;
}

/** H records come as `HFxxx<LONGNAME>:value` or bare `HFxxxvalue`. */
function headerValue(line: string): string {
  const body = line.slice(5);
  const i = body.indexOf(':');
  return i >= 0 ? body.slice(i + 1).trim() : body.trim();
}

/** Python's `str.splitlines`, restricted to the terminators IGC files use. */
function splitLines(text: string): string[] {
  const out = text.split(/\r\n|\n|\r/);
  // splitlines() does not produce a trailing empty element for a final newline.
  if (out.length && out[out.length - 1] === '') out.pop();
  return out;
}

export function parseIgc(text: string): ParsedIgc {
  const header: Header = {};
  const fixes: Fix[] = [];
  const task: TaskPoint[] = [];
  const warnings: string[] = [];
  let extDecl: string | null = null;
  const raw = splitLines(text);

  for (const line of raw) {
    if (!line) continue;
    const c = line[0].toUpperCase();
    if (c === 'H') {
      const up = line.toUpperCase();
      if (up.startsWith('HFDTE')) {
        const d = [...line.slice(5)].filter((ch) => ch >= '0' && ch <= '9').join('').slice(0, 6);
        if (d.length === 6) header.date = `20${d.slice(4, 6)}-${d.slice(2, 4)}-${d.slice(0, 2)}`;
      } else if (up.startsWith('HFGTY')) header.glider_type = headerValue(line);
      else if (up.startsWith('HFGID')) header.glider_id = headerValue(line);
      else if (up.startsWith('HFCID')) header.competition_id = headerValue(line);
      else if (up.startsWith('HFPLT')) header.pilot = headerValue(line);
      else if (up.startsWith('HFCM2')) header.crew2 = headerValue(line);
      else if (up.startsWith('HFFTY')) header.logger = headerValue(line);
      else if (up.startsWith('HFGPS')) header.gps = headerValue(line);
      else if (up.startsWith('HFTZN')) header.timezone = headerValue(line);
    } else if (c === 'A' && header.logger_id === undefined) {
      header.logger_id = line.slice(1).trim();
    } else if (c === 'I') {
      extDecl = line.trim();
    } else if (c === 'C') {
      // A task point carries hemisphere letters; the declaration header that
      // opens a C block is all digits. See DIVERGENCE.md (C-record header).
      if (line.length >= 18 && 'NS'.includes(line[8]) && 'EW'.includes(line[17])) {
        try {
          const lat = dm(line.slice(1, 8), 2, line[8]);
          const lon = dm(line.slice(9, 17), 3, line[17]);
          if (Math.abs(lat) > 0.001 || Math.abs(lon) > 0.001) {
            task.push({ lat, lon, name: line.slice(18).trim() });
          }
        } catch (e) {
          if (!(e instanceof ValueError)) throw e;
        }
      }
    } else if (c === 'B') {
      const f = parseB(line);
      if (f) fixes.push(f);
    }
  }

  if (fixes.length === 0) {
    throw new Error('no usable B records found - is this an IGC file?');
  }

  // Midnight rollover, applied in file order: B records are written
  // chronologically, so a time jumping backwards by more than an hour is a new
  // day. This has to happen before the sort, because sorting on the raw
  // wrapped times destroys the ordering the detection depends on.
  // See DIVERGENCE.md (midnight rollover).
  let dayOffset = 0;
  for (let i = 1; i < fixes.length; i++) {
    if (fixes[i].t + dayOffset < fixes[i - 1].t - 3600) dayOffset += 86400;
    fixes[i].t += dayOffset;
  }
  fixes.sort((p, q) => p.t - q.t);

  if (extDecl) {
    try {
      const n = pyInt(extDecl.slice(1, 3));
      const ends: number[] = [];
      for (let k = 0; k < n; k++) ends.push(pyInt(extDecl.slice(3 + 7 * k + 2, 3 + 7 * k + 4)));
      const lengths = raw.filter((l) => l.startsWith('B')).map((l) => l.length);
      if (ends.length === 0 || lengths.length === 0) throw new ValueError('empty');
      const declaredEnd = Math.max(...ends);
      const actual = Math.max(...lengths);
      if (declaredEnd !== actual) {
        warnings.push(
          `I-record declares extensions out to column ${declaredEnd} ` +
            `but B records are ${actual} characters - logger extension ` +
            `fields (speed/vario) are unreliable in this file. All ` +
            `figures below are derived from positions and times.`,
        );
      }
    } catch (e) {
      if (!(e instanceof ValueError)) throw e;
    }
  }

  return { header, fixes, task, warnings };
}

/**
 * Pressure altitude is smoother, so it wins where it is alive. Many FLARM and
 * OGN traces write 00000 throughout, in which case fall back to GNSS.
 */
export function chooseAltitude(fixes: Fix[]): 'pressure' | 'GNSS' {
  let pmin = Infinity;
  let pmax = -Infinity;
  for (const f of fixes) {
    if (f.palt < pmin) pmin = f.palt;
    if (f.palt > pmax) pmax = f.palt;
  }
  const pOk = pmax - pmin > 100 && pmin > -500 && pmin < 15000;
  for (const f of fixes) f.alt = pOk ? f.palt : f.galt;
  return pOk ? 'pressure' : 'GNSS';
}
