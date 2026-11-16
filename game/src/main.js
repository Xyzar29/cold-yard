// COLD YARD — main module: boots three.js, owns the fixed-step simulation loop, the
// shared combat resolver (one hitscan path for the player and every bot, so a wall
// stops a bullet the same way for everyone), grenades, the round phase machine, and
// the screenshot poses the entry's screenshots are taken from.
import * as THREE from 'three';
import { PALETTE, TEAMS } from './palette.js';
import { PHASE, RULES, createMatch, createCombatant, resetCharge } from './state.js';
import { buildWorld, SITES, SPAWNS, rayHitWorld, hasLineOfSight } from './world.js';
import { createInput } from './input.js';
import { createPlayer, stepPlayer, placeAtSpawn, eyePosition, eyeHeight } from './player.js';
import { WEAPONS, GRENADES, ARMOUR_PRICE, createGun, currentSpread, startReload, updateGun, damageAt, buildViewmodel } from './weapon.js';
import { createBot, resetBot, updateBot, botEye } from './bots.js';
import { planRound, planPostPlant, buyForBot, payRound, BUY_CATALOGUE } from './rounds.js';
import { createHud } from './hud.js';
import { initAudio, sfx } from './audio.js';

// --- Seeded randomness: one stream per match, so a ?seed= game is reproducible.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') ?? (Date.now() % 100000));
const rng = mulberry32(seed);

// --- Renderer and scene.
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
scene.fog = new THREE.Fog(PALETTE.fog, 30, 95);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.08, 220);
camera.rotation.order = 'YXZ';
scene.add(camera);

const hemi = new THREE.HemisphereLight(0x8fb4d8, 0x2c2f26, 0.85);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffd9b0, 1.6);
sun.position.set(-28, 38, 14);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -40; sun.shadow.camera.right = 40;
sun.shadow.camera.top = 40; sun.shadow.camera.bottom = -40;
sun.shadow.camera.far = 110;
sun.shadow.bias = -0.0004;
scene.add(sun);

buildWorld(scene);

// --- Fighters: the player plus nine bots, all sharing one combatant shape.
const match = createMatch(rng);
const playerCombatant = createCombatant(0, true);
playerCombatant.name = 'You';
const player = createPlayer();
const playerFighter = { isPlayer: true, combatant: playerCombatant, name: 'You' };
const bots = [];
const allCombatants = [playerCombatant];
match.allCombatants = allCombatants;
for (let team = 0; team < 2; team++) {
  const count = team === 0 ? 4 : 5;
  for (let i = 0; i < count; i++) {
    const combatant = createCombatant(team, false);
    const bot = createBot(combatant, i);
    bots.push(bot);
    allCombatants.push(combatant);
    scene.add(bot.group);
  }
}
const fighters = [playerFighter, ...bots];
match.defendingTeam = 0;
match.attackTeam = 1;

const input = createInput(canvas);
const hud = createHud();
const viewmodel = buildViewmodel(TEAMS[0].colour);
camera.add(viewmodel.group);

// Player gun state: one gun object per owned weapon, dealt fresh each round.
let playerGuns = { p9: createGun('p9') };
let currentGunId = 'p9';
const gun = () => playerGuns[currentGunId];

// --- Shared fighter queries (the ctx the bots see, and combat uses too).
const _eye = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
function fighterPos(f) {
  return f.isPlayer ? player.pos : f.pos;
}
function fighterEyeY(f) {
  if (f.isPlayer) return player.pos.y + eyeHeight(player);
  return f.crouched ? 1.15 : 1.62;
}
function fighterEye(f, out) {
  if (f.isPlayer) return eyePosition(player, out);
  return botEye(f, out);
}
let simTime = 0;
const lastNoise = { x: 0, z: 0, team: -1, t: -10 };
const smokes = []; // { x, y, z, r, t }
function smokeBlocks(ax, ay, az, bx, by, bz) {
  for (const s of smokes) {
    if (segmentHitsSphere(ax, ay, az, bx, by, bz, s)) return true;
  }
  return false;
}
function segmentHitsSphere(ax, ay, az, bx, by, bz, s) {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const len2 = abx * abx + aby * aby + abz * abz;
  if (len2 < 1e-6) return false;
  let t = ((s.x - ax) * abx + (s.y - ay) * aby + (s.z - az) * abz) / len2;
  t = Math.max(0, Math.min(1, t));
  const dx = ax + abx * t - s.x, dy = ay + aby * t - s.y, dz = az + abz * t - s.z;
  return dx * dx + dy * dy + dz * dz < s.r * s.r;
}
function siteAt(x, z) {
  for (const site of SITES) {
    if (Math.hypot(x - site.x, z - site.z) <= site.r) return site.id;
  }
  return -1;
}

// --- Tracers and impact puffs: small pools, reused, never allocated in the loop.
const tracerPool = [];
{
  const mat = new THREE.LineBasicMaterial({ color: PALETTE.tracer, transparent: true, opacity: 0.85 });
  for (let i = 0; i < 24; i++) {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const line = new THREE.Line(geo, mat);
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracerPool.push({ line, life: 0 });
  }
}
let tracerIdx = 0;
function spawnTracer(from, to) {
  const t = tracerPool[tracerIdx++ % tracerPool.length];
  const pos = t.line.geometry.attributes.position;
  pos.setXYZ(0, from.x, from.y, from.z);
  pos.setXYZ(1, to.x, to.y, to.z);
  pos.needsUpdate = true;
  t.line.visible = true;
  t.life = 0.055;
}
const puffPool = [];
{
  const geo = new THREE.BoxGeometry(0.09, 0.09, 0.09);
  const mat = new THREE.MeshBasicMaterial({ color: 0xb8c4ce, transparent: true });
  for (let i = 0; i < 20; i++) {
    const m = new THREE.Mesh(geo, mat.clone());
    m.visible = false;
    scene.add(m);
    puffPool.push({ m, life: 0, vx: 0, vy: 0, vz: 0 });
  }
}
let puffIdx = 0;
function spawnPuff(p) {
  for (let i = 0; i < 3; i++) {
    const puff = puffPool[puffIdx++ % puffPool.length];
    puff.m.position.copy(p);
    puff.m.visible = true;
    puff.m.material.opacity = 0.8;
    puff.life = 0.3;
    puff.vx = (rng() - 0.5) * 0.8;
    puff.vy = rng() * 0.9;
    puff.vz = (rng() - 0.5) * 0.8;
  }
}
const muzzleLight = new THREE.PointLight(PALETTE.muzzle, 0, 9, 2);
scene.add(muzzleLight);

