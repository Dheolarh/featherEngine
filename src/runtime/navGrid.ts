/**
 * Grid navmesh for Move To pathfinding — the A* upgrade over pure raycast steering.
 *
 * A walkability grid is baked on the XZ plane from the static (fixed-body) colliders' footprints,
 * inflated by the agent radius. Paths are found with 8-connected A* (no corner cutting) and then
 * string-pulled with a grid line-of-sight pass so agents walk straight runs, not staircases.
 * Dynamic obstacles are NOT in the grid — the Move To runtime keeps its ray-fan steering as local
 * avoidance while following these waypoints, so moving props still get dodged.
 */

export interface NavObstacle {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface NavGrid {
  /** 1 = blocked. Row-major [z * width + x]. */
  blocked: Uint8Array;
  width: number;
  height: number;
  cellSize: number;
  originX: number;
  originZ: number;
}

export interface NavGridOptions {
  cellSize?: number;
  /** Extra clearance added around every obstacle (the agent's radius). */
  agentRadius?: number;
  /** Padding added around the obstacle bounds so paths can go AROUND outermost walls. */
  boundsPadding?: number;
  /** Hard cap per axis so a giant world can't allocate an unbounded grid. */
  maxCellsPerAxis?: number;
}

export const buildNavGrid = (obstacles: NavObstacle[], options: NavGridOptions = {}): NavGrid | undefined => {
  if (!obstacles.length) return undefined;
  const cellSize = options.cellSize ?? 1;
  const agentRadius = options.agentRadius ?? 0.45;
  const padding = options.boundsPadding ?? 16;
  const maxCells = options.maxCellsPerAxis ?? 256;

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const box of obstacles) {
    minX = Math.min(minX, box.minX);
    maxX = Math.max(maxX, box.maxX);
    minZ = Math.min(minZ, box.minZ);
    maxZ = Math.max(maxZ, box.maxZ);
  }
  minX -= padding;
  maxX += padding;
  minZ -= padding;
  maxZ += padding;

  const width = Math.min(maxCells, Math.max(8, Math.ceil((maxX - minX) / cellSize)));
  const height = Math.min(maxCells, Math.max(8, Math.ceil((maxZ - minZ) / cellSize)));
  const grid: NavGrid = { blocked: new Uint8Array(width * height), width, height, cellSize, originX: minX, originZ: minZ };

  for (const box of obstacles) {
    const x0 = Math.max(0, Math.floor((box.minX - agentRadius - minX) / cellSize));
    const x1 = Math.min(width - 1, Math.floor((box.maxX + agentRadius - minX) / cellSize));
    const z0 = Math.max(0, Math.floor((box.minZ - agentRadius - minZ) / cellSize));
    const z1 = Math.min(height - 1, Math.floor((box.maxZ + agentRadius - minZ) / cellSize));
    for (let z = z0; z <= z1; z += 1) {
      for (let x = x0; x <= x1; x += 1) grid.blocked[z * width + x] = 1;
    }
  }
  return grid;
};

const cellOf = (grid: NavGrid, x: number, z: number): [number, number] => [
  Math.min(grid.width - 1, Math.max(0, Math.floor((x - grid.originX) / grid.cellSize))),
  Math.min(grid.height - 1, Math.max(0, Math.floor((z - grid.originZ) / grid.cellSize))),
];

const centerOf = (grid: NavGrid, cx: number, cz: number): [number, number] => [
  grid.originX + (cx + 0.5) * grid.cellSize,
  grid.originZ + (cz + 0.5) * grid.cellSize,
];

const isBlocked = (grid: NavGrid, cx: number, cz: number): boolean =>
  cx < 0 || cz < 0 || cx >= grid.width || cz >= grid.height || grid.blocked[cz * grid.width + cx] === 1;

/** Nearest walkable cell to (cx, cz), spiralling outward — rescues targets standing inside a wall's clearance. */
const nearestOpen = (grid: NavGrid, cx: number, cz: number, maxRing = 6): [number, number] | undefined => {
  if (!isBlocked(grid, cx, cz)) return [cx, cz];
  for (let ring = 1; ring <= maxRing; ring += 1) {
    for (let dz = -ring; dz <= ring; dz += 1) {
      for (let dx = -ring; dx <= ring; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
        if (!isBlocked(grid, cx + dx, cz + dz)) return [cx + dx, cz + dz];
      }
    }
  }
  return undefined;
};

