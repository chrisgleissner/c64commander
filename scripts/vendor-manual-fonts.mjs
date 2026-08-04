#!/usr/bin/env node
/*
 * Vendors the manual's print fonts into `scripts/vendor/fonts/` as subsetted WOFF2.
 *
 * The PDF is a print master: a font that is merely *named* in CSS is a font that
 * silently substitutes on any machine that lacks it, and a substituted face
 * changes line breaks, page breaks and every cross-reference page number. So the
 * faces are embedded as data URIs from files committed to the repository, and
 * this script is what produces those files.
 *
 * Run it only when the font set changes. It needs the Debian `fonts-ibm-plex`
 * and `fonts-dejavu-core` packages plus Python `fonttools` with brotli, none of
 * which the ordinary build requires — the committed WOFF2 files are the build
 * input, not these sources.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(scriptDir, "vendor/fonts");

const PLEX = "/usr/share/fonts/truetype/ibm-plex";
const DEJAVU = "/usr/share/fonts/truetype/dejavu";

/**
 * Latin text plus the punctuation and symbols the manual actually sets.
 *
 * Generous rather than exact: a subset pinned to today's glyph inventory turns
 * tomorrow's em dash into a missing-glyph box, and nobody proof-reads a PDF for
 * boxes. The ranges below still cut each face to a few tens of kilobytes.
 */
const UNICODES = [
  "U+0000-00FF", // Basic Latin + Latin-1 Supplement
  "U+0100-017F", // Latin Extended-A (accented names in credits)
  "U+2000-206F", // General Punctuation (dashes, curly quotes, ellipsis, bullet)
  "U+20A0-20BF", // Currency
  "U+2122", // trademark
  "U+2190-21FF", // Arrows (UI paths: Settings -> Play and Disk)
  "U+2212", // true minus
  "U+2215", // division slash
  "U+25A0-25FF", // Geometric shapes
  "U+2600-26FF", // Miscellaneous symbols
  "U+2700-27BF", // Dingbats
  "U+22EF", // midline horizontal ellipsis (the three-dot menu)
  "U+23E9-23FA", // media control symbols
].join(",");

/** [source file, output basename] */
const FACES = [
  [`${PLEX}/IBMPlexSerif-Regular.ttf`, "plex-serif-regular"],
  [`${PLEX}/IBMPlexSerif-Italic.ttf`, "plex-serif-italic"],
  [`${PLEX}/IBMPlexSerif-SemiBold.ttf`, "plex-serif-semibold"],
  [`${PLEX}/IBMPlexSerif-SemiBoldItalic.ttf`, "plex-serif-semibolditalic"],
  [`${PLEX}/IBMPlexSans-Regular.ttf`, "plex-sans-regular"],
  [`${PLEX}/IBMPlexSans-Italic.ttf`, "plex-sans-italic"],
  [`${PLEX}/IBMPlexSans-Medium.ttf`, "plex-sans-medium"],
  [`${PLEX}/IBMPlexSans-SemiBold.ttf`, "plex-sans-semibold"],
  [`${PLEX}/IBMPlexSans-Bold.ttf`, "plex-sans-bold"],
  [`${PLEX}/IBMPlexMono-Regular.ttf`, "plex-mono-regular"],
  [`${PLEX}/IBMPlexMono-SemiBold.ttf`, "plex-mono-semibold"],
  [`${DEJAVU}/DejaVuSans.ttf`, "symbols-fallback"],
];

mkdirSync(outDir, { recursive: true });

let total = 0;
for (const [source, basename] of FACES) {
  if (!existsSync(source)) throw new Error(`missing font source: ${source}`);
  const output = path.join(outDir, `${basename}.woff2`);
  execFileSync("python3", [
    "-m",
    "fontTools.subset",
    source,
    `--unicodes=${UNICODES}`,
    "--layout-features=kern,liga,calt,onum,lnum,tnum,frac,ccmp,locl,mark,mkmk",
    "--flavor=woff2",
    "--desubroutinize",
    "--no-hinting",
    "--drop-tables+=DSIG",
    `--output-file=${output}`,
  ]);
  const bytes = statSync(output).size;
  total += bytes;
  console.log(`${basename}.woff2  ${(bytes / 1024).toFixed(1)} kB`);
}
console.log(`total ${(total / 1024).toFixed(1)} kB in ${path.relative(process.cwd(), outDir)}`);
