// Match state for COLD YARD: one plain object, created once, mutated by the round logic.
// Nothing else in the game keeps a second copy of the score, the money or the clock —
// rendering and the HUD only read from here.

export const PHASE = {
  MENU: 'menu',       // title screen over a live scene
  BUY: 'buy',         // freeze time: buy menu open, weapons locked
  LIVE: 'live',       // the round is being played
  PLANTED: 'planted', // the charge is down and ticking
  END: 'end',         // round decided, banner up, brief pause
  OVER: 'over',       // match decided
};

export const RULES = {
  roundsToWin: 7,
  maxRounds: 13,
  swapAtRound: 7,        // sides swap after this many rounds have been played
  buySeconds: 10,
  roundSeconds: 100,
  chargeSeconds: 40,     // time from plant to detonation
  endSeconds: 5,
  startMoney: 800,
  maxMoney: 9000,
  winMoney: 2700,
  lossMoney: 1400,
  plantMoney: 300,       // team bonus when the charge goes down
  killMoney: 300,
  teamSize: 5,           // per side, including the player on the Wardens
};

export function createMatch(rng) {
  return {
    phase: PHASE.MENU,
    phaseT: 0,                 // seconds left in the current timed phase
    round: 0,
    score: [0, 0],             // rounds won, by team id
    swapped: false,
    winner: -1,                // team id once the match is decided
    lastRoundWinner: -1,
    lastRoundReason: '',       // 'elimination' | 'detonation' | 'defused' | 'time'
    charge: {
      planted: false,
      site: -1,                // 0 = A, 1 = B
      pos: null,               // THREE.Vector3 once planted
      t: 0,                    // seconds to detonation
      planter: null,
    },
    killfeed: [],              // { killer, victim, weapon, headshot, t }
    rng,                       // mulberry32 instance: one stream for the whole match
  };
}

// The player's fighter record: money and loadout live here between rounds, not on the
// player controller, so a death or a side swap never loses them.
export function createCombatant(team, isPlayer) {
  return {
    team,
    isPlayer,
    name: '',
    alive: true,
    health: 100,
    armour: 0,                 // 0 or 1: bought this round's vest (halves body damage)
    money: RULES.startMoney,
    primary: null,             // weapon id in the primary slot, or null
    sidearm: 'p9',
    grenades: { frag: 0, flash: 0, smoke: 0 },
    hasCharge: false,          // attackers only: carries the breach charge
    kills: 0,
    deaths: 0,
  };
}

export function resetCharge(match) {
  match.charge.planted = false;
  match.charge.site = -1;
  match.charge.pos = null;
  match.charge.t = 0;
  match.charge.planter = null;
}