// --- The one hitscan resolver. Returns the fighter hit (if any) for feedback.
const _dir = new THREE.Vector3();
function rayVsFighter(origin, dir, f) {
  const p = fighterPos(f);
  const crouch = f.isPlayer ? player.crouched : f.crouched;
  const off = crouch ? -0.3 : 0;
  const bodyTop = 1.48 + off;
  const headLo = 1.5 + off;
  const headHi = 1.82 + off;
  const headT = rayBoxSlab(origin, dir, p.x - 0.16, headLo, p.z - 0.16, p.x + 0.16, headHi, p.z + 0.16);
  if (headT !== null) return { t: headT, part: 'head' };
  const bodyT = rayBoxSlab(origin, dir, p.x - 0.27, 0.02, p.z - 0.27, p.x + 0.27, bodyTop, p.z + 0.27);
  if (bodyT !== null) {
    const y = origin.y + dir.y * bodyT;
    return { t: bodyT, part: y < 0.74 + off ? 'leg' : 'body' };
  }
  return null;
}
function rayBoxSlab(o, d, x0, y0, z0, x1, y1, z1) {
  let tmin = 0;
  let tmax = Infinity;
  const axes = [[o.x, d.x, x0, x1], [o.y, d.y, y0, y1], [o.z, d.z, z0, z1]];
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

let hurtVignette = 0;
let flashAmount = 0;
let shake = 0;

function fireHitscan(shooter, gunState, origin, baseDir) {
  const def = gunState.def;
  const shooterPos = fighterPos(shooter);
  lastNoise.x = shooterPos.x;
  lastNoise.z = shooterPos.z;
  lastNoise.team = shooter.combatant.team;
  lastNoise.t = simTime;
  const speed = shooter.isPlayer ? player.speed2D : shooter.speed;
  const spread = currentSpread(gunState, speed, shooter.isPlayer ? player.grounded : true, shooter.isPlayer ? player.crouched : shooter.crouched);
  const distToShooter = shooter.isPlayer ? 0 : Math.hypot(player.pos.x - shooterPos.x, player.pos.z - shooterPos.z);
  sfx.shoot(def.sound, distToShooter);

  for (let pellet = 0; pellet < def.pellets; pellet++) {
    _dir.copy(baseDir);
    _dir.x += (rng() * 2 - 1) * spread;
    _dir.y += (rng() * 2 - 1) * spread;
    _dir.z += (rng() * 2 - 1) * spread;
    _dir.normalize();
    const worldT = rayHitWorld(origin, _dir, 120);
    let bestT = worldT;
    let bestFighter = null;
    let bestPart = null;
    for (const f of fighters) {
      if (f === shooter || !f.combatant.alive || f.combatant.team === shooter.combatant.team) continue;
      const hit = rayVsFighter(origin, _dir, f);
      if (hit && hit.t < bestT) {
        bestT = hit.t;
        bestFighter = f;
        bestPart = hit.part;
      }
    }
    _v1.copy(_dir).multiplyScalar(bestT).add(origin);
    spawnTracer(origin, _v1);
    if (bestFighter) {
      applyDamage(shooter, bestFighter, damageAt(def, bestT, bestPart, bestFighter.combatant.armour), bestPart, def);
    } else if (worldT < 120) {
      spawnPuff(_v1);
    }
  }
  // Muzzle light pulse at the gun.
  muzzleLight.position.copy(origin).addScaledVector(baseDir, 0.7);
  muzzleLight.intensity = 14;
}

function applyDamage(attacker, victim, dmg, part, def) {
  const vc = victim.combatant;
  if (!vc.alive) return;
  vc.health -= dmg;
  if (victim.isPlayer) {
    hurtVignette = Math.min(1, hurtVignette + 0.45);
    sfx.hurt();
    shake = Math.min(0.5, shake + 0.12);
  }
  if (attacker.isPlayer && vc.health > 0) {
    hud.hitmark(part === 'head', false);
    sfx.hitmarker(part === 'head');
  }
  if (vc.health <= 0) {
    vc.alive = false;
    vc.health = 0;
    vc.deaths++;
    vc.diedLastRound = true;
    attacker.combatant.kills++;
    attacker.combatant.money = Math.min(RULES.maxMoney, attacker.combatant.money + RULES.killMoney);
    hud.kill(attacker.name, attacker.combatant.team, victim.name, vc.team, def.name, part === 'head');
    if (attacker.isPlayer) {
      hud.hitmark(part === 'head', true);
      sfx.kill();
    }
    if (!victim.isPlayer) victim.group.rotation.x = -Math.PI / 2; // flop handled in sync too
    if (victim.isPlayer) onPlayerDeath();
    checkRoundEnd();
  }
}

// --- Grenades: thrown projectiles with a fuse, resolved against the same world.
const grenades = []; // { kind, owner, pos, vel, t, mesh }
const _nadeGeo = new THREE.SphereGeometry(0.09, 10, 8);
const _nadeMats = {
  frag: new THREE.MeshLambertMaterial({ color: 0x4a5d3a }),
  flash: new THREE.MeshLambertMaterial({ color: 0xb9c2ca }),
  smoke: new THREE.MeshLambertMaterial({ color: 0x707880 }),
};
function throwGrenade(owner, kind, from, dir, power = 13) {
  const mesh = new THREE.Mesh(_nadeGeo, _nadeMats[kind]);
  mesh.position.copy(from);
  scene.add(mesh);
  const vel = dir.clone().multiplyScalar(power);
  vel.y += 3.2;
  grenades.push({ kind, owner, pos: mesh.position, vel, t: 0, mesh });
  if (owner.isPlayer) sfx.throwWhoosh();
}
function updateGrenades(dt) {
  for (let i = grenades.length - 1; i >= 0; i--) {
    const n = grenades[i];
    n.t += dt;
    n.vel.y -= 14 * dt;
    n.pos.addScaledVector(n.vel, dt);
    if (n.pos.y < 0.09) {
      n.pos.y = 0.09;
      n.vel.y = Math.abs(n.vel.y) > 1.2 ? -n.vel.y * 0.35 : 0;
      n.vel.x *= 0.7;
      n.vel.z *= 0.7;
    }
    const fuse = n.kind === 'smoke' ? 1.15 : n.kind === 'flash' ? 1.35 : 1.55;
    if (n.t >= fuse) {
      resolveGrenade(n);
      scene.remove(n.mesh);
      grenades.splice(i, 1);
    }
  }
}
function resolveGrenade(n) {
  const p = n.pos;
  const distToPlayer = Math.hypot(player.pos.x - p.x, player.pos.z - p.z);
  if (n.kind === 'frag') {
    sfx.fragBoom(distToPlayer);
    muzzleLight.position.set(p.x, 1, p.z);
    muzzleLight.intensity = 60;
    shake = Math.min(0.8, shake + Math.max(0, 0.5 - distToPlayer * 0.03));
    for (const f of fighters) {
      if (!f.combatant.alive) continue;
      const fp = fighterPos(f);
      const d = Math.hypot(fp.x - p.x, fp.z - p.z);
      if (d > GRENADES.frag.radius) continue;
      _v1.set(fp.x, 1, fp.z);
      if (!hasLineOfSight(p.x, 0.4, p.z, fp.x, 1, fp.z)) continue;
      const dmg = GRENADES.frag.damage * (1 - d / (GRENADES.frag.radius + 1.5));
      applyDamage(n.owner, f, dmg, 'body', { name: 'Frag grenade' });
    }
    spawnPuff(_v1.set(p.x, 0.4, p.z));
  } else if (n.kind === 'flash') {
    sfx.flashPop(distToPlayer);
    muzzleLight.position.set(p.x, 1.2, p.z);
    muzzleLight.intensity = 90;
    for (const f of fighters) {
      if (!f.combatant.alive || f === n.owner) continue;
      const fp = fighterPos(f);
      const d = Math.hypot(fp.x - p.x, fp.z - p.z);
      if (d > GRENADES.flash.radius) continue;
      if (!hasLineOfSight(p.x, 1.2, p.z, fp.x, fighterEyeY(f), fp.z)) continue;
      // Facing matters: looking at the pop is blinding, turning away halves it.
      let facing;
      if (f.isPlayer) {
        _v1.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
      } else {
        _v1.set(-Math.sin(f.yaw), 0, -Math.cos(f.yaw));
      }
      _v2.set(p.x - fp.x, 0, p.z - fp.z).normalize();
      facing = _v1.dot(_v2);
      const strength = (1 - d / GRENADES.flash.radius) * (facing > 0.2 ? 1 : facing > -0.4 ? 0.45 : 0.15);
      if (f.isPlayer) flashAmount = Math.min(1, flashAmount + strength);
      else f.blindT = Math.max(f.blindT, GRENADES.flash.blindS * strength);
    }
  } else {
    sfx.smokeHiss(distToPlayer);
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(GRENADES.smoke.radius, 18, 14),
      new THREE.MeshLambertMaterial({ color: 0x9aa4ac, transparent: true, opacity: 0.62 }),
    );
    mesh.position.set(p.x, 1.4, p.z);
    scene.add(mesh);
    smokes.push({ x: p.x, y: 1.4, z: p.z, r: GRENADES.smoke.radius, t: GRENADES.smoke.lifeS, mesh });
  }
}
function updateSmokes(dt) {
  for (let i = smokes.length - 1; i >= 0; i--) {
    smokes[i].t -= dt;
    if (smokes[i].t <= 0) {
      scene.remove(smokes[i].mesh);
      smokes.splice(i, 1);
    }
  }
}

