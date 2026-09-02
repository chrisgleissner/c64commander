#!/usr/bin/env node
/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Build the assets Demo Mode's synthetic Live View stream is made of.
 *
 * The simulated device streams a C64 screen, not a test pattern: the point of Demo Mode is to show
 * the app behaving as it does against real hardware, and against real hardware Live View shows
 * whatever the machine is doing — a BASIC prompt, a program loading, a program running. So the
 * device side draws a 40x25 text screen, and this supplies the two things it cannot make up:
 *
 * - `font8x8.bin` — 96 glyphs for ASCII 32..127, 8 rows each, one byte per row, bit 7 leftmost.
 *   Authored in `demoDevice/font.mjs`, because the C64's own character generator is Commodore ROM.
 * - `tone-ladder.json` — the eighteen tone-ladder slots, taken from `src/lib/streams/toneLadder.ts`
 *   so the mock stream and the app measure the same ladder. Duplicating the table in Kotlin would
 *   let the two drift apart silently, and the drift would look like a broken stream.
 *
 * Plus `docs/img/demo-stream-screen.png`, a render of the idle screen for review; nothing reads it.
 *
 *   npx vite-node --script scripts/build-demo-stream-assets.ts           # write the assets
 *   npx vite-node --script scripts/build-demo-stream-assets.ts --check   # fail if any has drifted
 */

import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { TONE_LADDER_SLOTS, TONE_LADDER_SLOT_SECONDS } from "../src/lib/streams/toneLadder";
import { FIRST_CODE, GLYPH_BYTES, GLYPH_COUNT, buildFont } from "./demoDevice/font.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const FONT_PATH = resolve(ROOT, "android/app/src/main/assets/demo-stream/font8x8.bin");
const LADDER_PATH = resolve(ROOT, "android/app/src/main/assets/demo-stream/tone-ladder.json");
const PNG_PATH = resolve(ROOT, "docs/img/demo-stream-screen.png");
const PALETTE_PATH = resolve(ROOT, "src/assets/palettes/default.vpl");

// The streamed frame, and where the C64's 40x25 text screen sits inside it. A PAL VIC puts 320x200
// of text in the middle of a 384x272 frame; the rest is border.
const WIDTH = 384;
const HEIGHT = 272;
const COLUMNS = 40;
const ROWS = 25;
const TEXT_LEFT = (WIDTH - COLUMNS * 8) / 2; // 32
const TEXT_TOP = (HEIGHT - ROWS * 8) / 2; // 36

const LIGHT_BLUE = 14;
const BLUE = 6;

const font = buildFont();

const drawScreen = (lines: string[], border: number, background: number, foreground: number) => {
  const frame = new Uint8Array(WIDTH * HEIGHT).fill(border);
  for (let y = 0; y < ROWS * 8; y += 1) {
    for (let x = 0; x < COLUMNS * 8; x += 1) frame[(TEXT_TOP + y) * WIDTH + TEXT_LEFT + x] = background;
  }
  lines.forEach((line, row) => {
    if (row >= ROWS) return;
    for (let column = 0; column < Math.min(line.length, COLUMNS); column += 1) {
      const code = line.charCodeAt(column);
      const index = code < FIRST_CODE || code >= FIRST_CODE + GLYPH_COUNT ? 0 : code - FIRST_CODE;
      for (let y = 0; y < 8; y += 1) {
        const bits = font[index * GLYPH_BYTES + y];
        for (let x = 0; x < 8; x += 1) {
          if ((bits & (0x80 >> x)) === 0) continue;
          frame[(TEXT_TOP + row * 8 + y) * WIDTH + TEXT_LEFT + column * 8 + x] = foreground;
        }
      }
    }
  });
  return frame;
};

/** The screen a C64 shows when it is switched on, which is what the simulated device shows at idle. */
const READY_SCREEN = [
  "",
  "    **** COMMODORE 64 BASIC V2 ****",
  "",
  " 64K RAM SYSTEM  38911 BASIC BYTES FREE",
  "",
  "READY.",
  "",
];

const readPalette = () => {
  const rgb: number[][] = [];
  for (const line of readFileSync(PALETTE_PATH, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed
      .split(/\s+/)
      .slice(0, 3)
      .map((value) => Number.parseInt(value, 16));
    if (parts.length < 3 || parts.some((value) => Number.isNaN(value))) continue;
    rgb.push(parts);
    if (rgb.length === 16) break;
  }
  if (rgb.length !== 16) throw new Error(`Expected 16 palette entries in ${PALETTE_PATH}, got ${rgb.length}`);
  return rgb;
};

// ── minimal PNG encoder (review artefact only; the APK ships no picture) ─────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (buffer: Buffer) => {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type: string, data: Buffer) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
};

const encodePng = (indices: Uint8Array, palette: number[][]) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(WIDTH, 0);
  ihdr.writeUInt32BE(HEIGHT, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 3; // colour type: indexed
  const raw = Buffer.alloc((WIDTH + 1) * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    raw[y * (WIDTH + 1)] = 0; // filter: none
    for (let x = 0; x < WIDTH; x += 1) raw[y * (WIDTH + 1) + 1 + x] = indices[y * WIDTH + x];
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("PLTE", Buffer.from(palette.flat())),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

// ── entry point ─────────────────────────────────────────────────────────────────────────────────

const digest = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex").slice(0, 16);

/**
 * The ladder as the device side needs it: whole slots in play order, each with the note to
 * synthesise and the palette index to put on the border. A silent slot has `hz: 0` and no colour of
 * its own — it holds the previous slot's colour, which is what makes the silences landmarks in the
 * picture as well as in the sound.
 */
const encodeLadder = () =>
  Buffer.from(
    `${JSON.stringify(
      {
        generatedBy: "scripts/build-demo-stream-assets.ts",
        slotSeconds: TONE_LADDER_SLOT_SECONDS,
        slots: TONE_LADDER_SLOTS.map((slot) => ({
          index: slot.index,
          name: slot.name,
          hz: slot.hz,
          colour: slot.colour,
        })),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

const main = () => {
  const check = process.argv.includes("--check");
  const png = encodePng(drawScreen(READY_SCREEN, LIGHT_BLUE, BLUE, LIGHT_BLUE), readPalette());

  const outputs: [string, Buffer][] = [
    [FONT_PATH, font],
    [LADDER_PATH, encodeLadder()],
    [PNG_PATH, png],
  ];

  if (check) {
    const stale = outputs.filter(([path, expected]) => {
      let actual;
      try {
        actual = readFileSync(path);
      } catch {
        return true;
      }
      return !actual.equals(expected);
    });
    if (stale.length > 0) {
      for (const [path, expected] of stale) console.error(`Stale: ${path} (expected sha256:${digest(expected)})`);
      console.error("Run: npm run demo-stream:build");
      process.exit(1);
    }
    console.log("Demo Mode stream assets are up to date.");
    return;
  }

  for (const [path, data] of outputs) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, data);
    console.log(`Wrote ${path} (${data.length} bytes, sha256:${digest(data)})`);
  }
};

main();
