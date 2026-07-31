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
 * The fields in order, ready to be joined.
 *
 * Returned as segments rather than one string so a caller can render them apart if it ever wants to,
 * and so the tests can name what is missing rather than diff a sentence.
 */
export const buildNowPlayingMetadataSegments = (input: NowPlayingMetadataInput): string[] => {
  const segments: string[] = [];

  const author = clean(input.author);
  if (author) segments.push(author);

  const released = clean(input.released);
  if (released) segments.push(released);

  // An unnamed chip is dropped rather than shown as a gap or guessed at. In practice this costs
  // nothing on multi-chip tunes: addressing a second chip needs a version 3 header, and every header
  // from version 2 carries the flags word the models are read from.
  const models = input.sidModels
    .map((model) => (model ? SID_MODEL_LABELS[model] : null))
    .filter((label): label is string => Boolean(label));
  if (models.length) segments.push(models.join(SID_MODEL_SEPARATOR));

  const clock = input.clock ? CLOCK_LABELS[input.clock] : null;
  if (clock) segments.push(clock);

  // "Tune", never "subsong": the pieces inside a SID file are what a listener is choosing between,
  // and calling them subsongs only ever meant something to the people who wrote the format.
  // Suppressed on a single-tune file, where "Tune 1 of 1" says nothing.
  if (input.tuneNumber && input.tuneCount && input.tuneCount > 1) {
    segments.push(`Tune ${input.tuneNumber} of ${input.tuneCount}`);
  }

  const length = clean(input.lengthLabel);
  if (length) segments.push(length);

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