// --- The charge prop: a dark case with a red beacon, shown once planted.
const chargeMesh = new THREE.Group();
{
  const caseMesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.28, 0.36), new THREE.MeshLambertMaterial({ color: 0x1d2126 }));
  caseMesh.position.y = 0.14;
  const beacon = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.1), new THREE.MeshBasicMaterial({ color: PALETTE.charge }));
  beacon.position.y = 0.32;
  chargeMesh.add(caseMesh, beacon);
  chargeMesh.visible = false;
  scene.add(chargeMesh);
}

// --- Bot callbacks: the ctx object bots.js reasons with.
const botCtx = {
  fighters,
  get time() { return simTime; },
  rng,
  lastNoise,
  isAlive: (f) => f.combatant.alive,
  fighterPos,
  fighterEyeY,
  smokeBlocks,
  siteAt,
  phaseIsLive: () => match.phase === PHASE.LIVE || match.phase === PHASE.PLANTED,
  chargePlanted: () => match.charge.planted,
  defendingTeam: () => match.defendingTeam,
  chargeDistance: (x, z) => (match.charge.pos ? Math.hypot(x - match.charge.pos.x, z - match.charge.pos.z) : 999),
  onChannel: () => {},
  onPlanted: (bot) => plantCharge(bot, bot.pos.x, bot.pos.z),
  onDefused: () => endRound(match.defendingTeam, 'defused'),
  onBotShoot,
};
function onBotShoot(bot, target) {
  const g = bot.gun;
  if (g.reloading > 0) return;
  if (g.mag <= 0) {
    if (startReload(g)) sfx.reloadStart();
    return;
  }
  g.mag--;
  g.bloom = Math.min(g.def.bloomMax, g.bloom + g.def.bloomPerShot);
  botEye(bot, _eye);
  fighterEye(target, _v2);
  _v2.y -= target.isPlayer ? 0.22 : 0.28; // aim at the chest, not the sky
  _dir.copy(_v2).sub(_eye).normalize();
  const targetSpeed = target.isPlayer ? player.speed2D : target.speed;
  const err = 0.013 / bot.skill + targetSpeed * 0.0035 + bot.speed * 0.003;
  _dir.x += (rng() * 2 - 1) * err;
  _dir.y += (rng() * 2 - 1) * err * 0.6;
  _dir.z += (rng() * 2 - 1) * err;
  _dir.normalize();
  fireHitscan(bot, g, _eye, _dir);
  // A bot that just opened an engagement sometimes lobs its frag first.
  if (!bot.nadeThrown && bot.combatant.grenades.frag > 0 && rng() < 0.3) {
    bot.nadeThrown = true;
    bot.combatant.grenades.frag--;
    _v1.copy(_dir);
    throwGrenade(bot, 'frag', _eye, _v1, 11);
  }
  if (!bot.target) bot.nadeThrown = false;
}

