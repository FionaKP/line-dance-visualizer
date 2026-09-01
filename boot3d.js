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
// Styling is role-based (vamp / shaft / collar / sole / opening), so a boot
// is recolored by config alone. Future decorative detail (western stitching,
// piping, pull straps) should be added as either extra mesh faces with new
// roles, or as a post-sort overlay pass that draws stroked paths in screen
// space on top of specific faces — renderBoot3D returns the sorted faces
// (with their roles and screen points) to make that overlay pass possible.

function buildBootMesh() {
  const faces = [];
  // sole wedge: the sole line rises from the toe toward the heel like a
  // real western boot, so the heel block stands on the floor
  const soleZ = x => x <= -8 ? 3 : Math.max(0, 3 * (2 - x) / 10);
  // foot/vamp: cross-section rings along the sole — [x, half-width, height]
  const sect = [
    [-15, 6.5, 9], [-7, 7.5, 11], [1, 7.5, 8.5], [9, 8, 7.5], [17, 6.8, 5.5], [26, 3.2, 2.5]
  ];
  const ring = ([x, w, h]) => {
    const z = soleZ(x);
    return [[x, -w, z], [x, w, z], [x, w * 0.72, z + h], [x, -w * 0.72, z + h]];
  };
  for (let i = 0; i < sect.length - 1; i++) {
    const a = ring(sect[i]), b = ring(sect[i + 1]);
    for (let e = 0; e < 4; e++) {
      const f = (e + 1) % 4;
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
  // shaft: elliptical tube from the ankle up; the collar's top edge dips at
  // the front (and slightly at the back) like a classic western V-cut
  const cx = -6.5, N = 10, z0 = 12, zCollar = 27, z1 = 34;
  const topDip = t => 4.5 * Math.pow(Math.max(0, Math.cos(t)), 2)
                    + 2 * Math.pow(Math.max(0, -Math.cos(t)), 2);
  const circ = (z, rx, ry, dip) => Array.from({ length: N }, (_, i) => {
    const t = (i + 0.5) / N * 2 * Math.PI;
    return [cx + Math.cos(t) * rx, Math.sin(t) * ry, z - (dip ? topDip(t) : 0)];
  });
  const lo = circ(z0, 8.4, 7.4), mid = circ(zCollar, 7.3, 6.3), hi = circ(z1, 7.5, 6.5, true);
  const tube = (A, B, role) => {
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      faces.push({ pts: [A[i], A[j], B[j], B[i]], role });
    }
  };
  tube(lo, mid, "shaft");
  tube(mid, hi, "collar");
  faces.push({ pts: hi.slice().reverse(), role: "opening" });
  return faces;
}

const BOOT_LIGHT = [-0.45, -0.35, 0.82]; // upper-left key light
const BOOT_CENTER = [1, 0, 12];          // for orienting face normals outward

function bootShade(rgb, b) {
  return "rgb(" + rgb.map(c => Math.max(0, Math.min(255, Math.round(c * b)))).join(",") + ")";
}

// pose: {sx, sy, yaw, liftPx, scale, tiltK, sinTilt,
//        colors: {vamp, shaft, collar, sole, opening} as [r,g,b]}
// Returns the painter-sorted faces ({role, pts}) for future overlay passes.
function renderBoot3D(el, mesh, pose) {
  const NS = "http://www.w3.org/2000/svg";
  while (el.childNodes.length < mesh.length) {
    const p = document.createElementNS(NS, "path");
    p.setAttribute("stroke", "rgba(12,14,20,0.45)");
    p.setAttribute("stroke-width", "0.5");
    el.appendChild(p);
  }
  const rad = pose.yaw * Math.PI / 180;
  const cosA = Math.cos(rad), sinA = Math.sin(rad);
  const S = pose.scale;
  const rot3 = ([lx, ly, lz]) => {
    const gx = -ly, gy = -lx;                 // foot-local → glyph frame (toe = -y)
    return [gx * cosA - gy * sinA, gx * sinA + gy * cosA, lz];
  };
  const ctr = rot3(BOOT_CENTER);
  const out = [];
  for (const f of mesh) {
    const r = f.pts.map(rot3);
    let depth = 0, mx = 0, my = 0, mz = 0;
    const pts = r.map(([rx, ry, rz]) => {
      depth += ry * pose.sinTilt + rz * pose.tiltK;
      mx += rx; my += ry; mz += rz;
      return [pose.sx + rx * S,
              pose.sy - pose.liftPx + (ry * pose.tiltK - rz * pose.sinTilt) * S];
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
    out.push({ role: f.role, pts, depth: depth / n, fill: bootShade(pose.colors[f.role], lum) });
  }
  out.sort((a, b) => a.depth - b.depth); // far faces first
  for (let i = 0; i < out.length; i++) {
    const p = el.childNodes[i];
    p.setAttribute("d", "M" + out[i].pts.map(q => q[0].toFixed(1) + "," + q[1].toFixed(1)).join("L") + "Z");
    p.setAttribute("fill", out[i].fill);
  }
  return out;
}
