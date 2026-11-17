
import * as THREE from 'three';


// ===== geometry.js =====
// ─────────────────────────────────────────────────────────────
//  Geometry: a blue whale cast in jelly, resting on its belly.
//  A signed distance field gives the body — a long, slender
//  section swept along the spine, the head broad and flat (a U
//  seen from above) with a long mouth line curving up to the eye,
//  a splash guard in front of twin blowholes, short narrow
//  flippers, a tiny dorsal fin far back, broad triangular flukes.
//  The throat is a pouch of clear jelly over a thin milky floor:
//  it balloons when the whale gulps, and fills with krill that is
//  then carried back to the stomach. Inside: a milky belly, rows
//  of licorice baleen hanging inside the upper jaw, bubbles.
//  A snapped hex lattice (5 tets per cell) for the simulation,
//  surface-nets render surfaces for the clear jelly and the milky
//  layer, and the barycentric embedding that ties every vertex to
//  a tetrahedron.
// ─────────────────────────────────────────────────────────────

// rest frame: the whale's length runs along x (flukes at −x, snout at +x), belly on the floor (y = 0), z across
const SHAPE = {
  x0: -1.46, x1: 1.62,       // the swept body, from the tail stock to the tip of the snout
  capT: 0.07, capS: 0.2,     // over these lengths the section closes, at the tail and round the broad snout
  floorK: 0.16,              // the fillet where the belly is pressed flat on the floor
  skin: 0.012,               // the milky layer sits this far under the surface
  blow: { x: 1.0, z: 0.034, a: 0.042, b: 0.016, c: 0.013 },    // twin blowholes, side by side
  guard: { x: 1.1, a: 0.1, b: 0.03, c: 0.055 },                 // the splash guard in front of them
  eye: { x: 0.9, a: 0.032, c: 0.025 },
  flip: { root: [0.6, 0.13, 0.27], dir: [-0.46, -0.26, 0.86], len: 0.4, r1: 0.07, r2: 0.022, th: 0.026 },
  fluke: { s0: [-1.46, 0.04], s1: [-1.76, 0.7], r1: 0.15, r2: 0.035, notch: [-1.76, 0.065] },
  dorsal: { x0: -0.8, x1: -0.94, h: 0.08, r1: 0.06, r2: 0.018, th: 0.024 },
  pouch: { x0: 0.26, x1: 1.55 },   // the throat: from the navel to the chin
};

// the body's outline along its length: x, the top of the back, the bottom of the belly, the half-width
// (authored slender, then scaled up in girth: a well-fed, chunky jelly)
const GIRTH = 1.38;
const PROFILE = [
  [-1.46, 0.11, 0.02, 0.045],
  [-1.25, 0.17, 0.0, 0.075],
  [-1.0, 0.25, -0.02, 0.12],
  [-0.7, 0.33, -0.035, 0.17],
  [-0.4, 0.4, -0.05, 0.21],
  [-0.1, 0.44, -0.06, 0.24],
  [0.2, 0.455, -0.065, 0.255],
  [0.5, 0.45, -0.065, 0.262],
  [0.8, 0.42, -0.06, 0.258],
  [1.05, 0.375, -0.05, 0.245],
  [1.3, 0.32, -0.035, 0.222],
  [1.5, 0.265, -0.02, 0.19],
  [1.62, 0.23, -0.01, 0.165],
].map(([x, t, b, w]) => [x, t * GIRTH, b * GIRTH, w * GIRTH]);

// seeded PRNG so the specimen is identical on each load
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smax = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * 0.25; };
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const clamp01 = v => Math.min(1, Math.max(0, v));
const sstep = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

// monotone cubic through the profile's knots (Fritsch–Carlson), one column at a time
function monotone(xs, ys) {
  const n = xs.length, d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return x => {
    let i = 0; while (i < n - 2 && x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = clamp01((x - xs[i]) / h), t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

// the mouth line along the side of the head: low at the snout, curving up toward the eye
const MOUTH_X0 = 0.9;
const mouthY = x => GIRTH * (0.09 + 0.05 * (SHAPE.x1 - x) / 0.65 + 0.032 * sstep(1.12, 0.92, x));
// the line between the clear jelly above and the milky layer below: it waves along the flank, sinks away along the
// tail stock, and in the throat thins to a milky floor under the clear pouch
function interfaceY(x, yc, ry) {
  let yb = yc - 0.3 * ry + 0.022 * Math.sin(6.0 * x + 0.8) + 0.009 * Math.sin(14.7 * x + 2.1);
  yb -= sstep(-0.5, -1.0, x) * 1.3 * ry;
  return yb + (0.04 - yb) * sstep(0.18, 0.42, x);
}
// how boxy the section is: round along the body, a little squarer (flat-topped, broad) at the head
const powAt = x => 2 + 0.45 * sstep(0.8, 1.35, x);

// the swept section, tabulated along x: centre height, half-height, half-width, and the milky line
const AXN = 1024;
const AX = (() => {
  const xs = PROFILE.map(p => p[0]);
  const top = monotone(xs, PROFILE.map(p => p[1])), bot = monotone(xs, PROFILE.map(p => p[2])), wid = monotone(xs, PROFILE.map(p => p[3]));
  const S = SHAPE, out = new Float32Array(AXN * 4);
  for (let i = 0; i < AXN; i++) {
    const x = S.x0 + (S.x1 - S.x0) * i / (AXN - 1);
    const T = top(x), B = bot(x);
    let f = 1;
    if (x < S.x0 + S.capT) f = Math.sqrt(Math.max(0, 1 - ((S.x0 + S.capT - x) / S.capT) ** 2));
    if (x > S.x1 - S.capS) f = Math.sqrt(Math.max(0, 1 - ((x - (S.x1 - S.capS)) / S.capS) ** 2));
    const yc = (T + B) / 2, ry = Math.max(0.004, (T - B) / 2 * f), rz = Math.max(0.004, wid(x) * f);
    out[4 * i] = yc; out[4 * i + 1] = ry; out[4 * i + 2] = rz; out[4 * i + 3] = interfaceY(x, yc, (T - B) / 2);
  }
  return out;
})();
function axisAt(x) {
  const S = SHAPE, f = clamp01((x - S.x0) / (S.x1 - S.x0)) * (AXN - 1), i = Math.min(AXN - 2, Math.floor(f)), t = f - i;
  return [0, 1, 2, 3].map(k => AX[4 * i + k] + (AX[4 * i + 4 + k] - AX[4 * i + k]) * t);
}
const topAt = x => { const a = axisAt(x); return a[0] + a[1]; };

// iq's uneven capsule in 2D: a circle of radius r1 at the origin joined by tangent lines to one of radius r2 at (0, h)
function sdUnevenCapsule(px, py, r1, r2, h) {
  px = Math.abs(px);
  const b = (r1 - r2) / h, a = Math.sqrt(1 - b * b), k = -b * px + a * py;
  if (k < 0) return Math.hypot(px, py) - r1;
  if (k > a * h) return Math.hypot(px, py - h) - r2;
  return a * px + b * py - r1;
}
// a 2D outline given thickness 2·th, its edges rounded with radius rr
function extrude(d2, t, th, rr) {
  const wx = d2 + rr, wy = Math.abs(t) - th + rr;
  return Math.min(Math.max(wx, wy), 0) + Math.hypot(Math.max(wx, 0), Math.max(wy, 0)) - rr;
}
function sdEllipsoid(px, py, pz, a, b, c) {
  const k0 = Math.hypot(px / a, py / b, pz / c);
  if (k0 < 1) return (k0 - 1) * Math.min(a, b, c);
  const k1 = Math.hypot(px / (a * a), py / (b * b), pz / (c * c));
  return k0 * (k0 - 1) / k1;
}

// ── the parts (z ≥ 0: the whale is mirrored across its midline) ──
function bodyRaw(x, y, z) {
  const S = SHAPE, xc = Math.min(Math.max(x, S.x0), S.x1);
  const A = axisAt(xc), ry = A[1], rz = A[2], p = powAt(xc);
  const u = Math.abs(y - A[0]) / ry, v = Math.abs(z) / rz;
  const k0 = Math.pow(Math.pow(u, p) + Math.pow(v, p), 1 / p);
  const kq = Math.pow(Math.max(k0, 1e-6), 1 - p);
  const g = Math.hypot(kq * Math.pow(u, p - 1) / ry, kq * Math.pow(v, p - 1) / rz);
  let d = (k0 - 1) / Math.max(g, 1e-6);
  if (k0 < 1) d = Math.max(d, (k0 - 1) * Math.min(ry, rz));
  const ex = x - xc;
  return ex !== 0 ? Math.hypot(Math.max(d, 0), ex) : d;
}
const FLIP = (() => {
  const F = SHAPE.flip, l = Math.hypot(...F.dir), D = F.dir.map(v => v / l);
  let C = [D[2], 0, -D[0]]; const cl = Math.hypot(...C); C = C.map(v => v / cl);
  const T = [D[1] * C[2] - D[2] * C[1], D[2] * C[0] - D[0] * C[2], D[0] * C[1] - D[1] * C[0]];
  return { D, C, T };
})();
// a short, narrow, pointed flipper
function flipperSD(x, y, z) {
  const F = SHAPE.flip, { D, C, T } = FLIP;
  const px = x - F.root[0], py = y - F.root[1], pz = z - F.root[2];
  const s = px * D[0] + py * D[1] + pz * D[2];
  let c = px * C[0] + py * C[1] + pz * C[2];
  const t = px * T[0] + py * T[1] + pz * T[2];
  const u = clamp01(s / F.len);
  c -= 0.014 * Math.sin(Math.PI * u);
  const d2 = sdUnevenCapsule(c, s, F.r1, F.r2, F.len);
  return extrude(d2, t, F.th * (1 - 0.4 * u), 0.017);
}
const FLUKE = (() => {
  const F = SHAPE.fluke, vx = F.s1[0] - F.s0[0], vz = F.s1[1] - F.s0[1], L = Math.hypot(vx, vz);
  return { L, u: [vx / L, vz / L], v: [vz / L, -vx / L] };
})();
// broad triangular flukes, a straight trailing edge, a small notch
function flukeSD(x, y, z) {
  const F = SHAPE.fluke, { L, u, v } = FLUKE;
  const px = x - F.s0[0], pz = z - F.s0[1];
  const s = px * u[0] + pz * u[1];
  let c = px * v[0] + pz * v[1];
  const tt = clamp01(s / L);
  c -= 0.014 * Math.sin(Math.PI * tt) - 0.03 * tt * tt;
  let d2 = sdUnevenCapsule(c, s, F.r1, F.r2, L);
  d2 = smax(d2, F.notch[1] - Math.hypot(x - F.notch[0], z), 0.03);
  const hf = 0.046 - 0.024 * tt, yf = hf + 0.003 + 0.05 * tt * tt;
  return extrude(d2, y - yf, hf, 0.018);
}
const DORSAL = (() => {
  const F = SHAPE.dorsal;
  const b0 = [F.x0, topAt(F.x0) - 0.05], b1 = [F.x1, topAt(F.x1) + F.h];
  const vx = b1[0] - b0[0], vy = b1[1] - b0[1], L = Math.hypot(vx, vy);
  return { b0, L, u: [vx / L, vy / L] };
})();
// the tiny dorsal fin, far back
function dorsalSD(x, y, z) {
  const F = SHAPE.dorsal, { b0, L, u } = DORSAL;
  const px = x - b0[0], py = y - b0[1];
  const s = px * u[0] + py * u[1], c = px * u[1] - py * u[0];
  const d2 = sdUnevenCapsule(c, s, F.r1, F.r2, L);
  return extrude(d2, z, F.th * (1 - 0.3 * clamp01(s / L)), 0.02);
}
// the twin blowholes and the ridge of the splash guard in front of them
const BLOW = [SHAPE.blow.x, topAt(SHAPE.blow.x) - 0.003, SHAPE.blow.z];
const GUARD = [SHAPE.guard.x, topAt(SHAPE.guard.x) - 0.012, 0];

function bodyFlat(x, y, z) { return smax(bodyRaw(x, y, z), -y, SHAPE.floorK); }
function tongueSD(x,y,z){return smin(sdEllipsoid(x+.29,y-1.02,z-.68,.14,.20,.14),smin(sdEllipsoid(x+.22,y-.90,z-.81,.22,.23,.16),sdEllipsoid(x+.15,y-.76,z-.91,.25,.23,.16),.10),.12);}
function nailongSolid(x,y,z){
 let d=sdEllipsoid(x+.79,y-.86,z-.03,1.02,.93,.73);
 d=smin(d,sdEllipsoid(x-.69,y-.76,z+.12,1.04,.77,.55),.09);
 // shoulder behind the head and the long arm resting over the chest
 d=smin(d,sdEllipsoid(x-.12,y-1.37,z-.08,.36,.37,.36),.08);
 d=smin(d,sdEllipsoid(x-.22,y-.98,z-.49,.23,.44,.24),.065);
 d=smin(d,sdEllipsoid(x-.25,y-.08,z-.08,.22,.13,.16),.045);
 d=smin(d,sdEllipsoid(x-1.43,y-.20,z-.16,.23,.20,.22),.045);
 d=smin(d,sdEllipsoid(x-1.46,y-.53,z+.20,.25,.23,.23),.045);
 return d;
}
function cavitySD(x,y,z){return sdEllipsoid(x+.25,y-.83,z-.77,.28,.49,.30);}
function whaleSD(x,y,z){let d=smax(nailongSolid(x,y,z),-cavitySD(x,y,z),.022);d=smin(d,tongueSD(x,y,z),.035);return smax(d,-y,.055);}

// the milky layer: the belly drawn in by the skin below the wavy line (a thin floor under the throat)
function coreSD(x,y,z){return smax(whaleSD(x,y,z)+.014,sdEllipsoid(x-.61,y-.44,z-.46,.53,.58,.16),.025);}
// which part a rest-space point belongs to: 3 a fin, 2 the skin, 1 the clear jelly, 0 the milky layer
function partOf(x,y,z){if(tongueSD(x,y,z)<.035)return 1;if(coreSD(x,y,z)<0)return 0;return -whaleSD(x,y,z)<.045?2:1;}
// the throat pouch: how much a rest-space point belongs to it (the lower half of the body from the navel to the chin)
function pouchW(x, y) {
  const P = SHAPE.pouch, A = axisAt(x);
  const wx = sstep(P.x0, P.x0 + 0.32, x) * (1 - sstep(P.x1 - 0.22, P.x1, x));
  const lim = Math.min(A[0] + 0.12 * A[1], x > MOUTH_X0 - 0.1 ? mouthY(Math.max(x, MOUTH_X0)) - 0.01 : 9);
  return wx * sstep(lim, lim - 0.12, y);
}
function sdGrad(sd, x, y, z, e = 1e-3) {
  const gx = sd(x + e, y, z) - sd(x - e, y, z), gy = sd(x, y + e, z) - sd(x, y - e, z), gz = sd(x, y, z + e) - sd(x, y, z - e);
  const l = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
  return [gx / l, gy / l, gz / l, l / (2 * e)];
}
// Newton steps onto the zero set
function project(sd, p, iters = 4) {
  for (let it = 0; it < iters; it++) {
    const d = sd(p[0], p[1], p[2]);
    if (Math.abs(d) < 1e-5) break;
    const g = sdGrad(sd, p[0], p[1], p[2]);
    const s = d / Math.max(0.3, g[3]);
    p[0] -= g[0] * s; p[1] -= g[1] * s; p[2] -= g[2] * s;
  }
  return p;
}

// ── surface nets: one vertex per sign-changing cell, projected onto the surface ──
function surfaceNets(sd, box, s) {
  const x0 = box[0] - s, y0 = box[1] - s, z0 = box[2] - s;
  const nx = Math.ceil((box[3] - box[0]) / s) + 3, ny = Math.ceil((box[4] - box[1]) / s) + 3, nz = Math.ceil((box[5] - box[2]) / s) + 3;
  const nxy = nx * ny;
  const val = new Float32Array(nxy * nz);
  for (let k = 0; k < nz; k++) { const z = z0 + k * s; for (let j = 0; j < ny; j++) { const y = y0 + j * s, o = nx * j + nxy * k; for (let i = 0; i < nx; i++) val[o + i] = sd(x0 + i * s, y, z); } }
  const cellV = new Int32Array(nxy * nz).fill(-1);
  const pos = [], nrm = [];
  const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const off = [0, 1, nx, nx + 1, nxy, nxy + 1, nxy + nx, nxy + nx + 1];
  const cv = new Float64Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const base = i + nx * j + nxy * k;
    let neg = 0;
    for (let c = 0; c < 8; c++) { cv[c] = val[base + off[c]]; if (cv[c] < 0) neg++; }
    if (neg === 0 || neg === 8) continue;
    let ax = 0, ay = 0, az = 0, n = 0;
    for (const [a, b] of E) {
      if ((cv[a] < 0) === (cv[b] < 0)) continue;
      const t = cv[a] / (cv[a] - cv[b]);
      ax += (a & 1) + (((b & 1) - (a & 1)) * t); ay += ((a >> 1) & 1) + ((((b >> 1) & 1) - ((a >> 1) & 1)) * t); az += ((a >> 2) & 1) + ((((b >> 2) & 1) - ((a >> 2) & 1)) * t);
      n++;
    }
    const p = project(sd, [x0 + (i + ax / n) * s, y0 + (j + ay / n) * s, z0 + (k + az / n) * s], 3);
    const g = sdGrad(sd, p[0], p[1], p[2]);
    cellV[base] = pos.length / 3;
    pos.push(p[0], p[1], p[2]); nrm.push(g[0], g[1], g[2]);
  }
  const idx = [];
  const quad = (a, b, c, d) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    const dAC = (pos[3 * a] - pos[3 * c]) ** 2 + (pos[3 * a + 1] - pos[3 * c + 1]) ** 2 + (pos[3 * a + 2] - pos[3 * c + 2]) ** 2;
    const dBD = (pos[3 * b] - pos[3 * d]) ** 2 + (pos[3 * b + 1] - pos[3 * d + 1]) ** 2 + (pos[3 * b + 2] - pos[3 * d + 2]) ** 2;
    if (dAC < dBD) idx.push(a, b, c, a, c, d); else idx.push(a, b, d, b, c, d);
  };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const base = i + nx * j + nxy * k, in0 = val[base] < 0;
    if (in0 !== (val[base + 1] < 0)) quad(cellV[base - nx - nxy], cellV[base - nxy], cellV[base], cellV[base - nx]);
    if (in0 !== (val[base + nx] < 0)) quad(cellV[base - 1 - nxy], cellV[base - 1], cellV[base], cellV[base - nxy]);
    if (in0 !== (val[base + nxy] < 0)) quad(cellV[base - 1 - nx], cellV[base - nx], cellV[base], cellV[base - 1]);
  }
  return { pos, nrm, idx };
}

// ── simulation lattice: hex cells, 5 tets each, boundary nodes snapped onto the surface ──
// a node layer lands exactly on the floor (y = 0), so the footprint stays flat
function buildSimMesh(h = 0.12) {
  const sd = whaleSD;
  const hh = [h, h * 0.85, h];
  const ext = [[-1.78, 1.83], [-0.78, 1.20]];
  const n = [Math.ceil((ext[0][1] - ext[0][0]) / hh[0]), Math.ceil(1.92 / hh[1]), Math.ceil((ext[1][1] - ext[1][0]) / hh[2])];
  const o = [(ext[0][0] + ext[0][1]) / 2 - n[0] * hh[0] / 2, 0, -n[2] * hh[2] / 2];
  const S = [n[0] + 1, n[1] + 1, n[2] + 1];
  const nodeAt = (i, j, k) => [o[0] + i * hh[0], o[1] + j * hh[1], o[2] + k * hh[2]];
  const hm = Math.min(...hh);
  const keep = new Uint8Array(n[0] * n[1] * n[2]);
  for (let k = 0; k < n[2]; k++) for (let j = 0; j < n[1]; j++) for (let i = 0; i < n[0]; i++) {
    const x = o[0] + (i + 0.5) * hh[0], y = o[1] + (j + 0.5) * hh[1], z = o[2] + (k + 0.5) * hh[2];
    // generous, so the thin fins and flukes keep a connected run of cells
    if (sd(x, y, z) < 0.4 * hm) keep[i + n[0] * (j + n[1] * k)] = 1;
  }
  const kept = (i, j, k) => i >= 0 && j >= 0 && k >= 0 && i < n[0] && j < n[1] && k < n[2] && keep[i + n[0] * (j + n[1] * k)] === 1;
  const nodeId = new Int32Array(S[0] * S[1] * S[2]).fill(-1);
  const rest = [], boundary = [];
  const nid = (i, j, k) => {
    const key = i + S[0] * (j + S[1] * k);
    if (nodeId[key] >= 0) return nodeId[key];
    const p = nodeAt(i, j, k);
    nodeId[key] = rest.length / 3;
    rest.push(p[0], p[1], p[2]);
    let all = true;
    for (let a = 0; a < 8; a++) if (!kept(i - 1 + (a & 1), j - 1 + ((a >> 1) & 1), k - 1 + ((a >> 2) & 1))) { all = false; break; }
    boundary.push(all ? 0 : 1);
    return nodeId[key];
  };
  const tets = [];
  const T0 = [[0, 1, 3, 5], [0, 3, 2, 6], [0, 5, 4, 6], [3, 5, 6, 7], [0, 3, 5, 6]];
  const T1 = [[0, 1, 2, 4], [3, 1, 2, 7], [5, 1, 4, 7], [6, 2, 4, 7], [1, 2, 4, 7]];
  for (let k = 0; k < n[2]; k++) for (let j = 0; j < n[1]; j++) for (let i = 0; i < n[0]; i++) {
    if (!kept(i, j, k)) continue;
    const cn = [];
    for (let a = 0; a < 8; a++) cn.push(nid(i + (a & 1), j + ((a >> 1) & 1), k + ((a >> 2) & 1)));
    for (const t of ((i + j + k) & 1 ? T1 : T0)) tets.push(cn[t[0]], cn[t[1]], cn[t[2]], cn[t[3]]);
  }
  const nN = rest.length / 3;
  const R = new Float64Array(rest);
  const volOf = (P, t) => tetVolume(P, tets[4 * t], tets[4 * t + 1], tets[4 * t + 2], tets[4 * t + 3]);
  for (let t = 0; t < tets.length / 4; t++) if (volOf(R, t) < 0) { const q = tets[4 * t + 2]; tets[4 * t + 2] = tets[4 * t + 3]; tets[4 * t + 3] = q; }
  const v0 = hh[0] * hh[1] * hh[2] / 6;
  // snap boundary nodes onto the surface (in or out), then back off wherever that would crush a tet
  const snapped = new Float64Array(nN * 3);
  for (let i = 0; i < nN; i++) {
    const p = [R[3 * i], R[3 * i + 1], R[3 * i + 2]];
    if (boundary[i] && p[1] > 1e-6 && sd(p[0], p[1], p[2]) > -0.95 * hm) project(sd, p, 6);
    if (boundary[i] && p[1] <= 1e-6) {                    // floor nodes slide along the floor only
      const q = [p[0], 0.002, p[2]]; project((x, y, z) => whaleSD(x, 0.002, z), q, 6); p[0] = q[0]; p[2] = q[2]; p[1] = 0;
    }
    snapped.set(p, 3 * i);
  }
  const P = new Float64Array(snapped);
  const blend = new Float32Array(nN).fill(1);
  for (let pass = 0; pass < 6; pass++) {
    let bad = 0;
    for (let t = 0; t < tets.length / 4; t++) {
      if (volOf(P, t) > 0.12 * v0) continue;
      bad++;
      for (let q = 0; q < 4; q++) {
        const v = tets[4 * t + q];
        if (!boundary[v] || blend[v] <= 0) continue;
        blend[v] = Math.max(0, blend[v] - 0.34);
        for (let k = 0; k < 3; k++) P[3 * v + k] = R[3 * v + k] + (snapped[3 * v + k] - R[3 * v + k]) * blend[v];
      }
    }
    if (!bad) break;
  }
  const keepT = [];
  for (let t = 0; t < tets.length / 4; t++) if (volOf(P, t) > 0.03 * v0) keepT.push(tets[4 * t], tets[4 * t + 1], tets[4 * t + 2], tets[4 * t + 3]);
  // drop nodes no surviving tet uses
  const used = new Int32Array(nN).fill(-1); let nu = 0;
  for (const v of keepT) if (used[v] < 0) used[v] = nu++;
  const restOut = new Float32Array(nu * 3);
  for (let i = 0; i < nN; i++) if (used[i] >= 0) restOut.set([P[3 * i], P[3 * i + 1], P[3 * i + 2]], 3 * used[i]);
  const tetsOut = new Uint32Array(keepT.map(v => used[v]));
  const region = new Uint8Array(nu);
  for (let i = 0; i < nu; i++) region[i] = partOf(restOut[3 * i], restOut[3 * i + 1], restOut[3 * i + 2]);
  return { rest: restOut, tets: tetsOut, region, h: hh };
}