// --- Round and match flow.
function aliveCount(team) {
  let n = 0;
  for (const c of allCombatants) if (c.team === team && c.alive) n++;
  return n;
}
function checkRoundEnd() {
  if (match.phase !== PHASE.LIVE && match.phase !== PHASE.PLANTED) return;
  const defAlive = aliveCount(match.defendingTeam);
  const atkAlive = aliveCount(match.attackTeam);
  if (match.charge.planted) {
    // With the charge down, wiping the defenders ends it; wiping the attackers
    // does not — the charge can still blow, so the defenders must defuse.
    if (defAlive === 0) endRound(match.attackTeam, 'elimination');
  } else {
    if (atkAlive === 0) endRound(match.defendingTeam, 'elimination');
    else if (defAlive === 0) endRound(match.attackTeam, 'elimination');
  }
}
function plantCharge(planter, x, z) {
  if (match.charge.planted) return;
  match.charge.planted = true;
  match.charge.site = siteAt(x, z);
  match.charge.pos = new THREE.Vector3(x, 0, z);
  match.charge.t = RULES.chargeSeconds;
  match.charge.planter = planter;
  planter.combatant.hasCharge = false;
  match.phase = PHASE.PLANTED;
  chargeMesh.position.set(x, 0, z);
  chargeMesh.visible = true;
  sfx.plantBeep(true);
  hud.banner('CHARGE PLANTED', `Site ${SITES[match.charge.site]?.label ?? ''} — ${RULES.chargeSeconds} seconds to detonation`, 3);
  planPostPlant(match, bots);
}
function endRound(winner, reason) {
  if (match.phase === PHASE.END || match.phase === PHASE.OVER) return;
  match.phase = PHASE.END;
  match.phaseT = RULES.endSeconds;
  match.score[winner]++;
  match.lastRoundWinner = winner;
  match.lastRoundReason = reason;
  payRound(match, winner, reason);
  hud.setBuyVisible(false);
  hud.setChannel(null);
  const playerWon = winner === playerCombatant.team;
  const reasonText = {
    elimination: 'Enemy team eliminated',
    detonation: 'The charge detonated',
    defused: 'The charge was defused',
    time: 'The clock ran out on the attack',
  }[reason];
  hud.banner(playerWon ? 'ROUND WON' : 'ROUND LOST', `${reasonText} · ${TEAMS[winner].name} take it`, 3.4);
  if (playerWon) sfx.roundWin(); else sfx.roundLose();
  if (reason === 'detonation') {
    sfx.explosion();
    shake = 1;
    flashAmount = Math.min(1, flashAmount + 0.35);
  }
}
function onPlayerDeath() {
  viewmodel.group.visible = false;
  hud.banner('YOU ARE DOWN', 'Spectating your team until the round ends', 3);
}
function startRound() {
  match.round++;
  if (match.round > RULES.swapAtRound && !match.swapped) {
    // Halftime: sides swap, money and arsenals reset, the yard stays the same.
    match.swapped = true;
    match.defendingTeam = 1;
    match.attackTeam = 0;
    for (const c of allCombatants) {
      c.money = RULES.startMoney;
      c.primary = null;
      c.armour = 0;
      c.grenades = { frag: 0, flash: 0, smoke: 0 };
    }
    hud.banner('SIDE SWAP', `The ${TEAMS[playerCombatant.team].name} now ${match.attackTeam === playerCombatant.team ? 'attack' : 'defend'}`, 3);
  }
  resetCharge(match);
  chargeMesh.visible = false;
  match.phase = PHASE.BUY;
  match.phaseT = RULES.buySeconds;

  const playerDefends = playerCombatant.team === match.defendingTeam;
  const playerSpawns = SPAWNS[playerDefends ? 0 : 1];
  if (playerCombatant.diedLastRound) {
    playerCombatant.primary = null;
    playerCombatant.armour = 0;
  }
  playerCombatant.alive = true;
  playerCombatant.health = 100;
  playerCombatant.diedLastRound = false;
  playerCombatant.hasCharge = false;
  placeAtSpawn(player, playerSpawns[0][0], playerSpawns[0][1], 0, 0);
  playerGuns = { p9: createGun('p9') };
  if (playerCombatant.primary) playerGuns[playerCombatant.primary] = createGun(playerCombatant.primary);
  currentGunId = playerCombatant.primary ?? 'p9';
  viewmodel.group.visible = true;

  for (const bot of bots) {
    const c = bot.combatant;
    if (c.diedLastRound) {
      c.primary = null;
      c.armour = 0;
    }
    c.diedLastRound = false;
    buyForBot(c, rng);
    const defends = c.team === match.defendingTeam;
    const spawns = SPAWNS[defends ? 0 : 1];
    const slot = bots.filter((b) => b.combatant.team === c.team).indexOf(bot);
    const spawn = spawns[(slot + (c.team === 0 ? 1 : 0)) % spawns.length];
    resetBot(bot, spawn, { kind: 'hold', node: defends ? 18 : 1, hold: null });
    bot.nadeThrown = false;
  }
  const site = planRound(match, bots);
  // Sometimes the player carries the charge on attack rounds.
  if (playerCombatant.team === match.attackTeam && rng() < 0.3) {
    for (const bot of bots) bot.combatant.hasCharge = false;
    playerCombatant.hasCharge = true;
  }
  hud.banner(`ROUND ${match.round}`, `${TEAMS[match.attackTeam].name} move on site ${SITES[site].label} — buy phase`, 2.6);
  hud.setBuyVisible(true);
  hud.refreshBuy(playerCombatant);
}
function startMatch() {
  match.score = [0, 0];
  match.round = 0;
  match.swapped = false;
  match.defendingTeam = 0;
  match.attackTeam = 1;
  for (const c of allCombatants) {
    c.money = RULES.startMoney;
    c.primary = null;
    c.armour = 0;
    c.grenades = { frag: 0, flash: 0, smoke: 0 };
    c.kills = 0;
    c.deaths = 0;
    c.diedLastRound = false;
  }
  hud.hideOver();
  hud.showMenu(false);
  startRound();
}
function matchWinner() {
  if (match.score[0] >= RULES.roundsToWin) return 0;
  if (match.score[1] >= RULES.roundsToWin) return 1;
  if (match.round >= RULES.maxRounds) return match.score[0] > match.score[1] ? 0 : 1;
  return -1;
}
let beepT = 0;
function updatePhases(dt) {
  if (match.phase === PHASE.BUY || match.phase === PHASE.LIVE || match.phase === PHASE.END) {
    match.phaseT -= dt;
  }
  if (match.phase === PHASE.BUY && match.phaseT <= 0) {
    match.phase = PHASE.LIVE;
    match.phaseT = RULES.roundSeconds;
    hud.setBuyVisible(false);
    hud.banner('ROUND LIVE', match.attackTeam === playerCombatant.team ? 'Plant the charge or wipe them out' : 'Hold the sites', 1.8);
  } else if (match.phase === PHASE.LIVE && match.phaseT <= 0) {
    endRound(match.defendingTeam, 'time');
  } else if (match.phase === PHASE.PLANTED) {
    match.charge.t -= dt;
    beepT -= dt;
    if (beepT <= 0) {
      beepT = match.charge.t < 10 ? 0.45 : 0.95;
      sfx.plantBeep(false);
    }
    if (match.charge.t <= 0) endRound(match.attackTeam, 'detonation');
  } else if (match.phase === PHASE.END && match.phaseT <= 0) {
    const winner = matchWinner();
    if (winner >= 0) {
      match.phase = PHASE.OVER;
      match.winner = winner;
      const won = winner === playerCombatant.team;
      hud.showOver(won ? 'VICTORY' : 'DEFEAT',
        `${TEAMS[0].name} ${match.score[0]} — ${match.score[1]} ${TEAMS[1].name} · Your line: ${playerCombatant.kills} kills, ${playerCombatant.deaths} deaths`);
      input.unlock();
    } else {
      startRound();
    }
  }
}

