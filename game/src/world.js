// The Cold Yard: an original container-yard map built from boxes. One list of solids
// drives everything — the meshes the player sees, the AABBs movement collides with,
// the ray tests bullets and bot vision use, and the waypoint graph bots walk — so the
// picture and the simulation can never disagree about where a wall is.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// A solid is an axis-aligned box: centre x/z, size w/d, height h, standing on the ground.
const SOLIDS = [
  // Perimeter walls (the yard fence line), height 4.
  { x: 0, z: -33, w: 68, d: 1, h: 4 }, { x: 0, z: 33, w: 68, d: 1, h: 4 },
  { x: -33, z: 0, w: 1, d: 68, h: 4 }, { x: 33, z: 0, w: 1, d: 68, h: 4 },

  // A site (west): a ring of containers with two entrances, a crane overhead.
  { x: -21, z: -24.5, w: 13, d: 2.4, h: 2.6, c: 'B' }, { x: -26.5, z: -18, w: 2.4, d: 11, h: 2.6, c: 'A' },
  { x: -15.5, z: -18, w: 2.4, d: 11, h: 2.6, c: 'D' }, { x: -21, z: -12.5, w: 5, d: 2.4, h: 2.6, c: 'C' },
  { x: -24, z: -19, w: 4.4, d: 2.2, h: 2.6, c: 'A', stack: true }, // stacked pair inside A

  // B site (east): depot sheds and a container cross.
  { x: 21, z: -25, w: 12, d: 2.4, h: 2.6, c: 'D' }, { x: 26.5, z: -19, w: 2.4, d: 10, h: 2.6, c: 'B' },
  { x: 15.5, z: -19, w: 2.4, d: 10, h: 2.6, c: 'A' }, { x: 21, z: -13.5, w: 5, d: 2.4, h: 2.6, c: 'C' },
  { x: 21, z: -19.5, w: 6, d: 2.2, h: 1.3, c: 'crate' }, // low depot crates: cover you can shoot over

  // Mid: two container rows with a cross gap at z = 2, so mid can be split or crossed.
  { x: -7.5, z: -8, w: 2.4, d: 18, h: 2.6, c: 'A' }, { x: 7.5, z: -8, w: 2.4, d: 18, h: 2.6, c: 'B' },
  { x: -7.5, z: 12, w: 2.4, d: 14, h: 2.6, c: 'D' }, { x: 7.5, z: 12, w: 2.4, d: 14, h: 2.6, c: 'C' },
  { x: 0, z: -20, w: 6, d: 2.2, h: 1.3, c: 'crate' }, // mid-top crates

  // A lane (west approach): staggered containers making three corners to clear.
  { x: -17, z: 6, w: 10, d: 2.4, h: 2.6, c: 'B' }, { x: -22, z: -2, w: 2.4, d: 9, h: 2.6, c: 'C' },
  { x: -13, z: -4, w: 2.4, d: 8, h: 2.6, c: 'A' }, { x: -18, z: 16, w: 2.4, d: 8, h: 2.6, c: 'D' },

  // B lane (east approach): mirrored rhythm, different cover.
  { x: 17, z: 6, w: 10, d: 2.4, h: 2.6, c: 'A' }, { x: 22, z: -2, w: 2.4, d: 9, h: 2.6, c: 'D' },
  { x: 13, z: -4, w: 2.4, d: 8, h: 2.6, c: 'B' }, { x: 18, z: 16, w: 2.4, d: 8, h: 2.6, c: 'C' },

  // Spawn yards: low cover so neither spawn is a shooting gallery.
  { x: -8, z: 26, w: 5, d: 2.2, h: 1.3, c: 'crate' }, { x: 8, z: 26, w: 5, d: 2.2, h: 1.3, c: 'crate' },
  { x: -8, z: -27, w: 5, d: 2.2, h: 1.3, c: 'crate' }, { x: 8, z: -27, w: 5, d: 2.2, h: 1.3, c: 'crate' },
  { x: 0, z: 20, w: 4.4, d: 2.2, h: 2.6, c: 'C' }, { x: 0, z: -27.5, w: 4.4, d: 2.2, h: 2.6, c: 'B' },
];

// Sites: the charge can be planted anywhere inside the circle.
export const SITES = [
  { id: 0, label: 'A', x: -21, z: -18.5, r: 5.5 },
  { id: 1, label: 'B', x: 21, z: -19, r: 5.5 },
];

// Spawn points per team (team 0 defends the north, team 1 attacks from the south).
export const SPAWNS = [
  [[-4, -29], [-2, -29.5], [0, -29], [2, -29.5], [4, -29]],
  [[-4, 29], [-2, 29.5], [0, 29], [2, 29.5], [4, 29]],
];

