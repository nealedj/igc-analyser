/**
 * Fetching a trace by link.
 *
 * This is the only part of the app that touches the network, and it only runs
 * when a link is pasted and Fetch is pressed. Dropping a file in stays entirely
 * local, and nothing is ever uploaded either way.
 *
 * Everything here is a plain client-side `fetch` from the page. Whether it
 * succeeds is up to the site being asked: a cross-origin read needs that site
 * to send `Access-Control-Allow-Origin`, and a browser will not tell a script
 * why a blocked request failed. So the approach is to try, and to report what
 * actually happened rather than to assume in advance what will not work.
 *
 * Known at the time of writing, from probing the two services:
 *
 * - The BGA Ladder reflects the requesting origin, so its IGC endpoint reads
 *   straight from the browser.
 * - WeGlide's published API has no IGC download route at all - `/v1/igcfile`
 *   is upload-only - and its other endpoints allow only `weglide.org`. The
 *   attempt is still made, because that is a policy on their side that can
 *   change, and because a probe from a server is not the same as a request
 *   from a browser.
 */

export type SourceKind = 'bga' | 'weglide' | 'direct';

export interface ImportTarget {
  kind: SourceKind;
  id: string;
  label: string;
  /**
   * URLs to try in order. WeGlide needs a lookup first, so its chain is built
   * during the fetch rather than up front.
   */
  urls: string[];
}

/** Recognise a pasted link, a bare BGA flight number, or any IGC URL. */
export function parseTarget(input: string): ImportTarget | null {
  const s = input.trim();
  if (!s) return null;

  const bga = s.match(/bgaladder\.net\/(?:.*?[?&]flightid=|(?:FlightInfo|flight)\/)(\d+)/i);
  const weglide = s.match(/weglide\.org\/flight\/(\d+)/i);
  const bare = s.match(/^(\d{4,10})$/);

  if (weglide) {
    return {
      kind: 'weglide',
      id: weglide[1],
      label: `WeGlide flight ${weglide[1]}`,
      urls: [],
    };
  }
  if (bga || bare) {
    const id = (bga?.[1] ?? bare![1]);
    return {
      kind: 'bga',
      id,
      label: `BGA Ladder flight ${id}`,
      urls: [`https://api.bgaladder.net/API/FLIGHTIGC/${id}`],
    };
  }
  // Any other http(s) link is treated as a direct link to an IGC file. A club
  // site, a personal server, a share link: if the host allows the read, it
  // works, and there is no reason to only know about two services.
  if (/^https?:\/\//i.test(s)) {
    let label = s;
    try {
      label = new URL(s).hostname;
    } catch {
      return null;
    }
    return { kind: 'direct', id: s, label, urls: [s] };
  }
  return null;
}

export class ImportError extends Error {
  readonly hint: string;
  constructor(message: string, hint: string) {
    super(message);
    this.name = 'ImportError';
    this.hint = hint;
  }
}

const DOWNLOAD_INSTEAD =
  'Downloading the .igc yourself and dropping it on this page always works, ' +
  'and keeps the file off the network entirely.';

interface Attempt {
  url: string;
  status: number | 'blocked';
  body?: string;
}

/** One client-side GET. A thrown fetch is reported as 'blocked', not as a crash. */
async function attempt(url: string, wantText: boolean): Promise<Attempt> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: 'omit', redirect: 'follow' });
  } catch {
    // The browser refuses to say whether this was CORS, DNS, TLS or offline.
    return { url, status: 'blocked' };
  }
  if (!res.ok) return { url, status: res.status };
  if (!wantText) return { url, status: res.status };
  // IGC is ASCII; latin1 keeps a stray high byte from becoming U+FFFD.
  const text = new TextDecoder('iso-8859-1').decode(await res.arrayBuffer());
  return { url, status: res.status, body: text };
}

const looksLikeIgc = (text: string): boolean => /^B\d{6}\d{7}[NS]/m.test(text);

/**
 * Ask WeGlide for the IGC. Its flight detail is a public GET and carries the
 * id of the underlying file, so that is looked up first and then tried against
 * the routes an IGC could plausibly live on.
 */
