/**
 * Small helpers that reproduce Python semantics exactly.
 *
 * The reference implementation in `reference/igc_analyse.py` is the
 * specification for this port, and the golden fixtures are its JSON output.
 * Several Python behaviours differ from the obvious JavaScript equivalent in
 * ways that show up in those fixtures, so they are reproduced here rather than
 * papered over at each call site.
 */

/** Python's `%`: the result takes the sign of the divisor, not the dividend. */
export function pyMod(a: number, b: number): number {
  const r = a % b;
  return r !== 0 && r < 0 !== b < 0 ? r + b : r;
}

/**
 * `statistics.mean`.
 *
 * CPython does not sum in floating point: `statistics._sum` accumulates exact
 * `Fraction`s and rounds once, at the end. Summing left to right in `double`
 * instead lands a unit in the last place away from it often enough to matter,
 * and it matters here because the mean feeds two discrete thresholds - the
 * `|turn rate| > 6 deg/s` that decides whether a fix is circling, and the
 * projection origin that every heading is ultimately derived from. One ulp
 * there moves a phase boundary by a whole fix, and the difference cascades
 * through the climb table.
 *
 * So this is exact too: every double is a dyadic rational, the sum of them is
 * computed in BigInt without loss, and the division by `n` is rounded once.
 */
export function mean(xs: readonly number[]): number {
  if (xs.length === 0) throw new Error('mean requires at least one data point');
  if (xs.length === 1) return xs[0];

  let minExp = Infinity;
  const parts: { m: bigint; e: number }[] = [];
  for (const x of xs) {
    if (!Number.isFinite(x)) {
      // Match the float path rather than inventing an exact answer for NaN.
      let s = 0;
      for (const v of xs) s += v;
      return s / xs.length;
    }
    const d = decompose(x);
    parts.push(d);
    if (d.e < minExp) minExp = d.e;
  }

  let total = 0n;
  for (const { m, e } of parts) total += m << BigInt(e - minExp);

  // mean = (total * 2^minExp) / n
  let num = total;
  let den = BigInt(xs.length);
  if (minExp >= 0) num <<= BigInt(minExp);
  else den <<= BigInt(-minExp);
  return ratioToDouble(num, den);
}

/** Split a finite double into `m * 2^e` exactly, with `m` signed. */
function decompose(x: number): { m: bigint; e: number } {
  if (x === 0) return { m: 0n, e: 0 };
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const bits = buf.getBigUint64(0);
  const neg = (bits >> 63n) === 1n;
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const mantBits = bits & 0xfffffffffffffn;
  const m = expBits === 0 ? mantBits : mantBits | 0x10000000000000n;
  const e = (expBits === 0 ? 1 : expBits) - 1075;
  return { m: neg ? -m : m, e };
}

const bitLength = (b: bigint): number => b.toString(2).length;

/** The nearest double to `num / den`, ties to even. `den` must be positive. */
function ratioToDouble(num: bigint, den: bigint): number {
  if (num === 0n) return 0;
  const neg = num < 0n;
  let n = neg ? -num : num;
  let d = den;

  // Aim for a 54-bit quotient, so there is a guard bit below the 53 kept.
  const approx = bitLength(n) - bitLength(d);
  const shift = 54 - approx;
  if (shift > 0) n <<= BigInt(shift);
  else if (shift < 0) d <<= BigInt(-shift);

  let q = n / d;
  const rem = n % d;

  const drop = bitLength(q) - 53;
  let exp = -shift;
  if (drop > 0) {
    const mask = (1n << BigInt(drop)) - 1n;
    const dropped = q & mask;
    const half = 1n << BigInt(drop - 1);
    q >>= BigInt(drop);
    exp += drop;
    const above = dropped > half || (dropped === half && rem !== 0n);
    const tie = dropped === half && rem === 0n;
    if (above || (tie && (q & 1n) === 1n)) q += 1n;
    if (bitLength(q) > 53) {
      q >>= 1n;
      exp += 1;
    }
  }

  const out = Number(q) * 2 ** exp;
  // Overflow or underflow to a subnormal: the exact path has nothing to add,
  // and no figure in this analysis lives out there anyway.
  const val = Number.isFinite(out) && (out !== 0 || q === 0n) ? out : Number(num) / Number(den);
  return neg ? -val : val;
}

/** `statistics.median`: middle value, or the mean of the two middle values. */
export function median(xs: readonly number[]): number {
  if (xs.length === 0) throw new Error('median requires at least one data point');
  const s = [...xs].sort((a, b) => a - b);
  const i = s.length >> 1;
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
}

/** `statistics.pstdev`: population standard deviation. */
/**
 * `statistics.pstdev`: population standard deviation.
 *
 * The mean it centres on is exact, as above. The sum of squares is not - the
 * oracle keeps that exact too - so this can sit a unit in the last place away
 * from CPython. It only ever reaches a continuous output (`sd_ias_kmh`), never
 * a threshold, so the golden comparison's float tolerance covers it.
 */
export function pstdev(xs: readonly number[]): number {
  if (xs.length === 0) throw new Error('pstdev requires at least one data point');
  const m = mean(xs);
  let acc = 0;
  for (const x of xs) acc += (x - m) ** 2;
  return Math.sqrt(acc / xs.length);
}

