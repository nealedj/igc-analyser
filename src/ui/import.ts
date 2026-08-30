/**
 * Fetching a trace from WeGlide or the BGA Ladder by link.
 *
 * This is the one place in the app that touches the network, and it only runs
 * when you paste a link and press the button. Dropping a file in stays
 * entirely local.
 *
 * The two sites differ in whether a browser is allowed to make the request at
 * all:
 *
 * - The BGA Ladder reflects the requesting origin in its
 *   `Access-Control-Allow-Origin` header, so the fetch works from anywhere.
 * - WeGlide's API allows only `https://weglide.org`. There is no way for a
 *   page on another origin to read the response, and no way to fix that from
 *   this side without a proxy - which would mean a backend, and would mean
 *   somebody else's flight passing through it. So the WeGlide path detects
 *   the block and says what to do instead, rather than failing silently or
 *   pretending the file is unavailable.
 */

export type Source = 'bga' | 'weglide';

export interface ImportTarget {
  source: Source;
  id: string;
  url: string;
  label: string;
}

/** Recognise a pasted link or a bare flight number. */
export function parseTarget(input: string): ImportTarget | null {
  const s = input.trim();
  if (!s) return null;

  const bgaUrl = s.match(/bgaladder\.net\/(?:FlightInfo|flight)[/?=]*(?:FlightID=)?(\d+)/i);
  const bgaQuery = s.match(/bgaladder\.net\/.*[?&]flightid=(\d+)/i);
  const weglide = s.match(/weglide\.org\/flight\/(\d+)/i);
  const bare = s.match(/^(\d{4,10})$/);

  const id = bgaUrl?.[1] ?? bgaQuery?.[1] ?? weglide?.[1] ?? bare?.[1];
  if (!id) return null;

  if (weglide) {
    return {
      source: 'weglide',
      id,
      url: `https://api.weglide.org/v1/flightdetail/${id}`,
      label: `WeGlide flight ${id}`,
    };
  }
  return {
    source: 'bga',
    id,
    url: `https://api.bgaladder.net/API/FLIGHTIGC/${id}`,
    label: `BGA Ladder flight ${id}`,
  };
}

export class ImportError extends Error {
  readonly hint: string;
  constructor(message: string, hint: string) {
    super(message);
    this.name = 'ImportError';
    this.hint = hint;
  }
}

export async function fetchTrace(target: ImportTarget): Promise<{ name: string; text: string }> {
  if (target.source === 'weglide') {
    throw new ImportError(
      'WeGlide does not allow other sites to read its API from a browser.',
      `Its API only answers requests from weglide.org itself, and working around ` +
        `that would mean routing your flight through a server - which this tool ` +
        `does not have and does not want. Open ` +
        `weglide.org/flight/${target.id}, use its own download button, and drop ` +
        `the .igc file here.`,
    );
  }

  let res: Response;
  try {
    res = await fetch(target.url, { credentials: 'omit', redirect: 'follow' });
  } catch {
    throw new ImportError(
      `Could not reach the BGA Ladder.`,
      'That is usually the network, or the site being down. Downloading the IGC ' +
        'yourself and dropping it here always works.',
    );
  }

  if (res.status === 404) {
    throw new ImportError(
      `The BGA Ladder has no flight ${target.id}.`,
      'Check the flight number in the link.',
    );
  }
  if (!res.ok) {
    throw new ImportError(
      `The BGA Ladder returned ${res.status}.`,
      'Downloading the IGC yourself and dropping it here always works.',
    );
  }

  // IGC is ASCII; decode as latin1 so a stray high byte does not become U+FFFD.
  const text = new TextDecoder('iso-8859-1').decode(await res.arrayBuffer());
  if (!/^B\d{6}/m.test(text)) {
    throw new ImportError(
      `What came back for flight ${target.id} is not an IGC file.`,
      'The flight may have been logged in another format, or withdrawn.',
    );
  }
  return { name: `bga-${target.id}.igc`, text };
}
