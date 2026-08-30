/**
 * Link parsing and the fetch-by-link behaviour.
 *
 * `fetch` is stubbed here so the tests are hermetic: no test in this suite
 * should depend on a third-party site being up, or on what its CORS policy
 * happens to be this week. What is being tested is that the code makes the
 * attempt client-side and reports honestly on whatever comes back.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ImportError, fetchTrace, parseTarget } from '../src/ui/import.ts';

const IGC =
  'AXGD001\r\nHFDTE140623\r\nHFGTYGLIDERTYPE:ASW 27\r\n' +
  'B1142015143108N00250575WA0050000520\r\nB1142025143109N00250576WA0050100521\r\n';

/** Swap in a fetch, run, and put the real one back. */
async function withFetch<T>(
  impl: (url: string) => Promise<Response> | Response,
  run: () => Promise<T>,
): Promise<T> {
  const real = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    seen.push(url);
    return impl(url);
  }) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = real;
  }
}

const ok = (body: string) => new Response(body, { status: 200 });
const status = (code: number) => new Response('', { status: code });
const blocked = () => {
  // What a browser gives a script when CORS refuses the read.
  throw new TypeError('Failed to fetch');
};

// -------------------------------------------------------------- parsing

test('BGA Ladder links are recognised in the forms the site produces', () => {
  for (const s of [
    'https://bgaladder.net/FlightInfo?FlightID=100000',
    'bgaladder.net/FlightInfo?FlightID=100000',
    'https://www.bgaladder.net/flight/100000',
    'https://bgaladder.net/FlightInfo?x=1&flightid=100000',
  ]) {
    const t = parseTarget(s);
    assert.equal(t?.kind, 'bga', s);
    assert.equal(t?.id, '100000', s);
  }
});

test('a bare flight number is taken as a BGA one', () => {
  const t = parseTarget('  100000 ');
  assert.equal(t?.kind, 'bga');
  assert.equal(t?.id, '100000');
});

test('WeGlide links are recognised', () => {
  const t = parseTarget('https://www.weglide.org/flight/1225332');
  assert.equal(t?.kind, 'weglide');
  assert.equal(t?.id, '1225332');
});

test('any other http link is treated as a direct link to an IGC file', () => {
  const t = parseTarget('https://gliding.example/logs/2026-07-19.igc');
  assert.equal(t?.kind, 'direct');
  assert.equal(t?.label, 'gliding.example');
  assert.deepEqual(t?.urls, ['https://gliding.example/logs/2026-07-19.igc']);
});

test('nonsense is rejected rather than guessed at', () => {
  for (const s of ['', '   ', 'not a link', 'ftp://example.com/x.igc', '12']) {
    assert.equal(parseTarget(s), null, JSON.stringify(s));
  }
});

// -------------------------------------------------------------- fetching

test('a BGA flight is fetched from the browser and returned', async () => {
  const got = await withFetch(
    (url) => {
      assert.equal(url, 'https://api.bgaladder.net/API/FLIGHTIGC/100000');
      return ok(IGC);
    },
    () => fetchTrace(parseTarget('100000')!),
  );
  assert.equal(got.name, 'bga-100000.igc');
  assert.ok(got.text.includes('B114201'));
});

test('a direct link is fetched as given and keeps its filename', async () => {
  const got = await withFetch(
    () => ok(IGC),
    () => fetchTrace(parseTarget('https://gliding.example/logs/flight.igc')!),
  );
  assert.equal(got.name, 'flight.igc');
});

test('WeGlide is actually attempted, not refused in advance', async () => {
  const asked: string[] = [];
  const got = await withFetch(
    (url) => {
      asked.push(url);
      if (url.includes('flightdetail')) return ok(JSON.stringify({ igc_file: { id: 1212711 } }));
      if (url.includes('igcfile/1212711')) return ok(IGC);
      return status(404);
    },
    () => fetchTrace(parseTarget('https://weglide.org/flight/1225332')!),
  );
  assert.ok(asked.some((u) => u.includes('flightdetail/1225332')), 'no detail lookup was made');
  assert.ok(asked.some((u) => u.includes('igcfile/1212711')), 'the file id from the lookup was not used');
  assert.equal(got.name, 'weglide-1225332.igc');
});

test('a blocked read is reported honestly, not as a crash or a verdict', async () => {
  const err = await withFetch(blocked, () =>
    fetchTrace(parseTarget('100000')!).then(() => null, (e) => e),
  );
  assert.ok(err instanceof ImportError, `got ${err}`);
  assert.match(err.message, /could not read/i);
  // A rejected fetch is CORS or a network failure and the browser will not say
  // which, so the message must not pick one.
  assert.match(err.hint, /either the site declining|request not getting there/);
  assert.match(err.hint, /Downloading the .igc yourself/);
});

test('a blocked file read after a working lookup says which it was', async () => {
  const err = await withFetch(
    (url) => (url.includes('flightdetail') ? ok('{}') : blocked()),
    () => fetchTrace(parseTarget('https://weglide.org/flight/1225332')!).then(() => null, (e) => e),
  );
  assert.ok(err instanceof ImportError);
  assert.match(err.hint, /did answer a different request/);
  // With that evidence in hand it may point at the cause, but still not assert
  // a network failure it cannot see.
  assert.doesNotMatch(err.hint, /request not getting there/);
});

test('a 404 everywhere is reported as no such flight', async () => {
  const err = await withFetch(
    () => status(404),
    () => fetchTrace(parseTarget('999999')!).then(() => null, (e) => e),
  );
  assert.ok(err instanceof ImportError);
  assert.match(err.message, /Nothing was found/);
});

test('WeGlide having no download route says so specifically', async () => {
  const err = await withFetch(
    (url) => (url.includes('flightdetail') ? ok('{}') : status(404)),
    () => fetchTrace(parseTarget('https://weglide.org/flight/1225332')!).then(() => null, (e) => e),
  );
  assert.ok(err instanceof ImportError);
  assert.match(err.message, /does not publish a download link/);
  assert.match(err.hint, /use the download button there/);
});

test('a successful fetch of something that is not IGC is caught', async () => {
  const err = await withFetch(
    () => ok('<!doctype html><title>Sign in</title>'),
    () => fetchTrace(parseTarget('100000')!).then(() => null, (e) => e),
  );
  assert.ok(err instanceof ImportError);
  assert.match(err.message, /is not an IGC file/);
  assert.match(err.hint, /no B records/);
});

test('a server error reports the status rather than guessing', async () => {
  const err = await withFetch(
    () => status(503),
    () => fetchTrace(parseTarget('100000')!).then(() => null, (e) => e),
  );
  assert.ok(err instanceof ImportError);
  assert.match(err.message, /\(503\)/);
});
