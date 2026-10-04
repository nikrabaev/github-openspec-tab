export interface Aligned<T> {
  before: T | null;
  after: T | null;
}

/**
 * Align two sequences in order, pairing items whose similarity reaches the
 * threshold and maximising total similarity (a weighted longest common
 * subsequence). Unpaired items come out alone, in document order, with
 * removals ahead of additions at the same position.
 */
export function alignSequences<T>(
  before: readonly T[],
  after: readonly T[],
  score: (a: T, b: T) => number,
  threshold = 0.5,
): Aligned<T>[] {
  const n = before.length;
  const m = after.length;
  const scores: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row: number[] = [];
    for (let j = 0; j < m; j++) {
      const a = before[i];
      const b = after[j];
      const value = a !== undefined && b !== undefined ? score(a, b) : 0;
      row.push(value >= threshold ? value : 0);
    }
    scores.push(row);
  }

  const best: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  const at = (i: number, j: number) => best[i]?.[j] ?? 0;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const pair = scores[i]?.[j] ?? 0;
      const row = best[i];
      if (!row) continue;
      row[j] = Math.max(at(i + 1, j), at(i, j + 1), pair > 0 ? pair + at(i + 1, j + 1) : 0);
    }
  }

  const out: Aligned<T>[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    const a = before[i];
    const b = after[j];
    const pair = scores[i]?.[j] ?? 0;
    if (a !== undefined && b !== undefined && pair > 0 && at(i, j) === pair + at(i + 1, j + 1)) {
      out.push({ before: a, after: b });
      i++;
      j++;
    } else if (a !== undefined && (b === undefined || at(i + 1, j) >= at(i, j + 1))) {
      out.push({ before: a, after: null });
      i++;
    } else if (b !== undefined) {
      out.push({ before: null, after: b });
      j++;
    }
  }
  return out;
}
