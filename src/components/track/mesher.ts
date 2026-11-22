import * as THREE from 'three';

export type V3 = [number, number, number];

/**
 * Tiny non-indexed geometry accumulator: flat-coloured quads and boxes with face
 * normals, so a whole layer (kerbs, stands, walls…) becomes one draw call.
 */
export class Mesher {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  uv: number[] | null;

  constructor(withUv = false) {
    this.uv = withUv ? [] : null;
  }

  get empty() {
    return this.pos.length === 0;
  }

  /** a,b = one edge, c,d = the next (a→c and b→d run along); colour per quad. */
  quad(a: V3, b: V3, c: V3, d: V3, color: THREE.Color, up = false, uvs?: [number, number, number, number]) {
    let nx = 0, ny = 1, nz = 0;
    if (!up) {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      nx = uy * vz - uz * vy;
      ny = uz * vx - ux * vz;
      nz = ux * vy - uy * vx;
      const L = Math.hypot(nx, ny, nz) || 1;
      nx /= L;
      ny /= L;
      nz /= L;
    }
    for (const p of [a, b, c, c, b, d]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(nx, ny, nz);
      this.col.push(color.r, color.g, color.b);
    }
    if (this.uv) {
      const [u0, u1, v0, v1] = uvs ?? [0, 1, 0, 1];
      this.uv.push(u0, v0, u1, v0, u0, v1, u0, v1, u1, v0, u1, v1);
    }
  }

  /** Box from a centre, a unit forward direction (x/z), half sizes [right, up, forward]. */
  box(c: V3, fx: number, fz: number, h: V3, color: THREE.Color, top?: THREE.Color) {
    const rx = -fz, rz = fx;
    const P = (sr: number, su: number, sf: number): V3 => [
      c[0] + rx * h[0] * sr + fx * h[2] * sf,
      c[1] + h[1] * su,
      c[2] + rz * h[0] * sr + fz * h[2] * sf,
    ];
    const tc = top ?? color;
    // top, bottom, four sides
    this.quad(P(-1, 1, -1), P(1, 1, -1), P(-1, 1, 1), P(1, 1, 1), tc);
    this.quad(P(-1, -1, 1), P(1, -1, 1), P(-1, -1, -1), P(1, -1, -1), color);
    this.quad(P(-1, -1, -1), P(1, -1, -1), P(-1, 1, -1), P(1, 1, -1), color);
    this.quad(P(1, -1, 1), P(-1, -1, 1), P(1, 1, 1), P(-1, 1, 1), color);
    this.quad(P(-1, -1, 1), P(-1, -1, -1), P(-1, 1, 1), P(-1, 1, -1), color);
    this.quad(P(1, -1, -1), P(1, -1, 1), P(1, 1, -1), P(1, 1, 1), color);
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    return g;
  }
}