function tetVolume(p, a, b, c, d) {
  const ax = p[3 * a], ay = p[3 * a + 1], az = p[3 * a + 2];
  const b0 = p[3 * b] - ax, b1 = p[3 * b + 1] - ay, b2 = p[3 * b + 2] - az;
  const c0 = p[3 * c] - ax, c1 = p[3 * c + 1] - ay, c2 = p[3 * c + 2] - az;
  const d0 = p[3 * d] - ax, d1 = p[3 * d + 1] - ay, d2 = p[3 * d + 2] - az;
  return (b0 * (c1 * d2 - c2 * d1) - b1 * (c0 * d2 - c2 * d0) + b2 * (c0 * d1 - c1 * d0)) / 6;
}

// a point on the outer surface: straight down from above at (x, z), or straight out from the midline at (x, y)
function surfaceDown(x, z) { let lo = -0.01, hi = 1.0; for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (whaleSD(x, m, z) < 0) lo = m; else hi = m; } return [x, lo, z]; }
function surfaceOut(x, y) { let lo = 0, hi = 1.3; for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (whaleSD(x, y, m) < 0) lo = m; else hi = m; } return [x, y, lo]; }

// the eye (z > 0 side; mirrored for the other): a small bead on the side of the head, just over the corner of the mouth
const EYE = (() => {
  const S = SHAPE, x = S.eye.x, y = mouthY(MOUTH_X0) + 0.032;
  const s = surfaceOut(x, y), g = sdGrad(whaleSD, s[0], s[1], s[2]);
  const w = [g[0], g[1], g[2]];
  let u = [1 - w[0] * w[0], -w[0] * w[1], -w[0] * w[2]]; { const l = Math.hypot(...u); u = u.map(q => q / l); }
  const v = [w[1] * u[2] - w[2] * u[1], w[2] * u[0] - w[0] * u[2], w[0] * u[1] - w[1] * u[0]];
  const p = [s[0] - w[0] * S.eye.c * 0.35, s[1] - w[1] * S.eye.c * 0.35, s[2] - w[2] * S.eye.c * 0.35];
  return { p, u, v, w };
})();

// the baleen: rows of thin licorice plates hanging inside the upper jaw, just over the mouth line, on both sides
const BALEEN = (() => {
  const out = [], n = 18;
  for (let i = 0; i < n; i++) {
    const x = 1.0 + i * (1.5 - 1.0) / (n - 1), ym = mouthY(x);
    const half = surfaceOut(x, ym + 0.03)[2];
    out.push({ p: [x, ym + 0.044, Math.max(0.04, half - 0.1)], h: 0.04 - 0.01 * (i / (n - 1)), w: 0.028 });
  }
  return out;
})();

// how far each point of the throat moves when the pouch is full: down toward the table and out to the sides
function pouchDisp(x,y,z){const w=Math.exp(-((x-.65)**2/.4+(y-.6)**2/.3+(z-.1)**2/.4));return [0,(y-.55)*w*.16,(z-.1)*w*.16];}
// the krill: each piece has a path in rest space — in at the mouth, round the full throat, back to the stomach
const KRILL_N = 96, KRILL_PATH = 12;
const KRILL = (() => {
  const R = rng(4242), out = [];
  const inClear = p => whaleSD(p[0], p[1], p[2]) < -0.04 && coreSD(p[0], p[1], p[2]) > 0.025;
  const pick = (gen) => { for (let k = 0; k < 400; k++) { const p = gen(); if (inClear(p)) return p; } return gen(); };
  for (let i = 0; i < KRILL_N; i++) {
    const start = pick(() => { const x = 1.28 + 0.24 * R(), A = axisAt(x); return [x, mouthY(x) - 0.015 - 0.03 * R(), (R() - 0.5) * 1.1 * A[2]]; });
    const pouch = pick(() => { const x = 0.5 + 0.8 * R(), A = axisAt(x), sd = R() < 0.5 ? -1 : 1; return [x, 0.07 + (A[0] - 0.06) * R(), sd * (0.35 + 0.45 * R()) * A[2]]; });
    const gut = pick(() => { const x = -0.3 + 0.55 * R(), A = axisAt(x), sd = R() < 0.5 ? -1 : 1; return [x, A[3] + 0.04 + (A[0] + 0.1 * A[1] - A[3] - 0.04) * R(), sd * (0.15 + 0.5 * R()) * A[2]]; });
    const mid = [0.3, Math.max(pouch[1], gut[1]) + 0.02, (pouch[2] + gut[2]) * 0.4];
    const path = [];
    for (let k = 0; k < 4; k++) { const t = k / 3; path.push(start.map((v, d) => v + (pouch[d] - v) * t)); }
    for (let k = 1; k <= 8; k++) { const t = k / 8, a = (1 - t) * (1 - t), b = 2 * t * (1 - t), c = t * t; path.push([0, 1, 2].map(d => a * pouch[d] + b * mid[d] + c * gut[d])); }
    out.push({ path, r: 0.018 + 0.009 * R(), dir: [R() - 0.5, (R() - 0.5) * 0.4, R() - 0.5] });
  }
  return out;
})();

// ── render mesh ──
// material ids: 0 body (clear jelly), 1 a drop of the spout, 2 eye, 3 the milky layer, 4 bubble, 5 baleen, 6 krill
const SPOUT_POOL = 72;
function buildRenderMesh(){
 const nets=surfaceNets(whaleSD,[-1.97,-.12,-.87,1.92,1.97,1.31],.043);
 const pos=nets.pos.slice(),nrm=nets.nrm.slice(),mat=new Array(pos.length/3).fill(0),idx=nets.idx.slice(),ctr=new Array(pos.length/3*4).fill(0);
 const add=(x,y,z,m,nx,ny,nz,c=null)=>{pos.push(x,y,z);nrm.push(nx,ny,nz);mat.push(m);ctr.push(...(c||[0,0,0,0]));return pos.length/3-1;};
 const bodyIndexCount=idx.length,bodyVertCount=pos.length/3,propStart=idx.length;
 const core=surfaceNets(coreSD,[-.05,-.01,.13,1.13,1.10,.67],.025),cv0=pos.length/3;
 for(let v=0;v<core.pos.length/3;v++)add(...core.pos.slice(v*3,v*3+3),3,...core.nrm.slice(v*3,v*3+3));
 for(const i of core.idx)idx.push(cv0+i);const coreRange={first:propStart,count:idx.length-propStart};
  const ovoid = (p, u, w, v, a, b, c, m, rings, segs, cv) => {
    const base = pos.length / 3;
    const local = (t, ph) => [-Math.cos(t) * a, Math.cos(ph) * Math.sin(t) * c, Math.sin(ph) * Math.sin(t) * b];
    const toW = q => [p[0] + u[0] * q[0] + w[0] * q[1] + v[0] * q[2], p[1] + u[1] * q[0] + w[1] * q[1] + v[1] * q[2], p[2] + u[2] * q[0] + w[2] * q[1] + v[2] * q[2]];
    const vtx = q => {
      const P = toW(q);
      const nq = [q[0] / (a * a), q[1] / (c * c), q[2] / (b * b)], n = toW(nq).map((x, k) => x - p[k]); const l = Math.hypot(...n) || 1;
      return add(P[0], P[1], P[2], m, n[0] / l, n[1] / l, n[2] / l, cv);
    };
    const top = vtx(local(0, 0));
    for (let i = 1; i < rings; i++) for (let j = 0; j < segs; j++) vtx(local(Math.PI * i / rings, 2 * Math.PI * j / segs + (i & 1) * Math.PI / segs));
    const bot = vtx(local(Math.PI, 0));
    const ring = i => base + 1 + (i - 1) * segs;
    for (let j = 0; j < segs; j++) idx.push(top, ring(1) + j, ring(1) + (j + 1) % segs);
    for (let i = 1; i < rings - 1; i++) for (let j = 0; j < segs; j++) {
      const p0 = ring(i) + j, p1 = ring(i) + (j + 1) % segs, p2 = ring(i + 1) + j, p3 = ring(i + 1) + (j + 1) % segs;
      idx.push(p0, p2, p3, p0, p3, p1);
    }
    for (let j = 0; j < segs; j++) idx.push(ring(rings - 1) + j, bot, ring(rings - 1) + (j + 1) % segs);
    return { v0: base, nv: pos.length / 3 - base };
  };

 const oval=(p,r,m)=>ovoid(p,[1,0,0],[0,1,0],[0,0,1],r[0],r[2],r[1],m,14,24,[...p,Math.max(...r)]);
 for(const [x,y,dy] of [[-1.00,1.22,-.047],[-.95,.57,.047]]){
   const z=surfaceOut(x,y)[2]-.006;
   oval([x,y,z],[.105,.140,.025],7);
   oval([x-.042,y+dy,z+.022],[.074,.085,.014],8);
   oval([x-.063,y+dy,z+.036],[.044,.063,.009],2);
   oval([x-.079,y+dy+.025,z+.046],[.012,.017,.007],7);
 }
 for(const [cx,cy,cz,n] of [[1.55,.15,.32,3],[1.61,.48,-.04,3],[-1.20,.035,.25,2],[.20,.06,.16,2]])for(let i=0;i<n;i++)oval([cx+(i-(n-1)/2)*.073,cy,cz],[.035,.036,.049],5);
 const R=rng(5858),bubbles=[];for(let tries=0;bubbles.length<28&&tries<5000;tries++){const p=[-1.5+R()*3.1,.12+R()*1.4,-.45+R()*1.1],r=.009+.012*R();if(whaleSD(...p)<-.08&&coreSD(...p)>.05&&tongueSD(...p)>.02){bubbles.push([...p,r]);oval(p,[r,r,r],4);}}
  // ── the krill: tiny pink beads, hidden until a gulp, then carried along their paths ──
  const krillV0 = pos.length / 3, krill = [];
  for (const K of KRILL) {
    const c = K.path[0], u = (() => { const l = Math.hypot(...K.dir) || 1; return K.dir.map(q => q / l); })();
    let w = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const v = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]; { const l = Math.hypot(...v); for (let k = 0; k < 3; k++) v[k] /= l; }
    w = [v[1] * u[2] - v[2] * u[1], v[2] * u[0] - v[0] * u[2], v[0] * u[1] - v[1] * u[0]];
    const o = ovoid(c, u, w, v, K.r * 1.7, K.r * 0.8, K.r * 0.8, 6, 4, 6, [...c, K.r]);
    krill.push({ p: c.slice(), v0: o.v0, nv: o.nv });
  }

  // ── the drops of the spout: hidden in the blowholes until they are blown ──
  const home = [BLOW[0], BLOW[1] - 0.05, 0];
  const drops = [];
  const RD = rng(77);
  for (let i = 0; i < SPOUT_POOL; i++) {
    const r = 0.022 + 0.02 * RD();
    const o = ovoid(home, [1, 0, 0], [0, 1, 0], [0, 0, 1], r, r * 0.97, r * 0.94, 1, 5, 9, [0, 0, 0, r]);
    drops.push({ p: home.slice(), r, v0: o.v0, nv: o.nv });
  }
  const propCount = idx.length - propStart;

  // make every triangle's winding agree with its analytic outward normal (CCW = front)
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i], b1 = idx[i + 1], c = idx[i + 2];
    const e1 = [pos[3 * b1] - pos[3 * a], pos[3 * b1 + 1] - pos[3 * a + 1], pos[3 * b1 + 2] - pos[3 * a + 2]];
    const e2 = [pos[3 * c] - pos[3 * a], pos[3 * c + 1] - pos[3 * a + 1], pos[3 * c + 2] - pos[3 * a + 2]];
    const fn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    let d = 0;
    for (const v of [a, b1, c]) d += fn[0] * nrm[3 * v] + fn[1] * nrm[3 * v + 1] + fn[2] * nrm[3 * v + 2];
    if (d < 0) { idx[i + 1] = c; idx[i + 2] = b1; }
  }

  return {
    rest: new Float32Array(pos), restNormal: new Float32Array(nrm), mat: new Float32Array(mat), ctr: new Float32Array(ctr),
    index: new Uint32Array(idx),
    body: { first: 0, count: bodyIndexCount },
    core: coreRange,
    seeds: { first: propStart, count: propCount },
    bodyVertCount, drops, home, krill, krillV0,
    bubbleCount: bubbles.length, baleenCount: BALEEN.length * 2,
  };
}
// ── barycentric embedding of points into tets (nearest tet when a point lies outside) ──
// `skip` = [first, count] of vertices to leave out
function embed(simRest, tets, verts, skip = [0, 0]) {
  const nT = tets.length / 4, nV = verts.length / 3;
  const cell = 0.25;
  const grid = new Map();
  const key = (i, j, k) => (i + 512) * 1048576 + (j + 512) * 1024 + (k + 512);
  const inv = new Float64Array(nT * 9);
  for (let t = 0; t < nT; t++) {
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    const id = [tets[4 * t], tets[4 * t + 1], tets[4 * t + 2], tets[4 * t + 3]];
    for (const v of id) for (let c = 0; c < 3; c++) { mn[c] = Math.min(mn[c], simRest[3 * v + c]); mx[c] = Math.max(mx[c], simRest[3 * v + c]); }
    for (let i = Math.floor(mn[0] / cell); i <= Math.floor(mx[0] / cell); i++)
      for (let j = Math.floor(mn[1] / cell); j <= Math.floor(mx[1] / cell); j++)
        for (let k = Math.floor(mn[2] / cell); k <= Math.floor(mx[2] / cell); k++) {
          const K = key(i, j, k); let l = grid.get(K); if (!l) grid.set(K, l = []); l.push(t);
        }
    const a = id[0], m = [];
    for (let c = 1; c < 4; c++) for (let r = 0; r < 3; r++) m.push(simRest[3 * id[c] + r] - simRest[3 * a + r]);
    const M = [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
    const det = M[0] * (M[4] * M[8] - M[5] * M[7]) - M[1] * (M[3] * M[8] - M[5] * M[6]) + M[2] * (M[3] * M[7] - M[4] * M[6]);
    const id2 = 1 / det;
    inv[9 * t + 0] = (M[4] * M[8] - M[5] * M[7]) * id2; inv[9 * t + 1] = (M[2] * M[7] - M[1] * M[8]) * id2; inv[9 * t + 2] = (M[1] * M[5] - M[2] * M[4]) * id2;
    inv[9 * t + 3] = (M[5] * M[6] - M[3] * M[8]) * id2; inv[9 * t + 4] = (M[0] * M[8] - M[2] * M[6]) * id2; inv[9 * t + 5] = (M[2] * M[3] - M[0] * M[5]) * id2;
    inv[9 * t + 6] = (M[3] * M[7] - M[4] * M[6]) * id2; inv[9 * t + 7] = (M[1] * M[6] - M[0] * M[7]) * id2; inv[9 * t + 8] = (M[0] * M[4] - M[1] * M[3]) * id2;
  }
  const tetOf = new Uint32Array(nV);
  const w = new Float32Array(nV * 4);
  for (let v = 0; v < nV; v++) {
    if (v >= skip[0] && v < skip[0] + skip[1]) continue;
    const x = verts[3 * v], y = verts[3 * v + 1], z = verts[3 * v + 2];
    let best = -1, bestScore = -Infinity, b0 = 0, b1 = 0, b2 = 0, b3 = 0;
    const tryT = t => {
      const a = tets[4 * t];
      const dx = x - simRest[3 * a], dy = y - simRest[3 * a + 1], dz = z - simRest[3 * a + 2], I = 9 * t;
      const q1 = inv[I] * dx + inv[I + 1] * dy + inv[I + 2] * dz;
      const q2 = inv[I + 3] * dx + inv[I + 4] * dy + inv[I + 5] * dz;
      const q3 = inv[I + 6] * dx + inv[I + 7] * dy + inv[I + 8] * dz;
      const q0 = 1 - q1 - q2 - q3;
      const s = Math.min(q0, q1, q2, q3);
      if (s > bestScore) { bestScore = s; best = t; b0 = q0; b1 = q1; b2 = q2; b3 = q3; }
    };
    const ci = Math.floor(x / cell), cj = Math.floor(y / cell), ck = Math.floor(z / cell);
    for (let r = 0; r <= 4; r++) {
      for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) for (let k = ck - r; k <= ck + r; k++) {
        if (Math.max(Math.abs(i - ci), Math.abs(j - cj), Math.abs(k - ck)) !== r) continue;
        const l = grid.get(key(i, j, k)); if (l) for (const t of l) tryT(t);
      }
      if (bestScore >= -1e-4 || (r >= 1 && best >= 0 && bestScore > -0.45)) break;
    }
    if (best < 0) for (let t = 0; t < nT; t++) tryT(t);
    tetOf[v] = best; w[4 * v] = b0; w[4 * v + 1] = b1; w[4 * v + 2] = b2; w[4 * v + 3] = b3;
  }
  return { tetOf, w };
}

// ===== physics.js =====
// ─────────────────────────────────────────────────────────────
//  XPBD tetrahedral soft body — firm fins and skin round a soft, wobbling body
//  · co-rotational tet constraints → elasticity (each tet pulled toward its
//                                    best-fit rotated rest shape; recovers inversions)
//  · tet volume constraints        → near-incompressibility
//  · soft grab attachment, ground contact with friction
//  · a throat pouch whose rest shape (and rest volume) can be inflated and let down again
//  · relative-velocity damping along edges (internal viscosity)
//  Fixed step, fixed substeps, "small steps" XPBD (1 iteration / substep).
// ─────────────────────────────────────────────────────────────

// compliance multipliers per region (0 milky layer, 1 clear jelly, 2 skin, 3 fins): smaller is firmer
const FIRM_OF = [0.3, 0.42, 0.2, 0.06];
const VOLK_OF = [2, 2.6, 1.4, 1];

