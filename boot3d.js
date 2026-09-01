"use strict";
// Procedural 3D cowboy boot, rendered as flat-shaded SVG faces.
//
// The mesh is built once in foot-local coordinates (x = toe direction,
// y = dancer's left, z = up, px units at scale 1). Each frame the faces are
// yawed to the foot's screen heading, projected through the app's oblique
// view (tiltK/sinTilt), painter-sorted, and written into a pooled set of
// <path> children — so the boot looks right from every angle the camera or
// the choreography can produce, with no prerendered sprites.
//
// Styling is role-based (vamp / shaft / collar / sole / lining / opening),
// so a boot is recolored by config alone. Decorative western stitching is a
// separate overlay pass: polylines defined on the shaft surface, projected
// with the same math and faded by how much their patch of leather faces the
// camera. More motifs (vamp stitching, piping, pull straps) go in
// buildBootStitches the same way.

function buildBootMesh() {
  const faces = [];
  // sole wedge: the sole line rises from the toe toward the heel like a
  // real western boot, so the heel block stands on the floor
  const soleZ = x => x <= -8 ? 3 : Math.max(0, 3 * (2 - x) / 10);
  // foot/vamp: rounded 7-point cross-sections along the sole
  // [x, half-width, height]
  const sect = [
    [-15, 6.5, 9], [-7, 7.5, 11], [1, 7.5, 8.5], [9, 8, 7.5],
    [16, 7.2, 6], [22, 5.8, 4.2], [27.5, 3, 2.2]
  ];
  const ring = ([x, w, h]) => {
    const z = soleZ(x);
    return [
      [x, -w, z], [x, w, z],
      [x, w * 0.94, z + h * 0.5], [x, w * 0.62, z + h * 0.92],
      [x, 0, z + h],
      [x, -w * 0.62, z + h * 0.92], [x, -w * 0.94, z + h * 0.5]
    ];
  };
  const P = 7;
  for (let i = 0; i < sect.length - 1; i++) {
    const a = ring(sect[i]), b = ring(sect[i + 1]);
    for (let e = 0; e < P; e++) {
      const f = (e + 1) % P;
      faces.push({ pts: [a[e], a[f], b[f], b[e]], role: "vamp" });
    }
  }
  faces.push({ pts: ring(sect[sect.length - 1]).reverse(), role: "vamp" }); // toe cap
  // angled cuban heel: tapers inward toward the floor, undercut at the back
  {
    const top = [[-15, -5.5, 3], [-15, 5.5, 3], [-8, 5.5, 3], [-8, -5.5, 3]];
    const bot = [[-13.6, -4.6, 0], [-13.6, 4.6, 0], [-8.4, 4.6, 0], [-8.4, -4.6, 0]];
    for (let e = 0; e < 4; e++) {
      const f = (e + 1) % 4;
      faces.push({ pts: [top[e], top[f], bot[f], bot[e]], role: "sole" });
    }
    faces.push({ pts: bot, role: "sole" });
    faces.push({ pts: [[-15, -6.5, 3], [-15, 6.5, 3], [-7, 7.5, 3], [-7, -7.5, 3]].reverse(), role: "vamp" }); // heel back cap
  }
  // shaft: a taller elliptical tube from the ankle up; the collar's top edge
  // dips at the front (and slightly at the back) like a classic western V-cut
  const cx = -6.5, N = 12, z0 = 11, zCollar = 31.5, z1 = 40;
  const topDip = t => 5 * Math.pow(Math.max(0, Math.cos(t)), 2)
                    + 2.5 * Math.pow(Math.max(0, -Math.cos(t)), 2);
  const circ = (z, rx, ry, dip) => Array.from({ length: N }, (_, i) => {
    const t = (i + 0.5) / N * 2 * Math.PI;
    return [cx + Math.cos(t) * rx, Math.sin(t) * ry, z - (dip ? topDip(t) : 0)];
  });
  const lo = circ(z0, 8.4, 7.4), mid = circ(zCollar, 7.2, 6.2), hi = circ(z1, 7.5, 6.5, true);
  const tube = (A, B, role) => {
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      faces.push({ pts: [A[i], A[j], B[j], B[i]], role });
    }
  };
  tube(lo, mid, "shaft");
  tube(mid, hi, "collar");
  // hollow opening: rim lip -> inner lining wall descending -> dark floor
  const hin = circ(z1 - 0.6, 6.1, 5.1, true);
  const inn = circ(z1 - 9, 5.7, 4.7);
  tube(hi, hin, "collar");
  tube(hin, inn, "lining");
  faces.push({ pts: inn.slice().reverse(), role: "opening" });
  return faces;
}

// Western stitch motifs on the shaft surface: each is a polyline of
// {p: [x,y,z], n: outward normal} sitting just proud of the leather. Four
// flame crowns, one per quadrant, mid-shaft below the collar.
function buildBootStitches() {
  const cx = -6.5, rx = 7.6, ry = 6.6;
  const motif = t0 =>
    [[-0.5, 16], [-0.3, 24], [-0.14, 18], [0, 27.5], [0.14, 18], [0.3, 24], [0.5, 16]]
      .map(([dt, z]) => {
        const t = t0 + dt;
        return { p: [cx + Math.cos(t) * rx, Math.sin(t) * ry, z],
                 n: [Math.cos(t), Math.sin(t), 0] };
      });
  return [0, Math.PI / 2, Math.PI, -Math.PI / 2].map(motif);
}

