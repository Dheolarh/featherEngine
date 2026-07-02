import { describe, expect, it } from 'vitest';
import { buildNavGrid, findNavPath } from '../navGrid';

describe('navGrid — grid A* pathfinding', () => {
  it('routes around a wall instead of through it', () => {
    // A wall spanning x ∈ [-1, 1], z ∈ [-6, 6] between start (-5, 0) and goal (5, 0).
    const grid = buildNavGrid([{ minX: -1, maxX: 1, minZ: -6, maxZ: 6 }], { boundsPadding: 10 })!;
    const path = findNavPath(grid, -5, 0, 5, 0);
    expect(path).toBeDefined();
    expect(path!.length).toBeGreaterThan(1); // detour, not a straight shot
    // The last waypoint is the exact requested goal.
    expect(path![path!.length - 1]).toEqual([5, 0]);
    // Every intermediate waypoint clears the wall's footprint (inflated by the agent radius).
    for (const [x, z] of path!.slice(0, -1)) {
      const inside = x > -1.5 && x < 1.5 && z > -6.5 && z < 6.5;
      expect(inside, `waypoint (${x}, ${z}) is inside the wall`).toBe(false);
    }
    // The detour goes around one END of the wall (|z| beyond ±6 at some point).
    expect(path!.some(([, z]) => Math.abs(z) > 6)).toBe(true);
  });

  it('returns a single direct waypoint when the goal is visible', () => {
    const grid = buildNavGrid([{ minX: 20, maxX: 22, minZ: 20, maxZ: 22 }], { boundsPadding: 10 })!;
    const path = findNavPath(grid, 0, 0, 5, 0);
    expect(path).toEqual([[5, 0]]);
  });

  it('reports unreachable goals as undefined', () => {
    // A closed box fully surrounding the goal.
    const grid = buildNavGrid(
      [
        { minX: 3, maxX: 9, minZ: 3, maxZ: 4 },
        { minX: 3, maxX: 9, minZ: 8, maxZ: 9 },
        { minX: 3, maxX: 4, minZ: 3, maxZ: 9 },
        { minX: 8, maxX: 9, minZ: 3, maxZ: 9 },
      ],
      { boundsPadding: 6 },
    )!;
    expect(findNavPath(grid, -2, -2, 6, 6)).toBeUndefined();
  });

  it('rescues a target standing inside an obstacle clearance ring', () => {
    const grid = buildNavGrid([{ minX: 4, maxX: 6, minZ: -2, maxZ: 2 }], { boundsPadding: 10 })!;
    // Goal exactly on the wall edge — nearestOpen should shift it to a walkable cell.
    const path = findNavPath(grid, -4, 0, 5, 0);
    expect(path).toBeDefined();
  });
});
