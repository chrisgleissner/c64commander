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
 * Demo Mode's Live View needs a picture the eye can grade: a test card with known geometry and
 * known colours, so a viewer can tell at a glance whether the frame arrived whole, in the right
 * order, in the right colours and the right way up. A procedural pattern cannot do that — a
 * scrolling gradient looks equally plausible mirrored, half-decoded, or with its nibbles swapped.
 *
 * `MockStreamServer` reads both at startup, tints the surround for each tone-ladder slot and
 * packetises the result. Two assets:
 *
 * - `testcard.vic4` — one 384x272 PAL frame, one nibble per pixel, two pixels per byte, LOW
 *   nibble first (the left pixel), rows top to bottom: the exact layout `vicDecode.ts` and
 *   `VicFrameAssembler` decode. Committed and shipped as an APK asset rather than drawn on the
 *   device, so the picture under test is reviewable here, is byte-identical on every run, and
 *   costs the phone nothing beyond a file read.
 * - `testcard-surround.mask` — one bit per pixel, set where that pixel is surround, LSB first.
 *   The surround is the part the device tints with the current slot's colour. It is a separate
 *   mask rather than "every pixel that is light blue" because the card's colour-bar strip shows
 *   all sixteen palette indices, light blue among them, and that bar must keep its own colour.
 * - `tone-ladder.json` — the eighteen tone-ladder slots, taken from `src/lib/streams/toneLadder.ts`
 *   so the mock stream and the app measure the same ladder. Duplicating the table in Kotlin would
 *   let the two drift apart silently, and the drift would look like a broken stream.
 *
 * Plus `docs/img/demo-stream-testcard.png`, which is only for review; nothing reads it.
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

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const ASSET_PATH = resolve(ROOT, "android/app/src/main/assets/demo-stream/testcard.vic4");
const MASK_PATH = resolve(ROOT, "android/app/src/main/assets/demo-stream/testcard-surround.mask");
const LADDER_PATH = resolve(ROOT, "android/app/src/main/assets/demo-stream/tone-ladder.json");
const PNG_PATH = resolve(ROOT, "docs/img/demo-stream-testcard.png");
const PALETTE_PATH = resolve(ROOT, "src/assets/palettes/default.vpl");

const WIDTH = 384;
const HEIGHT = 272;

// VIC palette indices, by name, so the drawing below reads as colours rather than as numbers.
const BLACK = 0;
const WHITE = 1;
const RED = 2;
const CYAN = 3;
const PURPLE = 4;
const GREEN = 5;
const BLUE = 6;
const YELLOW = 7;
const ORANGE = 8;
const BROWN = 9;
const PINK = 10;
const DARK_GREY = 11;
const GREY = 12;
const LIGHT_GREEN = 13;
const LIGHT_BLUE = 14;
const LIGHT_GREY = 15;

/**
 * The index the surround is drawn in here, and the one `MockStreamServer` replaces with the
 * current tone-ladder slot colour. Light blue is the C64's own default background, so the
 * committed PNG looks like a C64 screen; nothing else in the card may use it.
 */
const SURROUND = LIGHT_BLUE;

// The card body sits on a fixed black panel so its content stays legible against all sixteen
// surround colours. Everything outside the panel is surround, which is what the slot tints.
const PANEL_X = 48;
const PANEL_Y = 40;
const PANEL_W = 288;
const PANEL_H = 192;

const frame = new Uint8Array(WIDTH * HEIGHT).fill(SURROUND);

const px = (x: number, y: number, colour: number) => {
  if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
  frame[y * WIDTH + x] = colour;
};

const rect = (x: number, y: number, w: number, h: number, colour: number) => {
  for (let dy = 0; dy < h; dy += 1) for (let dx = 0; dx < w; dx += 1) px(x + dx, y + dy, colour);
};

const frameRect = (x: number, y: number, w: number, h: number, colour: number, thickness = 1) => {
  for (let t = 0; t < thickness; t += 1) {
    for (let dx = 0; dx < w; dx += 1) {
      px(x + dx, y + t, colour);
      px(x + dx, y + h - 1 - t, colour);
    }
    for (let dy = 0; dy < h; dy += 1) {
      px(x + t, y + dy, colour);
      px(x + w - 1 - t, y + dy, colour);
    }
  }
};

