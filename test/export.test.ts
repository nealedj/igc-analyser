/**
 * The export is a published file format, not an implementation detail, so it
 * is tested as one: the shape of `flight.json`, the conventions the document
 * promises, and a real round-trip through the zip writer.
 *
 * `docs/export-format.md` is the specification. If a test here fails, either
 * the code drifted or the document needs changing - and the document changing
 * is a breaking change.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyse } from '../src/core/index.ts';
import { SCHEMA_VERSION, buildFlightJson, bundleName } from '../src/ui/export.ts';
import { zip } from '../src/ui/zip.ts';
import { summariseTask, haversine } from '../src/core/task.ts';
import { fixtures } from './tools/fixtures.ts';

const load = (name: string) => {
  const f = fixtures().find((x) => x.name === name)!;
  return analyse(readFileSync(f.igc, 'latin1'));
};

// ------------------------------------------------------------- the schema

test('flight.json carries the documented top-level keys', () => {
  const j = buildFlightJson(load('thermal-day'));
  assert.equal(j.schemaVersion, SCHEMA_VERSION);
  for (const k of [
    'generator', 'source', 'flight', 'launch', 'task', 'phase',
    'wind', 'climbs', 'legs', 'polar', 'quality', 'figures',
  ]) {
    assert.ok(k in j, `flight.json is missing ${k}`);
  }
});

test('the profile is left out unless it is asked for', () => {
  assert.equal('profile' in buildFlightJson(load('thermal-day')), false);
  const withIt = buildFlightJson(load('thermal-day'), { includeProfile: true });
  assert.ok(Array.isArray(withIt.profile));
  assert.deepEqual(withIt.profileColumns, ['t', 'altM', 'lat', 'lon', 'circling']);
  const rows = withIt.profile as number[][];
  assert.equal(rows[0].length, 5);
  assert.ok(rows[0][4] === 0 || rows[0][4] === 1, 'circling should be 0 or 1');
});

test('every value is JSON-clean: no NaN, Infinity or undefined anywhere', () => {
  for (const f of fixtures()) {
    const j = buildFlightJson(analyse(readFileSync(f.igc, 'latin1')), { includeProfile: true });
    walk(j, '', (path, v) => {
      assert.ok(v !== undefined, `${f.name}: ${path} is undefined`);
      if (typeof v === 'number') {
        assert.ok(Number.isFinite(v), `${f.name}: ${path} is ${v}`);
      }
    });
    // And it must survive a round trip unchanged.
    assert.deepEqual(JSON.parse(JSON.stringify(j)), j, `${f.name} does not round-trip`);
  }
});

test('times of day are HH:MM:SSZ everywhere they appear', () => {
  const j = buildFlightJson(load('thermal-day')) as Record<string, any>;
  const re = /^\d{2}:\d{2}:\d{2}Z$/;
  for (const t of [j.flight.startTime, j.flight.endTime, j.launch.takeoffTime, j.launch.releaseTime]) {
    assert.match(t, re);
  }
  for (const c of j.climbs) {
    assert.match(c.startTime, re);
    assert.match(c.endTime, re);
    for (const p of c.perCircle) assert.match(p.startTime, re);
  }
  for (const l of j.legs) assert.match(l.startTime, re);
  for (const w of j.wind.perClimb) assert.match(w.time, re);
});

test('a flight across midnight keeps counting rather than wrapping', () => {
  const j = buildFlightJson(load('midnight-rollover')) as Record<string, any>;
  assert.equal(j.flight.startTime, '23:44:01Z');
  // Past midnight, so the end time is a small number and the instant rolls
  // onto the next day. Both have to be self-consistent.
  assert.match(j.flight.endTime, /^00:/);
  assert.ok(j.flight.durationS > 0 && j.flight.durationS < 7200);
  assert.ok(
    Date.parse(j.flight.endInstant) - Date.parse(j.flight.startInstant) === j.flight.durationS * 1000,
    'instants disagree with durationS',
  );
});

test('values are SI whatever the app was displaying', () => {
  const a = load('thermal-day');
  const j = buildFlightJson(a) as Record<string, any>;
  assert.equal(j.flight.maxAltitudeM, a.result.trace.max_alt_m);
  assert.ok(Math.abs(j.flight.trackDistanceM - a.result.track_distance_m) < 0.5);
  assert.ok(Math.abs(j.phase.circlingFraction - a.result.phase.circling_fraction) < 1e-4);
});

test('circle geometry is null below 1.5 circles, as the document promises', () => {
  for (const f of fixtures()) {
    const a = analyse(readFileSync(f.igc, 'latin1'));
    const j = buildFlightJson(a) as Record<string, any>;
    j.climbs.forEach((c: any, i: number) => {
      if (c.circles < 1.5) {
        for (const k of ['circleTimeS', 'radiusM', 'bankDeg']) {
          assert.equal(c[k], null, `${f.name} climb ${i + 1}: ${k} should be null at ${c.circles} circles`);
        }
      }
    });
  }
});

test('the honesty flags a consumer must not drop are all present', () => {
  for (const f of fixtures()) {
    const j = buildFlightJson(analyse(readFileSync(f.igc, 'latin1'))) as Record<string, any>;
    assert.equal(typeof j.launch.releaseConfident, 'boolean', `${f.name}`);
    assert.equal(typeof j.quality.coarse, 'boolean', `${f.name}`);
    assert.equal(typeof j.polar.matched, 'boolean', `${f.name}`);
    assert.equal(typeof j.polar.note, 'string', `${f.name}`);
    assert.ok(j.polar.note.length > 0, `${f.name}: polar note is empty`);
    if (j.wind) assert.equal(typeof j.wind.unreliable, 'boolean', `${f.name}`);
    // An airmass figure without a polar name would be a number resting on
    // nothing. Disabling the polar has to remove the figures too.
    if (j.polar.name === null) {
      for (const l of j.legs) assert.equal(l.meanAirmassMs, null, `${f.name}`);
    }
  }
});

test('the coarse flag matches the trace it describes', () => {
  assert.equal((buildFlightJson(load('coarse-ogn')) as any).quality.coarse, true);
  assert.equal((buildFlightJson(load('thermal-day')) as any).quality.coarse, false);
});

test('a dead pressure channel is reported as a GNSS source', () => {
  assert.equal((buildFlightJson(load('coarse-ogn')) as any).source.altitudeSource, 'GNSS');
  assert.equal((buildFlightJson(load('thermal-day')) as any).source.altitudeSource, 'pressure');
});

// ------------------------------------------------------------------ tasks

test('a declared task carries its distance, shape and legs', () => {
  const j = buildFlightJson(load('thermal-day')) as Record<string, any>;
  assert.equal(j.task.declared, true);
  assert.equal(j.task.closed, true);
  assert.equal(j.task.shape, 'out and return');
  assert.equal(j.task.points.length, 3);
  assert.equal(j.task.legs.length, 2);
  const summed = j.task.legs.reduce((s: number, l: any) => s + l.distanceM, 0);
  assert.ok(Math.abs(summed - j.task.distanceM) < 1, 'legs do not sum to the total');
});

test('the declared take-off and landing are carried, but not in the distance', () => {
  // Counting them as turnpoints would make a 300 km triangle a five-leg course
  // by way of the launch point, and publish the wrong total.
  const j = buildFlightJson(load('declared-300k')) as Record<string, any>;
  assert.equal(j.task.shape, 'triangle');
  assert.equal(j.task.turnpoints, 2);
  assert.equal(j.task.points.length, 4);
  assert.deepEqual(
    j.task.points.map((p: any) => p.role),
    ['start', 'turn', 'turn', 'finish'],
  );
  assert.equal(j.task.takeoff.name, 'TAKEOFF LASHAM');
  assert.equal(j.task.landing.name, 'LANDING LASHAM');
  assert.ok(
    Math.abs(j.task.distanceM - 300000) < 2000,
    `declared ${(j.task.distanceM / 1000).toFixed(1)} km, not 300`,
  );
  assert.equal(j.task.declaration.description, '300KM TRIANGLE');
  assert.equal(j.task.declaration.declaredTime, '09:35:00Z');
  assert.equal(j.task.legs[0].bearingDeg !== null, true);
});

test('the final glide and the circuit are published as separate legs', () => {
  const j = buildFlightJson(load('declared-300k')) as Record<string, any>;
  const kinds = j.legs.map((l: any) => l.kind);
  assert.equal(kinds.filter((k: string) => k === 'final glide').length, 1);
  assert.equal(kinds.filter((k: string) => k === 'circuit').length, 1);
  assert.equal(kinds[kinds.length - 1], 'circuit', 'the circuit is the last leg');

  const glide = j.legs.find((l: any) => l.kind === 'final glide');
  const circuit = j.legs.find((l: any) => l.kind === 'circuit');
  assert.equal(glide.circuit, false, 'circuit must agree with kind');
  assert.equal(circuit.circuit, true);
  assert.ok(glide.durationS > 900, `final glide only ${glide.durationS} s`);
  assert.ok(circuit.durationS < 600, `circuit is ${circuit.durationS} s`);
});

test('a file with no task says so rather than inventing one', () => {
  const j = buildFlightJson(load('ridge-day')) as Record<string, any>;
  assert.equal(j.task.declared, false);
  assert.equal(j.task.distanceM, null);
  assert.deepEqual(j.task.points, []);
});

test('task shapes are named from the number of legs and whether it closes', () => {
  const p = (name: string, lat: number, lon: number) => ({ name, lat, lon });
  const usk = p('USK', 51.71, -2.93);
  assert.equal(summariseTask([usk, p('A', 52.2, -2.2), usk])!.shape, 'out and return');
  assert.equal(summariseTask([usk, p('A', 52.2, -2.2), p('B', 52.8, -3.5), usk])!.shape, 'triangle');
  assert.equal(summariseTask([usk, p('A', 52.2, -2.2)])!.shape, 'straight distance');
  // A single point is not a task.
  assert.equal(summariseTask([usk]), null);
});

test('task distance is a great-circle sum, not a flat-earth one', () => {
  // Usk to Lake Vyrnwy, roughly: about 120 km. A flat-earth sum using a fixed
  // degree length would be out by enough to matter on a badge claim.
  const d = haversine(51.71, -2.93, 52.77, -3.47);
  assert.ok(d > 115000 && d < 130000, `got ${d} m`);
  // Symmetric, and zero for a point on itself.
  assert.equal(haversine(51.71, -2.93, 51.71, -2.93), 0);
  assert.ok(Math.abs(d - haversine(52.77, -3.47, 51.71, -2.93)) < 1e-6);
});

// ----------------------------------------------------------------- naming

test('the bundle is named after the flight, safely', () => {
  assert.equal(bundleName(load('thermal-day')), '2023-06-14-g-ckpt-igc-analysis');
  assert.match(bundleName(load('wave')), /^[a-z0-9-]+$/);
});

// -------------------------------------------------------------------- zip

test('the zip round-trips through a real reader', async () => {
  const enc = new TextEncoder();
  const files = [
    { name: 'flight.json', data: enc.encode(JSON.stringify({ schemaVersion: 1, hello: 'world' })) },
    // Big and repetitive, so it must take the deflate path.
    { name: 'trace.svg', data: enc.encode(`<svg>${'<path d="M0 0L1 1"/>'.repeat(500)}</svg>`) },
    { name: 'barogram.svg', data: enc.encode('<svg/>') },
  ];
  const blob = await zip(files, new Date('2026-08-30T12:00:00Z'));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const entries = await readZip(bytes);

  assert.deepEqual(entries.map((e) => e.name), ['flight.json', 'trace.svg', 'barogram.svg']);
  for (let i = 0; i < files.length; i++) {
    assert.deepEqual(entries[i].data, files[i].data, `${files[i].name} did not survive`);
  }
  // The large repetitive entry must actually have been compressed.
  assert.equal(entries[1].method, 8, 'trace.svg should have been deflated');
  assert.ok(blob.size < files[1].data.length, 'the zip is no smaller than its largest input');
});

test('the zip is still readable when nothing compresses well', async () => {
  // Random bytes deflate larger than they started, so the writer must store.
  const data = new Uint8Array(2048);
  for (let i = 0; i < data.length; i++) data[i] = (i * 2654435761) & 0xff;
  const bytes = new Uint8Array(await (await zip([{ name: 'noise.bin', data }])).arrayBuffer());
  const entries = await readZip(bytes);
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].data, data);
});

// ------------------------------------------------------------------ tools

/** Read a ZIP back via its central directory, checking every CRC. */
async function readZip(
  bytes: Uint8Array,
): Promise<{ name: string; data: Uint8Array; method: number }[]> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  assert.notEqual(eocd, -1, 'no end-of-central-directory record');

  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out: { name: string; data: Uint8Array; method: number }[] = [];

  for (let i = 0; i < count; i++) {
    assert.equal(dv.getUint32(p, true), 0x02014b50, 'bad central directory signature');
    const method = dv.getUint16(p + 10, true);
    const crc = dv.getUint32(p + 16, true);
    const csize = dv.getUint32(p + 20, true);
    const usize = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const offset = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));

    assert.equal(dv.getUint32(offset, true), 0x04034b50, 'bad local header signature');
    const lNameLen = dv.getUint16(offset + 26, true);
    const lExtraLen = dv.getUint16(offset + 28, true);
    const start = offset + 30 + lNameLen + lExtraLen;
    const body = bytes.subarray(start, start + csize);

    let data: Uint8Array;
    if (method === 0) {
      data = body;
    } else {
      const stream = new Blob([body as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      data = new Uint8Array(await new Response(stream).arrayBuffer());
    }
    assert.equal(data.length, usize, `${name}: size mismatch`);
    assert.equal(crc32(data), crc, `${name}: CRC mismatch`);

    out.push({ name, data, method });
    p += 46 + nameLen + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
  }
  return out;
}

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c ^= data[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function walk(v: unknown, path: string, fn: (path: string, v: unknown) => void): void {
  fn(path || '<root>', v);
  if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`, fn));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`, fn);
  }
}
