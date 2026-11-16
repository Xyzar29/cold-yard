// Bot fighters for COLD YARD: the other nine combatants. Each bot walks the world's
// waypoint graph toward a job — push a lane, hold a site, plant the charge, defuse it —
// and fights with the same guns, spread and line-of-sight rules as the player. Vision
// is a cone plus a ray test, hearing is a radius around gunfire, and a reaction delay
// and aim error keep them beatable; they burst-fire and strafe like they mean it.
import * as THREE from 'three';
import { PALETTE, TEAMS } from './palette.js';
import { WAYPOINTS, WAYPOINT_EDGES, collideMove, hasLineOfSight } from './world.js';
import { WEAPONS, createGun } from './weapon.js';

const BOT_NAMES = {
  0: ['Vex', 'Ondine', 'Marshal', 'Piotr'],
  1: ['Rook', 'Sable', 'Juno', 'Kestrel', 'Mara'],
};
const SKILL = [0.75, 0.9, 1.0, 1.1, 1.25]; // per-slot multiplier: higher is deadlier

// Adjacency for breadth-first pathfinding over the waypoint graph, built once.
const ADJ = WAYPOINTS.map(() => []);
for (const [a, b] of WAYPOINT_EDGES) {
  ADJ[a].push(b);
  ADJ[b].push(a);
}