// --- Player actions inside the fixed step.
let aiming = false;
window.addEventListener('mousedown', (e) => { if (e.button === 2) aiming = true; });
window.addEventListener('mouseup', (e) => { if (e.button === 2) aiming = false; });
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('wheel', (e) => {
  if (!playerCombatant.alive || match.phase === PHASE.MENU) return;
  const ids = Object.keys(playerGuns);
  if (ids.length < 2) return;
  const next = ids[(ids.indexOf(currentGunId) + (e.deltaY > 0 ? 1 : ids.length - 1)) % ids.length];
  switchGun(next);
}, { passive: true });
function switchGun(id) {
  if (!playerGuns[id] || id === currentGunId) return;
  currentGunId = id;
  gun().reloading = 0;
}
let playerChannel = 0; // seconds of E held on the current plant/defuse
function stepPlayerActions(dt) {
  const g = gun();
  const result = updateGun(g, dt);
  if (result === 'reloaded') sfx.reloadEnd();

  const inPlay = match.phase === PHASE.LIVE || match.phase === PHASE.PLANTED;
  if (!playerCombatant.alive || !inPlay) return;

  // Weapon selection.
  if (input.wasPressed('Digit1') && playerCombatant.primary) switchGun(playerCombatant.primary);
  if (input.wasPressed('Digit2')) switchGun('p9');

  // Reload.
  if (input.wasPressed('KeyR') && startReload(g)) sfx.reloadStart();

  // Fire. The edge press is always consumed, so a stale click can never leak
  // into a semi-automatic shot after a weapon switch.
  const pressed = input.takeFiringPressed();
  const wantFire = g.def.auto ? input.firing : pressed;
  if (wantFire && g.cooldown <= 0 && g.reloading <= 0) {
    if (g.mag <= 0) {
      sfx.dryFire();
      g.cooldown = 0.3;
      if (startReload(g)) sfx.reloadStart();
    } else {
      g.mag--;
      g.cooldown = 60 / g.def.rpm;
      g.bloom = Math.min(g.def.bloomMax, g.bloom + g.def.bloomPerShot);
      player.pitch += g.def.recoil * (0.55 + rng() * 0.25);
      g.recoilPitch += g.def.recoil * 6;
      eyePosition(player, _eye);
      _dir.set(-Math.sin(player.yaw) * Math.cos(player.pitch), Math.sin(player.pitch), -Math.cos(player.yaw) * Math.cos(player.pitch));
      fireHitscan(playerFighter, g, _eye, _dir);
    }
  }

  // Grenades on 4 / 5 / 6.
  const nadeKeys = [['Digit4', 'frag'], ['Digit5', 'flash'], ['Digit6', 'smoke']];
  for (const [key, kind] of nadeKeys) {
    if (input.wasPressed(key) && playerCombatant.grenades[kind] > 0) {
      playerCombatant.grenades[kind]--;
      eyePosition(player, _eye);
      _dir.set(-Math.sin(player.yaw) * Math.cos(player.pitch), Math.sin(player.pitch), -Math.cos(player.yaw) * Math.cos(player.pitch));
      throwGrenade(playerFighter, kind, _eye, _dir, 13.5);
    }
  }

  // Plant (attacker with the charge) or defuse (defender near the planted charge).
  const atSite = siteAt(player.pos.x, player.pos.z);
  const nearCharge = match.charge.pos && Math.hypot(player.pos.x - match.charge.pos.x, player.pos.z - match.charge.pos.z) < 2.2;
  let channelLabel = null;
  if (input.down('KeyE') && player.speed2D < 1.2) {
    if (playerCombatant.team === match.attackTeam && playerCombatant.hasCharge && atSite >= 0 && !match.charge.planted) {
      playerChannel += dt;
      channelLabel = 'PLANTING THE CHARGE';
      hud.setChannel(channelLabel, playerChannel / 3.2);
      if (playerChannel >= 3.2) {
        playerChannel = 0;
        plantCharge(playerFighter, player.pos.x, player.pos.z);
      }
    } else if (playerCombatant.team === match.defendingTeam && match.charge.planted && nearCharge) {
      playerChannel += dt;
      channelLabel = 'DEFUSING';
      hud.setChannel(channelLabel, playerChannel / 5);
      if (Math.floor(playerChannel * 4) !== Math.floor((playerChannel - dt) * 4)) sfx.defuseTick();
      if (playerChannel >= 5) {
        playerChannel = 0;
        hud.setChannel(null);
        endRound(match.defendingTeam, 'defused');
      }
    }
  }
  if (!channelLabel) {
    playerChannel = 0;
    hud.setChannel(null);
  }
}

