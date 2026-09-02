#!/usr/bin/env node
/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Build the files the simulated device serves over FTP.
 *
 * Demo Mode is meant to show the app as it behaves against real hardware. It could not: the
 * simulated device held one 122-byte SID whose player did nothing and six 18-byte files named
 * `.d64`. So the Ultimate source browsed almost empty, a mounted disk listed no directory, and a
 * tune added to the playlist had no length, no author and no sound.
 *
 * Everything here is the real format. The SIDs have a 6502 player and play music; the disk images
 * are 174848 bytes with a BAM, a directory chain and file data where the directory says it is; the
 * programs are tokenised BASIC that a C64 would run.
 *
 *   node scripts/build-demo-device-content.mjs           # write the tree
 *   node scripts/build-demo-device-content.mjs --check    # fail if it has drifted
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { REST, buildSid, tuneSeconds } from "./demoDevice/sid.mjs";
import { D64_BYTES, buildD64 } from "./demoDevice/d64.mjs";
import { buildBasicPrg } from "./demoDevice/prg.mjs";
import { buildCrt } from "./demoDevice/crt.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const FTP_ROOT = resolve(ROOT, "android/app/src/main/assets/ftp-root");

// ── the music ──────────────────────────────────────────────────────────────────────────────────

/**
 * Eight tunes, each with its own key, tempo and timbre, so a playlist of them is a playlist of
 * distinguishable music rather than eight versions of one bleep. Written as note names because a
 * frequency table is unreviewable — a wrong note in a table looks exactly like a right one.
 */
const TUNES = [
  {
    file: "Commander March.sid",
    title: "Commander March",
    author: "C64 Commander",
    framesPerStep: 10,
    waveform: "pulse",
    voices: [
      ["C4", "E4", "G4", "C5", "G4", "E4", "C4", "E4", "F4", "A4", "C5", "F5", "C5", "A4", "F4", "A4"],
      ["C3", REST, "G3", REST, "C3", REST, "G3", REST, "F3", REST, "C4", REST, "F3", REST, "C4", REST],
      ["C2", "C2", "G2", "G2", "C2", "C2", "G2", "G2", "F2", "F2", "C3", "C3", "F2", "F2", "C3", "C3"],
    ],
  },
  {
    file: "Blue Screen Waltz.sid",
    title: "Blue Screen Waltz",
    author: "C64 Commander",
    framesPerStep: 16,
    waveform: "triangle",
    voices: [
      ["D4", "F#4", "A4", "D5", "A4", "F#4", "E4", "G4", "B4", "E5", "B4", "G4"],
      ["D3", REST, REST, "A3", REST, REST, "E3", REST, REST, "B3", REST, REST],
      ["D2", "D2", "D2", "A2", "A2", "A2", "E2", "E2", "E2", "B2", "B2", "B2"],
    ],
  },
  {
    file: "Raster Bar Rag.sid",
    title: "Raster Bar Rag",
    author: "C64 Commander",
    framesPerStep: 8,
    waveform: "sawtooth",
    voices: [
      ["G4", "B4", "D5", "B4", "G4", "B4", "D5", "F5", "E5", "C5", "A4", "C5", "E5", "C5", "A4", "F#4"],
      ["G3", REST, "D4", REST, "G3", REST, "D4", REST, "C4", REST, "A3", REST, "C4", REST, "A3", REST],
      ["G2", "G2", "D3", "D3", "G2", "G2", "D3", "D3", "C3", "C3", "A2", "A2", "C3", "C3", "A2", "A2"],
    ],
  },
  {
    file: "Loading Screen.sid",
    title: "Loading Screen",
    author: "C64 Commander",
    framesPerStep: 6,
    waveform: "pulse",
    voices: [
      ["A4", "A4", "E5", "E5", "F#5", "F#5", "E5", REST, "D5", "D5", "C#5", "C#5", "B4", "B4", "A4", REST],
      ["A3", REST, "E4", REST, "F#4", REST, "E4", REST, "D4", REST, "C#4", REST, "B3", REST, "A3", REST],
    ],
  },
  {
    file: "Sprite Collision.sid",
    title: "Sprite Collision",
    author: "C64 Commander",
    framesPerStep: 7,
    waveform: "pulse",
    pulseWidth: 0x0400,
    voices: [
      ["E4", "G4", "B4", "E5", "D5", "B4", "G4", "E4", "F4", "A4", "C5", "F5", "E5", "C5", "A4", "F4"],
      ["E3", "E3", "B3", "B3", "E3", "E3", "B3", "B3", "F3", "F3", "C4", "C4", "F3", "F3", "C4", "C4"],
    ],
  },
  {
    file: "Datasette Dreams.sid",
    title: "Datasette Dreams",
    author: "C64 Commander",
    framesPerStep: 20,
    waveform: "triangle",
    voices: [
      ["F4", "A4", "C5", "A4", "G4", "B4", "D5", "B4"],
      ["F3", REST, "C4", REST, "G3", REST, "D4", REST],
      ["F2", "F2", "F2", "F2", "G2", "G2", "G2", "G2"],
    ],
  },
  {
    file: "Kernal Panic.sid",
    title: "Kernal Panic",
    author: "C64 Commander",
    framesPerStep: 5,
    waveform: "sawtooth",
    voices: [
      ["C4", "D#4", "F4", "G4", "A#4", "G4", "F4", "D#4", "C4", "D#4", "F4", "A#4", "C5", "A#4", "F4", "D#4"],
      ["C3", REST, "F3", REST, "A#3", REST, "F3", REST, "C3", REST, "F3", REST, "A#3", REST, "F3", REST],
    ],
  },
  {
    file: "Ready Prompt.sid",
    title: "Ready Prompt",
    author: "C64 Commander",
    framesPerStep: 14,
    waveform: "triangle",
    voices: [
      ["C5", "B4", "A4", "G4", "F4", "E4", "D4", "C4"],
      ["C3", "G3", "A3", "E3", "F3", "C3", "G3", "C3"],
    ],
  },
];