export function nearestWaypoint(x, z) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < WAYPOINTS.length; i++) {
    const dx = WAYPOINTS[i][0] - x;
    const dz = WAYPOINTS[i][1] - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

export function findPath(fromNode, toNode) {
  if (fromNode === toNode) return [fromNode];
  const prev = new Array(WAYPOINTS.length).fill(-1);
  const queue = [fromNode];
  prev[fromNode] = fromNode;
  while (queue.length) {
    const node = queue.shift();
    if (node === toNode) break;
    for (const next of ADJ[node]) {
      if (prev[next] === -1) {
        prev[next] = node;
        queue.push(next);
      }
    }
  }
  if (prev[toNode] === -1) return [fromNode];
  const path = [];
  let node = toNode;
  while (node !== fromNode) {
    path.push(node);
    node = prev[node];
  }
  path.push(fromNode);
  return path.reverse();
}

const _geoBody = new THREE.BoxGeometry(0.52, 0.78, 0.3);
const _geoLegs = new THREE.BoxGeometry(0.46, 0.72, 0.28);
const _geoHead = new THREE.BoxGeometry(0.3, 0.3, 0.3);
const _geoGun = new THREE.BoxGeometry(0.07, 0.12, 0.62);

export function createBot(combatant, slot) {
  const team = TEAMS[combatant.team];
  const group = new THREE.Group();
  const suit = new THREE.MeshLambertMaterial({ color: team.dark });
  const vest = new THREE.MeshLambertMaterial({ color: team.colour });
  const skin = new THREE.MeshLambertMaterial({ color: 0xc9a189 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x22282e });

  const legs = new THREE.Mesh(_geoLegs, suit);
  legs.position.y = 0.36;
  const body = new THREE.Mesh(_geoBody, vest);
  body.position.y = 1.11;
  body.castShadow = true;
  const head = new THREE.Mesh(_geoHead, skin);
  head.position.y = 1.66;
  head.castShadow = true;
  const gunMesh = new THREE.Mesh(_geoGun, dark);
  gunMesh.position.set(0.18, 1.32, -0.3);

  const bot = {
    combatant,
    name: BOT_NAMES[combatant.team][slot % BOT_NAMES[combatant.team].length],
    slot,
    skill: SKILL[slot % SKILL.length],
    group,
    bodyMesh: body,
    headMesh: head,
    pos: { x: 0, z: 0 },
    yaw: 0,
    crouched: false,
    state: 'advance',
    path: [],
    pathI: 0,
    goalNode: -1,
    holdPos: null,        // {x, z} to defend once the path ends
    target: null,         // fighter being engaged
    knownPos: null,       // last seen/heard enemy position {x, z}
    reactT: 0,
    scanT: Math.random() * 0.12,
    burstLeft: 0,
    burstPauseT: 0,
    shotT: 0,
    strafeDir: 1,
    strafeT: 0,
    channelT: 0,          // plant/defuse progress
    blindT: 0,
    gun: createGun('p9'),
    guns: { p9: null },
    speed: 0,
    stepPhase: 0,
  };
  combatant.name = bot.name;
  body.userData.fighter = bot;
  body.userData.part = 'body';
  head.userData.fighter = bot;
  head.userData.part = 'head';
  legs.userData.fighter = bot;
  legs.userData.part = 'leg';
  group.add(legs, body, head, gunMesh);
  bot.legsMesh = legs;
  return bot;
}

// Round setup: place the bot, deal its bought weapons, give it a job.
export function resetBot(bot, spawn, job) {
  const c = bot.combatant;
  c.alive = true;
  c.health = 100;
  bot.pos.x = spawn[0];
  bot.pos.z = spawn[1];
  bot.yaw = c.team === 0 ? Math.PI : 0; // defenders face south (+z), attackers north (-z)
  bot.state = 'advance';
  bot.target = null;
  bot.knownPos = null;
  bot.channelT = 0;
  bot.blindT = 0;
  bot.burstLeft = 0;
  bot.burstPauseT = 0;
  bot.crouched = false;
  // Guns: the primary the fighter bought (bots buy in rounds.js), else the sidearm.
  bot.guns = {};
  const primaryId = c.primary && WEAPONS[c.primary] ? c.primary : null;
  if (primaryId) bot.guns[primaryId] = createGun(primaryId);
  bot.guns.p9 = createGun('p9');
  bot.gun = primaryId ? bot.guns[primaryId] : bot.guns.p9;
  setJob(bot, job);
  bot.group.visible = true;
  syncBotMesh(bot);
}

export function setJob(bot, job) {
  bot.job = job; // { kind: 'push'|'hold'|'plant', node, hold?: {x,z} }
  const from = nearestWaypoint(bot.pos.x, bot.pos.z);
  bot.path = findPath(from, job.node);
  bot.pathI = 0;
  bot.goalNode = job.node;
  bot.holdPos = job.hold ?? null;
  if (bot.state !== 'engage') bot.state = 'advance';
}

export function syncBotMesh(bot) {
  bot.group.position.set(bot.pos.x, bot.crouched ? -0.28 : 0, bot.pos.z);
  bot.group.rotation.y = bot.yaw; // models are built facing -z, the yaw convention's forward
  const flop = bot.combatant.alive ? 0 : -Math.PI / 2;
  bot.group.rotation.x = flop;
  if (!bot.combatant.alive) bot.group.position.y = 0.25;
}

export function botEye(bot, out) {
  out.set(bot.pos.x, bot.crouched ? 1.15 : 1.62, bot.pos.z);
  return out;
}

// Perception + behaviour + movement for one tick. ctx carries the shared world:
// fighters (everyone, for targeting), time, the smoke test, and the callbacks main.js
// uses to resolve shots, plants and defuses (so bots and the player share one combat
// resolver and one set of rules).
const _eye = new THREE.Vector3();
const _aim = new THREE.Vector3();
export function updateBot(bot, dt, ctx) {
  const c = bot.combatant;
  if (!c.alive) return;
  bot.blindT = Math.max(0, bot.blindT - dt);
  bot.scanT -= dt;

  // --- Perception: refresh what this bot can see and hear.
  let visible = null;
  if (bot.scanT <= 0) {
    bot.scanT = 0.12;
    visible = scanForEnemy(bot, ctx);
    if (visible) {
      if (bot.target !== visible.fighter) {
        bot.target = visible.fighter;
        bot.reactT = 0.34 / bot.skill + ctx.rng() * 0.18;
      }
      bot.knownPos = { x: visible.x, z: visible.z };
    } else if (bot.target && !ctx.isAlive(bot.target)) {
      bot.target = null;
    }
  }
  // Hearing: recent gunfire from an enemy pulls the bot's attention that way.
  const heard = ctx.lastNoise;
  if (heard && heard.team !== c.team && heard.t > ctx.time - 0.4) {
    const dx = heard.x - bot.pos.x;
    const dz = heard.z - bot.pos.z;
    if (dx * dx + dz * dz < 20 * 20 && !bot.target) {
      bot.knownPos = { x: heard.x, z: heard.z };
    }
  }

  const engaged = bot.target && bot.reactT <= 0 && bot.blindT <= 0;
  bot.reactT = Math.max(0, bot.reactT - dt);

  // --- Behaviour by state.
  let moveTarget = null;
  let wantCrouch = false;
  if (bot.state === 'plant' || bot.state === 'defuse') {
    bot.channelT += dt;
    const need = bot.state === 'plant' ? 3.2 : 5.0;
    ctx.onChannel(bot, bot.state, bot.channelT / need);
    if (bot.channelT >= need) {
      if (bot.state === 'plant') ctx.onPlanted(bot);
      else ctx.onDefused(bot);
      bot.state = 'hold';
      bot.channelT = 0;
    }
  } else if (engaged) {
    bot.state = 'engage';
    faceToward(bot, bot.knownPos.x, bot.knownPos.z, dt, 10);
    // Strafe in short steps between bursts; crouch on the pause, like a player would.
    bot.strafeT -= dt;
    if (bot.strafeT <= 0) {
      bot.strafeT = 0.5 + ctx.rng() * 0.7;
      bot.strafeDir = ctx.rng() > 0.5 ? 1 : -1;
    }
    const perp = bot.yaw + Math.PI / 2;
    moveTarget = {
      x: bot.pos.x + Math.sin(perp) * bot.strafeDir * 1.4,
      z: bot.pos.z + Math.cos(perp) * bot.strafeDir * 1.4,
      speed: 2.6,
    };
    wantCrouch = bot.burstPauseT > 0.1 && ctx.rng() > 0.6;
    runBursts(bot, dt, ctx);
  } else if (bot.state === 'engage') {
    // Lost sight: push to the last known position, then fall back to the job.
    if (bot.knownPos) {
      moveTarget = { x: bot.knownPos.x, z: bot.knownPos.z, speed: 4.4 };
      faceToward(bot, bot.knownPos.x, bot.knownPos.z, dt, 6);
      if (dist2D(bot.pos, bot.knownPos) < 1.6) bot.knownPos = null;
    } else {
      bot.state = 'advance';
    }
  } else if (bot.state === 'advance') {
    const node = bot.path[bot.pathI];
    if (node === undefined) {
      bot.state = 'hold';
    } else {
      const [nx, nz] = WAYPOINTS[node];
      moveTarget = { x: nx, z: nz, speed: 4.9 };
      faceToward(bot, nx, nz, dt, 6);
      if (Math.hypot(nx - bot.pos.x, nz - bot.pos.z) < 1.1) bot.pathI++;
    }
    if (bot.state === 'advance' && bot.pathI >= bot.path.length) bot.state = 'hold';
  } else if (bot.state === 'hold') {
    if (bot.holdPos) {
      const d = Math.hypot(bot.holdPos.x - bot.pos.x, bot.holdPos.z - bot.pos.z);
      if (d > 0.8) {
        moveTarget = { x: bot.holdPos.x, z: bot.holdPos.z, speed: 4.2 };
        faceToward(bot, bot.holdPos.x, bot.holdPos.z, dt, 6);
      } else {
        // Settled: watch the lane the job cares about, small idle sway.
        faceToward(bot, bot.holdPos.watchX ?? bot.pos.x, bot.holdPos.watchZ ?? bot.pos.z + 1, dt, 2);
      }
    }
    // Attackers who reach the site with the charge start planting; defenders who
    // reach a planted charge start defusing. main.js spots both via ctx flags.
    if (c.hasCharge && ctx.siteAt(bot.pos.x, bot.pos.z) >= 0 && ctx.phaseIsLive()) {
      bot.state = 'plant';
      bot.channelT = 0;
    } else if (ctx.chargePlanted() && c.team === ctx.defendingTeam() &&
               ctx.chargeDistance(bot.pos.x, bot.pos.z) < 1.6) {
      bot.state = 'defuse';
      bot.channelT = 0;
    }
  }

  bot.crouched = wantCrouch;
  // --- Movement.
  if (moveTarget) {
    const dx = moveTarget.x - bot.pos.x;
    const dz = moveTarget.z - bot.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.05) {
      const step = Math.min(d, moveTarget.speed * dt);
      const moved = collideMove(bot.pos.x, bot.pos.z, 0.35, (dx / d) * step, (dz / d) * step);
      bot.speed = Math.hypot(moved.x - bot.pos.x, moved.z - bot.pos.z) / Math.max(dt, 1e-4);
      bot.pos.x = moved.x;
      bot.pos.z = moved.z;
    } else bot.speed = 0;
  } else bot.speed = 0;
  bot.stepPhase += bot.speed * dt * 1.7;
  syncBotMesh(bot);
  // A gentle bob so a walking bot does not glide.
  bot.group.position.y = bot.combatant.alive ? Math.abs(Math.sin(bot.stepPhase * 2)) * 0.03 * Math.min(1, bot.speed / 4) : 0.25;
}