/** Straight-line walkability between two cells (supercover — checks every cell the segment touches). */
const lineOfSight = (grid: NavGrid, ax: number, az: number, bx: number, bz: number): boolean => {
  const steps = Math.max(Math.abs(bx - ax), Math.abs(bz - az)) * 2;
  if (steps === 0) return true;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const x = Math.round(ax + (bx - ax) * t);
    const z = Math.round(az + (bz - az) * t);
    if (isBlocked(grid, x, z)) return false;
  }
  return true;
};

const NEIGHBORS: Array<[number, number, number]> = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

/**
 * A* path from world (fromX, fromZ) to (toX, toZ). Returns smoothed world waypoints (excluding the
 * start, including the goal), or undefined when unreachable / endpoints can't be rescued.
 * Straight-line-visible targets return a single waypoint, so steering stays authoritative up close.
 */
export const findNavPath = (
  grid: NavGrid,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
): Array<[number, number]> | undefined => {
  const start = nearestOpen(grid, ...cellOf(grid, fromX, fromZ));
  const goal = nearestOpen(grid, ...cellOf(grid, toX, toZ));
  if (!start || !goal) return undefined;
  if (lineOfSight(grid, start[0], start[1], goal[0], goal[1])) return [[toX, toZ]];

  const { width } = grid;
  const key = (x: number, z: number) => z * width + x;
  const startKey = key(start[0], start[1]);
  const goalKey = key(goal[0], goal[1]);
  const gScore = new Map<number, number>([[startKey, 0]]);
  const cameFrom = new Map<number, number>();
  const heuristic = (x: number, z: number) => Math.hypot(x - goal[0], z - goal[1]);
  // Simple sorted-insert open list — grids are ≤256², and paths explore a small fraction of that.
  const open: Array<{ k: number; x: number; z: number; f: number }> = [
    { k: startKey, x: start[0], z: start[1], f: heuristic(start[0], start[1]) },
  ];
  const closed = new Set<number>();
  let found = false;

  while (open.length) {
    let bestIdx = 0;
    for (let i = 1; i < open.length; i += 1) if (open[i].f < open[bestIdx].f) bestIdx = i;
    const current = open.splice(bestIdx, 1)[0];
    if (current.k === goalKey) {
      found = true;
      break;
    }
    if (closed.has(current.k)) continue;
    closed.add(current.k);

    for (const [dx, dz, cost] of NEIGHBORS) {
      const nx = current.x + dx;
      const nz = current.z + dz;
      if (isBlocked(grid, nx, nz)) continue;
      // No diagonal corner cutting: both orthogonal neighbors must be open.
      if (dx !== 0 && dz !== 0 && (isBlocked(grid, current.x + dx, current.z) || isBlocked(grid, current.x, current.z + dz))) continue;
      const nk = key(nx, nz);
      if (closed.has(nk)) continue;
      const tentative = (gScore.get(current.k) ?? Infinity) + cost;
      if (tentative < (gScore.get(nk) ?? Infinity)) {
        gScore.set(nk, tentative);
        cameFrom.set(nk, current.k);
        open.push({ k: nk, x: nx, z: nz, f: tentative + heuristic(nx, nz) });
      }
    }
  }
  if (!found) return undefined;

  // Reconstruct cell path, then string-pull: keep only waypoints where line of sight breaks.
  const cells: Array<[number, number]> = [];
  let cursor: number | undefined = goalKey;
  while (cursor !== undefined) {
    cells.push([cursor % width, Math.floor(cursor / width)]);
    cursor = cameFrom.get(cursor);
  }
  cells.reverse();

  const waypoints: Array<[number, number]> = [];
  let anchor = 0;
  for (let i = 2; i < cells.length; i += 1) {
    if (!lineOfSight(grid, cells[anchor][0], cells[anchor][1], cells[i][0], cells[i][1])) {
      anchor = i - 1;
      waypoints.push(centerOf(grid, cells[anchor][0], cells[anchor][1]));
    }
  }
  waypoints.push([toX, toZ]);
  return waypoints;
};