// --- Buying (number keys while the buy phase runs).
function stepBuy() {
  if (match.phase !== PHASE.BUY) return;
  if (input.wasPressed('KeyB')) {
    const el = hud.els.buyMenu;
    hud.setBuyVisible(el.style.display === 'none');
  }
  for (const item of BUY_CATALOGUE) {
    if (!input.wasPressed(item.key)) continue;
    const c = playerCombatant;
    if (item.kind === 'weapon') {
      if (c.primary === item.id) continue;
      if (c.money < item.price) { sfx.denied(); continue; }
      c.money -= item.price;
      c.primary = item.id;
      playerGuns[item.id] = createGun(item.id);
      currentGunId = item.id;
      sfx.buy();
    } else if (item.kind === 'armour') {
      if (c.armour === 1 || c.money < item.price) { sfx.denied(); continue; }
      c.money -= item.price;
      c.armour = 1;
      sfx.buy();
    } else {
      if (c.grenades[item.id] >= 2 || c.money < item.price) { sfx.denied(); continue; }
      c.money -= item.price;
      c.grenades[item.id]++;
      sfx.buy();
    }
    hud.refreshBuy(c);
  }
}

// --- Fixed-step simulation.
const STEP = 1 / 120;
let accumulator = 0;
let botTick = false;
function simulate(dt) {
  simTime += dt;
  updatePhases(dt);
  const inRound = match.phase === PHASE.BUY || match.phase === PHASE.LIVE ||
    match.phase === PHASE.PLANTED || match.phase === PHASE.END;
  if (inRound && playerCombatant.alive) {
    if (match.phase === PHASE.BUY) {
      // Freeze time: you may look around and shop, not move.
      const look = input.takeLook();
      player.yaw -= look.x * 0.0022;
      player.pitch = Math.max(-1.5, Math.min(1.5, player.pitch - look.y * 0.0022));
    } else {
      const scoped = aiming && gun().def.kind === 'sniper';
      stepPlayer(player, input, dt, scoped ? 0.001 : 0.0022);
    }
  }
  stepPlayerActions(dt);
  stepBuy();
  if (match.phase === PHASE.LIVE || match.phase === PHASE.PLANTED) {
    botTick = !botTick;
    if (botTick) {
      for (const bot of bots) {
        updateBot(bot, STEP * 2, botCtx);
        const event = updateGun(bot.gun, STEP * 2);
        if (event === 'reloaded') sfx.reloadEnd();
        if (bot.gun.mag <= 0 && bot.gun.reloading <= 0 && bot.combatant.alive) startReload(bot.gun);
      }
    }
  }
  updateGrenades(dt);
  updateSmokes(dt);
  for (const t of tracerPool) {
    if (t.life > 0) {
      t.life -= dt;
      if (t.life <= 0) t.line.visible = false;
    }
  }
  for (const p of puffPool) {
    if (p.life > 0) {
      p.life -= dt;
      p.m.position.x += p.vx * dt;
      p.m.position.y += p.vy * dt;
      p.m.position.z += p.vz * dt;
      p.m.material.opacity = Math.max(0, p.life * 2.4);
      if (p.life <= 0) p.m.visible = false;
    }
  }
  muzzleLight.intensity = Math.max(0, muzzleLight.intensity - dt * 260);
  hurtVignette = Math.max(0, hurtVignette - dt * 1.1);
  flashAmount = Math.max(0, flashAmount - dt / 2.4);
  shake = Math.max(0, shake - dt * 1.8);
  if (match.charge.planted) {
    chargeMesh.children[1].material.color.setHex(Math.sin(simTime * (match.charge.t < 10 ? 14 : 6)) > 0 ? PALETTE.charge : 0x571616);
  }
}

