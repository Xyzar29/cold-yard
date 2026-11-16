// Weapons for COLD YARD: data first, then the per-fighter gun state (magazine, bloom,
// recoil, reload) and the viewmodel the player sees. Accuracy is the game's core
// promise: spread grows with movement, airtime and sustained fire, and shrinks to a
// point when you stop, crouch and tap — stopping to aim pays.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  p9: {
    id: 'p9', name: 'P9 Sidearm', kind: 'pistol', slot: 'sidearm', price: 0,
    damage: 34, headMult: 3.4, rpm: 380, auto: false, mag: 12, reserve: 48,
    reloadS: 1.5, spread: 0.006, moveSpread: 0.035, bloomPerShot: 0.004, bloomMax: 0.02,
    recoil: 0.011, falloffFrom: 18, pellets: 1, sound: 'pistol', zoom: 1.0,
  },
  raptor: {
    id: 'raptor', name: 'Raptor-9 SMG', kind: 'smg', slot: 'primary', price: 1100,
    damage: 26, headMult: 3.0, rpm: 780, auto: true, mag: 32, reserve: 96,
    reloadS: 2.1, spread: 0.011, moveSpread: 0.03, bloomPerShot: 0.005, bloomMax: 0.032,
    recoil: 0.008, falloffFrom: 14, pellets: 1, sound: 'smg', zoom: 1.0,
  },
  s12: {
    id: 's12', name: 'S12 Scatter', kind: 'shotgun', slot: 'primary', price: 1500,
    damage: 11, headMult: 2.2, rpm: 75, auto: false, mag: 6, reserve: 24,
    reloadS: 2.8, spread: 0.045, moveSpread: 0.02, bloomPerShot: 0.01, bloomMax: 0.05,
    recoil: 0.05, falloffFrom: 7, pellets: 8, sound: 'shotgun', zoom: 1.0,
  },
  k4: {
    id: 'k4', name: 'K4 Carbine', kind: 'rifle', slot: 'primary', price: 2700,
    damage: 33, headMult: 3.6, rpm: 620, auto: true, mag: 30, reserve: 90,
    reloadS: 2.3, spread: 0.007, moveSpread: 0.038, bloomPerShot: 0.0045, bloomMax: 0.028,
    recoil: 0.012, falloffFrom: 24, pellets: 1, sound: 'rifle', zoom: 1.06,
  },
  l7: {
    id: 'l7', name: 'L7 Longshot', kind: 'sniper', slot: 'primary', price: 4500,
    damage: 112, headMult: 2.0, rpm: 44, auto: false, mag: 5, reserve: 20,
    reloadS: 3.1, spread: 0.0008, moveSpread: 0.06, bloomPerShot: 0.01, bloomMax: 0.02,
    recoil: 0.07, falloffFrom: 40, pellets: 1, sound: 'sniper', zoom: 2.6,
  },
};

export const GRENADES = {
  frag: { id: 'frag', name: 'Frag grenade', price: 300, damage: 92, radius: 6.5 },
  flash: { id: 'flash', name: 'Flash grenade', price: 250, radius: 16, blindS: 2.6 },
  smoke: { id: 'smoke', name: 'Smoke grenade', price: 300, radius: 3.4, lifeS: 13 },
};

export const ARMOUR_PRICE = 650;

// One gun state per fighter per weapon owned; created when the weapon is bought or
// issued, reset (full magazines) when a new round deals the weapons out again.
export function createGun(weaponId) {
  const def = WEAPONS[weaponId];
  return {
    def,
    mag: def.mag,
    reserve: def.reserve,
    bloom: 0,          // spread added by recent shots, decays over time
    recoilPitch: 0,    // camera kick not yet recovered
    cooldown: 0,       // seconds until the next shot may fire
    reloading: 0,      // seconds left of the reload, 0 when not reloading
    scoped: false,
  };
}

// Current spread (radians) for a gun, given how its owner is moving. The single
// formula player, bots and the crosshair all read, so what the HUD shows is what hits.
export function currentSpread(gun, speed, grounded, crouched) {
  const def = gun.def;
  let spread = def.spread + gun.bloom;
  const moveFrac = Math.min(1, speed / 5.2);
  spread += def.moveSpread * moveFrac * moveFrac;
  if (!grounded) spread += 0.05;
  if (crouched) spread *= 0.65;
  return spread;
}

export function startReload(gun) {
  if (gun.reloading > 0 || gun.mag >= gun.def.mag || gun.reserve <= 0) return false;
  gun.reloading = gun.def.reloadS;
  return true;
}

export function updateGun(gun, dt) {
  gun.cooldown = Math.max(0, gun.cooldown - dt);
  gun.bloom = Math.max(0, gun.bloom - dt * 0.045);
  gun.recoilPitch *= Math.pow(0.0001, dt); // fast exponential recovery
  if (gun.reloading > 0) {
    gun.reloading -= dt;
    if (gun.reloading <= 0) {
      const take = Math.min(gun.def.mag - gun.mag, gun.reserve);
      gun.mag += take;
      gun.reserve -= take;
      gun.reloading = 0;
      return 'reloaded';
    }
  }
  return null;
}

// Damage after range falloff and armour. Headshots ignore the vest unless a helmet
// was bought with it — here armour is one purchase that covers both, halving all
// damage but never below the weapon's identity: a Longshot headshot still kills.
export function damageAt(def, distance, part, armour) {
  let dmg = def.damage;
  if (distance > def.falloffFrom) {
    const over = distance - def.falloffFrom;
    dmg *= Math.max(0.45, 1 - over * 0.012);
  }
  if (part === 'head') dmg *= def.headMult;
  if (part === 'leg') dmg *= 0.75;
  if (armour) dmg *= part === 'head' ? 0.72 : 0.5;
  return dmg;
}

// --- Viewmodel: the gun in the player's hands, built from boxes -----------------
// Low, dark shapes with one accent in the team's colour; bobs when walking, kicks
// when firing, dips when reloading. Attached to the camera, rendered over the world.
export function buildViewmodel(teamColour) {
  const group = new THREE.Group();
  const dark = new THREE.MeshLambertMaterial({ color: 0x22282e });
  const mid = new THREE.MeshLambertMaterial({ color: 0x39434d });
  const accent = new THREE.MeshLambertMaterial({ color: teamColour });
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const parts = [
    // receiver, barrel, magazine, stock, grip, sight
    { p: [0, 0, -0.32], s: [0.07, 0.11, 0.52], m: dark },
    { p: [0, 0.012, -0.68], s: [0.035, 0.035, 0.3], m: mid },
    { p: [0, -0.1, -0.26], s: [0.05, 0.13, 0.09], m: mid },
    { p: [0, -0.01, -0.02], s: [0.06, 0.09, 0.18], m: dark },
    { p: [0, -0.085, -0.08], s: [0.045, 0.1, 0.05], m: dark },
    { p: [0, 0.085, -0.36], s: [0.02, 0.05, 0.1], m: accent },
    { p: [0.045, -0.03, -0.3], s: [0.012, 0.05, 0.2], m: accent },
  ];
  for (const part of parts) {
    const mesh = new THREE.Mesh(geo, part.m);
    mesh.position.set(...part.p);
    mesh.scale.set(...part.s);
    group.add(mesh);
  }
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.012, -0.85);
  group.add(muzzle);
  group.position.set(0.24, -0.22, -0.45);
  return { group, muzzle };
}
