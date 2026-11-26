// A small mesh builder: flat-shaded triangles with per-vertex colour, plus the primitive shapes the
// aircraft, trees, rings and props are assembled from. Every shape can be moved, rotated and scaled.

import { add, cross, normalize, quatRotate, sub } from './math.js';

export class MeshBuilder {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.col = [];
  }

  /** One triangle, its normal computed from the winding (counter-clockwise faces out). */
  tri(a, b, c, color) {
    const n = normalize(cross(sub(b, a), sub(c, a)));
    for (const p of [a, b, c]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nrm.push(n[0], n[1], n[2]);
      this.col.push(color[0], color[1], color[2]);
    }
  }

  quad(a, b, c, d, color) {
    this.tri(a, b, c, color);
    this.tri(a, c, d, color);
  }

  /** Box centred at `at` with size [w, h, d], rotated by quaternion q. */
  box(at, size, color, q = [0, 0, 0, 1]) {
    const [w, h, d] = size.map((s) => s / 2);
    const P = (x, y, z) => add(at, quatRotate(q, [x, y, z]));
    const c = [P(-w, -h, d), P(w, -h, d), P(w, h, d), P(-w, h, d), P(-w, -h, -d), P(w, -h, -d), P(w, h, -d), P(-w, h, -d)];
    this.quad(c[0], c[1], c[2], c[3], color); // front (+z)
    this.quad(c[5], c[4], c[7], c[6], color); // back
    this.quad(c[4], c[0], c[3], c[7], color); // left
    this.quad(c[1], c[5], c[6], c[2], color); // right
    this.quad(c[3], c[2], c[6], c[7], color); // top
    this.quad(c[4], c[5], c[1], c[0], color); // bottom
  }

  /** A tapered prism along the z axis: rectangle w0×h0 at z0 to w1×h1 at z1, offset in y by dy1 at the far end. */
  taper(at, z0, z1, w0, h0, w1, h1, color, dy1 = 0, q = [0, 0, 0, 1]) {
    const P = (x, y, z) => add(at, quatRotate(q, [x, y, z]));
    const a = [P(-w0, -h0, z0), P(w0, -h0, z0), P(w0, h0, z0), P(-w0, h0, z0)];
    const b = [P(-w1, -h1 + dy1, z1), P(w1, -h1 + dy1, z1), P(w1, h1 + dy1, z1), P(-w1, h1 + dy1, z1)];
    this.quad(a[0], a[1], a[2], a[3], color);
    this.quad(b[1], b[0], b[3], b[2], color);
    this.quad(b[0], a[0], a[3], b[3], color);
    this.quad(a[1], b[1], b[2], a[2], color);
    this.quad(a[3], a[2], b[2], b[3], color);
    this.quad(b[0], b[1], a[1], a[0], color);
  }

  /** Upright cone (or pyramid with few sides) standing on `at`. */
  cone(at, radius, height, color, sides = 7, base = null) {
    const top = add(at, [0, height, 0]);
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2;
      const a1 = ((i + 1) / sides) * Math.PI * 2;
      const p0 = add(at, [Math.cos(a0) * radius, 0, Math.sin(a0) * radius]);
      const p1 = add(at, [Math.cos(a1) * radius, 0, Math.sin(a1) * radius]);
      this.tri(p0, top, p1, color);
      if (base) this.tri(p1, at, p0, base);
    }
  }

  /** Torus in the plane facing `normalDir` (a ring the aircraft flies through). */
  torus(at, radius, tube, color, q, seg = 28, sides = 8) {
    const P = (u, v) => {
      const cu = Math.cos(u);
      const su = Math.sin(u);
      const r = radius + tube * Math.cos(v);
      return add(at, quatRotate(q, [r * cu, r * su, tube * Math.sin(v)]));
    };
    for (let i = 0; i < seg; i++) {
      const u0 = (i / seg) * Math.PI * 2;
      const u1 = ((i + 1) / seg) * Math.PI * 2;
      for (let j = 0; j < sides; j++) {
        const v0 = (j / sides) * Math.PI * 2;
        const v1 = ((j + 1) / sides) * Math.PI * 2;
        this.quad(P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1), color);
      }
    }
  }

  /** Low-poly blob (an octahedron squashed and subdivided once) for clouds and smoke. */
  blob(at, r, color, squash = 0.55) {
    const t = (1 + Math.sqrt(5)) / 2;
    const v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
      .map((p) => normalize(p));
    const f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    // Subdivide each face once and shade with radial normals, so clouds and puffs read as soft and round.
    const mid = (p, q) => normalize([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2]);
    const S = (p) => add(at, [p[0] * r, p[1] * r * squash, p[2] * r]);
    const N = (p) => normalize([p[0], p[1] / squash, p[2]]);
    const smoothTri = (a, b, c) => {
      for (const p of [a, b, c]) {
        const s = S(p);
        const n = N(p);
        this.pos.push(s[0], s[1], s[2]);
        this.nrm.push(n[0], n[1], n[2]);
        this.col.push(color[0], color[1], color[2]);
      }
    };
    for (const [ia, ib, ic] of f) {
      const a = v[ia];
      const b = v[ib];
      const c = v[ic];
      const ab = mid(a, b);
      const bc = mid(b, c);
      const ca = mid(c, a);
      smoothTri(a, ab, ca);
      smoothTri(ab, b, bc);
      smoothTri(ca, bc, c);
      smoothTri(ab, bc, ca);
    }
  }

  get count() {
    return this.pos.length / 3;
  }
}
