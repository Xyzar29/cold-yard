// COLD YARD — entry program for make.fun's threejs-fps-02 bounty (Node 22, standard library only).
//
// The game itself is the static site in game/ (ES modules, three.js vendored, no build step).
// This program is the hand-in: it copies game/ and screenshots/ into the output directory and
// writes dossier.json there with make.fun's vendored library, exactly as the scorer rebuilds it.
//
// Run locally the same way the grader does, with MAKEFUN_OUTPUT_DIR standing in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The caps below are the scorer's own (see the kit's RULES.txt, "The gate"): dossier text is
// capped at 160 KiB, screenshots at 4 files of 256 KiB, game/ at 993 entries and 48 MiB.
const DOSSIER_CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
} as const;

function copyTree(from: string, to: string): number {
  cpSync(from, to, { recursive: true });
  return readdirSync(to, { recursive: true }).length;
}

mkdirSync(outputDir, { recursive: true });

const gameEntries = copyTree(join(repoRoot, 'game'), join(outputDir, 'game'));

mkdirSync(join(outputDir, 'screenshots'), { recursive: true });
let shotCount = 0;
const shotsFrom = join(repoRoot, 'screenshots');
if (existsSync(shotsFrom)) {
  shotCount = copyTree(shotsFrom, join(outputDir, 'screenshots'));
}

const dossier = buildDossier(outputDir, DOSSIER_CAPS);
writeFileSync(join(outputDir, 'dossier.json'), dossier);

console.log(`cold-yard: copied game/ (${gameEntries} entries) and screenshots/ (${shotCount} files)`);
console.log(`cold-yard: dossier.json written (${Buffer.byteLength(dossier)} bytes)`);
