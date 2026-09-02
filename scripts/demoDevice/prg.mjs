/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Real BASIC programs for the simulated device.
 *
 * A `.prg` on the simulated device should be a program, not a placeholder: the app reads the load
 * address to decide how to start it, and a disk explorer shows what a file contains. These are
 * tokenised BASIC V2, loading at $0801 like any program a C64 would `LOAD"NAME",8`.
 */

/** BASIC V2 keywords, in token order from $80. Only the ones these programs use are named. */
const TOKENS = {
  END: 0x80,
  FOR: 0x81,
  NEXT: 0x82,
  DATA: 0x83,
  GOTO: 0x89,
  IF: 0x8b,
  RESTORE: 0x8c,
  GOSUB: 0x8d,
  RETURN: 0x8e,
  REM: 0x8f,
  PRINT: 0x99,
  POKE: 0x97,
  RUN: 0x8a,
  THEN: 0xa7,
  TO: 0xa4,
  STEP: 0xa9,
  AND: 0xaf,
  OR: 0xb0,
  PEEK: 0xc2,
  RND: 0xbb,
  INT: 0xb5,
  CHR$: 0xc7,
};

const KEYWORDS = Object.keys(TOKENS).sort((left, right) => right.length - left.length);

/**
 * Tokenise one BASIC line.
 *
 * Text inside quotes is left alone: `PRINT "FOR SALE"` must not turn the word inside the string
 * into a FOR token, which is the classic way a hand-rolled tokeniser corrupts a listing.
 */
const tokenizeLine = (text) => {
  const out = [];
  let index = 0;
  let inQuotes = false;
  while (index < text.length) {
    const character = text[index];
    if (character === '"') {
      inQuotes = !inQuotes;
      out.push(0x22);
      index += 1;
      continue;
    }
    if (!inQuotes) {
      const upper = text.slice(index).toUpperCase();
      const keyword = KEYWORDS.find((candidate) => upper.startsWith(candidate));
      if (keyword) {
        out.push(TOKENS[keyword]);
        index += keyword.length;
        continue;
      }
    }
    const code = text.toUpperCase().charCodeAt(index);
    out.push(code > 0xff ? 0x20 : code);
    index += 1;
  }
  return out;
};

/**
 * A tokenised BASIC program.
 *
 * `lines` is `[[number, "PRINT ..."], …]` in ascending line order. Each line is a link to the next,
 * the line number, the tokens, and a terminating zero; the program ends with a null link.
 */
export const buildBasicPrg = (lines) => {
  const START = 0x0801;
  const bodies = lines.map(([number, text]) => ({ number, tokens: tokenizeLine(text) }));

  // Two passes: the link field of each line is the address of the next, which is not known until
  // every line's length is.
  const lengths = bodies.map((line) => 2 + 2 + line.tokens.length + 1);
  const addresses = [];
  let cursor = START;
  for (const length of lengths) {
    addresses.push(cursor);
    cursor += length;
  }

  const out = [START & 0xff, (START >> 8) & 0xff];
  bodies.forEach((line, index) => {
    const next = index + 1 < addresses.length ? addresses[index + 1] : 0x0000;
    out.push(next & 0xff, (next >> 8) & 0xff);
    out.push(line.number & 0xff, (line.number >> 8) & 0xff);
    out.push(...line.tokens, 0x00);
  });
  out.push(0x00, 0x00); // the null link that ends the program

  return Buffer.from(out);
};

/** The same bytes without the two-byte load address, which is how a file sits inside a disk image. */
export const basicOnDisk = (lines) => buildBasicPrg(lines);