function scanForEnemy(bot, ctx) {
  const c = bot.combatant;
  if (bot.blindT > 0) return null;
  botEye(bot, _eye);
  let best = null;
  let bestD = 48;
  for (const f of ctx.fighters) {
    if (f === bot || f.combatant.team === c.team || !f.combatant.alive) continue;
    const fp = ctx.fighterPos(f);
    const dx = fp.x - bot.pos.x;
    const dz = fp.z - bot.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > bestD) continue;
    // Vision cone: 115 degrees, unless the enemy is close enough to hear moving.
    const ang = Math.abs(angleDiff(bot.yaw, Math.atan2(-dx, -dz)));
    if (ang > 1.0 && d > 6) continue;
    const eyeY = ctx.fighterEyeY(f);
    if (!hasLineOfSight(_eye.x, _eye.y, _eye.z, fp.x, eyeY - 0.25, fp.z)) continue;
    if (ctx.smokeBlocks(_eye.x, _eye.y, _eye.z, fp.x, eyeY - 0.25, fp.z)) continue;
    best = { fighter: f, x: fp.x, z: fp.z };
    bestD = d;
  }
  return best;
}

function runBursts(bot, dt, ctx) {
  bot.shotT -= dt;
  if (bot.burstPauseT > 0) {
    bot.burstPauseT -= dt;
    return;
  }
  if (bot.burstLeft <= 0) {
    bot.burstLeft = 3 + Math.floor(ctx.rng() * 3);
  }
  if (bot.shotT <= 0 && bot.target) {
    bot.shotT = 60 / bot.gun.def.rpm;
    bot.burstLeft--;
    ctx.onBotShoot(bot, bot.target);
    if (bot.burstLeft <= 0) bot.burstPauseT = 0.38 + ctx.rng() * 0.4;
  }
}

function faceToward(bot, x, z, dt, rate) {
  const want = Math.atan2(-(x - bot.pos.x), -(z - bot.pos.z));
  const diff = angleDiff(bot.yaw, want);
  const turn = Math.max(-rate * dt, Math.min(rate * dt, diff));
  bot.yaw += turn;
}

export function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function dist2D(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export { PALETTE };
