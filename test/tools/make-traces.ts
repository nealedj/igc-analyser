/**
 * Generate the synthetic IGC fixtures in `test/golden/`.
 *
 * The fixtures are synthetic on purpose. This repository is public, and a real
 * trace is somebody's flight: it carries their name, their registration and
 * where they live and fly. Synthetic traces also let the set span the cases
 * that actually need covering — a wave flight, a ridge day, a coarse
 * ground-station trace, a logger with a lying I record — rather than whatever
 * happened to be to hand.
 *
 * Deterministic: same seed, same bytes. Run with `npm run make-traces`.
 * Drop real `.igc` files into `test/golden/` and they are picked up too.
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'golden');

/** mulberry32: small, fast, and identical across runs and platforms. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const R = 6371000.0;
const D2R = Math.PI / 180;

interface Opts {
  seed: number;
  date: string; // DDMMYY
  gliderType: string;
  gliderId: string;
  pilot: string;
  logger: string;
  crew2?: string;
  /** Wind the air is moving towards, m/s, in (east, north). */
  wind: [number, number];
  startTime: number; // seconds since midnight UTC
  lat: number;
  lon: number;
  groundAlt: number;
  /** Seconds between fixes. */
  interval: number;
  /** Positional noise, metres, 1 sigma. */
  noise: number;
  /** Write 00000 in the pressure-altitude column throughout. */
  deadPressureAlt?: boolean;
  /** Declare I-record extensions past the end of the B records. */
  lyingIRecord?: boolean;
  /** Randomly drop fixes with this probability, plus occasional long gaps. */
  dropouts?: number;
  task?: { name: string; lat: number; lon: number }[];
}

class Flight {
  t: number;
  lat: number;
  lon: number;
  alt: number;
  hdg = 0;
  private rand: () => number;
  private o: Opts;
  private fixes: { t: number; lat: number; lon: number; alt: number }[] = [];

  constructor(o: Opts) {
    this.o = o;
    this.rand = rng(o.seed);
    this.t = o.startTime;
    this.lat = o.lat;
    this.lon = o.lon;
    this.alt = o.groundAlt;
  }