const BOOT_LIGHT = [-0.45, -0.35, 0.82]; // upper-left key light
const BOOT_CENTER = [1, 0, 14];          // for orienting face normals outward

function bootShade(rgb, b) {
  return "rgb(" + rgb.map(c => Math.max(0, Math.min(255, Math.round(c * b)))).join(",") + ")";
}

// pose: {sx, sy, yaw, liftPx, scale, tiltK, sinTilt,
//        colors: {vamp, shaft, collar, sole, lining, opening, stitch} as [r,g,b]}
function renderBoot3D(el, mesh, stitches, pose) {
  const NS = "http://www.w3.org/2000/svg";
  let gF = el.firstChild, gS = el.lastChild;
  if (!gF || gF === gS) {
    gF = document.createElementNS(NS, "g");
    gS = document.createElementNS(NS, "g");
    el.appendChild(gF);
    el.appendChild(gS);
  }
  while (gF.childNodes.length < mesh.length) {
    const p = document.createElementNS(NS, "path");
    p.setAttribute("stroke", "rgba(12,14,20,0.45)");
    p.setAttribute("stroke-width", "0.5");
    gF.appendChild(p);
  }
  while (gS.childNodes.length < stitches.length) {
    const p = document.createElementNS(NS, "path");
    p.setAttribute("fill", "none");
    p.setAttribute("stroke-width", "0.9");
    p.setAttribute("stroke-dasharray", "1.6 1.1");
    gS.appendChild(p);
  }
  const rad = pose.yaw * Math.PI / 180;
  const cosA = Math.cos(rad), sinA = Math.sin(rad);
  const S = pose.scale;
  const rot3 = ([lx, ly, lz]) => {
    const gx = -ly, gy = -lx;                 // foot-local → glyph frame (toe = -y)
    return [gx * cosA - gy * sinA, gx * sinA + gy * cosA, lz];
  };
  const proj = ([rx, ry, rz]) =>
    [pose.sx + rx * S,
     pose.sy - pose.liftPx + (ry * pose.tiltK - rz * pose.sinTilt) * S];
  const ctr = rot3(BOOT_CENTER);
  const out = [];
  for (const f of mesh) {
    const r = f.pts.map(rot3);
    let depth = 0, mx = 0, my = 0, mz = 0;
    const pts = r.map(v => {
      depth += v[1] * pose.sinTilt + v[2] * pose.tiltK;
      mx += v[0]; my += v[1]; mz += v[2];
      return proj(v);
    });
    const n = f.pts.length;
    mx /= n; my /= n; mz /= n;
    // flat shading with an outward-oriented face normal
    const [ax, ay, az] = r[0], [bx, by, bz] = r[1], [cx2, cy2, cz2] = r[2];
    let nx = (by - ay) * (cz2 - az) - (bz - az) * (cy2 - ay);
    let ny = (bz - az) * (cx2 - ax) - (bx - ax) * (cz2 - az);
    let nz = (bx - ax) * (cy2 - ay) - (by - ay) * (cx2 - ax);
    if (nx * (mx - ctr[0]) + ny * (my - ctr[1]) + nz * (mz - ctr[2]) < 0) {
      nx = -nx; ny = -ny; nz = -nz;
    }
    const nl = Math.hypot(nx, ny, nz) || 1;
    const lum = 0.55 + 0.55 * Math.max(0,
      (nx * BOOT_LIGHT[0] + ny * BOOT_LIGHT[1] + nz * BOOT_LIGHT[2]) / nl);
    out.push({ pts, depth: depth / n, fill: bootShade(pose.colors[f.role], lum) });
  }
  out.sort((a, b) => a.depth - b.depth); // far faces first
  for (let i = 0; i < out.length; i++) {
    const p = gF.childNodes[i];
    p.setAttribute("d", "M" + out[i].pts.map(q => q[0].toFixed(1) + "," + q[1].toFixed(1)).join("L") + "Z");
    p.setAttribute("fill", out[i].fill);
  }
  // stitching overlay: drawn on top, faded by how much its patch of leather
  // faces the camera (view vector in the rotated frame is (0, sinT, cosT))
  const stitchColor = "rgb(" + pose.colors.stitch.join(",") + ")";
  for (let s = 0; s < stitches.length; s++) {
    const path = gS.childNodes[s];
    const poly = stitches[s];
    let face = 0;
    const d = poly.map((pt, i) => {
      const rn = rot3(pt.n);
      face += rn[1] * pose.sinTilt + rn[2] * pose.tiltK;
      const [px, py] = proj(rot3(pt.p));
      return (i ? "L" : "M") + px.toFixed(1) + "," + py.toFixed(1);
    }).join("");
    face /= poly.length;
    path.setAttribute("d", d);
    path.setAttribute("stroke", stitchColor);
    path.setAttribute("opacity", Math.max(0, Math.min(1, face * 1.4)) * 0.55);
  }
}