// --- Camera, viewmodel and HUD per frame.
const spottedAt = new Map();
function renderFrame(frameDt) {
  const inMenu = match.phase === PHASE.MENU;
  if (inMenu) {
    const t = performance.now() * 0.00004;
    camera.position.set(Math.sin(t) * 27, 13, Math.cos(t) * 27);
    camera.lookAt(0, 0.5, -6);
    viewmodel.group.visible = false;
  } else if (!playerCombatant.alive && (match.phase === PHASE.LIVE || match.phase === PHASE.PLANTED || match.phase === PHASE.END)) {
    const ally = bots.find((b) => b.combatant.team === playerCombatant.team && b.combatant.alive);
    if (ally) {
      botEye(ally, _eye);
      camera.position.copy(_eye);
      camera.rotation.set(-0.04, ally.yaw, 0);
    }
    viewmodel.group.visible = false;
  } else {
    eyePosition(player, _eye);
    camera.position.copy(_eye);
    if (shake > 0) {
      camera.position.x += (rng() - 0.5) * shake * 0.14;
      camera.position.y += (rng() - 0.5) * shake * 0.14;
    }
    const g = gun();
    camera.rotation.set(player.pitch + g.recoilPitch, player.yaw, 0);
    const scoped = aiming && g.def.kind === 'sniper' && playerCombatant.alive;
    const targetFov = scoped ? 27 : aiming ? 75 / g.def.zoom : 75;
    camera.fov += (targetFov - camera.fov) * Math.min(1, frameDt * 11);
    camera.updateProjectionMatrix();
    // Viewmodel life: bob, recoil kick, reload dip, hidden while scoped.
    viewmodel.group.visible = !scoped;
    const vm = viewmodel.group;
    vm.position.set(
      0.24 + Math.sin(player.bobPhase) * 0.008 * player.bobAmount,
      -0.22 + Math.abs(Math.cos(player.bobPhase)) * 0.01 * player.bobAmount - (g.reloading > 0 ? Math.sin((1 - g.reloading / g.def.reloadS) * Math.PI) * 0.13 : 0),
      -0.45 + g.recoilPitch * 0.55,
    );
    vm.rotation.x = g.recoilPitch * 1.4 - (g.reloading > 0 ? Math.sin((1 - g.reloading / g.def.reloadS) * Math.PI) * 0.5 : 0);
  }

  // Spotted enemies for the minimap: seen by the player within the last 2.5 s.
  if (playerCombatant.alive && !inMenu) {
    eyePosition(player, _eye);
    for (const bot of bots) {
      if (bot.combatant.team === playerCombatant.team || !bot.combatant.alive) continue;
      _v1.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
      _v2.set(bot.pos.x - player.pos.x, 0, bot.pos.z - player.pos.z);
      const d = _v2.length();
      if (d < 42 && _v2.normalize().dot(_v1) > 0.1 && hasLineOfSight(_eye.x, _eye.y, _eye.z, bot.pos.x, 1.3, bot.pos.z)) {
        spottedAt.set(bot, simTime);
      }
    }
  }
  const dots = [];
  if (!inMenu) {
    if (playerCombatant.alive) dots.push({ x: player.pos.x, z: player.pos.z, colour: '#ffffff', self: true });
    for (const bot of bots) {
      if (!bot.combatant.alive) continue;
      if (bot.combatant.team === playerCombatant.team) {
        dots.push({ x: bot.pos.x, z: bot.pos.z, colour: '#6aa8ff' });
      } else if (simTime - (spottedAt.get(bot) ?? -99) < 2.5) {
        dots.push({ x: bot.pos.x, z: bot.pos.z, colour: '#ff9a6a' });
      }
    }
    if (match.charge.planted && match.charge.pos) {
      dots.push({ x: match.charge.pos.x, z: match.charge.pos.z, colour: '#ff4747' });
    }
  }
  const g = gun();
  let hint = '';
  if (match.phase === PHASE.BUY) hint = 'Buy phase — number keys buy, B toggles the menu';
  else if (!input.locked && !inMenu && match.phase !== PHASE.OVER && !shotMode) hint = 'Click to take control';
  else if (playerCombatant.hasCharge && !match.charge.planted) hint = 'You carry the charge — hold E inside site A or B to plant';
  else if (match.charge.planted && playerCombatant.team === match.defendingTeam && playerCombatant.alive) hint = 'The charge is planted — get to it and hold E to defuse';
  else if (!playerCombatant.alive && match.phase !== PHASE.OVER) hint = 'You are down — your team fights on without you';

  hud.update({
    phaseT: match.phase === PHASE.BUY || match.phase === PHASE.LIVE ? match.phaseT : match.phase === PHASE.PLANTED ? match.charge.t : 0,
    chargePlanted: match.charge.planted,
    chargeT: match.charge.t,
    chargeSite: match.charge.planted ? SITES[match.charge.site]?.label : '',
    score: match.score,
    round: Math.max(1, match.round),
    playerTeam: playerCombatant.team,
    alive: [aliveCount(0), aliveCount(1)],
    health: playerCombatant.health,
    armour: playerCombatant.armour,
    mag: g.mag,
    reserve: g.reserve,
    reloading: g.reloading > 0,
    money: playerCombatant.money,
    weaponName: g.def.name.toUpperCase(),
    grenades: playerCombatant.grenades,
    spreadPx: currentSpread(g, player.speed2D, player.grounded, player.crouched) * 620,
    scoped: aiming && g.def.kind === 'sniper' && playerCombatant.alive,
    hurtVignette,
    flashAmount,
    spectating: !playerCombatant.alive && !inMenu && match.phase !== PHASE.OVER
      ? (bots.find((b) => b.combatant.team === playerCombatant.team && b.combatant.alive)?.name ?? null)
      : null,
    hint,
    buyOpen: match.phase === PHASE.BUY,
    sites: SITES,
    dots,
    yaw: player.yaw,
  }, frameDt);
}

