/**
 * Tiny 2D circle physics for the footer pile: gravity, wall/floor bounces,
 * circle–circle impulses with positional correction, rolling spin, and a
 * kinematic "held" body for drag & toss. No dependencies.
 */
export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  /** rotation, radians */
  a: number;
  va: number;
  invM: number;
  held: boolean;
  /** pointer target while held */
  tx: number;
  ty: number;
}

export interface World {
  w: number;
  h: number;
  bodies: Body[];
  gravity: number;
}

export function makeBody(x: number, y: number, r: number): Body {
  return { x, y, vx: 0, vy: 0, r, a: 0, va: 0, invM: 1 / (r * r), held: false, tx: x, ty: y };
}

const REST = 0.32;
const WALL_REST = 0.4;
const FRICTION = 0.985;

export function step(world: World, dt: number) {
  const sub = 3;
  const h = dt / sub;
  const { bodies, w, h: H } = world;
  for (let s = 0; s < sub; s++) {
    for (const b of bodies) {
      if (b.held) {
        const nx = b.x + (b.tx - b.x) * 0.5;
        const ny = b.y + (b.ty - b.y) * 0.5;
        b.vx = (nx - b.x) / h;
        b.vy = (ny - b.y) / h;
        b.x = nx;
        b.y = ny;
        b.va *= 0.9;
        b.a += b.va * h;
        continue;
      }
      b.vy += world.gravity * h;
      b.x += b.vx * h;
      b.y += b.vy * h;
      b.a += b.va * h;
      // walls (no ceiling: bodies may be dropped in from above)
      if (b.x < b.r) {
        b.x = b.r;
        if (b.vx < 0) b.vx = -b.vx * WALL_REST;
      } else if (b.x > w - b.r) {
        b.x = w - b.r;
        if (b.vx > 0) b.vx = -b.vx * WALL_REST;
      }
      if (b.y > H - b.r) {
        b.y = H - b.r;
        if (b.vy > 0) b.vy = -b.vy * WALL_REST;
        if (Math.abs(b.vy) < 30) b.vy = 0;
        b.vx *= FRICTION;
        // roll without slipping on the floor
        b.va += (b.vx / b.r - b.va) * 0.3;
      }
      if (b.y < -H * 1.5) {
        b.y = -H * 1.5;
        b.vy = 0;
      }
    }
    // pairwise contacts (n is tiny)
    for (let it = 0; it < 2; it++) {
      for (let i = 0; i < bodies.length; i++) {
        const a = bodies[i];
        for (let j = i + 1; j < bodies.length; j++) {
          const b = bodies[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const rr = a.r + b.r;
          const d2 = dx * dx + dy * dy;
          if (d2 >= rr * rr || d2 === 0) continue;
          const d = Math.sqrt(d2);
          const nx = dx / d;
          const ny = dy / d;
          const ia = a.held ? 0 : a.invM;
          const ib = b.held ? 0 : b.invM;
          const sum = ia + ib;
          if (sum === 0) continue;
          const pen = rr - d;
          a.x -= nx * pen * (ia / sum);
          a.y -= ny * pen * (ia / sum);
          b.x += nx * pen * (ib / sum);
          b.y += ny * pen * (ib / sum);
          const rvx = b.vx - a.vx;
          const rvy = b.vy - a.vy;
          const vn = rvx * nx + rvy * ny;
          if (vn < 0) {
            const j = (-(1 + REST) * vn) / sum;
            a.vx -= j * nx * ia;
            a.vy -= j * ny * ia;
            b.vx += j * nx * ib;
            b.vy += j * ny * ib;
            // tangential velocity spins the discs a little
            const vt = rvx * -ny + rvy * nx;
            a.va -= (vt / a.r) * 0.08 * (ia ? 1 : 0);
            b.va += (vt / b.r) * 0.08 * (ib ? 1 : 0);
            // contact friction
            a.vx *= 0.995;
            b.vx *= 0.995;
          }
        }
      }
    }
  }
  for (const b of bodies) {
    b.va *= 0.995;
    const sp = Math.hypot(b.vx, b.vy);
    const max = 4200;
    if (sp > max) {
      b.vx *= max / sp;
      b.vy *= max / sp;
    }
  }
}

/** Settle a world synchronously (reduced motion: render the resting pile). */
export function settle(world: World, steps = 900) {
  for (let i = 0; i < steps; i++) step(world, 1 / 60);
  for (const b of world.bodies) {
    b.vx = b.vy = b.va = 0;
  }
}