  /** Box-Muller, for position jitter that looks like GPS rather than a saw. */
  private gauss(): number {
    const u = Math.max(1e-9, this.rand());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.rand());
  }

  private step(dt: number, tas: number, climb: number, turn: number): void {
    this.hdg = (this.hdg + turn * dt) % 360;
    const h = this.hdg * D2R;
    // Air velocity in (east, north), plus the wind the air itself carries.
    const vx = Math.sin(h) * tas + this.o.wind[0];
    const vy = Math.cos(h) * tas + this.o.wind[1];
    this.lat += ((vy * dt) / R) / D2R;
    this.lon += ((vx * dt) / (R * Math.cos(this.lat * D2R))) / D2R;
    this.alt += climb * dt;
    this.t += dt;
    this.emit();
  }

  private emit(): void {
    const n = this.o.noise;
    const jl = n ? (this.gauss() * n) / R / D2R : 0;
    const jo = n ? (this.gauss() * n) / (R * Math.cos(this.lat * D2R)) / D2R : 0;
    this.fixes.push({
      t: this.t,
      lat: this.lat + jl,
      lon: this.lon + jo,
      alt: this.alt + (n ? this.gauss() * (n / 3) : 0),
    });
  }

  /** Sit still on the ground. */
  ground(dur: number): this {
    for (let s = 0; s < dur; s += this.o.interval) this.step(this.o.interval, 0, 0, 0);
    return this;
  }

  /** Straight-ish flight: gentle wander so the track is not a ruler line. */
  cruise(dur: number, hdg: number, tas: number, climb: number): this {
    this.hdg = hdg;
    for (let s = 0; s < dur; s += this.o.interval) {
      const wander = (this.rand() - 0.5) * 1.2;
      this.step(this.o.interval, tas + (this.rand() - 0.5) * 4, climb, wander);
    }
    return this;
  }

  /** Circling at a given turn rate; `turn` sign picks the direction. */
  circle(dur: number, climb: number, turn: number, tas: number): this {
    for (let s = 0; s < dur; s += this.o.interval) {
      const c = climb * (0.75 + 0.5 * this.rand());
      this.step(this.o.interval, tas, c, turn + (this.rand() - 0.5) * 1.5);
    }
    return this;
  }

  /** Aerotow: a steady climb at tow speed with a lazy weave. */
  tow(dur: number, climb: number, tas: number): this {
    for (let s = 0; s < dur; s += this.o.interval) {
      this.step(this.o.interval, tas, climb, Math.sin(s / 25) * 2.5);
    }
    return this;
  }

  /** Winch: short, steep, and slow over the ground. */
  winch(dur: number, climb: number): this {
    for (let s = 0; s < dur; s += this.o.interval) {
      this.step(this.o.interval, 16 + s * 0.1, climb, 0);
    }
    return this;
  }

  /** A ridge beat: out along the ridge, procedure turn, and back. */
  beat(legs: number, dur: number, hdg: number, tas: number): this {
    for (let i = 0; i < legs; i++) {
      this.cruise(dur, i % 2 ? (hdg + 180) % 360 : hdg, tas, i % 2 ? 0.1 : 0.15);
      // The turn at the end of a beat is a genuine 180, not a thermal circle.
      this.circle(20, -0.3, i % 2 ? -9 : 9, tas * 0.85);
    }
    return this;
  }

  build(): string {
    const o = this.o;
    const L: string[] = [];
    L.push('AXGD001 synthetic fixture');
    L.push(`HFDTE${o.date}`);
    L.push('HFFXA035');
    L.push(`HFPLTPILOTINCHARGE:${o.pilot}`);
    L.push(`HFCM2CREW2:${o.crew2 ?? ''}`);
    L.push(`HFGTYGLIDERTYPE:${o.gliderType}`);
    L.push(`HFGIDGLIDERID:${o.gliderId}`);
    L.push('HFCIDCOMPETITIONID:');
    L.push(`HFFTYFRTYPE:${o.logger}`);
    L.push('HFGPS:synthetic');
    L.push('HFDTM100DATUM:WGS-1984');
    // Two extensions: FXA at 36-38, SIU at 39-40, so B records are 40 chars.
    L.push(o.lyingIRecord ? 'I023638FXA3941SIU' : 'I023638FXA3940SIU');

    if (o.task) {
      L.push(`C${o.date}${hhmmss(o.startTime)}${o.date}000${o.task.length - 2}`);
      for (const p of o.task) L.push(`C${latDM(p.lat)}${lonDM(p.lon)}${p.name}`);
    }

    let dropUntil = -1;
    let i = 0;
    for (const f of this.fixes) {
      i++;
      if (o.dropouts) {
        if (f.t < dropUntil) continue;
        // A scattering of single misses, and now and then a real outage.
        if (this.rand() < o.dropouts) continue;
        if (this.rand() < 0.0025) {
          dropUntil = f.t + 40 + Math.floor(this.rand() * 60);
          continue;
        }
      }
      const palt = o.deadPressureAlt ? 0 : Math.round(f.alt);
      const galt = Math.round(f.alt + 12);
      L.push(
        `B${hhmmss(f.t)}${latDM(f.lat)}${lonDM(f.lon)}A${alt5(palt)}${alt5(galt)}` +
          `${String(Math.min(999, 8 + (i % 5))).padStart(3, '0')}` +
          `${String(9 + (i % 3)).padStart(2, '0')}`,
      );
    }
    L.push(`LXGD synthetic fixture, seed ${o.seed}`);
    return L.join('\r\n') + '\r\n';
  }
}

const hhmmss = (t: number): string => {
  const s = Math.floor(t) % 86400;
  return (
    String(Math.floor(s / 3600)).padStart(2, '0') +
    String(Math.floor(s / 60) % 60).padStart(2, '0') +
    String(s % 60).padStart(2, '0')
  );
};

function latDM(lat: number): string {
  const h = lat < 0 ? 'S' : 'N';
  const a = Math.abs(lat);
  const d = Math.floor(a);
  const m = Math.round((a - d) * 60 * 1000);
  return `${String(d).padStart(2, '0')}${String(m).padStart(5, '0')}${h}`;
}

function lonDM(lon: number): string {
  const h = lon < 0 ? 'W' : 'E';
  const a = Math.abs(lon);
  const d = Math.floor(a);
  const m = Math.round((a - d) * 60 * 1000);
  return `${String(d).padStart(3, '0')}${String(m).padStart(5, '0')}${h}`;
}

const alt5 = (m: number): string =>
  m < 0 ? `-${String(Math.min(9999, -m)).padStart(4, '0')}` : String(Math.min(99999, m)).padStart(5, '0');