/**
 * A 5x7 pixel font, authored here rather than borrowed: the C64's own character generator is
 * Commodore ROM. Only the glyphs the card actually uses are defined; `text()` rejects anything
 * else rather than silently dropping it.
 */
const FONT: Record<string, readonly string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
};

const GLYPH_W = 5;
const GLYPH_H = 7;

const textWidth = (value: string, scale: number, spacing: number) =>
  value.length * (GLYPH_W * scale + spacing) - spacing;

const text = (value: string, x: number, y: number, colour: number, scale = 1, spacing = 1) => {
  let cursor = x;
  for (const character of value) {
    const glyph = FONT[character];
    if (!glyph) throw new Error(`No glyph for ${JSON.stringify(character)}; add it to FONT.`);
    for (let row = 0; row < GLYPH_H; row += 1) {
      for (let column = 0; column < GLYPH_W; column += 1) {
        if (glyph[row][column] !== "1") continue;
        rect(cursor + column * scale, y + row * scale, scale, scale, colour);
      }
    }
    cursor += GLYPH_W * scale + spacing;
  }
};

const centredText = (value: string, y: number, colour: number, scale: number, spacing = scale) => {
  text(value, Math.round((WIDTH - textWidth(value, scale, spacing)) / 2), y, colour, scale, spacing);
};

const drawCard = () => {
  // Registration marks in the four corners of the surround. A frame assembled from the wrong
  // line offset, or flipped, loses these before it loses anything else.
  for (const [cx, cy] of [
    [0, 0],
    [WIDTH - 16, 0],
    [0, HEIGHT - 16],
    [WIDTH - 16, HEIGHT - 16],
  ]) {
    rect(cx, cy, 16, 16, WHITE);
    rect(cx + 4, cy + 4, 8, 8, BLACK);
  }

  // Castellation combs along the top and bottom edges: alternate single-pixel columns. They are
  // the finest detail on the card, so any horizontal resampling or nibble-order error smears them
  // into flat grey while the rest of the picture still looks correct.
  for (let x = 24; x < WIDTH - 24; x += 2) {
    rect(x, 2, 1, 10, WHITE);
    rect(x, HEIGHT - 12, 1, 10, WHITE);
  }

  rect(PANEL_X, PANEL_Y, PANEL_W, PANEL_H, BLACK);
  frameRect(PANEL_X, PANEL_Y, PANEL_W, PANEL_H, WHITE, 2);

  centredText("C64 COMMANDER", PANEL_Y + 12, WHITE, 3);
  centredText("DEMO MODE", PANEL_Y + 40, LIGHT_GREY, 2);

  // All sixteen palette indices, in register order. A palette applied in the wrong order, or a
  // decoder that masks the high nibble, shows here before it shows anywhere else.
  const barsY = PANEL_Y + 60;
  const barW = Math.floor((PANEL_W - 32) / 16);
  for (let index = 0; index < 16; index += 1) {
    rect(PANEL_X + 16 + index * barW, barsY, barW, 28, index);
    // A hairline between bars, so index 0 (black) stays countable against the black panel and a
    // pair of adjacent similar greys cannot read as one wide bar.
    if (index > 0) rect(PANEL_X + 16 + index * barW, barsY, 1, 28, WHITE);
  }
  frameRect(PANEL_X + 16, barsY, barW * 16, 28, WHITE, 1);

  // The exact geometric centre of the frame, kept clear of every other element so a viewer can
  // see at a glance whether the picture is centred, and ticks on each panel edge pointing at it.
  const midX = WIDTH / 2;
  const midY = HEIGHT / 2;
  rect(midX - 14, midY - 1, 28, 2, WHITE);
  rect(midX - 1, midY - 14, 2, 28, WHITE);
  rect(PANEL_X + 4, midY - 1, 10, 2, RED);
  rect(PANEL_X + PANEL_W - 14, midY - 1, 10, 2, RED);
  rect(midX - 1, PANEL_Y + 4, 2, 6, RED);
  rect(midX - 1, PANEL_Y + PANEL_H - 10, 2, 6, RED);

  // The greyscale ramp the VIC actually has: black, dark grey, grey, light grey, white.
  const rampY = PANEL_Y + 112;
  const ramp = [BLACK, DARK_GREY, GREY, LIGHT_GREY, WHITE];
  const rampW = Math.floor((PANEL_W - 32) / ramp.length);
  ramp.forEach((colour, index) => {
    rect(PANEL_X + 16 + index * rampW, rampY, rampW, 22, colour);
  });
  frameRect(PANEL_X + 16, rampY, rampW * ramp.length, 22, WHITE, 1);

  // Colour-fringe probes: one-pixel and three-pixel bars of ten saturated indices on black. A
  // decoder that averages neighbouring pixels turns the one-pixel bars into a smear while the
  // three-pixel ones survive, which separates a resampling fault from a palette fault.
  const probeY = PANEL_Y + 144;
  [RED, GREEN, BLUE, YELLOW, PURPLE, CYAN, ORANGE, BROWN, PINK, LIGHT_GREEN].forEach((colour, index) => {
    rect(PANEL_X + 20 + index * 24, probeY, 1, 20, colour);
    rect(PANEL_X + 26 + index * 24, probeY, 3, 20, colour);
  });
};

