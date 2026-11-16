// COLD YARD palette: a container yard at blue hour — cold steel blues and greys, sodium
// work-lights for warmth, and one signal colour per team so a scene reads at a glance.
export const PALETTE = {
  sky: 0x1b2735,          // dusk blue overhead
  fog: 0x232f3d,          // cold haze between the container rows
  ground: 0x3a4149,       // worn asphalt-concrete
  groundLine: 0x59636e,   // painted yard markings, faded
  containerA: 0x74624a,   // rust-tan box
  containerB: 0x4a6172,   // slate blue box
  containerC: 0x5d5348,   // drab olive-grey box
  containerD: 0x6e4a3a,   // rust red box
  crate: 0x7a6a4f,        // wooden crate
  steel: 0x8b98a5,        // galvanised steel
  darkSteel: 0x2c343c,    // crane and gantry frames
  lamp: 0xffb45e,         // sodium work-light
  lampGlow: 0xff9a3c,
  sitePaint: 0xd8b13a,    // site markings in worn yellow
  wardens: 0x3f8cff,      // defender team colour — signal blue
  wardensDark: 0x1d3f73,
  jackals: 0xff7847,      // attacker team colour — signal orange
  jackalsDark: 0x73351d,
  charge: 0xff4747,       // the breach charge and its beacon
  tracer: 0xffd9a0,
  muzzle: 0xffc46b,
};

// Team ids used across the whole game: 0 defends (Wardens), 1 attacks (Jackals).
export const TEAMS = [
  { id: 0, name: 'Wardens', colour: PALETTE.wardens, dark: PALETTE.wardensDark },
  { id: 1, name: 'Jackals', colour: PALETTE.jackals, dark: PALETTE.jackalsDark },
];
