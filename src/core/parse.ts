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

import type { Fix, Header, ParsedIgc, TaskDeclaration, TaskPoint, TaskRole } from './types.ts';
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

/**
 * The header that opens a `C` block.
 *
 * Per the IGC specification it is `C` + `DDMMYY` + `HHMMSS` + `DDMMYY` +
 * `NNNN` + `NN` + free text: declaration date and time, flight date, task
 * number, and the number of turnpoints between start and finish. Plenty of
 * loggers write a short or padded version of it, so every field is optional
 * and a header that cannot be read is simply a header with nothing in it.
 */
export function parseDeclaration(line: string): TaskDeclaration {
  const d: TaskDeclaration = { description: line.slice(25).trim() };
  const digits = (from: number, to: number): number | null => {
    const raw = line.slice(from, to);
    if (raw.length !== to - from || !/^\d+$/.test(raw)) return null;
    return Number(raw);
  };
  const dd = digits(1, 3), mm = digits(3, 5), yy = digits(5, 7);
  if (dd !== null && mm !== null && yy !== null && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
    d.declared_date = `20${String(yy).padStart(2, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  }
  const hh = digits(7, 9), mi = digits(9, 11), ss = digits(11, 13);
  if (hh !== null && mi !== null && ss !== null && hh < 24 && mi < 60 && ss < 60) {
    d.declared_time_s = hh * 3600 + mi * 60 + ss;
  }
  const tps = digits(23, 25);
  if (tps !== null) d.turnpoints = tps;
  return d;
}

const TAKEOFF_NAME = /^take\s*-?\s*off/i;
const LANDING_NAME = /^land(ing)?\b/i;

/**
 * Give each C record the role its position in the block says it has.
 *
 * The block is take-off, start, turnpoints, finish, landing. Only the middle
 * three are the task, and the difference is not cosmetic: counting the
 * take-off and landing records as turnpoints turns a 300 km triangle into a
 * five-leg course of some other length, drawn on the map as a detour to the
 * launch point.
 *
 * The turnpoint count in the header is the evidence for the layout. Without
 * it - short headers are common - a block that names its first and last
 * records TAKEOFF and LANDING is taken at its word. Failing both, the records
 * are left unlabelled rather than guessed at, and everything downstream treats
 * them as the task, which is what this did before roles existed.
 */
export function assignRoles(
  raw: (TaskPoint | null)[],
  declaration: TaskDeclaration | null,
): TaskPoint[] {
  const n = raw.length;
  const declared = declaration?.turnpoints;
  const named = (p: TaskPoint | null, re: RegExp): boolean => p !== null && re.test(p.name);

  let hasEnds: boolean;
  if (declared !== undefined && n === declared + 4) hasEnds = true;
  else if (declared !== undefined && n === declared + 2) hasEnds = false;
  else if (n >= 4 && named(raw[0], TAKEOFF_NAME) && named(raw[n - 1], LANDING_NAME)) hasEnds = true;
  else if (n >= 2 && declared === undefined) hasEnds = false;
  else return raw.filter((p): p is TaskPoint => p !== null);

  const role = (i: number): TaskRole => {
    const first = hasEnds ? 1 : 0;
    const last = hasEnds ? n - 2 : n - 1;
    if (i < first) return 'takeoff';
    if (i > last) return 'landing';
    if (i === first) return 'start';
    if (i === last) return 'finish';
    return 'turn';
  };

  const out: TaskPoint[] = [];
  raw.forEach((p, i) => {
    if (p !== null) out.push({ ...p, role: role(i) });
  });
  return out;
}

export function parseIgc(text: string): ParsedIgc {
  const header: Header = {};
  const fixes: Fix[] = [];
  // C records in file order, coordinates and all, before roles are assigned.
  // A point with no coordinates is kept as a hole rather than dropped: the
  // roles are positional, and a logger that writes an all-zero TAKEOFF record
  // would otherwise shift every role after it by one.
  const cPoints: (TaskPoint | null)[] = [];
  let declaration: TaskDeclaration | null = null;
  const warnings: string[] = [];
  let extDecl: string | null = null;
  const raw = splitLines(text);

  for (const line of raw) {
    if (!line) continue;
    const c = line[0].toUpperCase();
    if (c === 'H') {
      const up = line.toUpperCase();
      if (up.startsWith('HFDTE')) {
        const d = line.slice(5).replace(/\D/g, '').slice(0, 6);
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
          cPoints.push(
            Math.abs(lat) > 0.001 || Math.abs(lon) > 0.001
              ? { lat, lon, name: line.slice(18).trim() }
              : null,
          );
        } catch (e) {
          if (!(e instanceof ValueError)) throw e;
          cPoints.push(null);
        }
      } else if (declaration === null) {
        declaration = parseDeclaration(line);
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

  return { header, fixes, task: assignRoles(cPoints, declaration), declaration, warnings };
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
