import * as THREE from 'three';

/**
 * Runtime decal ring buffer — bullet holes, blood splats, scorch/burn marks projected onto surfaces.
 *
 * Same module-singleton + fixed ring-buffer shape as skidMarks.ts: producers call `addDecal(...)` (from
 * the "Spawn Decal" script node and automatically at weapon/projectile impact sites), and the pooled
 * DecalLayer render component reads `decals.items` every frame and draws each as a normal-oriented quad
 * in an InstancedMesh. Oldest decals are recycled once MAX_DECALS is exceeded, so the cost is bounded no
 * matter how much the player shoots. Cleared on Play start/stop so sessions don't leak marks.
 */
export type DecalKind = 'bullet' | 'blood' | 'scorch';

export interface Decal {
  /** World position of the hit. */
  x: number;
  y: number;
  z: number;
  /** Surface normal at the hit (unit-ish) — the quad faces along this. */
  nx: number;
  ny: number;
  nz: number;
  /** Half-size of the decal quad in world units. */
  size: number;
  kind: DecalKind;
  /** Optional hex tint override (else the preset's own color). */
  color: string | null;
  /** Random spin about the normal so repeated marks don't look stamped. */
  roll: number;
  /** Seconds of life remaining; Infinity = permanent (recycled only by the ring buffer). */
  life: number;
  maxLife: number;
}

export const MAX_DECALS = 256;

export const decals: { items: Decal[]; head: number } = { items: [], head: 0 };

/**
 * Add a decal at a world point facing a surface normal. `life` in seconds (default Infinity = permanent
 * until recycled). Producers that only know the shot direction can pass the reversed direction as the
 * normal — good enough for a flat wall hit.
 */
export function addDecal(
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number,
  kind: DecalKind = 'bullet',
  size = 0.4,
  color: string | null = null,
  life = Infinity,
): void {
  // Normalize the normal defensively (callers may pass an un-normalized direction).
  const len = Math.hypot(nx, ny, nz) || 1;
  const slot = decals.head % MAX_DECALS;
  decals.items[slot] = {
    x,
    y,
    z,
    nx: nx / len,
    ny: ny / len,
    nz: nz / len,
    size: Math.max(0.02, size),
    kind,
    color,
    roll: Math.random() * Math.PI * 2,
    life,
    maxLife: life,
  };
  decals.head += 1;
}

export function clearDecals(): void {
  decals.items = [];
  decals.head = 0;
}

/** Procedurally-drawn alpha textures for each preset (no image assets needed). Built once, lazily. */
const textureCache = new Map<DecalKind, THREE.Texture>();

export function decalTexture(kind: DecalKind): THREE.Texture {
  const cached = textureCache.get(kind);
  if (cached) return cached;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;

  if (kind === 'bullet') {
    // Dark impact crater with a soft rim and a few radial cracks.
    const grad = ctx.createRadialGradient(c, c, 2, c, c, c);
    grad.addColorStop(0, 'rgba(15,12,10,0.95)');
    grad.addColorStop(0.45, 'rgba(30,26,22,0.7)');
    grad.addColorStop(0.75, 'rgba(60,55,50,0.25)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(c, c, c, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(20,18,16,0.5)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + Math.random() * 0.4;
      const r = c * (0.4 + Math.random() * 0.45);
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
      ctx.stroke();
    }
  } else if (kind === 'blood') {
    // Irregular red splat: a main blob plus scattered droplets.
    ctx.fillStyle = 'rgba(120,10,10,0.9)';
    const blob = (bx: number, by: number, r: number, alpha: number) => {
      const g = ctx.createRadialGradient(bx, by, 1, bx, by, r);
      g.addColorStop(0, `rgba(140,12,12,${alpha})`);
      g.addColorStop(0.7, `rgba(90,8,8,${alpha * 0.7})`);
      g.addColorStop(1, 'rgba(60,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(bx, by, r, 0, Math.PI * 2);
      ctx.fill();
    };
    blob(c, c, c * 0.6, 0.92);
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = c * (0.3 + Math.random() * 0.6);
      blob(c + Math.cos(a) * d, c + Math.sin(a) * d, c * (0.06 + Math.random() * 0.18), 0.85);
    }
  } else {
    // Scorch: soft dark burn.
    const grad = ctx.createRadialGradient(c, c, 2, c, c, c);
    grad.addColorStop(0, 'rgba(8,7,6,0.92)');
    grad.addColorStop(0.55, 'rgba(25,20,16,0.55)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(c, c, c, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  textureCache.set(kind, texture);
  return texture;
}