/**
 * `round(x, ndigits)` for floats: round-half-even applied to the exact binary
 * value of the double, not to its shortest decimal representation.
 *
 * `Number.prototype.toFixed` rounds halves away from zero, which would put the
 * `profile` latitudes and longitudes one unit in the last place away from the
 * oracle whenever a coordinate lands exactly on a half.
 */
export function pyRound(x: number, ndigits = 0): number {
  if (!Number.isFinite(x)) return x;
  // 20 significant digits is enough to see past any double's shortest form
  // while staying inside the exact decimal expansion of the value.
  const exact = exactDecimal(x);
  const rounded = roundDecimalHalfEven(exact, ndigits);
  return Number(rounded);
}

/** `f"{x:.Nf}"`: fixed-point formatting with round-half-even. */
export function pyFixed(x: number, ndigits: number): string {
  if (Number.isNaN(x)) return 'nan';
  if (!Number.isFinite(x)) return x > 0 ? 'inf' : '-inf';
  const neg = x < 0 || Object.is(x, -0);
  const s = roundDecimalHalfEven(exactDecimal(Math.abs(x)), ndigits);
  let [int, frac = ''] = s.split('.');
  if (ndigits > 0) frac = frac.padEnd(ndigits, '0').slice(0, ndigits);
  const body = ndigits > 0 ? `${int}.${frac}` : int;
  // Python keeps the sign even when the magnitude rounds away: -0.4 -> "-0".
  return neg ? `-${body}` : body;
}

/**
 * The exact decimal expansion of a double. Every double is exactly
 * representable in decimal, so this terminates; BigInt keeps it exact.
 */
function exactDecimal(x: number): string {
  if (Number.isInteger(x) && Math.abs(x) < 2 ** 53) return String(x);
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const bits = buf.getBigUint64(0);
  const sign = bits >> 63n ? -1n : 1n;
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const mantBits = bits & 0xfffffffffffffn;
  // Subnormals have an implicit leading 0 rather than 1.
  const mant = expBits === 0 ? mantBits : mantBits | 0x10000000000000n;
  const exp = (expBits === 0 ? 1 : expBits) - 1075;
  let digits: string;
  if (exp >= 0) {
    digits = String(mant << BigInt(exp));
    return (sign < 0n ? '-' : '') + digits;
  }
  // value = mant / 2^-exp = mant * 5^-exp / 10^-exp
  const shift = -exp;
  const scaled = mant * 5n ** BigInt(shift);
  digits = String(scaled).padStart(shift + 1, '0');
  const int = digits.slice(0, digits.length - shift);
  const frac = digits.slice(digits.length - shift).replace(/0+$/, '');
  return (sign < 0n ? '-' : '') + (frac ? `${int}.${frac}` : int);
}

/** Round an exact decimal string to `ndigits` places, ties to even. */
function roundDecimalHalfEven(s: string, ndigits: number): string {
  const neg = s.startsWith('-');
  if (neg) s = s.slice(1);
  let [int, frac = ''] = s.split('.');
  if (frac.length <= ndigits) return (neg ? '-' : '') + (frac ? `${int}.${frac}` : int);

  const keep = frac.slice(0, ndigits);
  const rest = frac.slice(ndigits);
  const digits = int + keep; // the integer we are rounding, scaled by 10^ndigits
  let n = BigInt(digits);

  const first = rest[0];
  const restNonZero = /[1-9]/.test(rest.slice(1));
  if (first > '5' || (first === '5' && restNonZero)) n += 1n;
  else if (first === '5' && !restNonZero && n % 2n === 1n) n += 1n;

  let out = String(n).padStart(ndigits + 1, '0');
  const body =
    ndigits > 0
      ? `${out.slice(0, out.length - ndigits)}.${out.slice(out.length - ndigits)}`
      : out;
  return (neg ? '-' : '') + body;
}

/**
 * `int(s)`: accepts surrounding whitespace and a sign, rejects anything else.
 * The oracle relies on this throwing to skip malformed records.
 */
export function pyInt(s: string): number {
  const t = s.trim();
  if (!/^[+-]?\d+$/.test(t)) throw new ValueError(`invalid literal for int(): ${s}`);
  return Number(t);
}

/** `float(s)`, restricted to the plain decimal forms an IGC file can contain. */
export function pyFloat(s: string): number {
  const t = s.trim();
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) {
    throw new ValueError(`could not convert string to float: ${s}`);
  }
  return Number(t);
}

/** Stands in for Python's ValueError so call sites can catch it specifically. */
export class ValueError extends Error {
  override name = 'ValueError';
}

/*
 * CPython precomputes these constants and multiplies once:
 *
 *   static const double degToRad = Py_MATH_PI / 180.0;
 *   static const double radToDeg = 180.0 / Py_MATH_PI;
 *
 * `x * (180/pi)` and `(x * 180) / pi` are not the same double. The difference
 * is one unit in the last place, which is invisible in every continuous figure
 * here and decisive in `perCircle`, where an accumulated heading is tested
 * against exactly 360 and a single ulp moves a circle boundary by a whole fix.
 */
const RAD_TO_DEG = 180.0 / Math.PI;
const DEG_TO_RAD = Math.PI / 180.0;

export const degrees = (rad: number): number => rad * RAD_TO_DEG;
export const radians = (deg: number): number => deg * DEG_TO_RAD;
