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

/** `statistics.mean`. Throws on an empty sequence, as Python does. */
export function mean(xs: readonly number[]): number {
  if (xs.length === 0) throw new Error('mean requires at least one data point');
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** `statistics.median`: middle value, or the mean of the two middle values. */
export function median(xs: readonly number[]): number {
  if (xs.length === 0) throw new Error('median requires at least one data point');
  const s = [...xs].sort((a, b) => a - b);
  const i = s.length >> 1;
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
}

/** `statistics.pstdev`: population standard deviation. */
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

export const degrees = (rad: number): number => (rad * 180) / Math.PI;
export const radians = (deg: number): number => (deg * Math.PI) / 180;