async function weglideUrls(id: string): Promise<{ urls: string[]; detail: Attempt }> {
  const detail = await attempt(`https://api.weglide.org/v1/flightdetail/${id}`, true);
  const urls = [`https://api.weglide.org/v1/igcfile/${id}`];
  if (detail.body) {
    try {
      const fileId = (JSON.parse(detail.body) as { igc_file?: { id?: number } }).igc_file?.id;
      if (fileId) urls.unshift(`https://api.weglide.org/v1/igcfile/${fileId}`);
    } catch {
      // Not JSON, or not the shape expected. The generic route is still tried.
    }
  }
  return { urls, detail };
}

export async function fetchTrace(target: ImportTarget): Promise<{ name: string; text: string }> {
  let urls = target.urls;
  let lookup: Attempt | null = null;

  if (target.kind === 'weglide') {
    const found = await weglideUrls(target.id);
    urls = found.urls;
    lookup = found.detail;
  }

  const tried: Attempt[] = [];
  for (const url of urls) {
    const a = await attempt(url, true);
    tried.push(a);
    if (a.body && looksLikeIgc(a.body)) {
      return { name: filename(target), text: a.body };
    }
  }

  throw explain(target, tried, lookup);
}

function filename(t: ImportTarget): string {
  if (t.kind === 'direct') {
    const last = t.id.split('?')[0].split('/').pop() || 'trace.igc';
    return /\.igc$/i.test(last) ? last : `${last || 'trace'}.igc`;
  }
  return `${t.kind}-${t.id}.igc`;
}

/** Turn what happened into something a pilot can act on. */
function explain(target: ImportTarget, tried: Attempt[], lookup: Attempt | null): ImportError {
  const blocked = tried.every((a) => a.status === 'blocked');
  const anyBlocked = tried.some((a) => a.status === 'blocked');
  const notFound = tried.length > 0 && tried.every((a) => a.status === 404);
  const gotSomething = tried.find((a) => a.body !== undefined);

  if (blocked && tried.length > 0) {
    // A rejected fetch is a rejected fetch: the browser deliberately does not
    // tell a script whether the site declined the cross-origin read or the
    // request never got there. Saying which would be a guess, so say both.
    // A lookup that succeeded while the file request did not is real evidence
    // for the first, and is worth passing on as evidence rather than a verdict.
    const lookupWorked = lookup !== null && lookup.status === 200;
    return new ImportError(
      `Your browser could not read the file from ${target.label}.`,
      `${lookupWorked
        ? 'The site did answer a different request from this page just now, which ' +
          'points at it declining to share the file itself rather than at the ' +
          'network. '
        : 'That is either the site declining to let another page read it, or the ' +
          'request not getting there at all - a browser will not tell a script ' +
          'which, so neither will this. '}` +
        `A site has to opt in before another page may read its files, and ` +
        `nothing here can work around one that has not without sending your ` +
        `flight through a server this tool deliberately does not have. ` +
        `${DOWNLOAD_INSTEAD}`,
    );
  }

  if (notFound) {
    return new ImportError(
      target.kind === 'weglide'
        ? `WeGlide does not publish a download link for flight ${target.id}.`
        : `Nothing was found at ${target.label}.`,
      target.kind === 'weglide'
        ? `Its public API can be asked about a flight but not for the file: the ` +
          `only IGC route it documents is for uploading. Open ` +
          `weglide.org/flight/${target.id}, use the download button there, and ` +
          `drop the file on this page.`
        : `Check the flight number or link. ${DOWNLOAD_INSTEAD}`,
    );
  }

  if (gotSomething) {
    return new ImportError(
      `What came back from ${target.label} is not an IGC file.`,
      `It fetched successfully but contains no B records. It may be a web page ` +
        `rather than a file, or the flight may have been logged in another ` +
        `format. This tool reads IGC only.`,
    );
  }

  const statuses = tried.map((a) => (a.status === 'blocked' ? 'blocked' : String(a.status)));
  return new ImportError(
    `${target.label} could not be fetched (${statuses.join(', ')}).`,
    `${anyBlocked ? 'At least one request was blocked by the browser, which usually ' +
      'means the site does not allow other pages to read it. ' : ''}${DOWNLOAD_INSTEAD}`,
  );
}
