export type RangePreset = 'all' | 'today' | '7d' | '30d' | '90d' | 'ytd' | 'custom';

export interface RangeValue {
  preset: RangePreset;
  /** YYYY-MM-DD, custom only */
  from?: string;
  to?: string;
}

export const PRESET_LABELS: Record<RangePreset, string> = {
  all: 'All time',
  today: 'Today',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  ytd: 'This year',
  custom: 'Custom',
};

const pad = (n: number) => String(n).padStart(2, '0');

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

export const toDateInput = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** "2026-09-16" → local midnight (or the last ms of that day). */
export function fromDateInput(value: string, end = false): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return (end ? endOfDay(d) : d).getTime();
}

export const toDateTimeLocal = (ms: number): string => {
  const d = new Date(ms);
  return `${toDateInput(ms)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function fromDateTimeLocal(value: string): number | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * Resolve a range to unix ms. Bounds snap to whole days so the result (and
 * any query key built from it) is stable for the whole day.
 */
export function resolveRange(v: RangeValue, now = new Date()): { from: number; to: number } | null {
  const to = endOfDay(now).getTime();
  const daysBack = (n: number) => startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (n - 1))).getTime();
  switch (v.preset) {
    case 'all':
      return null;
    case 'today':
      return { from: startOfDay(now).getTime(), to };
    case '7d':
      return { from: daysBack(7), to };
    case '30d':
      return { from: daysBack(30), to };
    case '90d':
      return { from: daysBack(90), to };
    case 'ytd':
      return { from: new Date(now.getFullYear(), 0, 1).getTime(), to };
    case 'custom': {
      const from = v.from ? fromDateInput(v.from) : null;
      const end = v.to ? fromDateInput(v.to, true) : null;
      if (from === null || end === null || end < from) return null;
      return { from, to: end };
    }
  }
}

const PRESETS = Object.keys(PRESET_LABELS) as RangePreset[];

export function rangeFromParams(sp: URLSearchParams, fallback: RangePreset): RangeValue {
  const raw = sp.get('range');
  const preset = PRESETS.includes(raw as RangePreset) ? (raw as RangePreset) : fallback;
  return preset === 'custom' ? { preset, from: sp.get('from') ?? '', to: sp.get('to') ?? '' } : { preset };
}

export function writeRangeParams(sp: URLSearchParams, v: RangeValue, fallback: RangePreset): URLSearchParams {
  const next = new URLSearchParams(sp);
  if (v.preset === fallback) next.delete('range');
  else next.set('range', v.preset);
  if (v.preset === 'custom') {
    next.set('from', v.from ?? '');
    next.set('to', v.to ?? '');
  } else {
    next.delete('from');
    next.delete('to');
  }
  return next;
}

/** Dashboard series dates are "YYYY-MM-DD" (or ISO); parse as local calendar dates. */
export function parseSeriesDate(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(s);
}
