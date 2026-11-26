// Kestrel Isles — the hand-in program for make.fun's flight game bounty (Node 22, standard library only).
//
// The game is the static folder game/: index.html, style.css and the ES modules in game/src (a WebGL2
// renderer, flight model, missions and HUD written for this game; no engine and no network requests).
// This program packages it for the grader: game/ and screenshots/ go to the output folder, and
// dossier.json is written by the kit's vendored library, which must stay byte for byte as shipped.
//
//   mkdir out; MAKEFUN_OUTPUT_DIR=out node main.ts      (the grader uses /output)
//   node serve.ts                                       (play at http://localhost:8080)

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const repo = fileURLToPath(new URL('.', import.meta.url));
const output = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** Copy one folder of the repository into the output, creating it even when the source is missing. */
function handIn(folder: string): void {
  mkdirSync(join(output, folder), { recursive: true });
  if (existsSync(join(repo, folder))) cpSync(join(repo, folder), join(output, folder), { recursive: true });
}

mkdirSync(output, { recursive: true });
handIn('game');
handIn('screenshots');

// The gate's limits: 4 screenshots of 256 KiB at most, 993 entries and 48 MiB under game/, 1000-byte paths.
writeFileSync(
  join(output, 'dossier.json'),
  buildDossier(output, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);
