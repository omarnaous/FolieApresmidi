import { describe, expect, it } from 'vitest';
import { sniffSiteFile } from '../../worker/lib/images';

const ftyp = (brand: string) => {
  const b = new Uint8Array(32);
  b.set([0, 0, 0, 0x20], 0);
  b.set([...'ftyp'].map((c) => c.charCodeAt(0)), 4);
  b.set([...brand].map((c) => c.charCodeAt(0)), 8);
  return b;
};

describe('sniffSiteFile', () => {
  it('takes any MP4 brand an editor or phone writes as a film', () => {
    for (const brand of ['isom', 'mp42', 'iso4', 'iso5', 'iso6', 'mp4v', 'dash', 'MSNV', '3gp5', 'qt  ']) {
      expect(sniffSiteFile(ftyp(brand))?.mime).toBe('video/mp4');
    }
  });
  it('refuses a still image or sound alone in the same box', () => {
    for (const brand of ['avif', 'heic', 'mif1', 'M4A ']) expect(sniffSiteFile(ftyp(brand))).toBeNull();
  });
  it('still knows a PDF and refuses anything else', () => {
    expect(sniffSiteFile(new TextEncoder().encode('%PDF-1.7'))?.mime).toBe('application/pdf');
    expect(sniffSiteFile(new TextEncoder().encode('RIFF....AVI '))).toBeNull();
  });
});
