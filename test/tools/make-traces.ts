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
  /**
   * A declared task, written as a spec-shaped C block: the header, then
   * take-off, start, the turnpoints, finish and landing in that order.
   * `points` is the scoring part - start, turnpoints, finish - and the
   * take-off and landing records are only written if given.
   */
  task?: {
    description?: string;
    takeoff?: Pt;
    points: Pt[];
    landing?: Pt;
  };
}

export interface Pt {
  name: string;
  lat: number;
  lon: number;
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

  private step(dt: number, tas: number, climb: number, turn: number, airborne = true): void {
    this.hdg = (this.hdg + turn * dt) % 360;
    const h = this.hdg * D2R;
    // Air velocity in (east, north), plus the wind the air itself carries.
    // A glider on the ground does not drift with it, which matters: take-off
    // is detected on ground speed, and a windy day would fake one.
    const vx = Math.sin(h) * tas + (airborne ? this.o.wind[0] : 0);
    const vy = Math.cos(h) * tas + (airborne ? this.o.wind[1] : 0);
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

  /** Sit still on the ground. Jitter is cut right down: a stationary
   *  receiver must not read fast enough to look like a take-off. */
  ground(dur: number): this {
    const n = this.o.noise;
    this.o = { ...this.o, noise: n / 8 };
    for (let s = 0; s < dur; s += this.o.interval) this.step(this.o.interval, 0, 0, 0, false);
    this.o = { ...this.o, noise: n };
    return this;
  }

  /** Circle until reaching a target altitude, so flights stay in a band. */
  circleTo(targetAlt: number, climb: number, turn: number, tas: number): this {
    let guard = 0;
    while (this.alt < targetAlt && guard++ < 4000) {
      const c = climb * (0.75 + 0.5 * this.rand());
      this.step(this.o.interval, tas, c, turn + (this.rand() - 0.5) * 1.5);
    }
    return this;
  }

  /** Glide on a heading until down to a target altitude. */
  glideTo(targetAlt: number, hdg: number, tas: number, sink: number): this {
    this.hdg = hdg;
    let guard = 0;
    while (this.alt > targetAlt && guard++ < 6000) {
      const wander = (this.rand() - 0.5) * 1.2;
      this.step(this.o.interval, tas + (this.rand() - 0.5) * 4, sink, wander);
    }
    return this;
  }

  /** A circuit and landing, so the trace ends on the ground like a real one. */
  land(hdg: number): this {
    const g = this.o.groundAlt;
    this.glideTo(g + 200, hdg, 26, -1.6);
    this.glideTo(g + 120, (hdg + 90) % 360, 26, -1.5);
    this.glideTo(g + 5, (hdg + 180) % 360, 25, -1.4);
    this.alt = g;
    // Roll out and stop.
    for (let v = 22; v > 0; v -= 3) this.step(this.o.interval, v, 0, 0, false);
    this.ground(40);
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

  /** Great-circle bearing from where the glider is now, degrees true. */
  private bearingTo(p: Pt): number {
    const p1 = this.lat * D2R;
    const p2 = p.lat * D2R;
    const dl = (p.lon - this.lon) * D2R;
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (Math.atan2(y, x) / D2R + 360) % 360;
  }

  /** Distance from where the glider is now, metres. */
  private rangeTo(p: Pt): number {
    const dy = (p.lat - this.lat) * D2R * R;
    const dx = (p.lon - this.lon) * D2R * R * Math.cos(this.lat * D2R);
    return Math.hypot(dx, dy);
  }

  /**
   * Fly a task leg: cruise towards the turnpoint, stopping to climb whenever
   * the glide runs down to the bottom of the band. The heading is refreshed
   * every minute, so the track is a real course made good rather than a
   * straight line drawn between two points.
   */
  toward(
    p: Pt,
    band: { bottom: number; top: number; climb: number; tas: number; sink: number },
    within = 3000,
  ): this {
    let guard = 0;
    while (this.rangeTo(p) > within && guard++ < 400) {
      if (this.alt < band.bottom) {
        this.circleTo(band.top, band.climb, guard % 2 ? 18 : -18, 28);
        continue;
      }
      const secs = Math.min(60, Math.max(20, this.rangeTo(p) / band.tas));
      this.cruise(secs, this.bearingTo(p), band.tas, band.sink);
    }
    return this;
  }

  /**
   * Final glide: straight at the finish, no climbing, all the way down. The
   * heading is refreshed for the same reason, and the descent rate is set to
   * arrive at roughly the height asked for.
   */
  finalGlide(p: Pt, arriveAlt: number, tas: number): this {
    let guard = 0;
    while (this.rangeTo(p) > 1500 && this.alt > arriveAlt && guard++ < 400) {
      const range = this.rangeTo(p);
      const secs = Math.min(60, Math.max(15, range / tas));
      // Spread the height left over the distance left, so the glide arrives
      // rather than levelling off or diving into the ground.
      const sink = -Math.max(0.2, (this.alt - arriveAlt) / Math.max(1, range / tas));
      this.cruise(secs, this.bearingTo(p), tas, sink);
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
      // C + declaration date + declaration time + flight date + task number +
      // turnpoint count + description, then one record per point. The count
      // excludes the start and the finish, which is what tells a reader
      // whether the take-off and landing records are there.
      const tps = Math.max(0, o.task.points.length - 2);
      const declared = o.startTime - 45 * 60;
      L.push(
        `C${o.date}${hhmmss(declared)}${o.date}0001${String(tps).padStart(2, '0')}` +
          (o.task.description ?? ''),
      );
      const block = [
        ...(o.task.takeoff ? [o.task.takeoff] : []),
        ...o.task.points,
        ...(o.task.landing ? [o.task.landing] : []),
      ];
      for (const p of block) L.push(`C${latDM(p.lat)}${lonDM(p.lon)}${p.name}`);
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
      task: {
        description: 'LOCAL OUT AND RETURN',
        points: [
          { name: 'ASTON DOWN', lat: 51.7, lon: -1.9 },
          { name: 'EDGEHILL', lat: 52.13, lon: -1.45 },
          { name: 'ASTON DOWN', lat: 51.7, lon: -1.9 },
        ],
      },
    });
    // Aerotow to 600 m, then eight climbs worked between 700 m and 1500 m:
    // a good but ordinary UK summer day, ending with a landing.
    f.ground(90).tow(230, 2.4, 30);
    const climbs: [number, number, number][] = [
      [1350, 1.6, 18], [1500, 2.2, 20], [1250, 1.2, 16], [1550, 2.6, 21],
      [1400, 1.8, 19], [1500, 2.4, 20], [1150, 1.1, 15], [1450, 2.1, 18],
    ];
    const heads = [35, 60, 25, 200, 215, 190, 240, 210];
    climbs.forEach((c, i) => {
      f.circleTo(c[0], c[1], i % 2 ? c[2] : -c[2], 28);
      f.glideTo(i === climbs.length - 1 ? 1000 : 850 + (i % 3) * 60, heads[i], 33, -1.8);
    });
    f.land(200);
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
    // Winch to 350 m above the site, then beats along the ridge that hold
    // height, one thermal off the top, and a landing.
    f.ground(60).winch(42, 8.5);
    // Off the wire, nose down, and a short push out to the ridge before
    // contact. Without this the initial climb runs straight on into the beats
    // and the launch reads as a tow.
    f.cruise(70, 250, 32, -1.6);
    f.beat(9, 420, 20, 27);
    f.circleTo(1100, 1.2, 17, 26);
    f.beat(4, 380, 20, 27);
    f.land(200);
    return f.build();
  },

  /** Wave: aerotow, then long straight climbs at height in a strong wind. */
  wave: () => {
    const f = new Flight({
      seed: 3, date: '211122', gliderType: 'Duo Discus', gliderId: 'G-CDUO',
      pilot: 'Fixture Pilot', crew2: 'Fixture P2', logger: 'LXNAV,LX8000',
      wind: [-13.0, 3.0], startTime: 9 * 3600 + 30 * 60,
      lat: 52.9, lon: -3.6, groundAlt: 200, interval: 1, noise: 2.0,
    });
    // Tow into the rotor, contact at about 900 m, then straight climbs in the
    // primary to 4,500 m. Almost no circling at all: that is the signature.
    f.ground(90).tow(300, 2.2, 31);
    f.cruise(180, 250, 26, -0.6);
    f.glideTo(900, 70, 28, -1.2);
    f.cruise(780, 250, 24, 2.4);   // the primary
    f.cruise(300, 70, 30, -0.4);
    f.cruise(600, 250, 24, 2.0);   // back into it, higher
    f.circle(90, 0.8, 14, 28);     // one exploratory turn
    f.cruise(420, 250, 25, 1.2);
    f.glideTo(500, 90, 38, -2.6);  // descent and run home
    f.land(180);
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
      .land(180);
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
      [900, 1.5, 15], [1050, 2.2, 17], [950, 1.2, 13], [1100, 1.9, 16],
    ];
    climbs.forEach((c, i) => {
      f.circleTo(c[0], c[1], i % 2 ? c[2] : -c[2], 27);
      f.glideTo(600, [90, 180, 270, 0][i], 28, -0.9);
    });
    f.land(180);
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
      [1300, 2.6, 19], [1450, 3.1, 20], [1200, 1.8, 16], [1400, 2.9, 18],
    ];
    climbs.forEach((c, i) => {
      f.circleTo(c[0], c[1], i % 2 ? c[2] : -c[2], 28);
      f.glideTo(750, [45, 120, 225, 300][i], 32, -1.0);
    });
    f.land(200);
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
      [1250, 2.4, 18], [1400, 3.3, 20], [1150, 1.7, 15],
    ];
    climbs.forEach((c, i) => {
      f.circleTo(c[0], c[1], i % 2 ? c[2] : -c[2], 28);
      f.glideTo(700, [70, 160, 250][i], 33, -1.0);
    });
    f.land(250);
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
      .glideTo(600, 90, 30, -0.8).circleTo(750, 1.0, 15, 27)
      .glideTo(300, 270, 30, -0.9).land(180);
    return f.build();
  },

  /**
   * A declared 300 km triangle, flown and finished.
   *
   * The case the other fixtures do not cover: a full IGC declaration - header,
   * take-off, start, two turnpoints, finish, landing - and a flight that ends
   * with a long final glide straight into the circuit. Both of those were got
   * wrong before this fixture existed. The take-off and landing records were
   * counted as turnpoints, which turned a 300 km triangle into a five-leg task
   * by way of the launch point; and the glide home and the circuit were one
   * straight run in the trace, reported whole as a twenty-minute landing.
   */
  'declared-300k': () => {
    // Legs of 100, 105 and 95 km: a 300 km triangle, the classic Gold badge
    // distance and the size at which a mis-parsed declaration is obvious.
    const home = { name: 'LASHAM', lat: 51.187, lon: -1.033 };
    const tp1 = { name: 'EDGEHILL', lat: 52.032, lon: -1.528 };
    const tp2 = { name: 'DEVIZES', lat: 51.259, lon: -2.399 };
    // 45 km short of home on the last leg: the top of the final glide.
    const runIn = { name: 'RUN IN', lat: 51.222, lon: -1.682 };
    const f = new Flight({
      seed: 9, date: '070623', gliderType: 'PIK-20D', gliderId: 'G-CPIK',
      pilot: 'Fixture Pilot', logger: 'LXNAV,LX9000', wind: [3.0, -2.5],
      startTime: 10 * 3600 + 20 * 60, lat: home.lat, lon: home.lon,
      groundAlt: 190, interval: 4, noise: 2.5,
      task: {
        description: '300KM TRIANGLE',
        takeoff: { ...home, name: 'TAKEOFF LASHAM' },
        points: [
          { ...home, name: 'START LASHAM' },
          tp1,
          tp2,
          { ...home, name: 'FINISH LASHAM' },
        ],
        landing: { ...home, name: 'LANDING LASHAM' },
      },
    });
    // Aerotow, a climb to the top of the band, then round the triangle
    // working the band between 900 m and 1,700 m.
    const band = { bottom: 900, top: 1700, climb: 2.2, tas: 33, sink: -1.5 };
    f.ground(120).tow(300, 2.6, 30).circleTo(1600, 2.0, 18, 28);
    f.toward(tp1, band).circleTo(1750, 2.4, -18, 28);
    f.toward(tp2, band).circleTo(1900, 2.6, 18, 28);
    // The last climb of the day, then twenty minutes of final glide at speed,
    // arriving over the finish at 350 m and joining straight in. The glide and
    // the circuit are one unbroken straight run in the trace, which is the
    // whole point of the fixture.
    f.toward(runIn, band, 2000);
    f.circleTo(1900, 2.2, -18, 28);
    f.finalGlide(home, 350, 36);
    f.land(200);
    return f.build();
  },
};

for (const [name, make] of Object.entries(traces)) {
  const path = join(OUT, `${name}.igc`);
  writeFileSync(path, make(), 'latin1');
  console.log(`wrote ${path}`);
}
