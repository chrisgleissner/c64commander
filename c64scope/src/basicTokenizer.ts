/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Minimal C64 BASIC V2 tokenizer for generating PRG binaries.
 *
 * Converts BASIC source text into a valid PRG file that can be uploaded
 * to a C64 Ultimate via POST /v1/runners:run_prg.
 *
 * Based on the PRG format documented in c64bridge/data/basic/basic-spec.md:
 *   [load address (2B LE)] [linked lines...] [0x00 0x00 terminator]
 *
 * Each line: [next-ptr (2B LE)] [line# (2B LE)] [tokenised bytes] [0x00]
 */

const DEFAULT_START = 0x0801;

// BASIC V2 token table — keywords sorted longest-first to match greedily.
const TOKEN_TABLE: Array<{ text: string; byte: number }> = buildTokenTable();

/** Convert BASIC source text to a PRG binary (Buffer). */
export function basicToPrg(source: string, startAddress = DEFAULT_START): Buffer {
  const lines = source.replace(/\r\n?/g, "\n").replace(/\n+$/, "").split("\n");

  const lineBuffers: Buffer[] = [];
  let addr = startAddress;

  for (const raw of lines) {
    const trimmed = raw.trimEnd();
    if (trimmed === "") continue;

    const m = /^\s*(\d+)\s*(.*)$/.exec(trimmed);
    if (!m) throw new Error(`Expected line number: "${raw}"`);

    const lineNo = Number.parseInt(m[1]!, 10);
    if (lineNo < 0 || lineNo > 65535) throw new Error(`Line number out of range: ${lineNo}`);

    const content = m[2] ?? "";
    const tokenised = tokenize(content);
    const size = 2 + 2 + tokenised.length + 1; // next-ptr + lineNo + body + null
    const next = addr + size;

    const buf = Buffer.alloc(size);
    buf.writeUInt16LE(next, 0);
    buf.writeUInt16LE(lineNo, 2);
    Buffer.from(tokenised).copy(buf, 4);
    buf[4 + tokenised.length] = 0x00;

    lineBuffers.push(buf);
    addr = next;
  }

  const header = Buffer.alloc(2);
  header.writeUInt16LE(startAddress, 0);

  return Buffer.concat([header, ...lineBuffers, Buffer.from([0x00, 0x00])]);
}

function tokenize(content: string): Uint8Array {
  const upper = content.toUpperCase();
  const bytes: number[] = [];
  let i = 0;
  let inString = false;
  let inRemark = false;

  while (i < content.length) {
    if (!inString && !inRemark) {
      const tok = matchToken(upper, i);
      if (tok) {
        bytes.push(tok.byte);
        i += tok.text.length;
        if (tok.byte === 0x8f) inRemark = true; // REM
        continue;
      }
    }

    const ch = content[i]!;

    if (!inRemark && ch === '"') {
      bytes.push(ch.charCodeAt(0)); // PETSCII " is the same code
      inString = !inString;
      i += 1;
      continue;
    }

    // Uppercase outside strings for consistency (PETSCII uppercase mode)
    const emit = !inString && !inRemark ? upper[i]! : ch;
    bytes.push(emit.charCodeAt(0));
    i += 1;
  }

  if (bytes.length === 0) bytes.push(0x20); // empty line → space
  return Uint8Array.from(bytes);
}

function matchToken(upperSource: string, start: number): { text: string; byte: number } | undefined {
  for (const entry of TOKEN_TABLE) {
    if (upperSource.startsWith(entry.text, start)) return entry;
  }
  return undefined;
}

function buildTokenTable(): Array<{ text: string; byte: number }> {
  const base: Array<[string, number]> = [
    ["END", 0x80],
    ["FOR", 0x81],
    ["NEXT", 0x82],
    ["DATA", 0x83],
    ["INPUT#", 0x84],
    ["INPUT", 0x85],
    ["DIM", 0x86],
    ["READ", 0x87],
    ["LET", 0x88],
    ["GOTO", 0x89],
    ["RUN", 0x8a],
    ["IF", 0x8b],
    ["RESTORE", 0x8c],
    ["GOSUB", 0x8d],
    ["RETURN", 0x8e],
    ["REM", 0x8f],
    ["STOP", 0x90],
    ["ON", 0x91],
    ["WAIT", 0x92],
    ["LOAD", 0x93],
    ["SAVE", 0x94],
    ["VERIFY", 0x95],
    ["DEF", 0x96],
    ["POKE", 0x97],
    ["PRINT#", 0x98],
    ["PRINT", 0x99],
    ["CONT", 0x9a],
    ["LIST", 0x9b],
    ["CLR", 0x9c],
    ["CMD", 0x9d],
    ["SYS", 0x9e],
    ["OPEN", 0x9f],
    ["CLOSE", 0xa0],
    ["GET", 0xa1],
    ["NEW", 0xa2],
    ["TAB(", 0xa3],
    ["TO", 0xa4],
    ["FN", 0xa5],
    ["SPC(", 0xa6],
    ["THEN", 0xa7],
    ["NOT", 0xa8],
    ["STEP", 0xa9],
    ["+", 0xaa],
    ["-", 0xab],
    ["*", 0xac],
    ["/", 0xad],
    ["^", 0xae],
    ["AND", 0xaf],
    ["OR", 0xb0],
    [">", 0xb1],
    ["=", 0xb2],
    ["<", 0xb3],
    ["SGN", 0xb4],
    ["INT", 0xb5],
    ["ABS", 0xb6],
    ["USR", 0xb7],
    ["FRE", 0xb8],
    ["POS", 0xb9],
    ["SQR", 0xba],
    ["RND", 0xbb],
    ["LOG", 0xbc],
    ["EXP", 0xbd],
    ["COS", 0xbe],
    ["SIN", 0xbf],
    ["TAN", 0xc0],
    ["ATN", 0xc1],
    ["PEEK", 0xc2],
    ["LEN", 0xc3],
    ["STR$", 0xc4],
    ["VAL", 0xc5],
    ["ASC", 0xc6],
    ["CHR$", 0xc7],
    ["LEFT$", 0xc8],
    ["RIGHT$", 0xc9],
    ["MID$", 0xca],
    ["GO", 0xcb],
  ];

  // Sort longest-first so e.g. "GOTO" matches before "GO" + "TO"
  return base.map(([text, byte]) => ({ text, byte })).sort((a, b) => b.text.length - a.text.length);
}

// -----------------------------------------------------------------------
// Pre-built BASIC programs for hardware verification
// -----------------------------------------------------------------------

/**
 * A BASIC program that:
 * 1. Sets border color to red (2) and background to blue (6)
 * 2. Prints a visible message
 * 3. Plays a short SID tone (triangle wave) on Voice 1
 * 4. Ends cleanly
 *
 * VIC-II color registers: $D020 = 53280 (border), $D021 = 53281 (background)
 * SID registers: see c64bridge/data/sound/sid-spec.md
 */
export const COLOR_AND_SOUND_PROGRAM = [
  "10 POKE 53280,2:POKE 53281,6",
  "20 PRINT CHR$(147)",
  '30 PRINT "C64SCOPE HARDWARE TEST"',
  '40 PRINT "BORDER=RED BACKGROUND=BLUE"',
  "50 POKE 54296,15",
  "60 POKE 54277,17:POKE 54278,240",
  "70 POKE 54273,45:POKE 54274,0",
  "80 POKE 54276,17",
  "90 FOR I=1 TO 3000:NEXT I",
  "100 POKE 54276,16",
  "110 FOR I=1 TO 500:NEXT I",
  "120 POKE 54273,60:POKE 54274,0",
  "130 POKE 54276,17",
  "140 FOR I=1 TO 3000:NEXT I",
  "150 POKE 54276,0",
  '160 PRINT "TEST COMPLETE"',
].join("\n");

/**
 * Stream validation program with stable, long-lived signal:
 * - Border red (2), background blue (6)
 * - Continuous SID tone (approx. A4)
 * - Infinite loop to keep deterministic A/V output during UDP capture
 */
export const STREAM_VALIDATION_PROGRAM = [
  "10 POKE 53280,2:POKE 53281,6",
  "20 PRINT CHR$(147)",
  '30 PRINT "C64SCOPE STREAM VALIDATION"',
  "40 POKE 54272,72:POKE 54273,29",
  "50 F=PEEK(54272)+256*PEEK(54273)",
  '60 PRINT "BORDER=";PEEK(53280);" BACKGROUND=";PEEK(53281)',
  '70 PRINT "SID FREQ REG=";F;" (~440 HZ)"',
  "80 POKE 54296,15",
  "90 POKE 54277,17:POKE 54278,240",
  "100 POKE 54276,17",
  "110 GOTO 110",
].join("\n");

/** Expected VIC-II register values after COLOR_AND_SOUND_PROGRAM runs line 10. */
export const EXPECTED_BORDER_COLOR = 2; // red
export const EXPECTED_BG_COLOR = 6; // blue
