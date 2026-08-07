/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * The line under the now-playing title: everything the tune's own SID header says about itself.
 *
 * One line rather than a scatter of badges around the title, because the title line has a job of its
 * own — the name on the left, the ranking actions on the right, and those actions in the same place
 * on every tune. Anything else on that line pushes them about.
 *
 * Order is fixed, and a field the file does not carry is left out along with its separator, so a
 * sparse header reads as a short line rather than as a line with holes in it:
 *
 *   Author - Released [- SID model [/ model 2 [/ model 3]]] [- video standard] [- Tune x of y] - Length
 *
 * Every field here comes from `parseSidHeaderMetadata`, which reads the header the player itself
 * obeys. Nothing is guessed from a file name: a tune whose header does not declare its clock simply
 * does not say, which is honest, where "PAL because the path said so" would not be.
 */

import type { SidClock, SidModel } from "@/lib/sid/sidUtils";

export interface NowPlayingMetadataInput {
  author: string | null;
  released: string | null;
  /**
   * One entry per chip the file actually addresses, in header order.
   *
   * A single-chip tune has one; a 2SID or 3SID has two or three, and they need not be the same
   * model — which is exactly why the models are listed rather than counted.
   */
  sidModels: (SidModel | null | undefined)[];
  clock: SidClock | null;
  /** Which tune of the file is playing, and how many it holds. */
  tuneNumber: number | null;
  tuneCount: number | null;
  /** The tune's length, already formatted, e.g. "3:12". */
  lengthLabel: string | null;
}

/**
 * `both` is the header saying the composer was happy either way, which is a real thing to know and
 * not the same as not saying — so it is spelled out rather than folded into one of the two models.
 */
const SID_MODEL_LABELS: Record<SidModel, string | null> = {
  mos6581: "6581",
  mos8580: "8580",
  both: "6581 or 8580",
  unknown: null,
};

const CLOCK_LABELS: Record<SidClock, string | null> = {
  pal: "PAL",
  ntsc: "NTSC",
  pal_ntsc: "PAL/NTSC",
  unknown: null,
};

/**
 * How the fields are separated on screen.
 *
 * A middle dot rather than a hyphen. Several of these fields legitimately contain a hyphen —
 * publishers ("Virgin/Acclaim", "Maniacs of Noise - Team"), hyphenated tune names, and the
 * `PAL/NTSC` clock — so a hyphen separator reads as part of the value it is meant to divide. The dot
 * cannot occur inside a field, so the line stays scannable however odd the metadata is.
 */
export const NOW_PLAYING_METADATA_SEPARATOR = " · ";
/**
 * Chips are separated by a slash with spaces around it, not a bare one.
 *
 * A model can itself be a phrase ("6581 or 8580"), so a bare slash would run two chips together into
 * something unreadable.
 */
const SID_MODEL_SEPARATOR = " / ";

const clean = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

/**
 * Which of the two metadata lines a segment belongs on.
 *
 * `credits` is who made it and when: the author and the HVSC `released` value, which is a
 * single field holding both year and publisher and is never split. `facts` is what the file
 * is: chip, video standard, which tune of how many, how long. The split exists so the
 * narrow screen can put the dislike and favourite actions at the right of the facts line
 * instead of spending a row of their own on them.
 */
export type NowPlayingMetadataRow = "credits" | "facts";

export type NowPlayingMetadataSegment = {
  text: string;
  /**
   * Which field a segment came from.
   *
   * Two are named, because two of them are somewhere to go rather than something to read. The
   * author is a person, and "more by this person" is a real question. The tune position says the
   * file holds others and gives no way to reach them. Everything else is a fact about the file
   * and is rendered as text.
   */
  kind: "author" | "tunes" | "detail";
  row: NowPlayingMetadataRow;
};

/**
 * The fields in order, ready to be joined.
 *
 * Returned as segments rather than one string so a caller can render them apart if it ever wants to,
 * and so the tests can name what is missing rather than diff a sentence.
 */
export const buildNowPlayingMetadataSegments = (input: NowPlayingMetadataInput): string[] =>
  buildNowPlayingMetadataParts(input).map((part) => part.text);

/** The same segments, each labelled with where it came from. */
export const buildNowPlayingMetadataParts = (input: NowPlayingMetadataInput): NowPlayingMetadataSegment[] => {
  const segments: NowPlayingMetadataSegment[] = [];
  const push = (text: string, row: NowPlayingMetadataRow, kind: NowPlayingMetadataSegment["kind"] = "detail") =>
    segments.push({ text, kind, row });

  const author = clean(input.author);
  if (author) push(author, "credits", "author");

  // One field, printed whole. HVSC stores "1985 Gremlin Graphics" as a single released
  // value, and splitting the year from the publisher would invent a distinction the
  // archive does not make and would sometimes be wrong about which half is which.
  const released = clean(input.released);
  if (released) push(released, "credits");

  // An unnamed chip is dropped rather than shown as a gap or guessed at. In practice this costs
  // nothing on multi-chip tunes: addressing a second chip needs a version 3 header, and every header
  // from version 2 carries the flags word the models are read from.
  const models = input.sidModels
    .map((model) => (model ? SID_MODEL_LABELS[model] : null))
    .filter((label): label is string => Boolean(label));
  if (models.length) push(models.join(SID_MODEL_SEPARATOR), "facts");

  const clock = input.clock ? CLOCK_LABELS[input.clock] : null;
  if (clock) push(clock, "facts");

  // "1/19" rather than "Tune 1 of 19". The facts line is read as a row of short values and
  // the long form spent most of the line restating what the position already says.
  // Suppressed on a single-tune file, where "1/1" says nothing.
  if (input.tuneNumber && input.tuneCount && input.tuneCount > 1) {
    push(`${input.tuneNumber}/${input.tuneCount}`, "facts", "tunes");
  }

  const length = clean(input.lengthLabel);
  if (length) push(length, "facts");

  return segments;
};

/** The whole line, or null when the header said nothing worth a line. */
export const buildNowPlayingMetadata = (input: NowPlayingMetadataInput): string | null => {
  const segments = buildNowPlayingMetadataSegments(input);
  return segments.length ? segments.join(NOW_PLAYING_METADATA_SEPARATOR) : null;
};

/**
 * The STIL line: what this tune is called, and who wrote the music.
 *
 * Separate from the header line above because the two disagree by design. The header names whoever
 * produced the C64 version; a large share of C64 music is an arrangement of something else, and
 * STIL is the only record of the original. Spelled out as "music by" rather than the conventional
 * "after", which assumes the reader knows the term.
 *
 * Returns null when STIL has neither, which is the case for most of the archive.
 */
export const buildStilTuneLine = (input: { title: string | null; originalArtist: string | null }): string | null => {
  const title = clean(input.title);
  const artist = clean(input.originalArtist);
  const segments: string[] = [];
  if (title) segments.push(title);
  if (artist) segments.push(`music by ${artist}`);
  return segments.length ? segments.join(NOW_PLAYING_METADATA_SEPARATOR) : null;
};
