// Round planning and the economy for COLD YARD: what each side tries to do this round,
// what the bots buy with their money, and the buy catalogue the player's menu shows.
// The phase clock itself lives in main.js; this module is the tactics and the money.
import { RULES } from './state.js';
import { WEAPONS, GRENADES, ARMOUR_PRICE } from './weapon.js';
import { SITES } from './world.js';
import { setJob } from './bots.js';

export const BUY_CATALOGUE = [
  { key: 'Digit1', kind: 'weapon', id: 'raptor', label: 'Raptor-9 SMG', price: WEAPONS.raptor.price },
  { key: 'Digit2', kind: 'weapon', id: 's12', label: 'S12 Scatter', price: WEAPONS.s12.price },
  { key: 'Digit3', kind: 'weapon', id: 'k4', label: 'K4 Carbine', price: WEAPONS.k4.price },
  { key: 'Digit4', kind: 'weapon', id: 'l7', label: 'L7 Longshot', price: WEAPONS.l7.price },
  { key: 'Digit5', kind: 'armour', id: 'armour', label: 'Vest + helmet', price: ARMOUR_PRICE },
  { key: 'Digit6', kind: 'grenade', id: 'frag', label: 'Frag grenade', price: GRENADES.frag.price },
  { key: 'Digit7', kind: 'grenade', id: 'flash', label: 'Flash grenade', price: GRENADES.flash.price },
  { key: 'Digit8', kind: 'grenade', id: 'smoke', label: 'Smoke grenade', price: GRENADES.smoke.price },
];

// Defender hold points: { x, z, watchX, watchZ } — stand here, watch that lane mouth.
const HOLDS = {
  A: [
    { x: -17.5, z: -21.5, watchX: -21, watchZ: -8 },
    { x: -25, z: -14.5, watchX: -16, watchZ: -7 },
  ],
  B: [
    { x: 24.5, z: -22, watchX: 21, watchZ: -8 },
    { x: 17, z: -15, watchX: 16, watchZ: -7 },
  ],
  MID: [{ x: -2.5, z: -17.5, watchX: 0, watchZ: -2 }],
};

// Plan the round: pick the attack site, name the carrier, hand every bot its job.
// Attackers split 3/1/1 (main hit, mid pressure, a lurk at the other site); defenders
// sit 2/2/1 across A, B and mid. Returns the chosen site index. Which team attacks
// flips at the side swap, so roles come from the match, never a hard-coded team.
export function planRound(match, bots) {
  const rng = match.rng;
  const site = rng() < 0.5 ? 0 : 1;
  const other = 1 - site;
  const attackers = bots.filter((b) => b.combatant.team === match.attackTeam);
  const defenders = bots.filter((b) => b.combatant.team === match.defendingTeam);

  for (const b of attackers) b.combatant.hasCharge = false;
  const carrier = attackers[Math.floor(rng() * attackers.length)];
  if (carrier) carrier.combatant.hasCharge = true;

  const siteNode = site === 0 ? 15 : 16;
  const otherNode = other === 0 ? 15 : 16;
  attackers.forEach((bot, i) => {
    if (bot === carrier) {
      setJob(bot, { kind: 'plant', node: siteNode, hold: { x: SITES[site].x, z: SITES[site].z } });
    } else if (i % 3 === 0) {
      setJob(bot, { kind: 'push', node: 13, hold: { x: 0, z: -14, watchX: 0, watchZ: 4 } }); // mid
    } else if (i % 3 === 1) {
      setJob(bot, { kind: 'push', node: siteNode, hold: { x: SITES[site].x + (site === 0 ? 3 : -3), z: SITES[site].z + 3 } });
    } else {
      setJob(bot, { kind: 'push', node: otherNode, hold: { x: SITES[other].x, z: SITES[other].z + 4 } }); // lurk
    }
  });

  const holdsA = [...HOLDS.A];
  const holdsB = [...HOLDS.B];
  defenders.forEach((bot, i) => {
    if (i % 3 === 0) setJob(bot, { kind: 'hold', node: 15, hold: holdsA.shift() ?? HOLDS.A[0] });
    else if (i % 3 === 1) setJob(bot, { kind: 'hold', node: 16, hold: holdsB.shift() ?? HOLDS.B[0] });
    else setJob(bot, { kind: 'hold', node: 13, hold: HOLDS.MID[0] });
  });
  return site;
}

// After the charge goes down the round changes shape: attackers guard the site,
// defenders converge on it. Called once, at the plant.
export function planPostPlant(match, bots) {
  const site = SITES[match.charge.site];
  for (const bot of bots) {
    if (!bot.combatant.alive) continue;
    if (bot.combatant.team === match.attackTeam) {
      const guard = {
        x: site.x + (bot.slot % 2 === 0 ? 3.4 : -3.4),
        z: site.z + (bot.slot % 3),
        watchX: site.x, watchZ: site.z + 10,
      };
      setJob(bot, { kind: 'hold', node: match.charge.site === 0 ? 15 : 16, hold: guard });
      bot.state = 'advance';
    } else {
      // Defenders converge on the charge itself, not just the site: the defuse
      // only starts within reach of where it was actually planted.
      const hold = match.charge.pos
        ? { x: match.charge.pos.x, z: match.charge.pos.z }
        : { x: site.x, z: site.z };
      setJob(bot, { kind: 'push', node: match.charge.site === 0 ? 15 : 16, hold });
      bot.state = 'advance';
    }
  }
}

// Bot shopping at the start of a round: keep it human — sometimes a full buy,
// sometimes an eco round with pistols, armour before a second grenade.
export function buyForBot(combatant, rng) {
  const c = combatant;
  c.armour = 0;
  const teamMoney = c.money;
  if (!c.primary) {
    if (teamMoney >= WEAPONS.k4.price && rng() > 0.25) {
      c.primary = 'k4';
      c.money -= WEAPONS.k4.price;
    } else if (teamMoney >= WEAPONS.s12.price && rng() > 0.5) {
      c.primary = 's12';
      c.money -= WEAPONS.s12.price;
    } else if (teamMoney >= WEAPONS.raptor.price && rng() > 0.35) {
      c.primary = 'raptor';
      c.money -= WEAPONS.raptor.price;
    }
  }
  if (c.money >= ARMOUR_PRICE && (c.primary || rng() > 0.5)) {
    c.armour = 1;
    c.money -= ARMOUR_PRICE;
  }
  if (c.money >= GRENADES.frag.price && rng() > 0.45) {
    c.grenades.frag = 1;
    c.money -= GRENADES.frag.price;
  }
  if (c.money >= GRENADES.flash.price && rng() > 0.5) {
    c.grenades.flash = 1;
    c.money -= GRENADES.flash.price;
  }
  if (c.money >= GRENADES.smoke.price && rng() > 0.6) {
    c.grenades.smoke = 1;
    c.money -= GRENADES.smoke.price;
  }
}

// Round-end money: winners, losers, and the plant bonus for the attacking team.
export function payRound(match, winnerTeam, reason) {
  for (const c of match.allCombatants) {
    if (c.team === winnerTeam) c.money = Math.min(RULES.maxMoney, c.money + RULES.winMoney);
    else c.money = Math.min(RULES.maxMoney, c.money + RULES.lossMoney);
  }
  if (reason === 'detonation' || match.charge.planted) {
    for (const c of match.allCombatants) {
      if (c.team === match.attackTeam) c.money = Math.min(RULES.maxMoney, c.money + RULES.plantMoney);
    }
  }
}