class SoftBody {
  constructor(mesh, opts = {}) {
    const { rest, tets, region } = mesh;
    this.n = rest.length / 3;
    this.nT = tets.length / 4;
    this.tets = tets;
    this.rest = Float32Array.from(rest);
    this.x = new Float32Array(rest.length);
    this.prev = new Float32Array(rest.length);
    this.v = new Float32Array(rest.length);
    this.invMass = new Float32Array(this.n);
    this.mass = new Float32Array(this.n);
    this.restVol = new Float32Array(this.nT);
    this.region = region;
    this.density = 1.0;

    // masses from rest volumes
    let vol = 0;
    for (let t = 0; t < this.nT; t++) {
      const v = this.tetVol(this.rest, t);
      this.restVol[t] = v; vol += v;
      for (let k = 0; k < 4; k++) this.mass[tets[4 * t + k]] += v * this.density / 4;
    }
    this.totalRestVolume = vol;
    this.totalMass = 0;
    for (let i = 0; i < this.n; i++) { this.invMass[i] = 1 / this.mass[i]; this.totalMass += this.mass[i]; }

    // unique edges
    const set = new Map();
    const pairs = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
    for (let t = 0; t < this.nT; t++) for (const [a, b] of pairs) {
      let i = tets[4 * t + a], j = tets[4 * t + b];
      if (i > j) [i, j] = [j, i];
      set.set(i * 65536 + j, [i, j]);
    }
    this.nE = set.size;
    this.edges = new Uint32Array(this.nE * 2);
    this.restLen = new Float32Array(this.nE);
    let e = 0;
    for (const [i, j] of set.values()) {
      this.edges[2 * e] = i; this.edges[2 * e + 1] = j;
      this.restLen[e] = Math.hypot(rest[3 * i] - rest[3 * j], rest[3 * i + 1] - rest[3 * j + 1], rest[3 * i + 2] - rest[3 * j + 2]);
      e++;
    }
    // shuffle edge order a little (reduces Gauss–Seidel directional bias)
    for (let k = this.nE - 1; k > 0; k--) {
      const r = (k * 2654435761) % (k + 1);
      for (const arr of [this.edges]) { const a0 = arr[2 * k], a1 = arr[2 * k + 1]; arr[2 * k] = arr[2 * r]; arr[2 * k + 1] = arr[2 * r + 1]; arr[2 * r] = a0; arr[2 * r + 1] = a1; }
      const tmp = this.restLen[k]; this.restLen[k] = this.restLen[r]; this.restLen[r] = tmp;
    }

    // co-rotational tet elasticity: rest shape, inverse rest matrix, warm-started rotation
    this.tetQ = new Float32Array(this.nT * 12);     // rest positions relative to tet centroid
    this.tetDmInv = new Float32Array(this.nT * 9);
    this.tetRot = new Float32Array(this.nT * 4);    // quaternion (x, y, z, w)
    this.tetFirm = new Float32Array(this.nT);
    this.tetVolK = new Float32Array(this.nT);
    for (let t = 0; t < this.nT; t++) {
      const id = [tets[4 * t], tets[4 * t + 1], tets[4 * t + 2], tets[4 * t + 3]];
      let cx = 0, cy = 0, cz = 0, M = 0;
      for (const v of id) { const mv = this.mass[v]; M += mv; cx += rest[3 * v] * mv; cy += rest[3 * v + 1] * mv; cz += rest[3 * v + 2] * mv; }
      cx /= M; cy /= M; cz /= M;
      for (let k = 0; k < 4; k++) {
        this.tetQ[12 * t + 3 * k] = rest[3 * id[k]] - cx;
        this.tetQ[12 * t + 3 * k + 1] = rest[3 * id[k] + 1] - cy;
        this.tetQ[12 * t + 3 * k + 2] = rest[3 * id[k] + 2] - cz;
      }
      // Dm columns: X1-X0, X2-X0, X3-X0 → store inverse row-major
      const m = [];
      for (let r = 0; r < 3; r++) for (let c = 1; c < 4; c++) m.push(rest[3 * id[c] + r] - rest[3 * id[0] + r]);
      const inv = inv3(m);
      this.tetDmInv.set(inv, 9 * t);
      this.tetRot[4 * t + 3] = 1;
      // the fins and flukes are firmest (so they flap rather than droop), then the skin; the clear jelly is the
      // softest, and the milky layer, set a little firmer, sits in between
      let fc = 0, vk = 0; for (const v of id) { fc += FIRM_OF[region[v]] / 4; vk += VOLK_OF[region[v]] / 4; }
      this.tetFirm[t] = fc;
      this.tetVolK[t] = vk;
    }

    // parameters (tuned in sim units: metres-ish, seconds)
    this.gravity = -9.81;
    this.firmness = opts.firmness ?? 0.5;   // 0..1 UI value
    this.damping = opts.damping ?? 0.45;    // 0..1 UI value
    this.substeps = 10;
    this.stepDt = 1 / 60;
    this.friction = 0.55;
    this.floorY = 0;
    this.maxSpeed = 12;

    // grab state
    this.grabIdx = new Int32Array(this.n);
    this.grabW = new Float32Array(this.n);
    this.grabOff = new Float32Array(this.n * 3);
    this.grabN = 0;
    this.grabTarget = new Float32Array(3);
    this.grabRot = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    this.grabbing = false;

    this.time = 0;
    this.reset(0);
  }

  tetVol(p, t) {
    const T = this.tets;
    const a = T[4 * t], b = T[4 * t + 1], c = T[4 * t + 2], d = T[4 * t + 3];
    const ax = p[3 * a], ay = p[3 * a + 1], az = p[3 * a + 2];
    const b0 = p[3 * b] - ax, b1 = p[3 * b + 1] - ay, b2 = p[3 * b + 2] - az;
    const c0 = p[3 * c] - ax, c1 = p[3 * c + 1] - ay, c2 = p[3 * c + 2] - az;
    const d0 = p[3 * d] - ax, d1 = p[3 * d + 1] - ay, d2 = p[3 * d + 2] - az;
    return (b0 * (c1 * d2 - c2 * d1) - b1 * (c0 * d2 - c2 * d0) + b2 * (c0 * d1 - c1 * d0)) / 6;
  }

  reset(drop = 0.35) {
    for (let i = 0; i < this.n; i++) {
      this.x[3 * i] = this.rest[3 * i];
      this.x[3 * i + 1] = this.rest[3 * i + 1] + drop;
      this.x[3 * i + 2] = this.rest[3 * i + 2];
    }
    this.prev.set(this.x);
    this.v.fill(0);
    this.endGrab();
  }

  // stiffness mapping: firmness 0..1 → edge compliance (log scale)
  shapeCompliance() { return Math.exp(Math.log(3.0) + (Math.log(0.05) - Math.log(3.0)) * this.firmness); }
  volCompliance() { return 1e-4 * (1 - 0.7 * this.firmness); }
  // damping 0..1 → rate (1/s) of relative-velocity decay along edges
  dampRate() { return 2 + 40 * this.damping * this.damping; }

  nudge(strength = 1) {
    // small hop with a twist — every particle gets v = v_lin + ω × (x − c)
    const c = this.centroid();
    const vy = 2.2 * strength, wx = 2.4 * strength, wz = -1.5 * strength, wy = 1.2 * strength;
    for (let i = 0; i < this.n; i++) {
      const rx = this.x[3 * i] - c[0], ry = this.x[3 * i + 1] - c[1], rz = this.x[3 * i + 2] - c[2];
      this.v[3 * i] += wy * rz - wz * ry;
      this.v[3 * i + 1] += vy + wz * rx - wx * rz;
      this.v[3 * i + 2] += wx * ry - wy * rx;
    }
  }

  centroid() {
    let x = 0, y = 0, z = 0, m = 0;
    for (let i = 0; i < this.n; i++) {
      const w = this.mass[i]; m += w;
      x += this.x[3 * i] * w; y += this.x[3 * i + 1] * w; z += this.x[3 * i + 2] * w;
    }
    return [x / m, y / m, z / m];
  }