// Waypoint graph for bot navigation: nodes at lane junctions and site mouths, edges
// only where a walker has a clear run. Bots path over this with breadth-first search.
export const WAYPOINTS = [
  [-14, 24], [0, 24], [14, 24],            // 0-2   attacker spawn exits
  [-16, 11], [0, 12], [16, 11],            // 3-5   lane mouths, south
  [-18, 0], [0, 2], [18, 0],               // 6-8   lane middles / mid cross gap
  [-16, -7], [0, -10], [16, -7],           // 9-11  lane tops / mid
  [-21, -8], [0, -16], [21, -8],           // 12-14 site approaches / mid top
  [-21, -18.5], [21, -19],                 // 15-16 the sites themselves
  [-12, -24], [0, -23], [12, -24],         // 17-19 defender spawn exits
  [-10, -12], [10, -12],                   // 20-21 top connectors
  [-11, 3], [11, 3],                       // 22-23 lower connectors (the z=1..5 corridor)
];
export const WAYPOINT_EDGES = [
  [0, 3], [0, 4], [1, 4], [2, 5], [2, 4],
  [3, 6], [3, 22], [4, 7], [5, 8], [5, 23],
  [6, 9], [6, 22], [7, 10], [7, 22], [7, 23], [8, 11], [8, 23],
  [9, 12], [9, 20], [10, 13], [10, 20], [10, 21], [11, 14], [11, 21],
  [12, 15], [13, 17], [13, 18], [13, 19], [13, 20], [13, 21], [14, 16],
  [15, 17], [16, 19], [17, 18], [18, 19], [20, 15], [21, 16], [22, 23],
];

const colliders = SOLIDS.map((s) => ({
  x0: s.x - s.w / 2, x1: s.x + s.w / 2, z0: s.z - s.d / 2, z1: s.z + s.d / 2, h: s.h,
}));

export function buildWorld(scene) {
  const mats = {
    A: new THREE.MeshLambertMaterial({ color: PALETTE.containerA }),
    B: new THREE.MeshLambertMaterial({ color: PALETTE.containerB }),
    C: new THREE.MeshLambertMaterial({ color: PALETTE.containerC }),
    D: new THREE.MeshLambertMaterial({ color: PALETTE.containerD }),
    crate: new THREE.MeshLambertMaterial({ color: PALETTE.crate }),
    wall: new THREE.MeshLambertMaterial({ color: PALETTE.darkSteel }),
  };
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  for (const s of SOLIDS) {
    const isWall = s.h === 4 && s.c === undefined;
    const mesh = new THREE.Mesh(boxGeo, isWall ? mats.wall : mats[s.c ?? 'A']);
    mesh.position.set(s.x, s.h / 2, s.z);
    mesh.scale.set(s.w, s.h, s.d);
    mesh.castShadow = !isWall;
    mesh.receiveShadow = true;
    scene.add(mesh);
    if (s.stack) {
      const top = new THREE.Mesh(boxGeo, mats[s.c]);
      top.position.set(s.x, s.h + s.h / 2, s.z);
      top.scale.set(s.w, s.h, s.d);
      top.castShadow = true;
      scene.add(top);
    }
  }

  // Ground: one canvas texture — asphalt, lane paint, site circles and letters.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 90),
    new THREE.MeshLambertMaterial({ map: groundTexture() }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  buildCrane(scene);
  buildLamps(scene);
  return { colliders };
}

function groundTexture() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 1024;
  const g = c.getContext('2d');
  const px = (v) => ((v + 45) / 90) * 1024; // world metres -> canvas pixels
  g.fillStyle = '#3a4149';
  g.fillRect(0, 0, 1024, 1024);
  // Asphalt noise.
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.05)';
    g.fillRect(Math.random() * 1024, Math.random() * 1024, 3, 3);
  }
  // Lane paint.
  g.strokeStyle = 'rgba(216,177,58,0.55)';
  g.lineWidth = 3;
  g.setLineDash([18, 14]);
  g.beginPath(); g.moveTo(px(0), px(-32)); g.lineTo(px(0), px(32)); g.stroke();
  g.beginPath(); g.moveTo(px(-28), px(2)); g.lineTo(px(28), px(2)); g.stroke();
  g.setLineDash([]);
  // Sites.
  for (const site of SITES) {
    g.strokeStyle = 'rgba(216,177,58,0.9)';
    g.lineWidth = 5;
    g.beginPath();
    g.arc(px(site.x), px(site.z), (site.r / 90) * 1024, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = 'rgba(216,177,58,0.85)';
    g.font = 'bold 64px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(site.label, px(site.x), px(site.z));
  }
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildCrane(scene) {
  const steel = new THREE.MeshLambertMaterial({ color: PALETTE.darkSteel });
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const parts = [
    { x: -27, z: -18, w: 1.2, h: 13, d: 1.2 }, { x: -15, z: -18, w: 1.2, h: 13, d: 1.2 },
    { x: -21, z: -18, w: 14, h: 1.4, d: 1.6, y: 13 }, { x: -21, z: -18, w: 3, h: 2.2, d: 2.4, y: 10.6 },
  ];
  for (const p of parts) {
    const m = new THREE.Mesh(geo, steel);
    m.position.set(p.x, p.y ?? p.h / 2, p.z);
    m.scale.set(p.w, p.h, p.d);
    scene.add(m);
  }
  // A container hanging over A site: the yard is mid-shift.
  const hanging = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: PALETTE.containerD }));
  hanging.position.set(-21, 8.2, -18);
  hanging.scale.set(6, 2.6, 2.4);
  hanging.castShadow = true;
  scene.add(hanging);
}

