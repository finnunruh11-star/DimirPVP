// Grid A* for click-to-walk and for checking that every door on a map can be
// reached. Pure: works on any `blocked(x, y)` predicate.

export interface Cell {
  x: number;
  y: number;
}

const DIRS: readonly [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

/**
 * Shortest 8-way path from `from` to `to`, never cutting a blocked corner.
 * Returns the cells after `from`, or null when `to` cannot be reached.
 */
export function findPath(
  w: number,
  h: number,
  blocked: (x: number, y: number) => boolean,
  from: Cell,
  to: Cell,
  maxNodes = 20000,
): Cell[] | null {
  return findWeightedPath(w, h, (x, y) => (blocked(x, y) ? Infinity : 1), from, to, maxNodes);
}

/**
 * Cheapest 8-way path where entering a cell costs `cost(x, y)` (Infinity blocks
 * it). Diagonals cost √2 as much and never cut a blocked corner. `minCost` is
 * the cheapest any cell can be, which keeps the heuristic honest.
 */
export function findWeightedPath(
  w: number,
  h: number,
  cost: (x: number, y: number) => number,
  from: Cell,
  to: Cell,
  maxNodes = 20000,
  minCost = 1,
): Cell[] | null {
  const blocked = (x: number, y: number): boolean => !Number.isFinite(cost(x, y));
  if (to.x < 0 || to.y < 0 || to.x >= w || to.y >= h || blocked(to.x, to.y)) return null;
  if (from.x === to.x && from.y === to.y) return [];
  const idx = (x: number, y: number): number => y * w + x;
  const g = new Float64Array(w * h).fill(Infinity);
  const came = new Int32Array(w * h).fill(-1);
  const closed = new Uint8Array(w * h);
  const heur = (x: number, y: number): number => {
    const dx = Math.abs(x - to.x);
    const dy = Math.abs(y - to.y);
    return (Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy)) * minCost;
  };
  // A binary heap of [f, index].
  const heap: [number, number][] = [];
  const push = (f: number, i: number): void => {
    heap.push([f, i]);
    let c = heap.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (heap[p][0] <= heap[c][0]) break;
      [heap[p], heap[c]] = [heap[c], heap[p]];
      c = p;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let c = 0;
      for (;;) {
        const l = c * 2 + 1;
        const r = l + 1;
        let m = c;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === c) break;
        [heap[m], heap[c]] = [heap[c], heap[m]];
        c = m;
      }
    }
    return top;
  };

  const start = idx(from.x, from.y);
  g[start] = 0;
  push(heur(from.x, from.y), start);
  let expanded = 0;
  while (heap.length && expanded++ < maxNodes) {
    const [, current] = pop();
    if (closed[current]) continue;
    closed[current] = 1;
    const cx = current % w;
    const cy = (current - cx) / w;
    if (cx === to.x && cy === to.y) {
      const path: Cell[] = [];
      for (let at = current; at !== start; at = came[at]) path.push({ x: at % w, y: Math.floor(at / w) });
      return path.reverse();
    }
    for (const [dx, dy, step] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || blocked(nx, ny)) continue;
      if (dx && dy && (blocked(cx + dx, cy) || blocked(cx, cy + dy))) continue;
      const next = idx(nx, ny);
      const tentative = g[current] + step * cost(nx, ny);
      if (tentative >= g[next]) continue;
      g[next] = tentative;
      came[next] = current;
      push(tentative + heur(nx, ny), next);
    }
  }
  return null;
}

/** Every cell reachable from `from`, as a flat mask. */
export function floodReach(
  w: number,
  h: number,
  blocked: (x: number, y: number) => boolean,
  from: Cell,
): Uint8Array {
  const seen = new Uint8Array(w * h);
  if (blocked(from.x, from.y)) return seen;
  const stack = [from.y * w + from.x];
  seen[stack[0]] = 1;
  while (stack.length) {
    const at = stack.pop()!;
    const x = at % w;
    const y = (at - x) / w;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || blocked(nx, ny)) continue;
      const next = ny * w + nx;
      if (seen[next]) continue;
      seen[next] = 1;
      stack.push(next);
    }
  }
  return seen;
}