  // ── grabbing ──
  beginGrab(hit, radius = 0.4) {
    this.grabN = 0;
    let nearest = -1, nd = Infinity;
    for (let i = 0; i < this.n; i++) {
      const dx = this.x[3 * i] - hit[0], dy = this.x[3 * i + 1] - hit[1], dz = this.x[3 * i + 2] - hit[2];
      const d = Math.hypot(dx, dy, dz);
      if (d < nd) { nd = d; nearest = i; }
      if (d < radius) {
        const f = 1 - d / radius;
        const k = this.grabN++;
        this.grabIdx[k] = i; this.grabW[k] = f * f * (3 - 2 * f);
        this.grabOff[3 * k] = dx; this.grabOff[3 * k + 1] = dy; this.grabOff[3 * k + 2] = dz;
      }
    }
    if (this.grabN === 0 && nearest >= 0) {
      this.grabIdx[0] = nearest; this.grabW[0] = 1;
      this.grabOff[0] = this.x[3 * nearest] - hit[0]; this.grabOff[1] = this.x[3 * nearest + 1] - hit[1]; this.grabOff[2] = this.x[3 * nearest + 2] - hit[2];
      this.grabN = 1;
    }
    this.grabTarget.set(hit);
    this.grabStart = Float32Array.from(hit);
    this.grabRot.set([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    this.grabbing = true;
  }
  moveGrab(target, rot) {
    this.grabTarget.set(target);
    // bounded reach: a strong stretch, never an unbounded one
    const dx = target[0] - this.grabStart[0], dy = target[1] - this.grabStart[1], dz = target[2] - this.grabStart[2];
    const d = Math.hypot(dx, dy, dz), maxReach = 2.2;
    if (d > maxReach) { const k = maxReach / d; this.grabTarget[0] = this.grabStart[0] + dx * k; this.grabTarget[1] = this.grabStart[1] + dy * k; this.grabTarget[2] = this.grabStart[2] + dz * k; }
    if (rot) this.grabRot.set(rot);
    // never drive the held patch into the floor: lift the whole patch instead of crushing it
    const R = this.grabRot;
    let lowest = Infinity;
    for (let k = 0; k < this.grabN; k++) lowest = Math.min(lowest, R[3] * this.grabOff[3 * k] + R[4] * this.grabOff[3 * k + 1] + R[5] * this.grabOff[3 * k + 2]);
    if (Number.isFinite(lowest)) this.grabTarget[1] = Math.max(this.grabTarget[1], this.floorY + 0.004 - lowest);
  }
  endGrab() { this.grabbing = false; this.grabN = 0; }

  // ── the throat pouch ──
  // disp: per node, how far it moves at full inflation. The tets that touch it take the inflated rest shape and
  // rest volume, scaled by the amount a (0 empty … 1 full), so the pouch really fills, pushing on the table and
  // lifting the head, rather than being blown up against the volume constraint.
  setPouch(disp) {
    this.pouchD = disp; this.pouchA = 0;
    const list = [];
    for (let t = 0; t < this.nT; t++) {
      let any = false;
      for (let k = 0; k < 4; k++) { const v = this.tets[4 * t + k]; if (Math.abs(disp[3 * v]) + Math.abs(disp[3 * v + 1]) + Math.abs(disp[3 * v + 2]) > 1e-6) { any = true; break; } }
      if (any) list.push(t);
    }
    this.pouchTets = Uint32Array.from(list);
  }
  inflate(a) {
    if (!this.pouchTets || Math.abs(a - this.pouchA) < 1e-4) return;
    this.pouchA = a;
    const { rest, tets, mass, tetQ, restVol } = this, D = this.pouchD, p = new Float64Array(12);
    let dv = 0;
    for (const t of this.pouchTets) {
      let M = 0, cx = 0, cy = 0, cz = 0;
      for (let k = 0; k < 4; k++) {
        const v = tets[4 * t + k], m = mass[v];
        const x = rest[3 * v] + D[3 * v] * a, y = rest[3 * v + 1] + D[3 * v + 1] * a, z = rest[3 * v + 2] + D[3 * v + 2] * a;
        p[3 * k] = x; p[3 * k + 1] = y; p[3 * k + 2] = z;
        M += m; cx += x * m; cy += y * m; cz += z * m;
      }
      cx /= M; cy /= M; cz /= M;
      for (let k = 0; k < 4; k++) { tetQ[12 * t + 3 * k] = p[3 * k] - cx; tetQ[12 * t + 3 * k + 1] = p[3 * k + 1] - cy; tetQ[12 * t + 3 * k + 2] = p[3 * k + 2] - cz; }
      const b0 = p[3] - p[0], b1 = p[4] - p[1], b2 = p[5] - p[2], c0 = p[6] - p[0], c1 = p[7] - p[1], c2 = p[8] - p[2], d0 = p[9] - p[0], d1 = p[10] - p[1], d2 = p[11] - p[2];
      const V = (b0 * (c1 * d2 - c2 * d1) - b1 * (c0 * d2 - c2 * d0) + b2 * (c0 * d1 - c1 * d0)) / 6;
      dv += V - restVol[t];
      restVol[t] = V;
    }
    this.totalRestVolume += dv;
  }

  // ── simulation ──
  step() {
    const sub = this.substeps;
    const dt = this.stepDt / sub;
    for (let s = 0; s < sub; s++) this.substep(dt);
    this.time += this.stepDt;
    // settling: once the jelly is nearly still, bleed off the last residual jitter
    if (!this.grabbing) {
      const ke = this.kineticEnergy() / this.totalMass; // ≈ ½ v²
      if (ke < 2e-3) {
        const f = Math.max(0.86, 1 - 0.14 * (1 - ke / 2e-3));
        for (let i = 0; i < this.v.length; i++) this.v[i] *= f;
      }
    }
    // safety: any non-finite value → reset gently
    for (let i = 0; i < this.x.length; i += 97) if (!Number.isFinite(this.x[i])) { this.reset(0.2); break; }
  }

  substep(dt) {
    const { x, prev, v, invMass, n } = this;
    const g = this.gravity * dt;
    // light air drag; while held, the hand steadies the whale a little more
    const air = Math.exp(-(this.grabbing ? 2.5 : 0.08) * dt);
    for (let i = 0; i < n; i++) {
      const k = 3 * i;
      v[k + 1] += g;
      v[k] *= air; v[k + 1] *= air; v[k + 2] *= air;
      prev[k] = x[k]; prev[k + 1] = x[k + 1]; prev[k + 2] = x[k + 2];
      x[k] += v[k] * dt; x[k + 1] += v[k + 1] * dt; x[k + 2] += v[k + 2] * dt;
    }
    if (this.grabbing) this.solveGrab(dt);
    this.solveTets(dt);
    this.solveVolumes(dt);
    this.solveFloor();
    const inv = 1 / dt, vmax = this.maxSpeed;
    for (let i = 0; i < 3 * n; i += 3) {
      let vx = (x[i] - prev[i]) * inv, vy = (x[i + 1] - prev[i + 1]) * inv, vz = (x[i + 2] - prev[i + 2]) * inv;
      const sp = Math.hypot(vx, vy, vz);
      if (sp > vmax) { const f = vmax / sp; vx *= f; vy *= f; vz *= f; }
      v[i] = vx; v[i + 1] = vy; v[i + 2] = vz;
    }
    this.dampEdges(dt);
  }

  solveGrab(dt) {
    const { x, invMass } = this;
    const a = 2e-6 / (dt * dt);
    const R = this.grabRot, T = this.grabTarget;
    for (let k = 0; k < this.grabN; k++) {
      const i = this.grabIdx[k], w = invMass[i];
      const ox = this.grabOff[3 * k], oy = this.grabOff[3 * k + 1], oz = this.grabOff[3 * k + 2];
      const tx = T[0] + R[0] * ox + R[1] * oy + R[2] * oz;
      const ty = Math.max(T[1] + R[3] * ox + R[4] * oy + R[5] * oz, this.floorY + 0.005);
      const tz = T[2] + R[6] * ox + R[7] * oy + R[8] * oz;
      let f = this.grabW[k] * w / (w + a);
      // pressing down near the table: yield instead of crushing the jelly underneath
      if (ty < x[3 * i + 1] && ty < 0.45) f *= Math.max(0.12, ty / 0.45);
      x[3 * i] += (tx - x[3 * i]) * f;
      x[3 * i + 1] += (ty - x[3 * i + 1]) * f;
      x[3 * i + 2] += (tz - x[3 * i + 2]) * f;
    }
  }

  // Per-tet co-rotational shape matching: find the rotation that best maps the rest tet onto the
  // current one (Müller et al. 2016, warm-started quaternion), then pull the four corners toward the
  // rotated rest shape with XPBD compliance. Inverted tets are always pushed back to a proper shape.
  solveTets(dt) {
    const { x, tets, tetQ, tetRot: Q, tetFirm, mass } = this;
    const base = this.shapeCompliance() / (dt * dt);
    for (let t = 0; t < this.nT; t++) {
      const a = 3 * tets[4 * t], b = 3 * tets[4 * t + 1], c = 3 * tets[4 * t + 2], d = 3 * tets[4 * t + 3];
      const ma = mass[a / 3], mb = mass[b / 3], mc = mass[c / 3], md = mass[d / 3];
      const M = ma + mb + mc + md;
      const cx = (x[a] * ma + x[b] * mb + x[c] * mc + x[d] * md) / M;
      const cy = (x[a + 1] * ma + x[b + 1] * mb + x[c + 1] * mc + x[d + 1] * md) / M;
      const cz = (x[a + 2] * ma + x[b + 2] * mb + x[c + 2] * mc + x[d + 2] * md) / M;
      const T = 12 * t;
      // A = Σ m p qᵀ (mass-weighted covariance of current vs rest, both about their centroids)
      let f00 = 0, f01 = 0, f02 = 0, f10 = 0, f11 = 0, f12 = 0, f20 = 0, f21 = 0, f22 = 0;
      {
        let px = (x[a] - cx) * ma, py = (x[a + 1] - cy) * ma, pz = (x[a + 2] - cz) * ma;
        let q0 = tetQ[T], q1 = tetQ[T + 1], q2 = tetQ[T + 2];
        f00 += px * q0; f01 += px * q1; f02 += px * q2; f10 += py * q0; f11 += py * q1; f12 += py * q2; f20 += pz * q0; f21 += pz * q1; f22 += pz * q2;
        px = (x[b] - cx) * mb; py = (x[b + 1] - cy) * mb; pz = (x[b + 2] - cz) * mb; q0 = tetQ[T + 3]; q1 = tetQ[T + 4]; q2 = tetQ[T + 5];
        f00 += px * q0; f01 += px * q1; f02 += px * q2; f10 += py * q0; f11 += py * q1; f12 += py * q2; f20 += pz * q0; f21 += pz * q1; f22 += pz * q2;
        px = (x[c] - cx) * mc; py = (x[c + 1] - cy) * mc; pz = (x[c + 2] - cz) * mc; q0 = tetQ[T + 6]; q1 = tetQ[T + 7]; q2 = tetQ[T + 8];
        f00 += px * q0; f01 += px * q1; f02 += px * q2; f10 += py * q0; f11 += py * q1; f12 += py * q2; f20 += pz * q0; f21 += pz * q1; f22 += pz * q2;
        px = (x[d] - cx) * md; py = (x[d + 1] - cy) * md; pz = (x[d + 2] - cz) * md; q0 = tetQ[T + 9]; q1 = tetQ[T + 10]; q2 = tetQ[T + 11];
        f00 += px * q0; f01 += px * q1; f02 += px * q2; f10 += py * q0; f11 += py * q1; f12 += py * q2; f20 += pz * q0; f21 += pz * q1; f22 += pz * q2;
      }
      let qx = Q[4 * t], qy = Q[4 * t + 1], qz = Q[4 * t + 2], qw = Q[4 * t + 3];
      let r00, r01, r02, r10, r11, r12, r20, r21, r22;
      for (let it = 0; it < 2; it++) {
        r00 = 1 - 2 * (qy * qy + qz * qz); r01 = 2 * (qx * qy - qw * qz); r02 = 2 * (qx * qz + qw * qy);
        r10 = 2 * (qx * qy + qw * qz); r11 = 1 - 2 * (qx * qx + qz * qz); r12 = 2 * (qy * qz - qw * qx);
        r20 = 2 * (qx * qz - qw * qy); r21 = 2 * (qy * qz + qw * qx); r22 = 1 - 2 * (qx * qx + qy * qy);
        const ox = (r10 * f20 - r20 * f10) + (r11 * f21 - r21 * f11) + (r12 * f22 - r22 * f12);
        const oy = (r20 * f00 - r00 * f20) + (r21 * f01 - r01 * f21) + (r22 * f02 - r02 * f22);
        const oz = (r00 * f10 - r10 * f00) + (r01 * f11 - r11 * f01) + (r02 * f12 - r12 * f02);
        const den = Math.abs(r00 * f00 + r10 * f10 + r20 * f20 + r01 * f01 + r11 * f11 + r21 * f21 + r02 * f02 + r12 * f12 + r22 * f22) + 1e-12;
        const wx = ox / den, wy = oy / den, wz = oz / den;
        const w = Math.sqrt(wx * wx + wy * wy + wz * wz);
        if (w < 1e-6) break;
        // small-angle quaternion step (renormalised below); large jumps are clamped
        const sc = w > 1 ? 0.5 / w : 0.5;
        const ax = wx * sc, ay = wy * sc, az = wz * sc, cs = 1;
        const nx = cs * qx + ax * qw + ay * qz - az * qy;
        const ny = cs * qy - ax * qz + ay * qw + az * qx;
        const nz = cs * qz + ax * qy - ay * qx + az * qw;
        const nw = cs * qw - ax * qx - ay * qy - az * qz;
        const nl = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz + nw * nw);
        qx = nx * nl; qy = ny * nl; qz = nz * nl; qw = nw * nl;
      }
      r00 = 1 - 2 * (qy * qy + qz * qz); r01 = 2 * (qx * qy - qw * qz); r02 = 2 * (qx * qz + qw * qy);
      r10 = 2 * (qx * qy + qw * qz); r11 = 1 - 2 * (qx * qx + qz * qz); r12 = 2 * (qy * qz - qw * qx);
      r20 = 2 * (qx * qz - qw * qy); r21 = 2 * (qy * qz + qw * qx); r22 = 1 - 2 * (qx * qx + qy * qy);
      Q[4 * t] = qx; Q[4 * t + 1] = qy; Q[4 * t + 2] = qz; Q[4 * t + 3] = qw;
      // the same fraction for all four corners keeps linear and angular momentum intact
      const f = 1 / (1 + base * tetFirm[t] * M * 0.25);
      let q0 = tetQ[T], q1 = tetQ[T + 1], q2 = tetQ[T + 2];
      x[a] += (cx + r00 * q0 + r01 * q1 + r02 * q2 - x[a]) * f; x[a + 1] += (cy + r10 * q0 + r11 * q1 + r12 * q2 - x[a + 1]) * f; x[a + 2] += (cz + r20 * q0 + r21 * q1 + r22 * q2 - x[a + 2]) * f;
      q0 = tetQ[T + 3]; q1 = tetQ[T + 4]; q2 = tetQ[T + 5];
      x[b] += (cx + r00 * q0 + r01 * q1 + r02 * q2 - x[b]) * f; x[b + 1] += (cy + r10 * q0 + r11 * q1 + r12 * q2 - x[b + 1]) * f; x[b + 2] += (cz + r20 * q0 + r21 * q1 + r22 * q2 - x[b + 2]) * f;
      q0 = tetQ[T + 6]; q1 = tetQ[T + 7]; q2 = tetQ[T + 8];
      x[c] += (cx + r00 * q0 + r01 * q1 + r02 * q2 - x[c]) * f; x[c + 1] += (cy + r10 * q0 + r11 * q1 + r12 * q2 - x[c + 1]) * f; x[c + 2] += (cz + r20 * q0 + r21 * q1 + r22 * q2 - x[c + 2]) * f;
      q0 = tetQ[T + 9]; q1 = tetQ[T + 10]; q2 = tetQ[T + 11];
      x[d] += (cx + r00 * q0 + r01 * q1 + r02 * q2 - x[d]) * f; x[d + 1] += (cy + r10 * q0 + r11 * q1 + r12 * q2 - x[d + 1]) * f; x[d + 2] += (cz + r20 * q0 + r21 * q1 + r22 * q2 - x[d + 2]) * f;
    }
  }

  solveVolumes(dt) {
    const { x, invMass, tets, restVol } = this;
    const alpha0 = this.volCompliance() / (dt * dt);
    for (let t = 0; t < this.nT; t++) {
      const a = tets[4 * t], b = tets[4 * t + 1], c = tets[4 * t + 2], d = tets[4 * t + 3];
      const A = 3 * a, B = 3 * b, Cc = 3 * c, D = 3 * d;
      // gradients (Müller): g_a = (d-b)×(c-b), g_b = (c-a)×(d-a), g_c = (d-a)×(b-a), g_d = (b-a)×(c-a)
      const bax = x[B] - x[A], bay = x[B + 1] - x[A + 1], baz = x[B + 2] - x[A + 2];
      const cax = x[Cc] - x[A], cay = x[Cc + 1] - x[A + 1], caz = x[Cc + 2] - x[A + 2];
      const dax = x[D] - x[A], day = x[D + 1] - x[A + 1], daz = x[D + 2] - x[A + 2];
      const dbx = x[D] - x[B], dby = x[D + 1] - x[B + 1], dbz = x[D + 2] - x[B + 2];
      const cbx = x[Cc] - x[B], cby = x[Cc + 1] - x[B + 1], cbz = x[Cc + 2] - x[B + 2];
      const gax = dby * cbz - dbz * cby, gay = dbz * cbx - dbx * cbz, gaz = dbx * cby - dby * cbx;
      const gbx = cay * daz - caz * day, gby = caz * dax - cax * daz, gbz = cax * day - cay * dax;
      const gcx = day * baz - daz * bay, gcy = daz * bax - dax * baz, gcz = dax * bay - day * bax;
      const gdx = bay * caz - baz * cay, gdy = baz * cax - bax * caz, gdz = bax * cay - bay * cax;
      const V = (dax * gdx + day * gdy + daz * gdz) / 6;
      const wa = invMass[a], wb = invMass[b], wc = invMass[c], wd = invMass[d];
      const wsum = wa * (gax * gax + gay * gay + gaz * gaz) + wb * (gbx * gbx + gby * gby + gbz * gbz)
                 + wc * (gcx * gcx + gcy * gcy + gcz * gcz) + wd * (gdx * gdx + gdy * gdy + gdz * gdz);
      if (wsum < 1e-12) continue;
      const r0 = restVol[t];
      // anti-inversion: elements far below rest volume get a rigid (compliance-free) correction
      const alpha = V < 0.25 * r0 ? 0 : alpha0 * this.tetVolK[t];
      const C = 6 * (V - r0);
      let s = -C / (wsum + alpha);
      x[A] += gax * s * wa; x[A + 1] += gay * s * wa; x[A + 2] += gaz * s * wa;
      x[B] += gbx * s * wb; x[B + 1] += gby * s * wb; x[B + 2] += gbz * s * wb;
      x[Cc] += gcx * s * wc; x[Cc + 1] += gcy * s * wc; x[Cc + 2] += gcz * s * wc;
      x[D] += gdx * s * wd; x[D + 1] += gdy * s * wd; x[D + 2] += gdz * s * wd;
    }
  }

  solveFloor() {
    const { x, prev, n } = this;
    const fy = this.floorY, mu = this.friction;
    for (let i = 0; i < n; i++) {
      const k = 3 * i;
      const pen = fy - x[k + 1];
      if (pen <= 0) continue;
      x[k + 1] = fy;
      // Coulomb-style positional friction
      const dx = x[k] - prev[k], dz = x[k + 2] - prev[k + 2];
      const dl = Math.hypot(dx, dz);
      if (dl < 1e-12) continue;
      // static friction for micro-slip, kinetic friction otherwise (never locks in large strain)
      const f = dl < mu * pen ? 1 : mu * pen / dl;
      x[k] -= dx * f; x[k + 2] -= dz * f;
    }
  }

  dampEdges(dt) {
    const { x, v, invMass, edges } = this;
    const k = 1 - Math.exp(-this.dampRate() * dt);
    for (let e = 0; e < this.nE; e++) {
      const i = edges[2 * e], j = edges[2 * e + 1];
      const I = 3 * i, J = 3 * j;
      let nx = x[J] - x[I], ny = x[J + 1] - x[I + 1], nz = x[J + 2] - x[I + 2];
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (l < 1e-9) continue;
      nx /= l; ny /= l; nz /= l;
      const rv = (v[J] - v[I]) * nx + (v[J + 1] - v[I + 1]) * ny + (v[J + 2] - v[I + 2]) * nz;
      const wi = invMass[i], wj = invMass[j], ws = wi + wj;
      const imp = rv * k / ws;
      v[I] += nx * imp * wi; v[I + 1] += ny * imp * wi; v[I + 2] += nz * imp * wi;
      v[J] -= nx * imp * wj; v[J + 1] -= ny * imp * wj; v[J + 2] -= nz * imp * wj;
    }
  }

  // ── diagnostics ──
  volumeRatio() {
    let s = 0;
    for (let t = 0; t < this.nT; t++) s += this.tetVol(this.x, t);
    return s / this.totalRestVolume;
  }
  minVolumeRatio() {
    let m = Infinity;
    for (let t = 0; t < this.nT; t++) m = Math.min(m, this.tetVol(this.x, t) / this.restVol[t]);
    return m;
  }
  kineticEnergy() {
    let e = 0;
    for (let i = 0; i < this.n; i++) {
      const k = 3 * i;
      e += 0.5 * this.mass[i] * (this.v[k] ** 2 + this.v[k + 1] ** 2 + this.v[k + 2] ** 2);
    }
    return e;
  }
  // mean deviation from rest shape after best rigid alignment is expensive; use edge strain instead
  meanStrain() {
    let s = 0;
    const { x, edges, restLen } = this;
    for (let e = 0; e < this.nE; e++) {
      const i = 3 * edges[2 * e], j = 3 * edges[2 * e + 1];
      s += Math.abs(Math.hypot(x[i] - x[j], x[i + 1] - x[j + 1], x[i + 2] - x[j + 2]) / restLen[e] - 1);
    }
    return s / this.nE;
  }
  minY() { let m = Infinity; for (let i = 1; i < this.x.length; i += 3) m = Math.min(m, this.x[i]); return m; }
}

function inv3(m) { // row-major 3x3
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C, k = 1 / det;
  return [A * k, -(b * i - c * h) * k, (b * f - c * e) * k, B * k, (a * i - c * g) * k, -(a * f - c * d) * k, C * k, -(a * h - b * g) * k, (a * e - b * d) * k];
}


// ─────────────────────────────────────────────────────────────
//  The spout: little drops of the same jelly, hidden in the blowhole until they are blown. Each one is a
//  small rigid ball with an orientation: it flies, lands, bounces, rolls and knocks into the others, and
//  meets the whale itself — it can land on the whale's back and roll down its flank.
// ─────────────────────────────────────────────────────────────
class DropSet {
  constructor(list, sim) {
    this.sim = sim;
    this.n = list.length;
    this.list = list.map(A => ({
      home: A.p.slice(), r: A.r, mass: A.r * A.r * A.r * 4.19 * 1.3,
      hidden: true, free: false, held: false, x: A.p.slice(), v: [0, 0, 0], R: new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]), w: [0, 0, 0],
      target: [0, 0, 0], sleep: 0, ghost: 0, touch: false, age: 0,
    }));
    this.stamp = new Int32Array(sim.nT); this.stampN = 0;
    this.floorY = 0;
    this.freeCount = 0;
    this.box = [[0, 0, 0], [0, 0, 0]];
  }
  reset() {
    for (const A of this.list) { A.free = false; A.hidden = true; A.held = false; A.v = [0, 0, 0]; A.w = [0, 0, 0]; A.sleep = 0; }
    this.freeCount = 0;
  }
  count() { this.freeCount = this.list.reduce((s, q) => s + (q.free ? 1 : 0), 0); }

  // blow a drop out from x with velocity v and spin w
  release(i, x, v, w) {
    const A = this.list[i];
    A.free = true; A.hidden = false; A.held = false;
    A.x = x.slice(); A.R.set([1, 0, 0, 0, 1, 0, 0, 0, 1]); A.v = v.slice(); A.w = w.slice();
    A.sleep = 0; A.ghost = 0.16; A.age = 0;
    this.count();
  }

  step(dt, subs = 3) {
    const h = dt / subs;
    // is any loose drop near the whale? then the whale's tetrahedra are binned for contact tests this step
    const x = this.sim.x, mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (let i = 0; i < x.length; i += 3) for (let d = 0; d < 3; d++) { mn[d] = Math.min(mn[d], x[i + d]); mx[d] = Math.max(mx[d], x[i + d]); }
    this.box = [mn, mx];
    let near = false;
    for (const A of this.list) if (A.free && !(A.sleep > 0.6 && !A.held) && A.ghost <= 0.05 && this.nearBox(A)) { near = true; break; }
    if (near) this.binTets();
    for (let s = 0; s < subs; s++) this.substep(h, near);
  }
  nearBox(A) {
    const [mn, mx] = this.box, m = A.r + 0.05;
    return A.x[0] > mn[0] - m && A.x[0] < mx[0] + m && A.x[1] > mn[1] - m && A.x[1] < mx[1] + m && A.x[2] > mn[2] - m && A.x[2] < mx[2] + m;
  }
  // a uniform grid of the deformed tetrahedra's bounding boxes
  binTets() {
    const sim = this.sim, x = sim.x, T = sim.tets, cell = 0.2, g = new Map();
    for (let t = 0; t < sim.nT; t++) {
      let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
      for (let k = 0; k < 4; k++) { const v = 3 * T[4 * t + k]; x0 = Math.min(x0, x[v]); x1 = Math.max(x1, x[v]); y0 = Math.min(y0, x[v + 1]); y1 = Math.max(y1, x[v + 1]); z0 = Math.min(z0, x[v + 2]); z1 = Math.max(z1, x[v + 2]); }
      for (let i = Math.floor(x0 / cell); i <= Math.floor(x1 / cell); i++) for (let j = Math.floor(y0 / cell); j <= Math.floor(y1 / cell); j++) for (let k = Math.floor(z0 / cell); k <= Math.floor(z1 / cell); k++) {
        const K = (i + 512) * 1048576 + (j + 512) * 1024 + (k + 512); let l = g.get(K); if (!l) g.set(K, l = []); l.push(t);
      }
    }
    this.grid = g;
  }
  // where a ball (centre P, radius r) presses into the deformed whale: carry its centre back to rest space through
  // the tetrahedron it is in (or nearest), ask the whale's signed distance there, push out along the deformed normal
  bodyQuery(P, r) {
    const sim = this.sim, x = sim.x, X = sim.rest, T = sim.tets, cell = 0.2;
    this.stampN++;
    let best = -1, bs = -1e9, bb = null;
    for (let i = Math.floor((P[0] - r) / cell); i <= Math.floor((P[0] + r) / cell); i++)
      for (let j = Math.floor((P[1] - r) / cell); j <= Math.floor((P[1] + r) / cell); j++)
        for (let k = Math.floor((P[2] - r) / cell); k <= Math.floor((P[2] + r) / cell); k++) {
          const l = this.grid.get((i + 512) * 1048576 + (j + 512) * 1024 + (k + 512)); if (!l) continue;
          for (const t of l) {
            if (this.stamp[t] === this.stampN) continue; this.stamp[t] = this.stampN;
            const a = 3 * T[4 * t];
            const m = [];
            for (let c = 1; c < 4; c++) { const v = 3 * T[4 * t + c]; m.push(x[v] - x[a], x[v + 1] - x[a + 1], x[v + 2] - x[a + 2]); }
            const Ds = [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
            const I = inv3(Ds);
            const dx = P[0] - x[a], dy = P[1] - x[a + 1], dz = P[2] - x[a + 2];
            const b1 = I[0] * dx + I[1] * dy + I[2] * dz, b2 = I[3] * dx + I[4] * dy + I[5] * dz, b3 = I[6] * dx + I[7] * dy + I[8] * dz;
            const sc = Math.min(1 - b1 - b2 - b3, b1, b2, b3);
            if (sc > bs) { bs = sc; best = t; bb = [b1, b2, b3, Ds, I]; }
          }
        }
    if (best < 0 || bs < -0.8) return null;
    const t = best, a = 3 * T[4 * t], [b1, b2, b3, , I] = bb;
    const Dm = [];
    for (let c = 1; c < 4; c++) { const v = 3 * T[4 * t + c]; Dm.push(X[v] - X[a], X[v + 1] - X[a + 1], X[v + 2] - X[a + 2]); }
    const Q = [X[a] + Dm[0] * b1 + Dm[3] * b2 + Dm[6] * b3, X[a + 1] + Dm[1] * b1 + Dm[4] * b2 + Dm[7] * b3, X[a + 2] + Dm[2] * b1 + Dm[5] * b2 + Dm[8] * b3];
    const sd = whaleSD(Q[0], Q[1], Q[2]);
    if (sd >= r) return null;
    const g = sdGrad(whaleSD, Q[0], Q[1], Q[2], 2e-3);
    const dg = [Dm[0] * g[0] + Dm[1] * g[1] + Dm[2] * g[2], Dm[3] * g[0] + Dm[4] * g[1] + Dm[5] * g[2], Dm[6] * g[0] + Dm[7] * g[1] + Dm[8] * g[2]];
    let n = [I[0] * dg[0] + I[3] * dg[1] + I[6] * dg[2], I[1] * dg[0] + I[4] * dg[1] + I[7] * dg[2], I[2] * dg[0] + I[5] * dg[1] + I[8] * dg[2]];
    const nl = Math.hypot(...n) || 1; n = n.map(q => q / nl);
    const w = [Math.max(0, 1 - b1 - b2 - b3), Math.max(0, b1), Math.max(0, b2), Math.max(0, b3)];
    return { n, pen: Math.min(r - sd, 0.08), t, w };
  }
  bodyContact(A, h) {
    const sim = this.sim, T = sim.tets, P = A.x, r = A.r;
    A.touch = false;
    const c = this.bodyQuery(P, r);
    if (!c) return;
    const { n, pen, t, w } = c;
    P[0] += n[0] * pen; P[1] += n[1] * pen; P[2] += n[2] * pen;
    A.touch = true;
    // the jelly's velocity there, and an exchange of momentum with its four corners
    const ws = w[0] + w[1] + w[2] + w[3] || 1;
    const vb = [0, 0, 0];
    for (let c = 0; c < 4; c++) { const v = 3 * T[4 * t + c]; for (let d = 0; d < 3; d++) vb[d] += sim.v[v + d] * w[c] / ws; }
    const rv = [A.v[0] - vb[0], A.v[1] - vb[1], A.v[2] - vb[2]], vn = rv[0] * n[0] + rv[1] * n[1] + rv[2] * n[2];
    if (vn < 0) {
      let mb = 0; for (let c = 0; c < 4; c++) mb += sim.mass[T[4 * t + c]] * w[c] / ws;
      // jelly on jelly: a soft, slightly sticky bounce
      const j0 = -(1 + (vn < -1.2 ? 0.3 : 0.08)) * vn / (1 / A.mass + 1 / mb);
      for (let d = 0; d < 3; d++) A.v[d] += n[d] * j0 / A.mass;
      for (let c = 0; c < 4; c++) { const v = 3 * T[4 * t + c], f = w[c] / ws; for (let d = 0; d < 3; d++) sim.v[v + d] -= n[d] * j0 / mb * f; }
    }
    // friction: slide less, roll more
    const tv = [A.v[0] - vb[0], A.v[1] - vb[1], A.v[2] - vb[2]], tn = tv[0] * n[0] + tv[1] * n[1] + tv[2] * n[2];
    const k = 1 - Math.exp(-5 * h);
    for (let d = 0; d < 3; d++) A.v[d] -= (tv[d] - tn * n[d]) * k;
    const rw = [n[1] * tv[2] - n[2] * tv[1], n[2] * tv[0] - n[0] * tv[2], n[0] * tv[1] - n[1] * tv[0]];
    for (let d = 0; d < 3; d++) A.w[d] += (-rw[d] / r - A.w[d]) * k;
  }
  substep(h, near) {
    const L = this.list, g = this.sim.gravity;
    for (const A of L) if (A.free && A.ghost > 0) A.ghost -= h;
    for (const A of L) {
      if (!A.free) continue;
      A.age += h;
      if (A.held) {
        // a soft spring to the finger: quick, but it still swings and lags
        const k = 260, c = 26;
        for (let d = 0; d < 3; d++) A.v[d] += ((A.target[d] - A.x[d]) * k - A.v[d] * c) * h;
        for (let d = 0; d < 3; d++) A.w[d] *= Math.exp(-4 * h);
      } else {
        if (A.sleep > 0.6) continue;
        A.v[1] += g * h;
        const air = Math.exp(-0.3 * h);
        for (let d = 0; d < 3; d++) A.v[d] *= air;
      }
      for (let d = 0; d < 3; d++) A.x[d] += A.v[d] * h;
      const wl = Math.hypot(A.w[0], A.w[1], A.w[2]);
      if (wl > 1e-6) rotateBy(A.R, A.w[0] / wl, A.w[1] / wl, A.w[2] / wl, wl * h);
      // the table: a gummy drop lands with a small bounce, then rolls and slows
      const r = A.r;
      if (A.x[1] < this.floorY + r) {
        A.x[1] = this.floorY + r;
        if (A.v[1] < 0) A.v[1] = A.v[1] < -0.9 ? -A.v[1] * 0.26 : 0;
        const rw = [A.v[2] / r, 0, -A.v[0] / r];
        const k = 1 - Math.exp(-14 * h);
        for (let d = 0; d < 3; d++) A.w[d] += (rw[d] - A.w[d]) * k;
        const roll = Math.exp(-3.6 * h);
        A.v[0] *= roll; A.v[2] *= roll;
      }
    }
    // knocks between loose drops
    for (let i = 0; i < L.length; i++) {
      const A = L[i]; if (!A.free) continue;
      for (let j = i + 1; j < L.length; j++) {
        const B = L[j]; if (!B.free) continue;
        const dx = B.x[0] - A.x[0], dy = B.x[1] - A.x[1], dz = B.x[2] - A.x[2], rr = A.r + B.r;
        if (Math.abs(dx) > rr || Math.abs(dy) > rr || Math.abs(dz) > rr) continue;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= rr * rr || d2 < 1e-12) continue;
        const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, nz = dz / d, pen = rr - d;
        const wa = A.held ? 0 : 1 / A.mass, wb = B.held ? 0 : 1 / B.mass, ws = wa + wb || 1;
        A.x[0] -= nx * pen * wa / ws; A.x[1] -= ny * pen * wa / ws; A.x[2] -= nz * pen * wa / ws;
        B.x[0] += nx * pen * wb / ws; B.x[1] += ny * pen * wb / ws; B.x[2] += nz * pen * wb / ws;
        const rv = (B.v[0] - A.v[0]) * nx + (B.v[1] - A.v[1]) * ny + (B.v[2] - A.v[2]) * nz;
        if (rv < 0) {
          const j0 = -(1 + 0.25) * rv / ws;
          A.v[0] -= nx * j0 * wa; A.v[1] -= ny * j0 * wa; A.v[2] -= nz * j0 * wa;
          B.v[0] += nx * j0 * wb; B.v[1] += ny * j0 * wb; B.v[2] += nz * j0 * wb;
          if (Math.abs(rv) > 0.3) { A.sleep = 0; B.sleep = 0; }
        }
      }
    }
    // the whale itself
    for (const A of L) {
      if (!A.free || (A.sleep > 0.6 && !A.held) || A.ghost > 0) continue;
      if (near && this.nearBox(A)) this.bodyContact(A, h); else A.touch = false;
    }
    // put still drops to sleep (and wake any the whale moves under)
    for (const A of L) {
      if (!A.free || A.held) { A.sleep = 0; continue; }
      const sp = Math.hypot(A.v[0], A.v[1], A.v[2]);
      const still = sp < 0.05 && A.x[1] < this.floorY + A.r + 0.002 && !A.touch;
      if (still) { A.sleep += h; if (A.sleep > 0.6) { A.v = [0, 0, 0]; A.w = [0, 0, 0]; } }
      else A.sleep = 0;
    }
  }
}

// rotate the 3×3 (row-major) R by angle a about unit axis (x, y, z), in world space: R ← Rot · R
function rotateBy(R, x, y, z, a) {
  const c = Math.cos(a), s = Math.sin(a), t = 1 - c;
  const M = [t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c];
  const o = new Float64Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[3 * i + j] = M[3 * i] * R[j] + M[3 * i + 1] * R[3 + j] + M[3 * i + 2] * R[6 + j];
  R.set(o);
}



// ===== shaders.js =====
// ─────────────────────────────────────────────────────────────
//  GLSL (three.js ShaderMaterials): the studio sweep and its soft shadows,
//  everything inside the jelly (the milky layer, the eyes, the baleen, the
//  krill and its glow, the bubbles, the drops of the spout), the clear
//  jelly with refraction / Beer–Lambert / scattering and the whale's own
//  markings, and the tone-map pass.
// ─────────────────────────────────────────────────────────────

const gf = v => (Math.round(v * 1e5) / 1e5).toFixed(5);
const g3 = a => `vec3(${a.map(gf).join(', ')})`;
// the whale's rest-space section along its length, mirrored from geometry.js so the shaders can find the mouth,
// the throat pleats, the blowholes and the mottling
const AX_SH = Array.from({ length: 96 }, (_, i) => axisAt(SHAPE.x0 + (SHAPE.x1 - SHAPE.x0) * i / 95));
const GLSL_SHAPE = /* glsl */`
const float AX0 = ${gf(SHAPE.x0)}; const float AX1 = ${gf(SHAPE.x1)};
const vec4 AXT[96] = vec4[96](${AX_SH.map(a => `vec4(${a.map(gf).join(', ')})`).join(', ')});
const vec3 EYE_C = ${g3(EYE.p)}; const vec3 EYE_W = ${g3(EYE.w)};
const vec3 BLOW_C = ${g3(BLOW)};
// the depth range of the key light's orthographic shadow map (far − near)
const float LIGHT_DEPTH = 15.9;
// centre height, half-height and half-width of the body's section at x, and the height of the milky line
vec4 axisAt(float x) {
  float f = clamp((x - AX0) / (AX1 - AX0), 0.0, 1.0) * 95.0;
  int i = min(int(floor(f)), 94);
  return mix(AXT[i], AXT[i + 1], f - float(i));
}
float mouthY(float x) { return ${gf(GIRTH)} * (0.09 + 0.05 * (AX1 - x) / 0.65 + 0.032 * smoothstep(1.12, 0.92, x)); }
float powAt(float x) { return 2.0 + 0.45 * smoothstep(0.8, 1.35, x); }
`;

