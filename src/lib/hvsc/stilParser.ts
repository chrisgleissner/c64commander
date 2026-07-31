/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * The SID Tune Information List, parsed.
 *
 * STIL is a hand-written document shipped in HVSC's `DOCUMENTS/` folder, next to the
 * `Songlengths.md5` the app already reads. It is editorial rather than technical: the archive's
 * editors wrote it, it is not extracted from the files, and it records what a SID header
 * structurally cannot.
 *
 * Two things in particular. A large share of C64 music is a cover — of pop, of film scores, of
 * arcade originals — and the header's author field names whoever converted it, not whoever wrote
 * it. Commando's header says Rob Hubbard; STIL says the music is Tamayo Kawamoto's and Hubbard
 * arranged the arcade score. And a SID holds many tunes, which the header cannot name individually,
 * so a file expanded into its nineteen tunes gives nineteen rows that differ only by length. STIL's
 * per-subsong titles are what turn those into "Title screen", "High score", "Game over".
 */

/** One title, with the original artist where STIL records one. */
export type StilCredit = {
  title: string;
  artist?: string;
};

/**
 * What STIL holds about one file, or about one tune inside it.
 *
 * The same shape serves both because STIL uses the same fields at both levels: a `(#3)` marker
 * switches the following fields from describing the file to describing its third tune.
 */
export type StilInfo = {
  /**
   * Titles of the music, in the order STIL lists them.
   *
   * Usually one. It is a list because a single tune is often a medley, and STIL times the sections
   * — Commando's first tune credits seven, each with the point it arrives at. The first is the
   * one worth showing; the rest are detail for anyone who opens the notes.
   */
  credits?: StilCredit[];
  /** STIL's own name for the tune, where it disagrees with or supplements the header. */
  name?: string;
  /** STIL's own author attribution, distinct from a cover's original `artist`. */
  author?: string;
  /** Free prose. Unbounded in length, which is why nothing displays it without collapsing it. */
  comment?: string;
};

export type StilEntry = StilInfo & {
  /** Per-tune information, keyed by song number as STIL writes it: 1-based, and sparse. */
  subsongs?: Record<number, StilInfo>;
};

/**
 * Field labels are right-aligned so every colon lands in the same column:
 *
 * ```
 * COMMENT: ...
 *  ARTIST: ...
 *   TITLE: ...
 *    NAME: ...
 * ```
 *
 * which leaves continuation lines indented past all of them. That is what makes the format
 * unambiguous, and it matters: comment prose contains its own colon-terminated words ("BTW:",
 * "MG:"), and a looser rule reads those as fields and truncates the comment at them.
 */
const FIELD_LINE = /^ {0,3}(NAME|AUTHOR|TITLE|ARTIST|COMMENT): ?(.*)$/;
/** `(#3)` on a line of its own: everything after it describes the third tune. */
const SUBSONG_LINE = /^\( ?# ?(\d+) ?\)\s*$/;

const isEntryHeading = (line: string) => line.startsWith("/") && line.toLowerCase().endsWith(".sid");

/**
 * Decode STIL's bytes.
 *
 * The file is ISO-8859-1, not UTF-8 — it predates it and has never been converted. Decoding it as
 * UTF-8 does not fail loudly; it silently replaces every accented character, so composer names come
 * out as "Ein Fall f�r Zwei" and stay that way through search and display. `windows-1252` is
 * the label to ask for: it is a superset of ISO-8859-1 and is what every browser implements.
 */
export const decodeStilText = (bytes: Uint8Array): string => new TextDecoder("windows-1252").decode(bytes);

const finishComment = (lines: string[]): string => lines.join("\n").trim();

/**
 * Parse STIL into one entry per file.
 *
 * Written as a single pass over the lines with no backtracking, because the real document is 3.7 MB
 * and this runs on a phone.
 */
export const parseStil = (text: string): Map<string, StilEntry> => {
  const entries = new Map<string, StilEntry>();

  let entry: StilEntry | null = null;
  /** The tune the following fields describe, or null while they describe the whole file. */
  let subsong: number | null = null;
  /** Set while a COMMENT is still absorbing its continuation lines. */
  let commentLines: string[] | null = null;

  const target = (): StilInfo => {
    const current = entry as StilEntry;
    if (subsong === null) return current;
    current.subsongs ??= {};
    current.subsongs[subsong] ??= {};
    return current.subsongs[subsong];
  };

  const closeComment = () => {
    if (!commentLines || !entry) return;
    const comment = finishComment(commentLines);
    commentLines = null;
    if (comment) target().comment = comment;
  };

  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");

    // `###` banners separate the archive's top-level folders and carry nothing.
    if (line.startsWith("#")) {
      closeComment();
      continue;
    }

    if (isEntryHeading(line)) {
      closeComment();
      entry = {};
      subsong = null;
      entries.set(line.trim(), entry);
      continue;
    }

    if (!entry) continue;

    const subsongMatch = SUBSONG_LINE.exec(line);
    if (subsongMatch) {
      closeComment();
      subsong = Number(subsongMatch[1]);
      continue;
    }

    const fieldMatch = FIELD_LINE.exec(line);
    if (fieldMatch) {
      closeComment();
      const [, field, value] = fieldMatch as unknown as [string, string, string];
      const info = target();
      const trimmed = value.trim();
      switch (field) {
        case "TITLE":
          // Opens a credit; a following ARTIST attaches to it.
          (info.credits ??= []).push({ title: trimmed });
          break;
        case "ARTIST": {
          const credits = info.credits;
          const open = credits?.[credits.length - 1];
          if (open && open.artist === undefined) {
            open.artist = trimmed;
          } else {
            // An ARTIST with no TITLE of its own still names whoever wrote the music.
            (info.credits ??= []).push({ title: "", artist: trimmed });
          }
          break;
        }
        case "NAME":
          info.name = trimmed;
          break;
        case "AUTHOR":
          info.author = trimmed;
          break;
        case "COMMENT":
          commentLines = [trimmed];
          break;
      }
      continue;
    }

    if (commentLines) {
      const continued = line.trim();
      // A blank line inside a comment is a paragraph break the editors put there on purpose.
      commentLines.push(continued);
      continue;
    }
  }

  closeComment();

  // A heading with nothing under it carries no information and would otherwise make callers check
  // for an entry that says nothing.
  for (const [path, value] of entries) {
    if (!value.credits && !value.name && !value.author && !value.comment && !value.subsongs) {
      entries.delete(path);
    }
  }

  return entries;
};

/** The one title worth putting in a row, or nothing when STIL has no title for this tune. */
export const primaryCredit = (info: StilInfo | undefined): StilCredit | undefined =>
  info?.credits?.find((credit) => credit.title.length > 0) ?? info?.credits?.[0];

/**
 * What STIL says about one specific tune, with the file's own information behind it.
 *
 * A per-tune lookup that found nothing should still show what the file says, because most entries
 * describe the file as a whole and never mention tune numbers at all.
 */
export const stilInfoForSubsong = (entry: StilEntry | undefined, songNr: number | undefined): StilInfo | undefined => {
  if (!entry) return undefined;
  const perTune = songNr === undefined ? undefined : entry.subsongs?.[songNr];
  if (!perTune) return entry;
  // Fall back field by field: a `(#3)` block that only sets a title should still show the file's
  // comment rather than hiding it.
  return {
    credits: perTune.credits ?? entry.credits,
    name: perTune.name ?? entry.name,
    author: perTune.author ?? entry.author,
    comment: perTune.comment ?? entry.comment,
  };
};