function buildLamps(scene) {
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 6, 6);
  const poleMat = new THREE.MeshLambertMaterial({ color: PALETTE.darkSteel });
  const headMat = new THREE.MeshBasicMaterial({ color: PALETTE.lamp });
  const spots = [[-12, 8], [12, 8], [-12, -14], [12, -14], [0, -2]];
  for (const [x, z] of spots) {
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(x, 3, z);
    scene.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.18, 0.4), headMat);
    head.position.set(x, 6.05, z);
    scene.add(head);
  }
  // Two real point lights only (the rest is faked by the emissive heads and the
  // directional light): enough to warm mid and the A approach without costing frames.
  for (const [x, z] of [[0, -2], [-12, -14]]) {
    const light = new THREE.PointLight(PALETTE.lampGlow, 60, 30, 1.8);
    light.position.set(x, 5.8, z);
    scene.add(light);
  }
}

// --- Collision and sight queries over the solids list -----------------------

// Move a circle (x, z, radius r) against every solid, axis by axis; returns the
// corrected position. Used identically by the player and the bots.
export function collideMove(x, z, r, dx, dz) {
  let nx = x + dx;
  for (const b of colliders) {
    if (nx + r > b.x0 && nx - r < b.x1 && z + r > b.z0 && z - r < b.z1) {
      nx = dx > 0 ? b.x0 - r : b.x1 + r;
    }
  }
  let nz = z + dz;
  for (const b of colliders) {
    if (nx + r > b.x0 && nx - r < b.x1 && nz + r > b.z0 && nz - r < b.z1) {
      nz = dz > 0 ? b.z0 - r : b.z1 + r;
    }
  }
  return { x: nx, z: nz };
}

// Ray vs the world: slab test against each solid (as a 3D box) and the ground plane.
// Returns the nearest distance along the ray, or Infinity. dir must be normalised.
const _box = new THREE.Box3();
const _v = new THREE.Vector3();
export function rayHitWorld(origin, dir, maxDist) {
  let best = maxDist;
  if (dir.y < -1e-6) {
    const t = -origin.y / dir.y;
    if (t > 0 && t < best) best = t;
  }
  for (const b of colliders) {
    _box.min.set(b.x0, 0, b.z0);
    _box.max.set(b.x1, b.h, b.z1);
    _v.copy(dir).multiplyScalar(best);
    // Cheap reject: only test boxes the ray can reach within the current best.
    if (_box.distanceToPoint(origin) > best) continue;
    const hit = rayBox(origin, dir, b);
    if (hit !== null && hit < best) best = hit;
  }
  return best;
}

function rayBox(o, d, b) {
  let tmin = 0;
  let tmax = Infinity;
  const axes = [
    [o.x, d.x, b.x0, b.x1],
    [o.y, d.y, 0, b.h],
    [o.z, d.z, b.z0, b.z1],
  ];
  for (const [oo, dd, lo, hi] of axes) {
    if (Math.abs(dd) < 1e-8) {
      if (oo < lo || oo > hi) return null;
    } else {
      let t1 = (lo - oo) / dd;
      let t2 = (hi - oo) / dd;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}

// Line of sight between two eye-height points: blocked by any solid taller than the
// lower of the two sight lines (crates at 1.3 m hide a croucher, not a stander).
const _origin = new THREE.Vector3();
export function hasLineOfSight(ax, ay, az, bx, by, bz) {
  _v.set(bx - ax, by - ay, bz - az);
  const dist = _v.length();
  if (dist < 1e-4) return true;
  _v.multiplyScalar(1 / dist);
  _origin.set(ax, ay, az);
  const hit = rayHitWorld(_origin, _v, dist);
  return hit >= dist - 0.01;
}