// ── the programs ───────────────────────────────────────────────────────────────────────────────

const HELLO_PRG = buildBasicPrg([
  [10, 'PRINT "HELLO FROM THE SIMULATED C64"'],
  [20, 'PRINT "C64 COMMANDER DEMO MODE"'],
  [30, "FOR I=0 TO 15"],
  [40, "POKE 53280,I"],
  [50, "FOR J=0 TO 200"],
  [60, "NEXT J"],
  [70, "NEXT I"],
  [80, "GOTO 30"],
]);

const BORDERS_PRG = buildBasicPrg([
  [10, 'PRINT "RASTER BARS"'],
  [20, "POKE 53280,RND(1)*16"],
  [30, "POKE 53281,RND(1)*16"],
  [40, "GOTO 20"],
]);

const SCROLLER_PRG = buildBasicPrg([
  [10, 'PRINT "GREETINGS FROM C64 COMMANDER"'],
  [20, 'PRINT "THIS DISK IS SIMULATED"'],
  [30, "FOR I=0 TO 500"],
  [40, "NEXT I"],
  [50, "GOTO 10"],
]);

const MENU_PRG = buildBasicPrg([
  [10, 'PRINT "SAMPLE QUEST"'],
  [20, 'PRINT "1. START"'],
  [30, 'PRINT "2. HIGH SCORES"'],
  [40, 'PRINT "3. QUIT"'],
  [50, "GOTO 50"],
]);

// ── the tree ───────────────────────────────────────────────────────────────────────────────────

const sidFor = (tune) => ({
  bytes: buildSid(tune),
  seconds: tuneSeconds(tune.voices, tune.framesPerStep),
});

