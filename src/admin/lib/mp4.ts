/**
 * Read what a film is before it is uploaded: its video codec, size and
 * length, from the MP4/MOV boxes themselves — no decoding, and only the
 * metadata is read (a top-level box header at a time, then `moov`, which is
 * small even for a long film). The codec decides who can watch it: H.264
 * plays everywhere; HEVC (what an iPhone records) only on Apple devices and
 * some others; and the shop's hero says so to the browser through the
 * `type` it is given, so one that cannot play it shows the house film.
 */

export interface FilmInfo {
  /** the sample-entry fourcc: avc1, avc3, hvc1, hev1, av01, vp09… */
  fourcc: string | null;
  /** the full MIME type with codecs, for <source type> */
  type: string;
  /** plain words for the admin */
  codecName: string;
  /** true when every browser plays it */
  universal: boolean;
  width: number | null;
  height: number | null;
  seconds: number | null;
}

const MAX_MOOV = 32 * 1024 * 1024;

const ascii = (v: DataView, at: number) =>
  String.fromCharCode(v.getUint8(at), v.getUint8(at + 1), v.getUint8(at + 2), v.getUint8(at + 3));

async function bytesOf(file: Blob, from: number, to: number): Promise<DataView> {
  return new DataView(await file.slice(from, to).arrayBuffer());
}

/** Find the top-level `moov` box, wherever it sits — before or after the media data. */
async function findMoov(file: File): Promise<DataView | null> {
  let at = 0;
  while (at + 8 <= file.size) {
    const h = await bytesOf(file, at, Math.min(at + 16, file.size));
    let size = h.getUint32(0);
    const type = ascii(h, 4);
    let header = 8;
    if (size === 1 && h.byteLength >= 16) {
      size = Number(h.getBigUint64(8));
      header = 16;
    } else if (size === 0) {
      size = file.size - at;
    }
    if (size < header) return null;
    if (type === 'moov') return size > MAX_MOOV ? null : bytesOf(file, at + header, at + size);
    at += size;
  }
  return null;
}

/** The child boxes of a container's payload, as [type, start, end] in the view. */
function children(v: DataView, from = 0, to = v.byteLength): [string, number, number][] {
  const out: [string, number, number][] = [];
  let at = from;
  while (at + 8 <= to) {
    let size = v.getUint32(at);
    const type = ascii(v, at + 4);
    let header = 8;
    if (size === 1 && at + 16 <= to) {
      size = Number(v.getBigUint64(at + 8));
      header = 16;
    } else if (size === 0) {
      size = to - at;
    }
    if (size < header || at + size > to) break;
    out.push([type, at + header, at + size]);
    at += size;
  }
  return out;
}

const child = (v: DataView, from: number, to: number, type: string) => children(v, from, to).find(([t]) => t === type);
const hex2 = (n: number) => n.toString(16).padStart(2, '0').toUpperCase();

function codecString(v: DataView, fourcc: string, entryStart: number, entryEnd: number): string {
  // a visual sample entry is 78 bytes of fixed fields before its own boxes
  const boxes = children(v, entryStart + 78, entryEnd);
  if (fourcc === 'avc1' || fourcc === 'avc3') {
    const avcC = boxes.find(([t]) => t === 'avcC');
    if (avcC) return `${fourcc}.${hex2(v.getUint8(avcC[1] + 1))}${hex2(v.getUint8(avcC[1] + 2))}${hex2(v.getUint8(avcC[1] + 3))}`;
    return `${fourcc}.42E01E`;
  }
  if (fourcc === 'hvc1' || fourcc === 'hev1') {
    const hvcC = boxes.find(([t]) => t === 'hvcC');
    if (hvcC) {
      const b = hvcC[1];
      const ps = v.getUint8(b + 1);
      const space = ['', 'A', 'B', 'C'][ps >> 6] ?? '';
      const profile = ps & 0x1f;
      const tier = ps & 0x20 ? 'H' : 'L';
      let compat = v.getUint32(b + 2);
      // the compatibility flags are written bit-reversed
      let rev = 0;
      for (let i = 0; i < 32; i++) {
        rev = (rev << 1) | (compat & 1);
        compat >>>= 1;
      }
      const level = v.getUint8(b + 12);
      return `${fourcc}.${space}${profile}.${(rev >>> 0).toString(16).toUpperCase()}.${tier}${level}.B0`;
    }
    return `${fourcc}.1.6.L93.B0`;
  }
  if (fourcc === 'av01') return 'av01.0.08M.08';
  if (fourcc === 'vp09') return 'vp09.00.10.08';
  return fourcc;
}

const NAMES: Record<string, [string, boolean]> = {
  avc1: ['H.264', true],
  avc3: ['H.264', true],
  hvc1: ['HEVC (H.265)', false],
  hev1: ['HEVC (H.265)', false],
  av01: ['AV1', false],
  vp09: ['VP9', false],
};

/** Read a film. Never throws: an unreadable one comes back as unknown, and is still allowed. */
export async function inspectFilm(file: File): Promise<FilmInfo> {
  const unknown: FilmInfo = { fourcc: null, type: 'video/mp4', codecName: 'an unknown format', universal: false, width: null, height: null, seconds: null };
  try {
    const moov = await findMoov(file);
    if (!moov) return unknown;
    let seconds: number | null = null;
    const mvhd = child(moov, 0, moov.byteLength, 'mvhd');
    if (mvhd) {
      const version = moov.getUint8(mvhd[1]);
      const scale = moov.getUint32(mvhd[1] + (version === 1 ? 20 : 12));
      const duration = version === 1 ? Number(moov.getBigUint64(mvhd[1] + 24)) : moov.getUint32(mvhd[1] + 16);
      if (scale) seconds = duration / scale;
    }
    for (const [type, start, end] of children(moov)) {
      if (type !== 'trak') continue;
      const mdia = child(moov, start, end, 'mdia');
      if (!mdia) continue;
      const hdlr = child(moov, mdia[1], mdia[2], 'hdlr');
      if (!hdlr || ascii(moov, hdlr[1] + 8) !== 'vide') continue;
      const tkhd = child(moov, start, end, 'tkhd');
      let width: number | null = null;
      let height: number | null = null;
      if (tkhd) {
        const at = tkhd[1] + (moov.getUint8(tkhd[1]) === 1 ? 88 : 76);
        width = Math.round(moov.getUint32(at) / 65536) || null;
        height = Math.round(moov.getUint32(at + 4) / 65536) || null;
      }
      const minf = child(moov, mdia[1], mdia[2], 'minf');
      const stbl = minf && child(moov, minf[1], minf[2], 'stbl');
      const stsd = stbl && child(moov, stbl[1], stbl[2], 'stsd');
      if (!stsd) return { ...unknown, width, height, seconds };
      // version/flags and the entry count come before the first entry
      const entry = children(moov, stsd[1] + 8, stsd[2])[0];
      if (!entry) return { ...unknown, width, height, seconds };
      const fourcc = entry[0];
      const [codecName, universal] = NAMES[fourcc] ?? [fourcc.trim() || 'an unknown format', false];
      return {
        fourcc,
        type: `video/mp4; codecs="${codecString(moov, fourcc, entry[1], entry[2])}"`,
        codecName,
        universal,
        width,
        height,
        seconds,
      };
    }
    return { ...unknown, seconds };
  } catch {
    return unknown;
  }
}

/** Whether this browser — the admin's own — can play the film. */
export const playsHere = (type: string) =>
  typeof document !== 'undefined' && document.createElement('video').canPlayType(type) !== '';
