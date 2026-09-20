import { describe, expect, it } from 'vitest';
import { parseRange } from '../../worker/lib/range';

describe('byte ranges', () => {
  it('resolves the forms browsers send', () => {
    expect(parseRange('bytes=0-1', 100)).toEqual({ start: 0, end: 1 });
    expect(parseRange('bytes=0-', 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=90-200', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=-500', 100)).toEqual({ start: 0, end: 99 });
  });

  it('serves the whole body for anything else', () => {
    expect(parseRange(undefined, 100)).toBeNull();
    expect(parseRange('bytes=-', 100)).toBeNull();
    expect(parseRange('bytes=0-1,5-9', 100)).toBeNull();
    expect(parseRange('items=0-1', 100)).toBeNull();
  });

  it('refuses ranges outside the body', () => {
    expect(parseRange('bytes=100-', 100)).toBe('unsatisfiable');
    expect(parseRange('bytes=5-2', 100)).toBe('unsatisfiable');
    expect(parseRange('bytes=-0', 100)).toBe('unsatisfiable');
  });
});