const buildTree = () => {
  const files = new Map();
  const put = (path, bytes) => files.set(path, Buffer.from(bytes));

  const tunes = TUNES.map((tune) => ({ tune, built: sidFor(tune) }));
  for (const { tune, built } of tunes) put(join("Usb0", "Music", tune.file), built.bytes);

  // A songlengths database in the HVSC format, so the playlist shows a duration for these tunes
  // the same way it does for a tune from HVSC rather than falling back to a default.
  const md5 = (bytes) => createHash("md5").update(bytes).digest("hex");
  const songlengths = [
    "[Database]",
    ...tunes.map(({ tune, built }) => {
      const total = Math.round(built.seconds);
      const stamp = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
      return `${md5(built.bytes)}=${stamp} ; Usb0/Music/${tune.file}`;
    }),
    "",
  ].join("\n");
  put(join("Usb0", "Music", "Songlengths.md5"), Buffer.from(songlengths, "latin1"));

  put(join("Usb0", "Carts", "Demo Cartridge.crt"), buildCrt({ name: "C64 COMMANDER DEMO CART" }));
  put(join("Usb0", "Carts", "Sample Action.crt"), buildCrt({ name: "SAMPLE ACTION CARTRIDGE" }));

  put(join("Usb0", "Programs", "Hello.prg"), HELLO_PRG);
  put(join("Usb0", "Programs", "Borders.prg"), BORDERS_PRG);
  put(join("Usb0", "Programs", "Scroller.prg"), SCROLLER_PRG);

  put(
    join("Usb0", "Games", "Sample Quest", "Side A.d64"),
    buildD64({
      diskName: "SAMPLE QUEST A",
      diskId: "SQ",
      files: [
        { name: "MENU", data: MENU_PRG },
        { name: "HELLO", data: HELLO_PRG },
        { name: "SCROLLER", data: SCROLLER_PRG },
      ],
    }),
  );
  put(
    join("Usb0", "Games", "Sample Quest", "Side B.d64"),
    buildD64({
      diskName: "SAMPLE QUEST B",
      diskId: "SQ",
      files: [
        { name: "LEVEL 2", data: BORDERS_PRG },
        { name: "CREDITS", data: SCROLLER_PRG },
      ],
    }),
  );
  for (const disk of [1, 2, 3]) {
    put(
      join("Usb0", "Games", "Sample Arcade", `Disk ${disk}.d64`),
      buildD64({
        diskName: `SAMPLE ARCADE ${disk}`,
        diskId: `A${disk}`,
        files: [
          { name: `ARCADE ${disk}`, data: MENU_PRG },
          { name: "BORDERS", data: BORDERS_PRG },
        ],
      }),
    );
  }
  for (const part of [1, 2]) {
    put(
      join("Usb0", "Demos", "Demo Collection", `Part ${part}.d64`),
      buildD64({
        diskName: `DEMO PART ${part}`,
        diskId: `D${part}`,
        files: [
          { name: `PART ${part}`, data: SCROLLER_PRG },
          { name: "BORDERS", data: BORDERS_PRG },
        ],
      }),
    );
  }

  return files;
};

// ── entry point ────────────────────────────────────────────────────────────────────────────────

const listExisting = (root) => {
  const out = new Map();
  const walk = (directory) => {
    for (const entry of readdirSync(directory)) {
      const full = join(directory, entry);
      if (statSync(full).isDirectory()) walk(full);
      else out.set(relative(root, full), readFileSync(full));
    }
  };
  try {
    walk(root);
  } catch {
    // No tree yet, which `--check` reports as drift and a write run creates.
  }
  return out;
};

const main = () => {
  const wanted = buildTree();
  const check = process.argv.includes("--check");
  const existing = listExisting(FTP_ROOT);

  if (check) {
    const problems = [];
    for (const [path, bytes] of wanted) {
      const actual = existing.get(path);
      if (!actual) problems.push(`missing: ${path}`);
      else if (!actual.equals(bytes)) problems.push(`stale:   ${path}`);
    }
    for (const path of existing.keys()) if (!wanted.has(path)) problems.push(`extra:   ${path}`);
    if (problems.length > 0) {
      for (const problem of problems) console.error(problem);
      console.error("Run: npm run demo-device:build");
      process.exit(1);
    }
    console.log(`Simulated device content is up to date (${wanted.size} files).`);
    return;
  }

  rmSync(FTP_ROOT, { recursive: true, force: true });
  for (const [path, bytes] of wanted) {
    const full = join(FTP_ROOT, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, bytes);
  }
  const total = [...wanted.values()].reduce((sum, bytes) => sum + bytes.length, 0);
  console.log(`Wrote ${wanted.size} files (${(total / 1024).toFixed(0)} KiB) to ${FTP_ROOT}`);
  for (const [path, bytes] of wanted) {
    const kind = bytes.length === D64_BYTES ? "d64" : path.endsWith(".sid") ? "sid" : path.endsWith(".prg") ? "prg" : "";
    console.log(`  ${String(bytes.length).padStart(7)}  ${kind.padEnd(3)}  ${path}`);
  }
};

main();
