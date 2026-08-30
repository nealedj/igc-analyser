/**
 * A minimal ZIP writer.
 *
 * The export is a bundle of three files, and pulling in a zip library for that
 * would be the only third-party dependency in the project. This is the whole
 * format that is needed: local headers, a central directory, and an
 * end-of-central-directory record.
 *
 * Entries are deflated with `CompressionStream` where the browser has it - the
 * profile array in `flight.json` compresses to a fraction of its size - and
 * stored uncompressed where it does not. Both are valid ZIP; every reader
 * handles either.
 */

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
/** Bit 11: the name and comment are UTF-8. */
const FLAG_UTF8 = 0x0800;

let crcTable: Uint32Array | null = null;

function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    // 'deflate-raw' is not universally supported; storing is always valid.
    return null;
  }
}

/** DOS date and time, which is what a ZIP header carries. */
function dosDateTime(d: Date): { time: number; date: number } {
  return {
    time: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff,
    date: (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff,
  };
}

export async function zip(entries: ZipEntry[], when = new Date()): Promise<Blob> {
  const { time, date } = dosDateTime(when);
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = enc.encode(entry.name);
    const raw = entry.data;
    const deflated = await deflateRaw(raw);
    // Only worth it if it actually came out smaller.
    const useDeflate = deflated !== null && deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw);

    const header = new Uint8Array(30 + name.length);
    const hv = new DataView(header.buffer);
    hv.setUint32(0, LOCAL_SIG, true);
    hv.setUint16(4, 20, true);
    hv.setUint16(6, FLAG_UTF8, true);
    hv.setUint16(8, method, true);
    hv.setUint16(10, time, true);
    hv.setUint16(12, date, true);
    hv.setUint32(14, crc, true);
    hv.setUint32(18, body.length, true);
    hv.setUint32(22, raw.length, true);
    hv.setUint16(26, name.length, true);
    hv.setUint16(28, 0, true);
    header.set(name, 30);

    const dir = new Uint8Array(46 + name.length);
    const dv = new DataView(dir.buffer);
    dv.setUint32(0, CENTRAL_SIG, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 20, true);
    dv.setUint16(8, FLAG_UTF8, true);
    dv.setUint16(10, method, true);
    dv.setUint16(12, time, true);
    dv.setUint16(14, date, true);
    dv.setUint32(16, crc, true);
    dv.setUint32(20, body.length, true);
    dv.setUint32(24, raw.length, true);
    dv.setUint16(28, name.length, true);
    dv.setUint32(42, offset, true);
    dir.set(name, 46);

    parts.push(header, body);
    central.push(dir);
    offset += header.length + body.length;
  }

  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, EOCD_SIG, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  return new Blob([...parts, ...central, eocd] as BlobPart[], { type: 'application/zip' });
}