const GLSL_COMMON = /* glsl */`
#define PI 3.14159265
uniform mat4 uViewProj;
uniform mat4 uInvViewProj;
uniform mat4 uLightVP;
uniform mat4 uTopVP;
uniform vec4 uCamPos;     // xyz, w = time
uniform vec3 uCamFwd;
uniform vec4 uKeyDir;     // xyz toward light, w = intensity
uniform vec4 uScreen;     // w, h, 1/w, 1/h
uniform vec4 uFlesh;      // the clear jelly's colour in transmission; w = how strongly it absorbs
uniform vec3 uFleshDeep;  // its scattering albedo
uniform vec3 uPale;       // the milky layer
uniform vec3 uSkin;       // the line of the mouth, the blowholes
uniform vec4 uMottle;     // the mottling: rgb its tint, w how strong
uniform vec3 uKrill;      // the krill
uniform vec3 uSeed;       // the eyes
uniform float uRough;
uniform vec4 uMisc;       // exposure, meshAlpha, floorY, how dark the room is (0 lights on … 1 lights out)
uniform vec3 uBg;
uniform vec3 uShadowTint;
uniform vec3 uAril;       // the drops of the spout
uniform vec4 uGlowP;      // the krill's glow: xyz the middle of the swarm, w how bright
uniform vec3 uGlowC;

float hash3(vec3 p) {
  vec3 q = fract(p * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float vnoise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(hash3(i), hash3(i + vec3(1.0, 0.0, 0.0)), u.x), mix(hash3(i + vec3(0.0, 1.0, 0.0)), hash3(i + vec3(1.0, 1.0, 0.0)), u.x), u.y);
  float b = mix(mix(hash3(i + vec3(0.0, 0.0, 1.0)), hash3(i + vec3(1.0, 0.0, 1.0)), u.x), mix(hash3(i + vec3(0.0, 1.0, 1.0)), hash3(i + vec3(1.0, 1.0, 1.0)), u.x), u.y);
  return mix(a, b, u.z);
}
float fbm(vec3 p) {
  return 0.55 * vnoise(p) + 0.3 * vnoise(p * 2.13 + 7.1) + 0.15 * vnoise(p * 4.37 + 3.3);
}

// rounded rectangle softbox seen along direction d
float softbox(vec3 d, vec3 c, vec3 up, vec2 size, float blur) {
  float cd = dot(d, c);
  if (cd <= 0.0) return 0.0;
  vec3 t1 = normalize(cross(up, c));
  vec3 t2 = cross(c, t1);
  vec2 uv = vec2(dot(d, t1), dot(d, t2)) / cd;
  vec2 q = abs(uv) - size;
  float sd = length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - 0.04;
  return 1.0 - smoothstep(-blur, blur, sd);
}

// procedural photo studio: pale cyclorama, overhead softbox, back-left strip, front-right fill card (dimmed with the lights)
vec3 studioEnv(vec3 d, float rough, vec3 bg) {
  float b = 0.012 + rough * 0.55;
  float y = d.y;
  float on = 1.0 - 0.9 * uMisc.w;
  vec3 col = mix(bg * 0.62, bg * 1.05, smoothstep(-0.35, 0.25, y));
  col += bg * 0.55 * (1.0 - smoothstep(0.0, 0.3, abs(y + 0.08)));
  col = mix(col, bg * 0.8, smoothstep(0.3, 1.0, y));
  col += on * vec3(1.0, 0.985, 0.96) * 3.2 * softbox(d, normalize(vec3(0.05, 1.0, -0.15)), vec3(0.0, 0.0, 1.0), vec2(0.55, 0.32), b);
  col += on * vec3(1.0, 0.98, 0.95) * 3.0 * softbox(d, normalize(vec3(-0.42, 0.34, -0.8)), vec3(0.0, 1.0, 0.0), vec2(0.7, 0.06), b);
  col += on * vec3(1.0, 0.97, 0.93) * 4.0 * softbox(d, normalize(vec3(-0.8, 0.38, -0.2)), vec3(0.0, 1.0, 0.0), vec2(0.08, 0.55), b);
  col += on * vec3(0.95, 0.97, 1.0) * 1.2 * softbox(d, normalize(vec3(0.85, 0.3, 0.55)), vec3(0.0, 1.0, 0.0), vec2(0.45, 0.5), b * 1.3);
  return col;
}

float ggx(vec3 N, vec3 V, vec3 L, float rough) {
  vec3 H = normalize(V + L);
  float a = max(rough * rough, 0.002);
  float a2 = a * a;
  float NdH = max(dot(N, H), 0.0);
  float NdL = max(dot(N, L), 0.0);
  float NdV = max(dot(N, V), 1e-3);
  float dd = NdH * NdH * (a2 - 1.0) + 1.0;
  float D = a2 / (PI * dd * dd);
  float k = a * 0.5;
  float G = (NdL / (NdL * (1.0 - k) + k)) * (NdV / (NdV * (1.0 - k) + k));
  return D * G / max(4.0 * NdL * NdV, 1e-3) * NdL;
}

float linearDepth(vec3 p) { return dot(p - uCamPos.xyz, uCamFwd); }
// the krill's light reaching a surface at P facing N
vec3 glowLight(vec3 P, vec3 N, float k) {
  vec3 d = uGlowP.xyz - P; float l = length(d);
  // the light crosses the clear jelly on its way, so it leaves the krill warm and arrives blue
  vec3 sJ = -log(clamp(uFlesh.rgb, vec3(0.002), vec3(0.999))) * uFlesh.w;
  return uGlowC * uGlowP.w * clamp((dot(N, d / max(l, 1e-4)) + 0.4) / 1.4, 0.0, 1.0) / (1.0 + l * l * k) * exp(-sJ * l * 0.7);
}
` + GLSL_SHAPE;

const GLSL_SHADOW_FNS = /* glsl */`
uniform sampler2D uShadowDepth;
uniform highp sampler2DShadow uShadowCmp;
uniform sampler2D uHeight;
const vec2 POISSON[16] = vec2[16](
  vec2(-0.94201624, -0.39906216), vec2(0.94558609, -0.76890725), vec2(-0.094184101, -0.92938870), vec2(0.34495938, 0.29387760),
  vec2(-0.91588581, 0.45771432), vec2(-0.81544232, -0.87912464), vec2(-0.38277543, 0.27676845), vec2(0.97484398, 0.75648379),
  vec2(0.44323325, -0.97511554), vec2(0.53742981, -0.47373420), vec2(-0.26496911, -0.41893023), vec2(0.79197514, 0.19090188),
  vec2(-0.24188840, 0.99706507), vec2(-0.81409955, 0.91437590), vec2(0.19984126, 0.78641367), vec2(0.14383161, -0.14100790));

float keyShadow(vec3 P, float bias) {
  vec4 lp = uLightVP * vec4(P, 1.0);
  vec2 uv = lp.xy * 0.5 + 0.5;
  float z = lp.z * 0.5 + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 1.0;
  // blocker search → penumbra size (PCSS-lite)
  vec2 dims = vec2(textureSize(uShadowDepth, 0));
  float blk = 0.0; float nb = 0.0;
  for (int i = 0; i < 16; i++) {
    vec2 s = uv + POISSON[i] * 0.02;
    float d = texelFetch(uShadowDepth, ivec2(clamp(s, vec2(0.0), vec2(0.999)) * dims), 0).r;
    if (d < z - bias) { blk += d; nb += 1.0; }
  }
  if (nb < 0.5) return 1.0;
  blk /= nb;
  float pen = clamp((z - blk) * 0.45, 0.003, 0.022);
  float sum = 0.0;
  float rot = hash3(P * 91.7) * 6.2831;
  vec2 cs = vec2(cos(rot), sin(rot));
  for (int i = 0; i < 16; i++) {
    vec2 o = POISSON[i];
    vec2 r = vec2(o.x * cs.x - o.y * cs.y, o.x * cs.y + o.y * cs.x);
    sum += texture(uShadowCmp, vec3(uv + r * pen, z - bias));
  }
  return sum / 16.0;
}

float contactAO(vec3 P) {
  vec4 tp = uTopVP * vec4(P, 1.0);
  vec2 uv = tp.xy * 0.5 + 0.5;
  vec2 dims = vec2(textureSize(uHeight, 0));
  float occ = 0.0;
  // the height map holds (y + 1) / 5 of the lowest surface above each point of the floor
  for (int ring = 0; ring < 3; ring++) {
    float rad = 0.012 + float(ring) * 0.028;
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.785398 + float(ring) * 0.39;
      vec2 s = uv + vec2(cos(a), sin(a)) * rad;
      if (s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0) continue;
      float d = texelFetch(uHeight, ivec2(s * dims), 0).r;
      float h = d * 5.0 - 1.0;
      if (d < 0.9999) {
        float dist = float(ring) * 0.028 * 5.2 + 0.05;
        occ += (1.0 - smoothstep(0.0, 0.55 + dist, h)) * (1.0 - float(ring) * 0.22);
      }
    }
  }
  return clamp(occ / 16.0, 0.0, 1.0);
}

// light from the key that has crossed the clear jelly to reach P: the shadow map holds the depth of the first
// surface toward the light, so the path inside is the difference, absorbed with the jelly's own colour
// (capped near the whale's own thickness: for a point on the floor under a lifted whale, most of it is air)
vec3 jellyLight(vec3 P, vec3 sigJ, float maxPath) {
  vec4 lp = uLightVP * vec4(P, 1.0);
  vec2 uv = lp.xy * 0.5 + 0.5;
  float z = lp.z * 0.5 + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec3(1.0);
  vec2 dims = vec2(textureSize(uShadowDepth, 0));
  vec3 acc = vec3(0.0);
  for (int k = 0; k < 5; k++) {
    vec2 s = uv + POISSON[k] * 0.004;
    float d = texelFetch(uShadowDepth, ivec2(clamp(s, vec2(0.0), vec2(0.999)) * dims), 0).r;
    float path = min(max(z - d - 0.0006, 0.0) * LIGHT_DEPTH, maxPath);
    acc += exp(-sigJ * path);
  }
  return acc / 5.0;
}
`;