// --------------------------------------------------------------- the fixtures

const traces: Record<string, () => string> = {
  /** A classic thermal day: aerotow, eight climbs, cruises between them. */
  'thermal-day': () => {
    const f = new Flight({
      seed: 1, date: '140623', gliderType: 'ASW 27', gliderId: 'G-CKPT',
      pilot: 'Fixture Pilot', logger: 'LXNAV,LX9000', wind: [4.5, 2.0],
      startTime: 11 * 3600 + 42 * 60, lat: 51.7, lon: -1.9, groundAlt: 150,
      interval: 1, noise: 2.5,
      task: [
        { name: 'ASTON DOWN', lat: 51.7, lon: -1.9 },
        { name: 'EDGEHILL', lat: 52.13, lon: -1.45 },
        { name: 'ASTON DOWN', lat: 51.7, lon: -1.9 },
      ],
    });
    f.ground(90).tow(230, 2.4, 30);
    const climbs = [
      [190, 2.1, 18], [240, 3.0, 20], [170, 1.6, 16], [300, 3.6, 21],
      [210, 2.4, 19], [260, 3.2, 20], [150, 1.4, 15], [280, 2.8, 18],
    ];
    const heads = [35, 60, 25, 200, 215, 190, 240, 210];
    climbs.forEach((c, i) => {
      f.circle(c[0], c[1], i % 2 ? c[2] : -c[2], 28);
      f.cruise(200 + i * 20, heads[i], 33, -0.9);
    });
    f.cruise(240, 200, 30, -1.1).circle(60, 0.4, 16, 27).cruise(300, 200, 28, -1.3);
    return f.build();
  },

  /** Ridge: winch launch, long beats, strong wind, very little circling. */
  'ridge-day': () => {
    const f = new Flight({
      seed: 2, date: '030223', gliderType: 'SZD-51 Junior', gliderId: 'G-CJNR',
      pilot: 'Fixture Pilot', logger: 'LXNAV,Nano3', wind: [-11.5, 1.5],
      startTime: 10 * 3600 + 5 * 60, lat: 52.02, lon: -3.35, groundAlt: 380,
      interval: 1, noise: 2.0,
    });
    f.ground(60).winch(42, 8.5);
    f.beat(9, 420, 20, 27);
    f.circle(120, 1.2, 17, 26);
    f.beat(4, 380, 20, 27);
    f.cruise(260, 200, 25, -1.0);
    return f.build();
  },

  /** Wave: aerotow, then long straight climbs at height in a strong wind. */
  wave: () => {
    const f = new Flight({
      seed: 3, date: '211122', gliderType: 'Duo Discus', gliderId: 'G-CDUO',
      pilot: 'Fixture Pilot', crew2: 'Fixture P2', logger: 'LXNAV,LX8000',
      wind: [-18.0, 4.0], startTime: 9 * 3600 + 30 * 60,
      lat: 52.9, lon: -3.6, groundAlt: 200, interval: 1, noise: 2.0,
    });
    f.ground(90).tow(300, 2.2, 31);
    f.cruise(180, 250, 26, -0.6);
    f.cruise(900, 250, 24, 2.6);   // the primary
    f.cruise(300, 70, 30, -0.4);
    f.cruise(780, 250, 24, 2.2);   // back into it, higher
    f.circle(90, 0.8, 14, 28);     // one exploratory turn
    f.cruise(600, 250, 25, 1.4);
    f.cruise(700, 90, 38, -2.2);   // descent and run home
    return f.build();
  },

  /** A short circuit: winch launch, one circuit, land. Nothing to analyse. */
  'short-circuit': () => {
    const f = new Flight({
      seed: 4, date: '090923', gliderType: 'ASK 21', gliderId: 'G-CKTU',
      pilot: 'Fixture Pilot', crew2: 'Fixture Student', logger: 'LXNAV,Nano4',
      wind: [2.0, -1.0], startTime: 14 * 3600 + 18 * 60,
      lat: 51.68, lon: -2.05, groundAlt: 180, interval: 1, noise: 2.0,
    });
    f.ground(45).winch(38, 9.0)
      .cruise(60, 180, 26, -1.2).cruise(70, 270, 26, -1.3)
      .cruise(80, 0, 26, -1.2).cruise(60, 90, 25, -1.4)
      .cruise(55, 180, 24, -1.6).ground(30);
    return f.build();
  },

  /** Two-seat trainer, moderate thermal day, instructional pace. */
  'two-seater': () => {
    const f = new Flight({
      seed: 5, date: '270523', gliderType: 'ASK 21', gliderId: 'G-CKTU',
      pilot: 'Fixture Instructor', crew2: 'Fixture Student',
      logger: 'LXNAV,Nano4', wind: [3.0, 3.5],
      startTime: 13 * 3600 + 5 * 60, lat: 51.68, lon: -2.05,
      groundAlt: 180, interval: 1, noise: 2.5,
    });
    f.ground(60).tow(280, 2.1, 29);
    const climbs: [number, number, number][] = [
      [220, 1.5, 15], [180, 2.2, 17], [260, 1.2, 13], [200, 1.9, 16],
    ];
    climbs.forEach((c, i) => {
      f.circle(c[0], c[1], i % 2 ? c[2] : -c[2], 27);
      f.cruise(180, [90, 180, 270, 0][i], 28, -0.9);
    });
    f.cruise(300, 200, 27, -1.2);
    return f.build();
  },

  /**
   * Ground-station trace: 5 s nominal, dropouts, minute-plus outages, and a
   * dead pressure-altitude channel. Exercises the coarse-trace warning and the
   * GNSS fallback together.
   */
  'coarse-ogn': () => {
    const f = new Flight({
      seed: 6, date: '180722', gliderType: 'Standard Cirrus', gliderId: 'G-CSTC',
      pilot: '', logger: 'OGN,ground station', wind: [5.0, -3.0],
      startTime: 12 * 3600 + 11 * 60, lat: 51.55, lon: -1.72,
      groundAlt: 120, interval: 5, noise: 9.0, deadPressureAlt: true,
      dropouts: 0.12,
    });
    f.ground(120).tow(240, 2.3, 30);
    const climbs: [number, number, number][] = [
      [240, 2.6, 19], [300, 3.1, 20], [200, 1.8, 16], [260, 2.9, 18],
    ];
    climbs.forEach((c, i) => {
      f.circle(c[0], c[1], i % 2 ? c[2] : -c[2], 28);
      f.cruise(280, [45, 120, 225, 300][i], 32, -1.0);
    });
    f.cruise(420, 200, 30, -1.2);
    return f.build();
  },

  /**
   * A logger whose I record declares extensions past the end of its own B
   * records. The warning this raises is the whole point of the fixture.
   */
  'lying-i-record': () => {
    const f = new Flight({
      seed: 7, date: '020822', gliderType: 'LS4', gliderId: 'G-CLS4',
      pilot: 'Fixture Pilot', logger: 'FLARM,unknown', wind: [-6.0, 2.5],
      startTime: 11 * 3600 + 55 * 60, lat: 52.4, lon: -0.85,
      groundAlt: 90, interval: 2, noise: 4.0, lyingIRecord: true,
    });
    f.ground(60).tow(260, 2.2, 30);
    const climbs: [number, number, number][] = [
      [220, 2.4, 18], [280, 3.3, 20], [190, 1.7, 15],
    ];
    climbs.forEach((c, i) => {
      f.circle(c[0], c[1], i % 2 ? c[2] : -c[2], 28);
      f.cruise(240, [70, 160, 250][i], 33, -1.0);
    });
    f.cruise(360, 250, 30, -1.1);
    return f.build();
  },

  /** A late evening flight that runs past 00:00 UTC, to catch the rollover. */
  'midnight-rollover': () => {
    const f = new Flight({
      seed: 8, date: '211221', gliderType: 'Grob G109 / motorglider',
      gliderId: 'G-CMGL', pilot: 'Fixture Pilot', logger: 'LXNAV,Nano3',
      wind: [2.0, 1.0], startTime: 23 * 3600 + 44 * 60,
      lat: 50.85, lon: -0.42, groundAlt: 60, interval: 1, noise: 2.0,
    });
    f.ground(45).tow(320, 2.4, 30)
      .cruise(300, 90, 30, -0.8).circle(120, 1.0, 15, 27)
      .cruise(400, 270, 30, -0.9).cruise(240, 180, 28, -1.1);
    return f.build();
  },
};

for (const [name, make] of Object.entries(traces)) {
  const path = join(OUT, `${name}.igc`);
  writeFileSync(path, make(), 'latin1');
  console.log(`wrote ${path}`);
}
