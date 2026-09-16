/**
 * Integer money arithmetic. Amounts are minor units; rates are basis points.
 * BigInt is used wherever an intermediate product could pass 2^53.
 */

/** round(a / b), half up, for a ≥ 0 and b > 0. */
export function divRound(a: number, b: number): number {
  if (b <= 0) throw new RangeError('divisor must be positive');
  if (a <= 0) return 0;
  const A = BigInt(a);
  const B = BigInt(b);
  return Number((A * 2n + B) / (B * 2n));
}

/** amount × bps / 10000, rounded half up. */
export const applyBps = (amount: number, bps: number): number => divRound(amount * bps, 10_000);

/**
 * Split `total` across `weights` proportionally, largest remainder first, so
 * the parts are integers that sum to exactly `total`. Ties go to the earlier
 * index, which keeps allocations deterministic.
 */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + Math.max(0, b), 0);
  if (total <= 0 || sum <= 0) return weights.map(() => 0);

  const T = BigInt(total);
  const S = BigInt(sum);
  const parts = weights.map((w, i) => {
    const product = T * BigInt(Math.max(0, w));
    return { i, floor: product / S, rem: product % S };
  });

  let left = T - parts.reduce((acc, p) => acc + p.floor, 0n);
  const order = [...parts].sort((a, b) => (a.rem === b.rem ? a.i - b.i : a.rem > b.rem ? -1 : 1));
  const out = weights.map(() => 0);
  for (const p of order) {
    const bump = left > 0n ? 1n : 0n;
    left -= bump;
    out[p.i] = Number(p.floor + bump);
  }
  return out;
}

export const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0);