const GLSL_FULL_VS = /* glsl */`
varying vec2 vNdc;
void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// deforming meshes: world-space position/normal from the CPU skinning (model matrix = identity), plus rest coords
const GLSL_MESH_VS = /* glsl */`
attribute vec3 rest;
attribute float mat;
attribute vec4 ctr;
varying vec3 vWp;
varying vec3 vN;
varying vec3 vRest;
varying float vMat;
varying vec4 vCtr;
void main() {
  vWp = position; vN = normal; vRest = rest; vMat = mat; vCtr = ctr;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;

const GLSL_POS_VS = /* glsl */`
varying vec3 vWp;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWp = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }
`;

const GLSL_SHADOW_FS = /* glsl */`
void main() { gl_FragColor = vec4(gl_FragCoord.z, 0.0, 0.0, 1.0); }
`;

// top-down height map, seen from under the floor so the lowest surface wins; stores (y + 1) / 5
const GLSL_HEIGHT_FS = /* glsl */`
varying vec3 vWp;
void main() { gl_FragColor = vec4((vWp.y + 1.0) / 5.0, 0.0, 0.0, 1.0); }
`;

// ── the studio sweep: soft key shadow tinted by the jelly it crossed, contact occlusion, the krill's glow ──
const GLSL_FLOOR_FS = GLSL_COMMON + GLSL_SHADOW_FNS + /* glsl */`
varying vec2 vNdc;
void main() {
  vec4 a = uInvViewProj * vec4(vNdc, -1.0, 1.0);
  vec4 b = uInvViewProj * vec4(vNdc, 1.0, 1.0);
  vec3 ro = a.xyz / a.w;
  vec3 rd = normalize(b.xyz / b.w - ro);
  vec3 col = uBg;
  float dep = 1000.0;
  // slight falloff above the horizon, like a paper sweep lit from above
  col *= 1.0 - 0.08 * smoothstep(0.0, 0.6, rd.y);
  if (rd.y < -1e-4) {
    float t = (uMisc.z - ro.y) / rd.y;
    vec3 P = ro + rd * t;
    dep = linearDepth(P);
    float sh = keyShadow(P, 0.0015);
    float ao = contactAO(P);
    // translucent jelly casts a tinted shadow: pale under the flukes, deep under the body; contact occlusion stays neutral
    vec3 jT = clamp(uFlesh.rgb, vec3(0.002), vec3(0.999));
    vec3 trans = jellyLight(P, -log(jT) * uFlesh.w, 0.75);
    vec3 shadowCol = mix(vec3(1.0), max(trans, uShadowTint * 0.52) * 0.92, (1.0 - sh) * (1.0 - 0.6 * uMisc.w));
    vec3 fl = uBg * (0.9 + 0.1 * clamp(1.0 - length(P.xz - vec2(0.0, 0.8)) * 0.12, 0.0, 1.0));
    fl *= shadowCol;
    fl *= 1.0 - ao * 0.72;
    // the krill's light, coming out through the blue of the whale
    float gd = length(P - uGlowP.xyz);
    fl += uGlowC * uGlowP.w * 0.1 / (1.0 + gd * gd * 2.2) * exp(log(jT) * uFlesh.w * 0.32) * (1.0 - ao * 0.5);
    float fade = smoothstep(7.0, 22.0, t);
    col = mix(fl, col, fade);
  }
  gl_FragColor = vec4(col, dep);
}
`;

// ── inside / beside the jelly: drops, eyes, the milky layer, bubbles, baleen, krill ──
const GLSL_PROPS_FS = GLSL_COMMON + GLSL_SHADOW_FNS + /* glsl */`
varying vec3 vWp;
varying vec3 vN;
varying vec3 vRest;
varying float vMat;
varying vec4 vCtr;
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(uCamPos.xyz - vWp);
  float NdV = max(dot(N, V), 1e-3);
  vec3 L = uKeyDir.xyz;
  float key = uKeyDir.w;
  vec3 keyC = vec3(1.0, 0.97, 0.92) * key;
  float NdL = dot(N, L);
  vec3 jellyT = clamp(uFlesh.rgb, vec3(0.002), vec3(0.999));
  vec3 sigJ = -log(jellyT) * uFlesh.w;
  int m = int(vMat + 0.5);
  float t = uCamPos.w;
  vec3 col;
  if (m == 1) {
    // ── a drop of the spout: a bead of the same clear jelly, bright where the light comes through it ──
    float sh = keyShadow(vWp, 0.0015);
    float r = max(vCtr.w, 1e-3);
    float chord = 2.0 * r * NdV;
    vec3 T = exp(-sigJ * chord * 2.6);
    vec3 behind = uBg * 0.84;
    float wrap = clamp((NdL + 0.5) / 1.5, 0.0, 1.0);
    vec3 amb = uBg * mix(0.35, 0.8, N.y * 0.5 + 0.5);
    float focus = pow(clamp(-NdL * 0.5 + 0.5, 0.0, 1.0), 5.0) * key * 0.8 * sh;
    float thru = pow(clamp(dot(V, -L), 0.0, 1.0), 2.0) * 0.5 * key;
    vec3 base = behind * T + uAril * (amb * 0.55 + keyC * 0.32 * wrap * mix(0.4, 1.0, sh)) * (1.0 - T)
              + uAril * (focus + thru) * mix(vec3(1.0), jellyT, 0.5);
    float F = 0.04 + 0.96 * pow(1.0 - NdV, 5.0);
    vec3 env = studioEnv(reflect(-V, N), 0.05, uBg);
    col = base * (1.0 - F) + env * F + keyC * ggx(N, V, L, 0.05) * sh + uAril * glowLight(vWp, N, 6.0) * 0.4;
  } else if (m == 2) {
    // ── an eye: a dark glossy bead, a faint brown ring round the pupil ──
    float sh = keyShadow(vWp, 0.0015);
    vec3 W = vec3(EYE_W.x, EYE_W.y, EYE_W.z * sign(vRest.z));
    float ca = dot(normalize(vRest - vCtr.xyz), W);
    vec3 base = uSeed;
    base = mix(base, base * vec3(3.4, 2.2, 1.5) + vec3(0.012, 0.007, 0.003), (1.0 - smoothstep(0.87, 0.93, ca)) * smoothstep(0.6, 0.78, ca) * 0.8);
    float wrap = clamp((NdL + 0.3) / 1.3, 0.0, 1.0);
    vec3 amb = uBg * mix(0.25, 0.6, N.y * 0.5 + 0.5);
    float F = 0.045 + 0.955 * pow(1.0 - NdV, 5.0);
    vec3 env = studioEnv(reflect(-V, N), 0.06, uBg);
    col = base * (amb + keyC * 0.4 * wrap * mix(0.4, 1.0, sh)) + env * F * 0.9 + keyC * ggx(N, V, L, 0.06) * sh;
  } else if (m == 3) {
    // ── the milky layer: lit by light that has crossed the clear jelly above it, and by the krill ──
    vec3 Q = vRest;
    vec4 A = axisAt(Q.x);
    vec3 T = jellyLight(vWp, sigJ, 1.2);
    float onLine = 1.0 - smoothstep(0.004, 0.03, A.w - Q.y);
    vec3 ambT = mix(vec3(1.0), exp(-sigJ * 0.22), onLine);
    float wrap = clamp((NdL + 0.7) / 1.7, 0.0, 1.0);
    vec3 amb = uBg * mix(0.42, 0.88, N.y * 0.5 + 0.5) * ambT;
    float cloud = fbm(Q * 7.0 + vec3(3.0));
    vec3 base = uPale * (0.93 + 0.12 * cloud);
    col = base * (amb + keyC * 0.6 * wrap * T) + base * T * key * 0.06 + base * glowLight(vWp, N, 9.0) * 0.55;
  } else if (m == 4) {
    // ── a bubble: a pocket of air, bright round its rim and clear in the middle ──
    vec3 T = jellyLight(vWp, sigJ, 1.2);
    float rim = pow(1.0 - NdV, 2.0);
    vec3 env = studioEnv(reflect(-V, N), 0.08, uBg);
    vec3 clear = uBg * 0.95 * mix(vec3(1.0), T, 0.4);
    col = mix(clear, env * 0.7 + vec3(0.05), rim * 0.7) + keyC * ggx(N, V, L, 0.06) * T * 0.5 + glowLight(vWp, N, 10.0) * rim * 0.4;
  } else if (m == 5) {
    // ── a plate of baleen: dark licorice, glossy, a little brown where the light comes through its fringe ──
    vec3 T = jellyLight(vWp, sigJ, 1.2);
    float fr = clamp((vCtr.y - vRest.y) / max(vCtr.w, 1e-3) * 0.5 + 0.5, 0.0, 1.0);
    vec3 base = mix(vec3(0.03, 0.022, 0.018), vec3(0.16, 0.09, 0.045), fr * fr);
    float wrap = clamp((NdL + 0.4) / 1.4, 0.0, 1.0);
    vec3 amb = uBg * mix(0.3, 0.7, N.y * 0.5 + 0.5);
    float F = 0.045 + 0.955 * pow(1.0 - NdV, 5.0);
    vec3 env = studioEnv(reflect(-V, N), 0.12, uBg);
    col = base * (amb + keyC * 0.5 * wrap * T) + env * F * 0.7 + keyC * ggx(N, V, L, 0.12) * T * 0.6 + base * glowLight(vWp, N, 9.0) * 2.0;
  } else if(m==7 || m==8){
    vec3 base=m==7?vec3(.92,.91,.84):vec3(.022,.36,.012);
    float sh=keyShadow(vWp,.0015);float wrap=clamp((NdL+.4)/1.4,0.0,1.0);
    col=base*(uBg*.65+keyC*.45*wrap*mix(.45,1.0,sh))+studioEnv(reflect(-V,N),.13,uBg)*.055+keyC*ggx(N,V,L,.13)*sh*.4;
  } else {
    // ── a piece of krill: translucent pink, darker along its back, glowing when the lights are out ──
    vec3 T = jellyLight(vWp, sigJ, 1.2);
    float wrap = clamp((NdL + 0.6) / 1.6, 0.0, 1.0);
    vec3 amb = uBg * mix(0.4, 0.85, N.y * 0.5 + 0.5);
    float F = 0.04 + 0.96 * pow(1.0 - NdV, 5.0);
    vec3 env = studioEnv(reflect(-V, N), 0.1, uBg);
    float core = pow(NdV, 0.6);
    vec3 base = mix(uKrill * 0.55, uKrill, core);
    vec3 em = uGlowC * (0.3 + 1.4 * uMisc.w) * (0.4 + 0.8 * core);
    col = base * (amb * 0.9 + keyC * 0.5 * wrap * T) + em + keyC * ggx(N, V, L, 0.1) * T * 0.5 + env * F * 0.35;
  }
  gl_FragColor = vec4(col, linearDepth(vWp));
}
`;

// ── back faces → linear depth (for view-ray thickness); farthest wins ──
const GLSL_BACK_FS = GLSL_COMMON + /* glsl */`
varying vec3 vWp;
void main() {
  gl_FragColor = vec4(linearDepth(vWp), 0.0, 0.0, 1.0);
  gl_FragDepth = 1.0 - gl_FragCoord.z;
}
`;

const GLSL_COPY_FS = /* glsl */`
uniform sampler2D uSceneTex;
void main() { gl_FragColor = vec4(texelFetch(uSceneTex, ivec2(gl_FragCoord.xy), 0).rgb, 1.0); }
`;

// ── the clear jelly ──
const GLSL_JELLY_FS = GLSL_COMMON + /* glsl */`
uniform sampler2D uSceneTex;
uniform sampler2D uBackTex;
varying vec3 vWp;
varying vec3 vN;
varying vec3 vRest;

vec2 toUV(vec3 p) {
  vec4 c = uViewProj * vec4(p, 1.0);
  return c.xy / c.w * 0.5 + 0.5;
}
// bump a normal by a scalar height field using screen-space derivatives (Mikkelsen 2010): no tangents needed,
// and the pattern stays glued to the rest-space coordinates of the jelly
vec3 bumpNormal(vec3 N, vec3 P, float h) {
  vec3 dPx = dFdx(P), dPy = dFdy(P);
  float dhx = dFdx(h), dhy = dFdy(h);
  vec3 r1 = cross(dPy, N), r2 = cross(N, dPx);
  float det = dot(dPx, r1);
  vec3 g = sign(det) * (dhx * r1 + dhy * r2);
  return normalize(abs(det) * N - g);
}

void main() {
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 P = vWp;
  vec3 V = normalize(uCamPos.xyz - P);
  vec3 L = uKeyDir.xyz;
  float key = uKeyDir.w;

  vec3 Q=vRest;
  float mouth=0.0,blowM=0.0,pleat=0.0,mot=0.0;
  float tongueField=min(length((Q-vec3(-.29,1.02,.68))/vec3(.14,.20,.14))-1.0,min(length((Q-vec3(-.22,.90,.81))/vec3(.22,.23,.16))-1.0,length((Q-vec3(-.15,.76,.91))/vec3(.25,.23,.16))-1.0));
  float tongueMask=1.0-smoothstep(.15,.6,tongueField);
  float cavityField=(length((Q-vec3(-.25,.83,.77))/vec3(.28,.49,.30))-1.0)*.28;
  float cavityMask=(1.0-smoothstep(.012,.045,abs(cavityField)))*(1.0-tongueMask);
  N=bumpNormal(N,P,(vnoise(Q*46.0)-.5)*.0003);
  float NdV=max(dot(N,V),1e-3);
  // ── thickness along the view ray: to the back faces, or to whatever sits inside (milk, a bubble, the krill) ──
  vec2 uv = gl_FragCoord.xy * uScreen.zw;
  ivec2 pix = ivec2(gl_FragCoord.xy);
  float fz = linearDepth(P);
  float bz = texelFetch(uBackTex, pix, 0).r;
  float sz = texelFetch(uSceneTex, pix, 0).a;
  float cosv = max(dot(-V, uCamFwd), 0.35);
  float thick = clamp((min(bz, sz) - fz) / cosv, 0.0, 3.0);
  float thickBack = clamp((bz - fz) / cosv, 0.0, 3.0);

  // ── the clear jelly: Beer–Lambert absorption in its own colour, a faint cloud ──
  float grain = fbm(Q * 9.0);
  float dens = 1.0 + (grain - 0.5) * 0.18;
  vec3 jellyT = mix(clamp(uFlesh.rgb, vec3(0.002), vec3(0.999)),vec3(.38,.065,.16),tongueMask);
  vec3 sigma = -log(jellyT) * uFlesh.w * dens;
  float scatK = 1.1;
  float rough = uRough;

  // ── refraction: bend the view ray into the jelly, find what it meets ──
  float ior = 1.4;
  vec3 Rr = refract(-V, N, 1.0 / ior);
  vec3 exitP = P + Rr * min(thick, 0.9) * 0.5;
  vec2 ruv = mix(uv, toUV(exitP), 0.85);
  float blurR = 0.0008 + 0.0035 * min(thick, 1.0);
  vec3 transmitted = vec3(0.0);
  float pathL = 0.0;
  for (int k = 0; k < 7; k++) {
    float a = float(k) * 0.8976 + 0.3;
    vec2 o = k == 6 ? vec2(0.0) : vec2(cos(a), sin(a)) * blurR;
    vec4 s = textureLod(uSceneTex, clamp(ruv + o, vec2(0.001), vec2(0.999)), 0.0);
    float pl = clamp(min(thickBack, max(s.a - fz, 0.0) / cosv + 0.01), 0.0, 3.0);
    transmitted += s.rgb * exp(-sigma * pl);
    pathL += pl;
  }
  transmitted /= 7.0; pathL /= 7.0;
  float scat = 1.0 - exp(-scatK * pathL * 0.5 - 0.015);

  // ── light scattered inside the body ──
  float NdL = dot(N, L);
  float wrap = clamp((NdL + 0.6) / 1.6, 0.0, 1.0);
  vec3 amb = uBg * mix(0.3, 0.75, N.y * 0.5 + 0.5);
  vec3 inner = mix(uFleshDeep,vec3(.20,.018,.07),tongueMask) * (amb + vec3(1.0, 0.97, 0.92) * key * 0.45 * wrap);
  // the krill's light, caught in the jelly round it
  float gd = length(P - uGlowP.xyz);
  vec3 sq = uGlowC * uGlowP.w * exp(-gd * 1.5) * (1.0 - exp(-pathL * 1.6)) * exp(-sigma * gd * 0.7) * 1.2;

  // thin parts (flukes, flippers) glow when the key light is behind them
  float back = pow(clamp(dot(V, -L), 0.0, 1.0), 3.0) * 1.4 + 0.25;
  vec3 thinK = exp(-sigma * (pathL * 0.6 + 0.04));
  vec3 glow = jellyT * thinK * back * key * 0.38 * clamp(1.0 - NdL * 0.6, 0.0, 1.0);

  vec3 body = transmitted * (1.0 - scat) + inner * scat + glow + sq;
  // the markings: pale mottling, a little colour held in the pleats, the dark line of the mouth and the blowholes
  body = mix(body, body + uMottle.rgb * 0.35, mot * uMottle.w);
  body = mix(body, body * mix(vec3(1.0), jellyT, 0.55) * 0.88, pleat * 0.6);
  body = mix(body, uSkin, max(mouth * 0.75, blowM * 0.85));

  // ── surface: Fresnel reflection of the studio + key highlight ──
  vec3 R = reflect(-V, N);
  float F0 = 0.04;
  float F = F0 + (1.0 - F0) * pow(1.0 - NdV, 5.0);
  vec3 env = studioEnv(R, rough, uBg);
  vec3 spec = ggx(N, V, L, rough) * key * vec3(1.0, 0.97, 0.93);
  float gloss = 0.8 * (1.0 - mouth * 0.4);
  vec3 col = body * (1.0 - F * gloss) + env * F * gloss + spec * gloss;
  col=mix(col,vec3(.026,.002,.012)*(amb+key*.15)+env*F*.22,cavityMask);
  gl_FragColor = vec4(col, 1.0);
}
`;

const GLSL_LINE_VS = /* glsl */`
uniform vec4 uCamPos;
uniform vec3 uCamFwd;
varying float vD;
void main() {
  vD = dot(position - uCamPos.xyz, uCamFwd);
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;
const GLSL_LINE_FS = /* glsl */`
uniform vec4 uMisc;
varying float vD;
void main() {
  float a = uMisc.y * mix(0.9, 0.35, clamp((vD - 5.0) * 0.5, 0.0, 1.0));
  gl_FragColor = vec4(vec3(0.04, 0.05, 0.06) * a, a);
}
`;

// ── post: three.js Khronos PBR Neutral tone mapping + sRGB output, then a 1/255 dither ──
const GLSL_POST_FS = /* glsl */`
uniform sampler2D uHdr;
float hash3(vec3 p) { vec3 q = fract(p * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
void main() {
  vec3 c = texelFetch(uHdr, ivec2(gl_FragCoord.xy), 0).rgb;
  gl_FragColor = vec4(max(c, vec3(0.0)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.rgb += (hash3(vec3(gl_FragCoord.xy, 1.0)) - 0.5) / 255.0;
}
`;


// ===== renderer.js =====
// ─────────────────────────────────────────────────────────────
//  three.js renderer (WebGL2). Passes, each a THREE.Scene drawn into a render target:
//    key-light shadow map · top-down height map (contact AO)
//    · scene (the sweep; the milky layer, eyes, baleen, krill, bubbles, drops; 4× MSAA, half float)
//    · jelly back-face depth · clear jelly (refraction / absorption / scattering; 4× MSAA) + mesh overlay
//    · NeutralToneMapping + sRGB to the canvas
// ─────────────────────────────────────────────────────────────

const MSAA = 4;
const DYN = 10;   // floats per vertex in the dynamic buffer: position, normal, the centre + radius of the bead it belongs to

class Renderer {
  static async create(canvas, A) {
    const probe = document.createElement('canvas').getContext('webgl2');
    if (!probe) throw new Error('no-webgl2');
    const r = new Renderer(canvas, A);
    r.check();
    return r;
  }

  constructor(canvas, A) {
    const R = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: !!window.__keepFrame });
    R.autoClear = false;
    R.toneMapping = THREE.NeutralToneMapping;
    R.toneMappingExposure = 1.0;
    R.outputColorSpace = THREE.SRGBColorSpace;
    if (!R.extensions.has('EXT_color_buffer_float')) throw new Error('no-float-targets');
    this.three = R;
    this.canvas = canvas;
    const mesh = A.mesh;
    this.mesh = mesh;
    this.nV = mesh.rest.length / 3;
    this.lost = false;
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); this.lost = true; this.onLost && this.onLost(); });
    canvas.addEventListener('webglcontextrestored', () => { this.lost = false; this.onRestored && this.onRestored(); });

    // ── the whale and everything in it: one interleaved dynamic buffer (skinned position, normal, bead centre) ──
    this.dyn = new Float32Array(this.nV * DYN);
    this.dynBuf = new THREE.InterleavedBuffer(this.dyn, DYN).setUsage(THREE.DynamicDrawUsage);
    const aPos = new THREE.InterleavedBufferAttribute(this.dynBuf, 3, 0);
    const aNrm = new THREE.InterleavedBufferAttribute(this.dynBuf, 3, 3);
    const aCtr = new THREE.InterleavedBufferAttribute(this.dynBuf, 4, 6);
    const aRest = new THREE.BufferAttribute(mesh.rest, 3);
    const aMat = new THREE.BufferAttribute(mesh.mat, 1);
    const aIdx = new THREE.BufferAttribute(mesh.index, 1);
    const geo = (first, count) => {
      const g = new THREE.BufferGeometry();
      g.setIndex(aIdx);
      g.setAttribute('position', aPos); g.setAttribute('normal', aNrm); g.setAttribute('ctr', aCtr);
      g.setAttribute('rest', aRest); g.setAttribute('mat', aMat);
      g.setDrawRange(first, count);
      return g;
    };
    const gBody = geo(0, mesh.body.count);
    const gCasters = geo(0, mesh.body.count + mesh.seeds.count);
    const gProps = geo(mesh.seeds.first, mesh.seeds.count);

    this.linePos = new THREE.BufferAttribute(new Float32Array(A.nParticles * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const gLines = new THREE.BufferGeometry();
    gLines.setAttribute('position', this.linePos);
    gLines.setIndex(new THREE.BufferAttribute(A.simEdges, 1));

    // ── render targets ──
    this.shadowSize = 2048; this.topSize = 1024;
    this.shadowRT = new THREE.WebGLRenderTarget(this.shadowSize, this.shadowSize, {
      type: THREE.FloatType, format: THREE.RedFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false,
    });
    const dt = new THREE.DepthTexture(this.shadowSize, this.shadowSize, THREE.FloatType);
    dt.minFilter = dt.magFilter = THREE.LinearFilter;
    dt.compareFunction = THREE.LessCompare;
    this.shadowRT.depthTexture = dt;
    this.heightRT = new THREE.WebGLRenderTarget(this.topSize, this.topSize, {
      type: THREE.FloatType, format: THREE.RedFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false,
    });
    const hdrOpts = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, samples: MSAA };
    this.sceneRT = new THREE.WebGLRenderTarget(1, 1, hdrOpts);
    this.hdrRT = new THREE.WebGLRenderTarget(1, 1, hdrOpts);
    this.backRT = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.FloatType, format: THREE.RedFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false,
    });

    // ── one uniform block shared by every material ──
    const v3 = () => ({ value: new THREE.Vector3() }), v4 = () => ({ value: new THREE.Vector4() }), m4 = () => ({ value: new THREE.Matrix4() });
    this.U = {
      uViewProj: m4(), uInvViewProj: m4(), uLightVP: m4(), uTopVP: m4(),
      uCamPos: v4(), uCamFwd: v3(), uKeyDir: v4(), uScreen: v4(),
      uFlesh: v4(), uFleshDeep: v3(), uPale: v3(), uSkin: v3(), uSeed: v3(), uRough: { value: 0.07 },
      uMisc: v4(), uBg: v3(), uShadowTint: v3(), uAril: v3(), uGlowP: v4(), uGlowC: v3(), uMottle: v4(), uKrill: v3(),
      uShadowDepth: { value: this.shadowRT.texture }, uShadowCmp: { value: dt }, uHeight: { value: this.heightRT.texture },
      uSceneTex: { value: this.sceneRT.texture }, uBackTex: { value: this.backRT.texture }, uHdr: { value: this.hdrRT.texture },
    };
    const mat = (vs, fs, extra = {}) => new THREE.ShaderMaterial({ uniforms: this.U, vertexShader: vs, fragmentShader: fs, toneMapped: false, ...extra });
    const fullscreen = new THREE.PlaneGeometry(2, 2);
    const add = (scene, g, m, order, Kind = THREE.Mesh) => {
      const o = new Kind(g, m); o.frustumCulled = false; o.renderOrder = order; o.matrixAutoUpdate = false; scene.add(o);
      return o;
    };

    this.materials = {
      shadow: mat(GLSL_POS_VS, GLSL_SHADOW_FS, { side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }),
      height: mat(GLSL_POS_VS, GLSL_HEIGHT_FS, { side: THREE.DoubleSide }),
      floor: mat(GLSL_FULL_VS, GLSL_FLOOR_FS, { depthTest: false, depthWrite: false }),
      props: mat(GLSL_MESH_VS, GLSL_PROPS_FS),
      back: mat(GLSL_POS_VS, GLSL_BACK_FS, { side: THREE.BackSide }),
      copy: mat(GLSL_FULL_VS, GLSL_COPY_FS, { depthTest: false, depthWrite: false }),
      depth: mat(GLSL_POS_VS, 'void main() { gl_FragColor = vec4(0.0); }', { colorWrite: false }),
      jelly: mat(GLSL_MESH_VS, GLSL_JELLY_FS),
      lines: mat(GLSL_LINE_VS, GLSL_LINE_FS, {
        transparent: true, depthTest: false, depthWrite: false, blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      }),
      post: new THREE.ShaderMaterial({ uniforms: this.U, vertexShader: GLSL_FULL_VS, fragmentShader: GLSL_POST_FS, depthTest: false, depthWrite: false, toneMapped: true }),
    };
    const M = this.materials;
    this.shadowScene = new THREE.Scene(); add(this.shadowScene, gCasters, M.shadow, 0);
    // the height map only takes the body: a small loose drop would print a ring of dots in the contact shading
    this.heightScene = new THREE.Scene(); add(this.heightScene, gBody, M.height, 0);
    this.sceneScene = new THREE.Scene();
    add(this.sceneScene, fullscreen, M.floor, 0); add(this.sceneScene, gProps, M.props, 1);
    this.backScene = new THREE.Scene(); add(this.backScene, gBody, M.back, 0);
    this.mainScene = new THREE.Scene();
    add(this.mainScene, fullscreen, M.copy, 0);
    add(this.mainScene, gProps, M.depth, 1);
    add(this.mainScene, gBody, M.jelly, 2);
    this.lines = add(this.mainScene, gLines, M.lines, 5, THREE.LineSegments);
    this.postScene = new THREE.Scene(); add(this.postScene, fullscreen, M.post, 0);
    for (const s of [this.shadowScene, this.heightScene, this.sceneScene, this.backScene, this.mainScene, this.postScene]) s.matrixWorldAutoUpdate = false;

    // ── cameras ──
    this.camera = new THREE.PerspectiveCamera(27, 1, 0.1, 80);
    this.lightCam = new THREE.OrthographicCamera(-3, 3, 3, -3, 0.1, 16);
    this.lightCam.up.set(0, 0, 1);
    this.topCam = new THREE.OrthographicCamera(-3.2, 3.2, 3.2, -3.2, 0, 5);
    this.topCam.up.set(0, 0, -1);
    this.w = 0; this.h = 0;
  }

  check() {
    const R = this.three, errs = [];
    const prev = R.debug.onShaderError;
    R.debug.onShaderError = (gl, program, vs, fs) => {
      errs.push((gl.getProgramInfoLog(program) || '') + (gl.getShaderInfoLog(fs) || '') + (gl.getShaderInfoLog(vs) || ''));
    };
    if (!this.w) this.resize(2, 2, 2, 2, 1);
    this.draw(true);
    R.debug.onShaderError = prev;
    if (errs.length) throw new Error('GLSL compile error\n' + errs.join('\n').slice(0, 1500));
  }

  resize(w, h, cssW, cssH, dpr) {
    w = Math.max(1, Math.floor(w)); h = Math.max(1, Math.floor(h));
    if (w === this.w && h === this.h) return;
    this.three.setPixelRatio(dpr);
    this.three.setSize(cssW, cssH, false);
    const size = this.three.getDrawingBufferSize(new THREE.Vector2());
    this.w = size.x; this.h = size.y;
    for (const rt of [this.sceneRT, this.hdrRT, this.backRT]) rt.setSize(this.w, this.h);
  }

  // cam = { viewProj, invViewProj, pos, fwd } · light = { dir, intensity, at } · P a palette · S = { time, exposure, meshAlpha, bg, dark, glowP, glowC }
  setUniforms(cam, light, P, S) {
    const U = this.U;
    U.uViewProj.value.fromArray(cam.viewProj); U.uInvViewProj.value.fromArray(cam.invViewProj);
    const at = light.at, d = light.dir;
    this.lightCam.position.set(at[0] + d[0] * 8, at[1] + d[1] * 8, at[2] + d[2] * 8);
    this.lightCam.lookAt(at[0], at[1], at[2]);
    this.lightCam.updateMatrixWorld();
    U.uLightVP.value.multiplyMatrices(this.lightCam.projectionMatrix, this.lightCam.matrixWorldInverse);
    // top-down height map: a camera under the floor looking up, so the lowest surface wins; depth = (y + 1) / 5
    this.topCam.position.set(at[0], -1, at[2]);
    this.topCam.lookAt(at[0], 1, at[2]);
    this.topCam.updateMatrixWorld();
    U.uTopVP.value.multiplyMatrices(this.topCam.projectionMatrix, this.topCam.matrixWorldInverse);
    U.uCamPos.value.set(cam.pos[0], cam.pos[1], cam.pos[2], S.time);
    U.uCamFwd.value.fromArray(cam.fwd);
    U.uKeyDir.value.set(d[0], d[1], d[2], light.intensity);
    U.uScreen.value.set(this.w, this.h, 1 / this.w, 1 / this.h);
    U.uFlesh.value.set(P.flesh[0], P.flesh[1], P.flesh[2], P.density);
    U.uFleshDeep.value.fromArray(P.fleshDeep);
    U.uPale.value.fromArray(P.pale); U.uSkin.value.fromArray(P.skin); U.uSeed.value.fromArray(P.seed);
    U.uRough.value = P.rough;
    U.uMisc.value.set(S.exposure, S.meshAlpha, 0, S.dark || 0);
    U.uBg.value.fromArray(S.bg);
    U.uShadowTint.value.fromArray(P.shadowTint);
    U.uAril.value.fromArray(P.aril); U.uKrill.value.fromArray(P.krill);
    U.uMottle.value.set(P.mottle[0], P.mottle[1], P.mottle[2], P.mottleW);
    U.uGlowP.value.fromArray(S.glowP);
    U.uGlowC.value.fromArray(S.glowC);
    this.three.toneMappingExposure = S.exposure;
  }

  uploadGeometry(particles, showMesh) {
    this.dynBuf.needsUpdate = true;
    if (showMesh) { this.linePos.array.set(particles); this.linePos.needsUpdate = true; }
  }

  draw(showMesh) {
    if (this.lost) return;
    const R = this.three;
    R.setClearColor(0xffffff, 1);
    R.setRenderTarget(this.shadowRT); R.clear(true, true, false); R.render(this.shadowScene, this.lightCam);
    R.setRenderTarget(this.heightRT); R.clear(true, true, false); R.render(this.heightScene, this.topCam);
    R.setClearColor(0x000000, 1);
    R.setRenderTarget(this.sceneRT); R.clear(true, true, false); R.render(this.sceneScene, this.camera);
    R.setRenderTarget(this.backRT); R.clear(true, true, false); R.render(this.backScene, this.camera);
    this.lines.visible = !!showMesh;
    R.setRenderTarget(this.hdrRT); R.clear(true, true, false); R.render(this.mainScene, this.camera);
    R.setRenderTarget(null); R.render(this.postScene, this.camera);
  }
}


// ===== main.js =====
// ─────────────────────────────────────────────────────────────
//  App: sim ↔ render glue, camera, picking, the spout, the gulp and the krill, the lights, UI
// ─────────────────────────────────────────────────────────────

const srgbToLin = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const linToSrgb = c => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const hex = rgb => '#' + rgb.map(c => Math.round(Math.min(1, Math.max(0, linToSrgb(c))) * 255).toString(16).padStart(2, '0')).join('');
const hexLin = h => [1, 3, 5].map(i => srgbToLin(parseInt(h.slice(i, i + 2), 16) / 255));
const vnorm = v => { const l = Math.hypot(...v) || 1; return v.map(q => q / l); };
const lerp3 = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t);

// three colourways (authored in sRGB, used in linear RGB)
// flesh: the clear jelly in transmission, density: how strongly it absorbs · fleshDeep: its scattering
// pale: the milky layer · skin: the mouth line and blowholes · seed: the eyes · aril: the drops
// krill, glow: the krill and its light · mottle: the pale blotches on the back
const PALETTES = {
  ocean: {
    name: 'Golden',
    flesh: hexLin('#ffe340'), density: 1.25, fleshDeep: hexLin('#e9a914'), pale: hexLin('#f3efe6'),
    skin: hexLin('#4a112d'), seed: hexLin('#0a0c11'), aril: hexLin('#ffc928'), krill: hexLin('#ff6f5e'), glow: hexLin('#ffb09a'),
    mottle: hexLin('#cfe4ff'), mottleW: 0.0, shadowTint: [0.5, 0.6, 0.8], rough: 0.07,
    ui: { deep: hexLin('#dba818'), mid: hexLin('#ffe340'), pale: hexLin('#ff6f5e') },
  },
  arctic: {
    name: 'Honey',
    flesh: hexLin('#ffd050'), density: 1.6, fleshDeep: hexLin('#c58a19'), pale: hexLin('#f6f8f6'),
    skin: hexLin('#063a52'), seed: hexLin('#080c10'), aril: hexLin('#f3b534'), krill: hexLin('#ff7a6a'), glow: hexLin('#ffb7a2'),
    mottle: hexLin('#e8f8ff'), mottleW: 0.5, shadowTint: [0.52, 0.7, 0.8], rough: 0.06,
    ui: { deep: hexLin('#c58a19'), mid: hexLin('#ffd050'), pale: hexLin('#ff7a6a') },
  },
  twilight: {
    name: 'Amber',
    flesh: hexLin('#ffbd35'), density: 1.8, fleshDeep: hexLin('#b16a13'), pale: hexLin('#f5f0f4'),
    skin: hexLin('#16134a'), seed: hexLin('#0a0a12'), aril: hexLin('#d18c1b'), krill: hexLin('#ff6a8a'), glow: hexLin('#ffa8c0'),
    mottle: hexLin('#e2deff'), mottleW: 0.5, shadowTint: [0.58, 0.56, 0.8], rough: 0.07,
    ui: { deep: hexLin('#b16a13'), mid: hexLin('#ffbd35'), pale: hexLin('#ff6a8a') },
  },
};

// the backdrop, chosen so that after the Neutral tone map it lands exactly on the page colour (lights on / out)
function invNeutral(o) {
  const m = Math.min(...o);
  const off = m >= 0.04 ? 0.04 : Math.sqrt(m / 6.25) - m;
  return o.map(v => v + off);
}
const BG_ON = invNeutral(hexLin('#e2dfda'));
const BG_OFF = invNeutral(hexLin('#15181e'));

const SCALE_CM = 2.0;      // illustrative: 1 simulation unit ≈ 2 cm (the whale is ≈ 6.7 cm from snout to fluke tips)
const DENSITY = 1.3;       // g/cm³, gummy candy

const $ = s => document.querySelector(s);

function setStatus(text, state) {
  const el = $('#status');
  $('#statusText').textContent = text;
  el.dataset.state = state;
}

function showFallback(title, detail) {
  const f = $('#fallback');
  f.hidden = false;
  $('#fallbackTitle').textContent = title;
  $('#fallbackDetail').textContent = detail;
  document.body.classList.add('no-gpu');
  setStatus('THREE.JS · UNAVAILABLE', 'off');
  for (const el of document.querySelectorAll('.panel button, .panel input')) el.disabled = true;
}

async function main() {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const canvas = $('#gl');

  // ── build everything once ──
  let cached;
  try{cached=await fetch('./nailong-mesh.json').then(r=>{if(!r.ok)throw Error('mesh cache unavailable');return r.json();});}catch{cached={simMesh:buildSimMesh(.24),renderMesh:buildRenderMesh()};}
  const simMesh=cached.simMesh,renderMesh=cached.renderMesh;
  simMesh.rest=new Float32Array(simMesh.rest);simMesh.tets=new Uint32Array(simMesh.tets);simMesh.region=new Uint8Array(simMesh.region);
  for(const key of ['rest','restNormal','mat','ctr'])renderMesh[key]=new Float32Array(renderMesh[key]);renderMesh.index=new Uint32Array(renderMesh.index);
  const nV = renderMesh.rest.length / 3;
  const dropList = renderMesh.drops;
  const dv0 = dropList[0].v0;                       // the drops are the last vertices, the krill just before them
  const kv0 = renderMesh.krillV0, krillList = renderMesh.krill;
  const emb = cached.emb ? {tetOf:new Int32Array(cached.emb.tetOf),w:new Float32Array(cached.emb.w)} : embed(simMesh.rest, simMesh.tets, renderMesh.rest, [kv0, nV - kv0]);
  const sim = new SoftBody(simMesh, { firmness: 0.5, damping: reduced.matches ? 0.65 : 0.4 });
  // the throat pouch: how far each node moves when it is full
  {
    const disp = new Float32Array(simMesh.rest.length);
    for (let i = 0; i < simMesh.rest.length / 3; i++) disp.set(pouchDisp(simMesh.rest[3 * i], simMesh.rest[3 * i + 1], simMesh.rest[3 * i + 2]), 3 * i);
    sim.setPouch(disp);
  }
  const vol0 = sim.totalRestVolume;
  const drops = new DropSet(dropList, sim);
  const skinIdx = new Uint32Array(nV * 4);
  for (let v = 0; v < kv0; v++) for (let k = 0; k < 4; k++) skinIdx[4 * v + k] = simMesh.tets[4 * emb.tetOf[v] + k];
  const skinW = emb.w;
  // points that ride the jelly: the two blowholes and a point under them (the axis of the spout), the tip of the
  // snout and the notch of the flukes (the live length), the head, and every point of every krill's path
  const A_BL = 0, A_BR = 1, A_UNDER = 2, A_SNOUT = 3, A_NOTCH = 4, A_HEAD = 5, A_KRILL = 6;
  const anc = [[BLOW[0], BLOW[1], BLOW[2]], [BLOW[0], BLOW[1], -BLOW[2]], [BLOW[0] - 0.02, BLOW[1] - 0.2, 0], [1.6, axisAt(1.6)[0], 0], [-1.7, 0.06, 0], [1.2, 0.27, 0]];
  for (const K of KRILL) for (const p of K.path) anc.push(p);
  const embC = embed(simMesh.rest, simMesh.tets, new Float32Array(anc.flat()));
  const restOff = new Float32Array(nV * 3);           // drop and krill vertices relative to their centre
  const dropOf = new Int32Array(nV).fill(-1), krillOf = new Int32Array(nV).fill(-1);
  dropList.forEach((A, i) => { for (let v = A.v0; v < A.v0 + A.nv; v++) { dropOf[v] = i; for (let k = 0; k < 3; k++) restOff[3 * v + k] = renderMesh.rest[3 * v + k] - A.p[k]; } });
  krillList.forEach((A, i) => { for (let v = A.v0; v < A.v0 + A.nv; v++) { krillOf[v] = i; for (let k = 0; k < 3; k++) restOff[3 * v + k] = renderMesh.rest[3 * v + k] - A.p[k]; } });
  // each piece of krill: where it is along its path (−1 not eaten), and how far it has grown in (0 … 1)
  const kState = krillList.map(() => ({ t: -1, grow: 0, t0: 0, t1: 0, u0: 0, u1: 0 }));
  const index = renderMesh.index;
  const bodyTriEnd = renderMesh.body.count;
  const coreFirst = renderMesh.core.first, coreEnd = renderMesh.core.first + renderMesh.core.count;
  // how much each node of the lattice belongs to the head and throat (for the lunge of a gulp)
  const headW = new Float32Array(sim.n);
  for (let i = 0; i < sim.n; i++) headW[i] = sstep(0.1, 0.9, simMesh.rest[3 * i]);

  let currentPalette = 'ocean';
  const swatches = $('#swatches');
  for (const [key, p] of Object.entries(PALETTES)) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'swatch'; b.dataset.key = key;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', p.name + ' Nailong');
    b.innerHTML = `<span class="chip"><i style="background:${hex(p.ui.mid)}"></i><i style="background:${hex(p.ui.deep)}"></i><i style="background:${hex(p.ui.pale)}"></i></span><span class="swname">${p.name}</span>`;
    b.addEventListener('click', () => setPalette(key));
    swatches.appendChild(b);
  }
  function setPalette(key) {
    currentPalette = key;
    for (const b of swatches.children) b.setAttribute('aria-checked', String(b.dataset.key === key));
    document.documentElement.style.setProperty('--accent', hex(PALETTES[key].ui.mid));
    document.documentElement.style.setProperty('--glow', hex(PALETTES[key].krill));
  }
  setPalette('ocean');

  let renderer;
  try {
    renderer = await Renderer.create(canvas, { mesh: renderMesh, simEdges: sim.edges, nParticles: sim.n });
  } catch (err) {
    console.warn(err);
    const msg = String(err && err.message || err);
    if (msg === 'no-webgl2' || /WebGL context/i.test(msg)) showFallback('This whale needs WebGL 2.', 'The browser could not create a WebGL 2 context, so three.js has nothing to draw with. Switch hardware acceleration on, or try a current Chrome, Edge, Firefox or Safari.');
    else if (msg === 'no-float-targets') showFallback('Float render targets are missing.', 'This GPU exposes WebGL 2 but not EXT_color_buffer_float, which the jelly needs for its depth and HDR passes. Try another browser or device.');
    else showFallback('The renderer could not start.', msg.slice(0, 400));
    return;
  }
  const dyn = renderer.dyn;
  const D = DYN;
  // the eyes, baleen and bubbles carry their own (rest-space) centre for the shader
  for (let v = renderMesh.bodyVertCount; v < kv0; v++) for (let k = 0; k < 4; k++) dyn[D * v + 6 + k] = renderMesh.ctr[4 * v + k];
  const camera = renderer.camera;
  const vp = new THREE.Matrix4(), ivp = new THREE.Matrix4();

  // ── state ──
  const state = {
    paused: false, slow: false, showMesh: false,
    az: -.08, el: .13, zoom: 1,
    time: 0,
    lightsOut: false, dark: 0, flash: 0, gulp: -1, gulps: 0, eaten: 0, pouch: 0,
  };
  renderer.onLost = () => setStatus('THREE.JS · CONTEXT LOST', 'off');
  renderer.onRestored = () => { setStatus(state.paused ? 'THREE.JS · PAUSED' : 'THREE.JS · LIVE', state.paused ? 'paused' : 'live'); requestAnimationFrame(frame); };

  // ── skinning: the jelly, the milky layer, the eyes, the baleen and the bubbles follow their tetrahedra;
  //    a loose drop is rigid; a drop not yet blown waits, folded to a point, under the blowholes;
  //    a piece of krill rides along its path, between the points of it that ride the jelly ──
  const nsm = new Float32Array(kv0 * 3);
  const kp = [0, 0, 0], ka = [0, 0, 0], kb = [0, 0, 0];
  const krillAt = (i, t, out) => {
    const f = Math.min(Math.max(t, 0), 1) * (KRILL_PATH - 1), j = Math.min(KRILL_PATH - 2, Math.floor(f)), u = f - j;
    anchor(A_KRILL + i * KRILL_PATH + j, ka); anchor(A_KRILL + i * KRILL_PATH + j + 1, kb);
    for (let k = 0; k < 3; k++) out[k] = ka[k] + (kb[k] - ka[k]) * u;
    return out;
  };
  const anchor = (i, out) => {
    const x = sim.x, i4 = 4 * i, t = 4 * embC.tetOf[i];
    const a = 3 * simMesh.tets[t], b = 3 * simMesh.tets[t + 1], c = 3 * simMesh.tets[t + 2], d = 3 * simMesh.tets[t + 3];
    const w0 = embC.w[i4], w1 = embC.w[i4 + 1], w2 = embC.w[i4 + 2], w3 = embC.w[i4 + 3];
    out[0] = x[a] * w0 + x[b] * w1 + x[c] * w2 + x[d] * w3;
    out[1] = x[a + 1] * w0 + x[b + 1] * w1 + x[c + 1] * w2 + x[d + 1] * w3;
    out[2] = x[a + 2] * w0 + x[b + 2] * w1 + x[c + 2] * w2 + x[d + 2] * w3;
    return out;
  };
  const anchorVel = i => {
    const v = sim.v, i4 = 4 * i, t = 4 * embC.tetOf[i], out = [0, 0, 0];
    for (let c = 0; c < 4; c++) { const q = 3 * simMesh.tets[t + c], w = embC.w[i4 + c]; out[0] += v[q] * w; out[1] += v[q + 1] * w; out[2] += v[q + 2] * w; }
    return out;
  };
  const hole = [0, 0, 0];
  let kLast = -1;
  function skin() {
    const x = sim.x, L = drops.list;
    anchor(A_UNDER, hole);
    for (let v = 0; v < nV; v++) {
      const o = D * v, di = dropOf[v], ki = krillOf[v];
      if (ki >= 0) {
        const K = kState[ki];
        if (ki !== kLast) { kLast = ki; if (K.t >= 0) krillAt(ki, K.t, kp); }
        const live = K.t >= 0, g = live ? K.grow : 0, k3 = 3 * v, c = live ? kp : hole;
        dyn[o] = c[0] + restOff[k3] * g; dyn[o + 1] = c[1] + restOff[k3 + 1] * g; dyn[o + 2] = c[2] + restOff[k3 + 2] * g;
        dyn[o + 6] = c[0]; dyn[o + 7] = c[1]; dyn[o + 8] = c[2]; dyn[o + 9] = krillList[ki].r;
      } else if (di >= 0) {
        const A = L[di];
        if (A.free) {
          const R = A.R, k = 3 * v, ox = restOff[k], oy = restOff[k + 1], oz = restOff[k + 2];
          dyn[o] = A.x[0] + R[0] * ox + R[1] * oy + R[2] * oz;
          dyn[o + 1] = A.x[1] + R[3] * ox + R[4] * oy + R[5] * oz;
          dyn[o + 2] = A.x[2] + R[6] * ox + R[7] * oy + R[8] * oz;
          dyn[o + 6] = A.x[0]; dyn[o + 7] = A.x[1]; dyn[o + 8] = A.x[2];
        } else {
          dyn[o] = hole[0]; dyn[o + 1] = hole[1]; dyn[o + 2] = hole[2];
          dyn[o + 6] = hole[0]; dyn[o + 7] = hole[1]; dyn[o + 8] = hole[2];
        }
        dyn[o + 9] = A.r;
      } else {
        const i4 = 4 * v;
        const a = 3 * skinIdx[i4], b = 3 * skinIdx[i4 + 1], c = 3 * skinIdx[i4 + 2], d = 3 * skinIdx[i4 + 3];
        const w0 = skinW[i4], w1 = skinW[i4 + 1], w2 = skinW[i4 + 2], w3 = skinW[i4 + 3];
        dyn[o] = x[a] * w0 + x[b] * w1 + x[c] * w2 + x[d] * w3;
        dyn[o + 1] = x[a + 1] * w0 + x[b + 1] * w1 + x[c + 1] * w2 + x[d + 1] * w3;
        dyn[o + 2] = x[a + 2] * w0 + x[b + 2] * w1 + x[c + 2] * w2 + x[d + 2] * w3;
      }
      dyn[o + 3] = 0; dyn[o + 4] = 0; dyn[o + 5] = 0;
    }
    for (let t = 0; t < index.length; t += 3) {
      const a = D * index[t], b = D * index[t + 1], c = D * index[t + 2];
      const e1x = dyn[b] - dyn[a], e1y = dyn[b + 1] - dyn[a + 1], e1z = dyn[b + 2] - dyn[a + 2];
      const e2x = dyn[c] - dyn[a], e2y = dyn[c + 1] - dyn[a + 1], e2z = dyn[c + 2] - dyn[a + 2];
      const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      dyn[a + 3] += nx; dyn[a + 4] += ny; dyn[a + 5] += nz;
      dyn[b + 3] += nx; dyn[b + 4] += ny; dyn[b + 5] += nz;
      dyn[c + 3] += nx; dyn[c + 4] += ny; dyn[c + 5] += nz;
    }
    for (let o = 0; o < dyn.length; o += D) {
      const l = Math.hypot(dyn[o + 3], dyn[o + 4], dyn[o + 5]) || 1;
      dyn[o + 3] /= l; dyn[o + 4] /= l; dyn[o + 5] /= l;
    }
    // one smoothing pass over the jelly's surface and the milky layer: the lattice deforms piecewise-linearly,
    // and without this the studio's reflections pick out every kink between tetrahedra
    nsm.fill(0);
    const smooth = (t0, t1) => {
      for (let t = t0; t < t1; t += 3) {
        const a = index[t], b = index[t + 1], c = index[t + 2];
        const A = D * a, B = D * b, C = D * c;
        const sx = dyn[A + 3] + dyn[B + 3] + dyn[C + 3], sy = dyn[A + 4] + dyn[B + 4] + dyn[C + 4], sz = dyn[A + 5] + dyn[B + 5] + dyn[C + 5];
        nsm[3 * a] += sx; nsm[3 * a + 1] += sy; nsm[3 * a + 2] += sz;
        nsm[3 * b] += sx; nsm[3 * b + 1] += sy; nsm[3 * b + 2] += sz;
        nsm[3 * c] += sx; nsm[3 * c + 1] += sy; nsm[3 * c + 2] += sz;
      }
    };
    kLast = -1;
    smooth(0, bodyTriEnd); smooth(coreFirst, coreEnd);
    for (let v = 0; v < kv0; v++) {
      const k = 3 * v, l = Math.hypot(nsm[k], nsm[k + 1], nsm[k + 2]);
      if (l > 1e-9) { dyn[D * v + 3] = nsm[k] / l; dyn[D * v + 4] = nsm[k + 1] / l; dyn[D * v + 5] = nsm[k + 2] / l; }
    }
  }

  // ── camera & framing (keeps the whale clear of the text and panel) ──
  const cam = { viewProj: null, view: null, invViewProj: null, pos: [0, 0, 0], fwd: [0, 0, -1] };
  const target = [0.0, .77, .0];
  const FOV = 27 * Math.PI / 180;
  function safeRect() {
    const cr = canvas.getBoundingClientRect();
    if (document.body.classList.contains('stacked')) return { x: 0, y: 0, w: cr.width, h: cr.height };
    const panel = $('.panel').getBoundingClientRect();
    const head = $('.masthead').getBoundingClientRect();
    const read = $('.readouts').getBoundingClientRect();
    const left = Math.min(head.right-cr.left+16,cr.width*.30);
    const right = panel.left - cr.left - 12;
    const top = Math.min(head.bottom - cr.top, cr.height * 0.34) * 0.5;
    const bottom = read.top - cr.top + 24;
    return { x: left, y: top, w: Math.max(200, right - left), h: Math.max(200, bottom - top) };
  }
  // the camera eases after the whale if it is thrown or dragged far from home (never while holding it)
  const home = target.slice();
  const restC = sim.centroid();
  function followWhale(dt) {
    if (drag.mode === 'grab') return;
    const c = sim.centroid();
    const k = 1 - Math.exp(-dt * 1.4);
    const gx = home[0] + (c[0] - restC[0]) * 0.7, gz = home[2] + (c[2] - restC[2]) * 0.7;
    target[0] += (gx - target[0]) * k; target[2] += (gz - target[2]) * k;
  }
  function updateCamera() {
    const W = renderer.w, H = renderer.h;
    const cr = canvas.getBoundingClientRect();
    const r = safeRect();
    const aspect = W / H;
    const hf = r.h / cr.height, wf = r.w / cr.width;
    // fit the whale, flukes and flippers and all
    const st = document.body.classList.contains('stacked');
    // fit the long body closely: the whale should fill the stage
    const Rh = st ? 1.8 : 1.78, Rv = st ? .95 : .88;
    const t2 = Math.tan(FOV / 2);
    const dist = Math.max(Rv / (t2 * 0.9 * hf), Rh / (t2 * 0.92 * aspect * wf)) * state.zoom;
    const ce = Math.cos(state.el);
    const eye = [target[0] + dist * Math.sin(state.az) * ce, target[1] + dist * Math.sin(state.el), target[2] + dist * Math.cos(state.az) * ce];
    camera.fov = FOV * 180 / Math.PI; camera.aspect = aspect; camera.near = 0.1; camera.far = 80;
    camera.position.set(eye[0], eye[1], eye[2]);
    camera.lookAt(target[0], target[1], target[2]);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    // lens shift so the target lands at the centre of the safe rect
    const cx = (r.x + r.w / 2) / cr.width, cy = (r.y + r.h / 2) / cr.height;
    const pe = camera.projectionMatrix.elements;
    pe[8] -= (cx * 2 - 1); pe[9] -= -(cy * 2 - 1);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    ivp.copy(vp).invert();
    cam.view = camera.matrixWorldInverse.elements; cam.viewProj = vp.elements; cam.invViewProj = ivp.elements;
    cam.pos = eye;
    const f = [target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]];
    const fl = Math.hypot(...f); cam.fwd = f.map(v => v / fl);
  }

  // light rig: key from behind and above the tail (so the flukes and flippers glow toward the camera)
  const keyDir = vnorm([-0.45, 0.86, -0.36]);
  const light = { dir: keyDir, intensity: 2.3, at: [0, 0.3, 0] };
  function updateLight() {
    // shadow and height maps are centred on the whale itself so they never lose it
    const c = sim.centroid();
    light.at = [c[0], 0.3, c[2]];
    light.intensity = 2.3 * (1 - 0.86 * state.dark);
  }

  // ── resize ──
  function resize() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, window.__fixPR || 1.5);
    renderer.resize(r.width * dpr, r.height * dpr, r.width, r.height, dpr);
  }
  const stacked = matchMedia('(max-width: 860px), (max-height: 560px) and (max-width: 1000px)');
  const applyLayout = () => {
    document.body.classList.toggle('stacked', stacked.matches);
    // on a wide screen the whale sits a little left of the panel, so the slanted spout lands in view
    const hx = stacked.matches ? 0.0 : 0.18; target[0] += hx - home[0]; home[0] = hx;
    resize();
  };
  stacked.addEventListener('change', applyLayout);
  applyLayout();
  new ResizeObserver(resize).observe(canvas);

  // ── picking ──
  function rayFrom(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    const nx = ((clientX - r.left) / r.width) * 2 - 1, ny = 1 - ((clientY - r.top) / r.height) * 2;
    const m = cam.invViewProj;
    const un = (x, y, z) => {
      const w = m[3] * x + m[7] * y + m[11] * z + m[15];
      return [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w, (m[2] * x + m[6] * y + m[10] * z + m[14]) / w];
    };
    const a = un(nx, ny, -1), b = un(nx, ny, 1);
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; const l = Math.hypot(...d);
    return { o: a, d: d.map(v => v / l) };
  }
  // nearest hit on the whale's surface: distance along the ray (or Infinity)
  function pickT(ray) {
    let best = Infinity;
    const { o, d } = ray;
    for (let t = 0; t < bodyTriEnd; t += 3) {
      const a = D * index[t], b = D * index[t + 1], c = D * index[t + 2];
      const e1x = dyn[b] - dyn[a], e1y = dyn[b + 1] - dyn[a + 1], e1z = dyn[b + 2] - dyn[a + 2];
      const e2x = dyn[c] - dyn[a], e2y = dyn[c + 1] - dyn[a + 1], e2z = dyn[c + 2] - dyn[a + 2];
      const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-12) continue;
      const inv = 1 / det;
      const tx = o[0] - dyn[a], ty = o[1] - dyn[a + 1], tz = o[2] - dyn[a + 2];
      const uu = (tx * px + ty * py + tz * pz) * inv; if (uu < 0 || uu > 1) continue;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
      const vv = (d[0] * qx + d[1] * qy + d[2] * qz) * inv; if (vv < 0 || uu + vv > 1) continue;
      const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (tt > 1e-4 && tt < best) best = tt;
    }
    return best;
  }
  function pick(ray) { const t = pickT(ray); return t < Infinity ? [ray.o[0] + ray.d[0] * t, ray.o[1] + ray.d[1] * t, ray.o[2] + ray.d[2] * t] : null; }
  // nearest loose drop along the ray (not one hidden behind the whale)
  function pickDrop(ray, bodyT, touch) {
    const { o, d } = ray;
    let best = -1, bt = Infinity;
    for (let i = 0; i < drops.n; i++) {
      const A = drops.list[i]; if (!A.free) continue;
      const cx = A.x[0] - o[0], cy = A.x[1] - o[1], cz = A.x[2] - o[2];
      const tc = cx * d[0] + cy * d[1] + cz * d[2];
      if (tc <= 0) continue;
      const r = A.r * (touch ? 2.6 : 1.8);
      const d2 = cx * cx + cy * cy + cz * cz - tc * tc;
      if (d2 > r * r) continue;
      const t = tc - Math.sqrt(r * r - d2);
      if (t > bodyT + 0.02) continue;
      if (t < bt) { bt = t; best = i; }
    }
    return best;
  }

  // forgiving fallback for grabs that land just outside the rounded silhouette
  function pickNear(clientX, clientY, maxPx) {
    const r = canvas.getBoundingClientRect(), M = cam.viewProj, x = sim.x;
    let best = -1, bd = maxPx * maxPx;
    for (let i = 0; i < sim.n; i++) {
      const X = x[3 * i], Y = x[3 * i + 1], Z = x[3 * i + 2];
      const w = M[3] * X + M[7] * Y + M[11] * Z + M[15];
      const sx = r.left + ((M[0] * X + M[4] * Y + M[8] * Z + M[12]) / w * 0.5 + 0.5) * r.width;
      const sy = r.top + (0.5 - (M[1] * X + M[5] * Y + M[9] * Z + M[13]) / w * 0.5) * r.height;
      const dd = (sx - clientX) ** 2 + (sy - clientY) ** 2 - w * 1e-3; // prefer nearer particles on ties
      if (dd < bd) { bd = dd; best = i; }
    }
    return best < 0 ? null : [x[3 * best], x[3 * best + 1], x[3 * best + 2]];
  }

  // ── pointer interaction ──
  // grab: the jelly · drop: a loose drop, in the hand · orbit: the view
  const drag = { mode: null, id: -1, plane: null, twist: 0, twist0: 0, second: null, lastX: 0, lastY: 0, drop: -1, grabOff: null };
  function rotMat(axis, ang) {
    const [x, y, z] = axis, c = Math.cos(ang), s = Math.sin(ang), t = 1 - c;
    return [t * x * x + c, t * x * y - s * z, t * x * z + s * y,
      t * x * y + s * z, t * y * y + c, t * y * z - s * x,
      t * x * z - s * y, t * y * z + s * x, t * z * z + c];
  }
  function dragTarget(clientX, clientY) {
    const ray = rayFrom(clientX, clientY);
    const { p, n } = drag.plane;
    const den = ray.d[0] * n[0] + ray.d[1] * n[1] + ray.d[2] * n[2];
    if (Math.abs(den) < 1e-5) return null;
    const t = ((p[0] - ray.o[0]) * n[0] + (p[1] - ray.o[1]) * n[1] + (p[2] - ray.o[2]) * n[2]) / den;
    const q = [ray.o[0] + ray.d[0] * t, ray.o[1] + ray.d[1] * t, ray.o[2] + ray.d[2] * t];
    // keep the grab within a generous but finite reach, and above the floor
    const dx = q[0] - target[0], dz = q[2] - target[2], lim = 3.4, dl = Math.hypot(dx, dz);
    if (dl > lim) { q[0] = target[0] + dx / dl * lim; q[2] = target[2] + dz / dl * lim; }
    q[1] = Math.min(Math.max(q[1], 0.02), 3.2);
    return q;
  }
  function applyDrag(x, y) {
    const q = dragTarget(x, y);
    if (!q) return;
    if (drag.mode === 'grab') sim.moveGrab(q, rotMat(cam.fwd, drag.twist));
    else if (drag.mode === 'drop') {
      const A = drops.list[drag.drop], o = drag.grabOff || [0, 0, 0];
      q[0] += o[0]; q[1] += o[1]; q[2] += o[2];
      q[1] = Math.max(q[1], A.r);
      A.target = q;
    }
  }
  // the krill answers a prod with a flicker of light, the nearer the brighter
  const glowP = [0, 0, 0, 0];
  function startle(p, k) {
    if (state.eaten === 0) return;
    const d = Math.hypot(p[0] - glowP[0], p[1] - glowP[1], p[2] - glowP[2]);
    state.flash = Math.min(1.6, state.flash + k / (1 + d * d * 4));
  }
  canvas.addEventListener('pointerdown', e => {
    if (drag.mode === 'grab' && e.pointerId !== drag.id && e.pointerType === 'touch') {
      // second finger twists the grabbed patch
      drag.second = { id: e.pointerId, x: e.clientX, y: e.clientY };
      drag.twist0 = drag.twist - Math.atan2(e.clientY - drag.lastY, e.clientX - drag.lastX);
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* synthetic pointer */ }
      return;
    }
    if (drag.mode) return;
    if (e.button !== undefined && e.button > 0 && e.pointerType === 'mouse') return;
    drag.id = e.pointerId; drag.lastX = e.clientX; drag.lastY = e.clientY;
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* synthetic pointer */ }
    canvas.dataset.cursor = 'grabbing';
    e.preventDefault();
    if (state.paused) { drag.mode = 'orbit'; canvas.dataset.cursor = 'orbit'; return; }
    const ray = rayFrom(e.clientX, e.clientY), bt = pickT(ray);
    const di = pickDrop(ray, bt, e.pointerType === 'touch');
    if (di >= 0) {
      const A = drops.list[di], c = A.x.slice();
      drag.drop = di; drag.mode = 'drop';
      drag.plane = { p: c, n: cam.fwd.slice() };
      const q0 = dragTarget(e.clientX, e.clientY) || c.slice();
      drag.grabOff = [c[0] - q0[0], c[1] - q0[1], c[2] - q0[2]];
      A.held = true; A.target = c; A.sleep = 0;
      return;
    }
    const hit = bt < Infinity ? [ray.o[0] + ray.d[0] * bt, ray.o[1] + ray.d[1] * bt, ray.o[2] + ray.d[2] * bt] : pickNear(e.clientX, e.clientY, e.pointerType === 'touch' ? 34 : 18);
    if (hit) {
      drag.mode = 'grab'; drag.twist = 0;
      drag.plane = { p: hit, n: cam.fwd.slice() };
      sim.beginGrab(hit, 0.36);
      startle(hit, 0.9);
    } else {
      drag.mode = 'orbit';
      canvas.dataset.cursor = 'orbit';
    }
  });
  canvas.addEventListener('pointermove', e => {
    if (drag.second && e.pointerId === drag.second.id) {
      drag.second.x = e.clientX; drag.second.y = e.clientY;
      drag.twist = drag.twist0 + Math.atan2(drag.second.y - drag.lastY, drag.second.x - drag.lastX);
      drag.twist = Math.max(-1.3, Math.min(1.3, drag.twist));
      applyDrag(drag.lastX, drag.lastY);
      return;
    }
    if (e.pointerId !== drag.id || !drag.mode) { hoverX = e.clientX; hoverY = e.clientY; hoverDirty = true; return; }
    const dx = e.clientX - drag.lastX, dy = e.clientY - drag.lastY;
    drag.lastX = e.clientX; drag.lastY = e.clientY;
    if (drag.mode === 'orbit') {
      state.az = state.az - dx * 0.006;
      state.el = Math.max(0.12, Math.min(1.3, state.el + dy * 0.005));
    } else applyDrag(e.clientX, e.clientY);
  });
  const endPointer = e => {
    if (drag.second && e.pointerId === drag.second.id) { drag.second = null; return; }
    if (e.pointerId !== drag.id) return;
    if (drag.mode === 'grab') sim.endGrab();
    if (drag.mode === 'drop') drops.list[drag.drop].held = false;
    drag.mode = null; drag.id = -1; drag.second = null; drag.drop = -1;
    canvas.dataset.cursor = '';
    hoverDirty = true;
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('lostpointercapture', endPointer);
  // wheel: twists the held patch (wherever the pointer is), otherwise zooms when over the stage
  window.addEventListener('wheel', e => {
    if (drag.mode === 'grab') {
      e.preventDefault();
      const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      drag.twist = Math.max(-1.3, Math.min(1.3, drag.twist + d * 0.004));
      applyDrag(drag.lastX, drag.lastY);
    } else if (e.target === canvas) {
      e.preventDefault();
      state.zoom = Math.max(0.6, Math.min(1.7, state.zoom * Math.exp(e.deltaY * 0.001)));
    }
  }, { passive: false });
  canvas.addEventListener('dblclick', () => { state.az = -.08; state.el = .13; state.zoom = 1; });
  let hoverX = 0, hoverY = 0, hoverDirty = false;

  // ── UI ──
  const firm = $('#firmness'), damp = $('#damping');
  const firmOut = $('#firmnessOut'), dampOut = $('#dampingOut');
  const syncSliders = () => {
    sim.firmness = firm.value / 100; sim.damping = damp.value / 100;
    firmOut.textContent = (firm.value / 100).toFixed(2);
    dampOut.textContent = (damp.value / 100).toFixed(2);
  };
  firm.value = Math.round(sim.firmness * 100); damp.value = Math.round(sim.damping * 100);
  firm.addEventListener('input', syncSliders); damp.addEventListener('input', syncSliders);
  syncSliders();

  // ── the spout ──
  // the axis of each blowhole, from the points that ride the jelly: straight up out of the top of the head —
  // the blue whale's blow is a tall, slim column, two jets side by side
  const tmpB = [0, 0, 0], tmpC = [0, 0, 0];
  function blowDir(side) {
    anchor(side ? A_BR : A_BL, tmpB); anchor(A_UNDER, tmpC);
    const d = [tmpB[0] - tmpC[0], tmpB[1] - tmpC[1], tmpB[2] - tmpC[2]], l = Math.hypot(...d) || 1;
    return d.map(v => v / l);
  }
  const spout = { queue: 0, side: 0 };
  let spouts = 0;
  function blow() {
    if (state.paused) return;
    spout.queue = Math.min(spout.queue + 32, 64);
    spouts++;
    // the whale exhales: the crown of its head dips as the drops leave, and springs back
    const c = anchor(A_BL, [0, 0, 0]), n = blowDir(0), R2 = 0.2, k = reduced.matches ? 0.5 : 1;
    for (let i = 0; i < sim.n; i++) {
      const dx = sim.x[3 * i] - c[0], dy = sim.x[3 * i + 1] - c[1], dz = sim.x[3 * i + 2] - c[2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < R2) { const f = 1.2 * k * (1 - d2 / R2); sim.v[3 * i] -= n[0] * f; sim.v[3 * i + 1] -= n[1] * f; sim.v[3 * i + 2] -= n[2] * f; }
    }
    startle(c, 0.3);
  }
  function emitDrop() {
    const L = drops.list;
    let i = L.findIndex(A => A.hidden);
    if (i < 0) {
      // all out: take back the one that has lain still on the table the longest
      let bs = -1;
      L.forEach((A, k) => { if (A.free && !A.held && A.sleep > 0.6 && A.age > bs) { bs = A.age; i = k; } });
    }
    if (i < 0) return false;
    const side = spout.side ^= 1;
    const p = anchor(side ? A_BR : A_BL, [0, 0, 0]), n = blowDir(side);
    let t1 = Math.abs(n[1]) < 0.9 ? [n[2], 0, -n[0]] : [0, -n[2], n[1]];
    { const l = Math.hypot(...t1); t1 = t1.map(v => v / l); }
    const t2 = [n[1] * t1[2] - n[2] * t1[1], n[2] * t1[0] - n[0] * t1[2], n[0] * t1[1] - n[1] * t1[0]];
    // a tall slim column: a narrow cone about the blowhole's axis, leaning a little out to its own side
    const spread = 0.03 + 0.15 * Math.random() ** 1.5, a = Math.random() * 2 * Math.PI, lean = side ? -0.06 : 0.06;
    const d = [0, 1, 2].map(k => n[k] + (t1[k] * Math.cos(a) + t2[k] * Math.sin(a)) * spread + (k === 2 ? lean : 0));
    const dl = Math.hypot(...d);
    const sp = (4.6 - 2.6 * spread) * (0.82 + 0.26 * Math.random()) * (reduced.matches ? 0.75 : 1);
    const vb = anchorVel(side ? A_BR : A_BL);
    const sw = 12;
    drops.release(i, [p[0] + n[0] * 0.03, p[1] + n[1] * 0.03, p[2] + n[2] * 0.03], d.map((v, k) => v / dl * sp + vb[k]),
      [(Math.random() - 0.5) * sw, (Math.random() - 0.5) * sw, (Math.random() - 0.5) * sw]);
    return true;
  }

  // ── the gulp: the throat balloons, a swarm of krill is drawn in at the mouth and swirls in the pouch; then the
  //    pouch slowly empties (the water strained out through the baleen) and the krill is carried back to the stomach ──
  const GULP_IN = 0.55, GULP_HOLD = 1.5, GULP_OUT = 2.8, BATCH = 32;
  const pouchAt = t => t < 0 ? 0 : t < GULP_IN ? 1 - (1 - t / GULP_IN) ** 3 : t < GULP_IN + GULP_HOLD ? 1 : 1 - sstep(GULP_IN + GULP_HOLD, GULP_IN + GULP_HOLD + GULP_OUT, t);
  function gulp(){if(state.paused)return;for(let i=0;i<sim.n;i++){const x=sim.rest[3*i];sim.v[3*i+1]+=Math.sin(x*2.0)*.7;sim.v[3*i+2]+=.25*Math.cos(x*2.0);}}
  function stepKrill(h) {
    if (state.gulp < 0) return;
    state.gulp += h;
    const t = state.gulp, swirl = Math.sin(t * 3.0);
    const inPouch = 3 / (KRILL_PATH - 1);
    for (const K of kState) {
      if (K.t < 0 || K.t >= 1) continue;
      if (t < K.t0) { K.t = 0; K.grow = 0; continue; }
      K.grow = Math.min(1, K.grow + h * 6);
      if (t < K.t1) K.t = inPouch * sstep(K.t0, K.t1, t);
      else if (t < K.u0) K.t = inPouch * (1 + 0.04 * swirl);
      else K.t = Math.min(1, inPouch + (1 - inPouch) * sstep(K.u0, K.u1, t));
    }
    if (t > GULP_IN + GULP_HOLD + GULP_OUT + 2.6) state.gulp = -1;
  }

  $('#blow').addEventListener('click', blow);
  $('#gulp').addEventListener('click', gulp);
  $('#reset').addEventListener('click', () => {
    if (drag.mode === 'grab') sim.endGrab();
    drag.mode = null; drag.drop = -1;
    sim.inflate(0); sim.reset(reduced.matches ? 0 : 0.35); drops.reset(); spout.queue = 0; acc = 0;
    for (const K of kState) { K.t = -1; K.grow = 0; }
    state.gulp = -1; state.eaten = 0; state.gulps = 0;
  });
  $('#slow').addEventListener('change', e => { state.slow = e.target.checked; });
  $('#mesh').addEventListener('change', e => { state.showMesh = e.target.checked; });
  const pauseBtn = $('#pause');
  pauseBtn.addEventListener('click', () => {
    state.paused = !state.paused;
    if (state.paused && drag.mode === 'grab') { sim.endGrab(); drag.mode = null; }
    if (state.paused && drag.mode === 'drop') { drops.list[drag.drop].held = false; drag.mode = null; }
    pauseBtn.textContent = state.paused ? 'Resume' : 'Pause';
    pauseBtn.setAttribute('aria-pressed', String(state.paused));
    setStatus(state.paused ? 'THREE.JS · PAUSED' : 'THREE.JS · LIVE', state.paused ? 'paused' : 'live');
  });
  // the lights: out, the room goes dark and the krill the whale has eaten is the only light left
  const lightsBtn = $('#lights');
  function setLights(out) {
    state.lightsOut = out;
    document.body.classList.toggle('lights-out', out);
    lightsBtn.textContent = out ? 'Lights on' : 'Lights out';
    lightsBtn.setAttribute('aria-pressed', String(out));
  }
  lightsBtn.addEventListener('click', () => setLights(!state.lightsOut));
  window.addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('input, button, summary')) return;
    if (e.key === ' ') { e.preventDefault(); pauseBtn.click(); }
    if (e.key === 'b' || e.key === 'B' || e.key === 'n' || e.key === 'N') $('#blow').click();
    if (e.key === 'g' || e.key === 'G') $('#gulp').click();
    if (e.key === 'r' || e.key === 'R') $('#reset').click();
    if (e.key === 'l' || e.key === 'L') lightsBtn.click();
  });

  $('#nParticles').textContent = sim.n.toLocaleString('en');
  $('#nTets').textContent = sim.nT.toLocaleString('en');
  $('#nBubbles').textContent = String(renderMesh.bubbleCount);
  $('#nBaleen').textContent = String(renderMesh.baleenCount);
  $('#nKrill').textContent = String(KRILL_N);
  const massOut = $('#massOut'), volOut = $('#volOut'), lenOut = $('#lenOut'), krillOut = $('#krillOut');
  // the mass from the volume enclosed by the jelly's surface (divergence theorem over its triangles)
  let encl = 0;
  { const p = renderMesh.rest; for (let t = 0; t < bodyTriEnd; t += 3) { const a = 3 * index[t], b = 3 * index[t + 1], c = 3 * index[t + 2];
    encl += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6; } }
  massOut.textContent = (Math.abs(encl) * SCALE_CM ** 3 * DENSITY).toFixed(1);
  const tS = [0, 0, 0], tF = [0, 0, 0];
  function updateReadouts() {
    volOut.textContent = (sim.volumeRatio() * sim.totalRestVolume / vol0 * 100).toFixed(1);
    anchor(A_SNOUT, tS); anchor(A_NOTCH, tF);
    lenOut.textContent = (Math.hypot(tS[0] - tF[0], tS[1] - tF[1], tS[2] - tF[2]) * SCALE_CM).toFixed(1);
    krillOut.textContent = String(drops.freeCount);
  }

  // keep loose drops on a table of finite size (a soft lip round the edge of the view)
  function corral() {
    for (const A of drops.list) {
      if (!A.free || A.held) continue;
      const dx = A.x[0] - home[0], dz = A.x[2] - home[2], d = Math.hypot(dx, dz), lim = 3.1;
      if (d > lim) { A.x[0] = home[0] + dx / d * lim; A.x[2] = home[2] + dz / d * lim; const vn = (A.v[0] * dx + A.v[2] * dz) / d; if (vn > 0) { A.v[0] -= 1.5 * vn * dx / d; A.v[2] -= 1.5 * vn * dz / d; } }
    }
  }

  // expose a small hook for automated checks
  window.__nailong = { sim, drops, state, cam, pick, pickT, pickDrop, rayFrom, renderer, blow, gulp, anchor, dyn, drag, renderMesh, setLights, kState, get fps() { return fps; }, get stepMs() { return stepAvg; }, get spouts() { return spouts; } };

  // one fixed step of everything: the throat, the jelly, the krill, the spout, the loose drops
  function fixedStep() {
    stepKrill(sim.stepDt);
    state.pouch = pouchAt(state.gulp);
    sim.inflate(state.pouch);
    sim.step();
    for (let k = 0; k < 2 && spout.queue > 0; k++) { if (emitDrop()) spout.queue--; else spout.queue = 0; }
    if (drops.freeCount) { drops.step(sim.stepDt); corral(); }
  }
  window.__nailong.advance = n => { for (let i = 0; i < n; i++) fixedStep(); };

  // ── loop ──
  sim.reset(reduced.matches ? 0 : 0.35);
  let last = performance.now(), fpsStart = last, acc = 0, readoutT = 0, fps = 60, frames = 0, fpsT = 0, first = true, stepAvg = 4;
  skin();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (!state.paused) {
      acc += dt * (state.slow ? 0.25 : 1);
      let steps = 0;
      while (acc >= sim.stepDt && steps < 3) {
        const t0 = performance.now();
        fixedStep();
        acc -= sim.stepDt; steps++;
        stepAvg += (performance.now() - t0 - stepAvg) * 0.05;
      }
      // a slow device: trade a few substeps for a steady frame rate (once)
      if (stepAvg > 11 && sim.substeps > 7 && state.time > 2) sim.substeps = 7;
      if (steps === 3) acc = Math.min(acc, sim.stepDt);
      state.time += dt;
    }
    // the room's lights ease in and out; startled krill flicker and fade
    const goal = state.lightsOut ? 1 : 0;
    state.dark += (goal - state.dark) * (1 - Math.exp(-dt * (reduced.matches ? 20 : 3.2)));
    if (Math.abs(goal - state.dark) < 1e-3) state.dark = goal;
    state.flash *= Math.exp(-dt * 1.6);
    skin();
    followWhale(dt);
    updateCamera();
    updateLight();
    if (hoverDirty && !drag.mode) {
      hoverDirty = false;
      if (state.paused) canvas.dataset.cursor = '';
      else {
        const ray = rayFrom(hoverX, hoverY), bt = pickT(ray);
        canvas.dataset.cursor = (pickDrop(ray, bt, false) >= 0 || bt < Infinity || pickNear(hoverX, hoverY, 18)) ? 'grab' : '';
      }
    }
    const P = PALETTES[currentPalette];
    // the krill's light: from the middle of the eaten swarm, as bright as there is krill to give it
    let n = 0; glowP[0] = 0; glowP[1] = 0; glowP[2] = 0;
    for (let i = 0; i < kState.length; i += 3) if (kState[i].t >= 0 && kState[i].grow > 0.5) { krillAt(i, kState[i].t, kp); glowP[0] += kp[0]; glowP[1] += kp[1]; glowP[2] += kp[2]; n++; }
    if (n) { glowP[0] /= n; glowP[1] /= n; glowP[2] /= n; } else anchor(A_HEAD, glowP);
    const breathe = reduced.matches ? 0 : 0.1 * Math.sin(state.time * 1.7) + 0.05 * Math.sin(state.time * 4.3 + 1.0);
    const amount = Math.min(1, state.eaten / 40);
    glowP[3] = amount * ((0.25 + 1.9 * state.dark) * (1 + breathe) + state.flash * (0.6 + 1.4 * state.dark));
    renderer.setUniforms(cam, light, P, {
      time: state.time, exposure: 1.0, meshAlpha: state.showMesh ? 0.32 : 0,
      bg: lerp3(BG_ON, BG_OFF, state.dark), dark: state.dark, glowP, glowC: P.glow,
    });
    renderer.uploadGeometry(sim.x, state.showMesh);
    renderer.draw(state.showMesh);
    if (first) { first = false; setStatus('THREE.JS · LIVE', 'live'); document.body.classList.add('ready'); }
    readoutT += dt; frames++; fpsT += dt;
    if (fpsT > 0.5) { fps = frames / ((now - fpsStart) / 1000); frames = 0; fpsT = 0; fpsStart = now; }
    if (readoutT > 0.12) { readoutT = 0; updateReadouts(); }
    if (!renderer.lost) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

main().catch(err => { console.error(err); showFallback('Something went wrong while starting.', String(err && err.message || err)); });