/**
 * One bit per pixel, LSB first within each byte, set where the pixel is surround.
 *
 * Surround means: outside the card's panel AND still holding the surround colour. Both halves
 * matter. Without the panel test, the colour-bar strip's light-blue bar would be tinted along with
 * the surround, silently turning the sixteen-colour check into a fifteen-colour one. Without the
 * colour test, the registration marks and castellations drawn on the surround would be tinted away.
 */
const packSurroundMask = (indices: Uint8Array) => {
  const mask = new Uint8Array((WIDTH * HEIGHT) / 8);
  for (let i = 0; i < indices.length; i += 1) {
    const x = i % WIDTH;
    const y = Math.floor(i / WIDTH);
    const insidePanel = x >= PANEL_X && x < PANEL_X + PANEL_W && y >= PANEL_Y && y < PANEL_Y + PANEL_H;
    if (!insidePanel && indices[i] === SURROUND) mask[i >> 3] |= 1 << (i & 7);
  }
  return mask;
};

/** Pack one index per pixel into 4bpp, low nibble = left pixel. */
const packFrame = (indices: Uint8Array) => {
  const packed = new Uint8Array((WIDTH * HEIGHT) / 2);
  for (let i = 0; i < packed.length; i += 1) {
    packed[i] = (indices[i * 2] & 0x0f) | ((indices[i * 2 + 1] & 0x0f) << 4);
  }
  return packed;
};

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

// ── minimal PNG encoder (review artefact only; the APK ships the raw frame) ──────────────────

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
  const plte = Buffer.from(palette.flat());
  const raw = Buffer.alloc((WIDTH + 1) * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    raw[y * (WIDTH + 1)] = 0; // filter: none
    for (let x = 0; x < WIDTH; x += 1) raw[y * (WIDTH + 1) + 1 + x] = indices[y * WIDTH + x];
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("PLTE", plte),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

// ── entry point ─────────────────────────────────────────────────────────────────────────────

const digest = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex").slice(0, 16);

/**
 * The ladder as the device side needs it: whole slots in play order, each with the note to
 * synthesise and the palette index to tint the surround with. A silent slot has `hz: 0` and no
 * colour of its own — it holds the previous slot's colour, which is what makes the silences
 * landmarks in the picture as well as in the sound.
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
  drawCard();
  const packed = Buffer.from(packFrame(frame));
  const png = encodePng(frame, readPalette());
  const check = process.argv.includes("--check");

  const outputs: [string, Buffer][] = [
    [ASSET_PATH, packed],
    [MASK_PATH, Buffer.from(packSurroundMask(frame))],
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
      for (const [path, expected] of stale) {
        console.error(`Stale: ${path} (expected sha256:${digest(expected)})`);
      }
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
