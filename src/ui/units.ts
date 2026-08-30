/**
 * Unit handling and formatting.
 *
 * One system at a time, never mixed within a view. Times are UTC throughout
 * and labelled as such, because that is what the trace contains.
 */

export type UnitSystem = 'imperial' | 'metric';

const KT = 1.943844;
const FT = 3.280840;
const STORAGE_KEY = 'igc-analyser:units';

let current: UnitSystem = 'imperial';

export function loadUnits(): UnitSystem {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'metric' || v === 'imperial') current = v;
  } catch {
    // Private browsing, or storage disabled. The default is fine.
  }
  return current;
}

export function setUnits(u: UnitSystem): void {
  current = u;
  try {
    localStorage.setItem(STORAGE_KEY, u);
  } catch {
    // Not being able to remember the preference is not worth surfacing.
  }
}

export const units = (): UnitSystem => current;

/** Height. Feet by default, because that is what British gliding flies on. */
export function height(m: number, digits = 0): string {
  return current === 'imperial'
    ? `${fmt(m * FT, digits)} ft`
    : `${fmt(m, digits)} m`;
}

export const heightValue = (m: number): number => (current === 'imperial' ? m * FT : m);
export const heightUnit = (): string => (current === 'imperial' ? 'ft' : 'm');

/** Climb rate, always signed: the sign is the whole point. */
export function climb(ms: number): string {
  return current === 'imperial'
    ? `${ms >= 0 ? '+' : ''}${fmt(ms * KT, 1)} kt`
    : `${ms >= 0 ? '+' : ''}${fmt(ms, 2)} m/s`;
}

export const climbValue = (ms: number): number => (current === 'imperial' ? ms * KT : ms);
export const climbUnit = (): string => (current === 'imperial' ? 'kt' : 'm/s');

/** Airspeed. Knots in imperial, km/h in metric. */
export function airspeed(ms: number): string {
  return current === 'imperial' ? `${fmt(ms * KT, 0)} kt` : `${fmt(ms * 3.6, 0)} km/h`;
}

/** Wind speed. Knots either way: gliding uses knots for wind in both systems. */
export const windSpeed = (ms: number): string => `${fmt(ms * KT, 0)} kt`;

/** Distance. Kilometres in both systems. */
export const distance = (m: number, digits = 0): string => `${fmt(m / 1000, digits)} km`;

/** Task speed. km/h in both systems. */
export const taskSpeed = (ms: number): string => `${fmt(ms * 3.6, 0)} km/h`;

/** Seconds since midnight UTC as HH:MM:SS. */
export function hms(t: number): string {
  const s = Math.floor(t) % 86400;
  return (
    `${String(Math.floor(s / 3600)).padStart(2, '0')}:` +
    `${String(Math.floor(s / 60) % 60).padStart(2, '0')}:` +
    `${String(s % 60).padStart(2, '0')}`
  );
}

/** Seconds since midnight UTC as HH:MM. */
export function hm(t: number): string {
  const s = Math.floor(t) % 86400;
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}`;
}

/** A duration as M:SS, or H:MM:SS once it runs past an hour. */
export function duration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor(s / 60) % 60;
  const ss = s % 60;
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
    : `${m}:${String(ss).padStart(2, '0')}`;
}

/** Thousands separators, and no trailing `.0` pretending to be precision. */
export function fmt(x: number, digits = 0): string {
  if (!Number.isFinite(x)) return '-';
  return x.toLocaleString('en-GB', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export const percent = (frac: number): string => `${Math.round(frac * 100)}%`;