// --- Boot: lay the teams out at their spawns behind the title screen.
for (const bot of bots) {
  const defends = bot.combatant.team === 0;
  const spawns = SPAWNS[defends ? 0 : 1];
  const slot = bots.filter((b) => b.combatant.team === bot.combatant.team).indexOf(bot);
  resetBot(bot, spawns[slot % spawns.length], { kind: 'hold', node: defends ? 18 : 1, hold: null });
}
placeAtSpawn(player, 0, -29, 0, 0);
hud.showMenu(true);
document.getElementById('play-btn').addEventListener('click', () => {
  initAudio();
  startMatch();
  input.lock();
});
document.getElementById('again-btn').addEventListener('click', () => {
  initAudio();
  startMatch();
  input.lock();
});
canvas.addEventListener('click', () => {
  if (match.phase !== PHASE.MENU && match.phase !== PHASE.OVER && !input.locked && !shotMode) {
    initAudio();
    input.lock();
  }
});

// --- Screenshot poses: ?shot=start|buy|play|end renders a deterministic scene the
// entry's screenshots are captured from. Bots and phases freeze; the render loop runs.
let shotMode = params.get('shot');
if (shotMode) {
  hud.showMenu(false);
  if (shotMode === 'buy') {
    startMatch();
    playerCombatant.money = 4750;
    hud.refreshBuy(playerCombatant);
    hud.setBuyVisible(true);
  } else if (shotMode === 'play' || shotMode === 'end') {
    startMatch();
    hud.setBuyVisible(false);
    match.phase = PHASE.LIVE;
    match.phaseT = 83;
    playerCombatant.primary = 'k4';
    playerGuns = { p9: createGun('p9'), k4: createGun('k4') };
    currentGunId = 'k4';
    if (shotMode === 'play') {
      match.score = [3, 2];
      match.round = 6;
      playerCombatant.health = 76;
      playerCombatant.money = 2350;
      playerCombatant.armour = 1;
      gun().mag = 17;
      placeAtSpawn(player, 0.5, -3.5, 0.5, -20);
      const enemy = bots.find((b) => b.combatant.team === 1);
      enemy.pos.x = 1.9;
      enemy.pos.z = -15.5;
      enemy.yaw = Math.PI;
      enemy.group.position.set(enemy.pos.x, 0, enemy.pos.z);
      enemy.group.rotation.y = enemy.yaw;
      const ally = bots.find((b) => b.combatant.team === 0);
      ally.pos.x = -3.4;
      ally.pos.z = -9;
      ally.group.position.set(ally.pos.x, 0, ally.pos.z);
      hud.kill('Vex', 0, 'Rook', 1, 'K4 Carbine', false);
      hud.kill('Sable', 1, 'Ondine', 0, 'Raptor-9 SMG', true);
    } else {
      match.score = [4, 2];
      match.round = 7;
      playerCombatant.money = 5100;
      match.phase = PHASE.PLANTED;
      match.charge.planted = true;
      match.charge.site = 0;
      match.charge.pos = new THREE.Vector3(-20.4, 0, -17.6);
      match.charge.t = 26;
      chargeMesh.position.set(-20.4, 0, -17.6);
      chargeMesh.visible = true;
      placeAtSpawn(player, -17.8, -13.8, -21, -18.5);
      const ally = bots.find((b) => b.combatant.team === 0);
      ally.pos.x = -19.2;
      ally.pos.z = -16.2;
      ally.yaw = 2.4;
      ally.group.position.set(ally.pos.x, 0, ally.pos.z);
      ally.group.rotation.y = ally.yaw;
      hud.banner('CHARGE PLANTED', 'Site A — hold E by the charge to defuse', 60);
    }
  }
}

// --- The loop: fixed-step simulation, one render per animation frame.
let lastMs = performance.now();
function frame(nowMs) {
  requestAnimationFrame(frame);
  let frameDt = (nowMs - lastMs) / 1000;
  lastMs = nowMs;
  if (frameDt > 0.1) frameDt = 0.1;
  if (!shotMode) {
    accumulator += frameDt;
    while (accumulator >= STEP) {
      simulate(STEP);
      accumulator -= STEP;
    }
  } else {
    // Posed scenes still breathe: light pulses and the beacon blink.
    simTime += frameDt;
    muzzleLight.intensity = shotMode === 'play' ? 9 : Math.max(0, muzzleLight.intensity - frameDt * 200);
    if (match.charge.planted) {
      chargeMesh.children[1].material.color.setHex(Math.sin(simTime * 8) > 0 ? PALETTE.charge : 0x571616);
    }
  }
  renderFrame(frameDt);
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);
