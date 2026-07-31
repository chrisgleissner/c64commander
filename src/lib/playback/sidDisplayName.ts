/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { PlayFileCategory } from "@/lib/playback/fileTypes";
import { SHORT_ENGLISH_WORDS } from "@/generated/titleCaseWords";

/**
 * How many SID chips a tune plays through — always at least one.
 *
 * Not narrowed to `1 | 2 | 3`. The SID header addresses a second and a third chip, but the count is
 * read from a file the app did not write, and multi-chip tunes are exactly the corner where an
 * unexpected value would arrive. A number that is merely larger than expected must still render.
 */
export type SidChipCount = number;

export type SidDisplayName = {
  /** What to put on screen in place of the file name. Never empty. */
  title: string;
  /**
   * The chip count **worth showing** — two or more — or `null`.
   *
   * `null` covers both "one chip" and "nobody said", and the two do not need telling apart on
   * screen: every tune here is a SID, so saying so on the ~99.5% of tunes that use one chip is
   * noise that costs a row of space and buys nothing. Only the rare tune that needs a second or
   * third chip gets a marker. Keeping that rule here rather than at each call site is what stops
   * the surfaces from drifting apart.
   */
  chipCount: SidChipCount | null;
};

/**
 * The chip-count marker HVSC appends to a file name: `Oooaaaeee_2SID.sid`.
 *
 * This is a *fallback*, used only when the caller has no parsed SID header to offer. The header is
 * the authority — `parseSidHeaderMetadata` derives `sidChipCount` from the second and third chip
 * address bytes, which is what the player itself obeys — but it needs the file's bytes, and a
 * playlist row has nothing but a path.
 *
 * A separator is required in front of the digit so the marker has to be a token of its own. Without
 * that, HVSC's `2SID03.sid` and `3SID_Tracker_Demo_2.sid` would be misread, and a name is not
 * allowed to lose a word to a badge that was never about it. Checked against every one of the 59,886
 * files in HVSC #85: the suffix and the parsed header agree on all of them, with no exceptions in
 * either direction.
 *
 * The digits are deliberately unbounded rather than `[23]`. HVSC stops at three today; a marker for
 * more should still be recognised as a marker and taken out of the title.
 */
const CHIP_COUNT_SUFFIX = /[ _.-]([1-9]\d?)SID$/i;

/** Only a `.sid` extension is dropped — every other trailing dot belongs to the name (`M.U.L.E.`). */
const SID_EXTENSION = /\.sid$/i;

/**
 * Words English title case leaves lower-case when they fall inside a title: articles, coordinating
 * conjunctions and the short prepositions. The first and last word are always capitalised anyway,
 * which is what rescues "Wake Up" and "Nowhere to Run To".
 *
 * There is no part-of-speech tagger here, so a particle that happens to be spelled like a
 * preposition ("Shut Up the Noise") is set lower-case mid-title. That is the same trade every house
 * style makes, and it only applies where this module is choosing the casing at all — see
 * {@link formatSidDisplayName}.
 */
const SMALL_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "but",
  "or",
  "nor",
  "for",
  "yet",
  "so",
  "of",
  "in",
  "on",
  "at",
  "to",
  "from",
  "by",
  "with",
  "up",
  "off",
  "as",
  "per",
  "via",
]);

/**
 * Trailing words that mark a variant of a tune rather than part of its name, and so stay lower-case.
 *
 * Derived from the corpus rather than written by hand. For every HVSC name ending in a run of
 * lower-case words, the tune's own SID header was asked whether it wraps that word in brackets —
 * HVSC's own way of saying "this is a marker". Every word appearing at least twelve times and
 * bracketed by the header at least half the time is here; the rate is decisive rather than marginal,
 * at 97.7% for "tune" (2,081 of 2,130), 96.6% for "part" and 100% for "menu" and "level". The words
 * that failed the test are just as clearly ordinary title words — "the" at 44%, "plus" and "of" at
 * 0% — so nothing near the boundary had to be judged.
 */
const QUALIFIER_WORDS = new Set([
  "compo",
  "demo",
  "edit",
  "end",
  "extended",
  "game",
  "ingame",
  "intro",
  "issue",
  "level",
  "loader",
  "long",
  "magazine",
  "main",
  "menu",
  "mix",
  "music",
  "note",
  "part",
  "preview",
  "remix",
  "short",
  "title",
  "tune",
  "tunes",
  "unused",
  "version",
]);

/**
 * A version marker, which is a qualifier the bracket test could not see.
 *
 * `v2` is bracketed by the header only 42% of the time, so it did not clear the bar above — but the
 * header keeps it lower-case either way, and "1942 V2" reads as though V2 were part of the title.
 * Matched by shape instead, which is what it is.
 */
const VERSION_MARKER = /^v\d+$/i;

/**
 * Capitalised words that are initialisms, not shouting, and keep their capitals wherever they appear.
 *
 * Several of these are ordinary dictionary words as well — PAL, USSR, NATO, BASIC, SID, CIA, USA,
 * RAM, LED — so the word list alone would quieten them. They are named here because in a C64 library
 * they are overwhelmingly the initialism: PAL is the video standard 12 times over in HVSC, never the
 * friend, and MOS is the chip maker.
 */
const PROTECTED_ACRONYMS = new Set([
  "AIDS",
  "BASIC",
  "BPM",
  "CCCP",
  "CIA",
  "DOS",
  "IBM",
  "KGB",
  "LED",
  "MOS",
  "NOP",
  "NTSC",
  "NATO",
  "PAL",
  "PET",
  "PETSCII",
  "RAM",
  "RIP",
  "SEUCK",
  "SID",
  "SOS",
  "UFO",
  "USA",
  "USSR",
  "VIC",
]);

/**
 * Roman numerals, applied to a word of five letters or more, or to one of the numerals for 1..100.
 *
 * The pattern alone is not safe at short lengths: MIX is 1009, MC is 1100 and CD is 400, and a tune
 * called "Helloween-MIX" must not have its MIX protected as a number. Bounding the short cases to
 * 1..100 — the range a sequel plausibly counts in — excludes MIX and friends by construction, while
 * five letters and up stays open so MCMLXXXII remains a year rather than becoming "Mcmlxxxii".
 */
const ROMAN_NUMERAL = /^M{0,4}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;
const ROMAN_1_TO_100 = new Set(
  Array.from({ length: 100 }, (_, index) => {
    const table: ReadonlyArray<readonly [number, string]> = [
      [100, "C"],
      [90, "XC"],
      [50, "L"],
      [40, "XL"],
      [10, "X"],
      [9, "IX"],
      [5, "V"],
      [4, "IV"],
      [1, "I"],
    ];
    let left = index + 1;
    let text = "";
    for (const [amount, glyph] of table) {
      while (left >= amount) {
        text += glyph;
        left -= amount;
      }
    }
    return text;
  }),
);

/**
 * Words of two letters or fewer are never re-cased.
 *
 * At this length a capitalised word is an initialism or a set of initials almost without exception —
 * IK, DJ, MC, TV, XO — and there is no English word so short that shouting it is hard to read.
 */
const ALWAYS_KEEP_LETTERS = 2;

/**
 * From five letters up, a capitalised word is treated as shouting on length alone.
 *
 * The corpus is emphatic: of the 799 occurrences of a five-letter-or-longer capitalised word in
 * HVSC, 598 are BASIC, PETSCII or SEUCK — all named above — and essentially all of the rest are
 * handles and shouting: FRODIGI, SWABBASWAG, DANGER, CARRIER, MEGAMIX, TESTTUNE.
 */
const SHOUTING_LETTERS = 5;

const letterCount = (token: string) => (token.match(/[A-Za-z]/g) ?? []).length;

/** All the letters are capitals, and there are at least two of them to have an opinion about. */
const isAllCapitals = (token: string) => letterCount(token) >= 2 && !/[a-z]/.test(token);

const lettersOf = (token: string) => token.replace(/[^A-Za-z]/g, "");

const isRomanNumeral = (letters: string) =>
  ROMAN_NUMERAL.test(letters) && (letters.length >= SHOUTING_LETTERS || ROMAN_1_TO_100.has(letters));

/**
 * A capitalised word that keeps its capitals wherever it appears: too short to be worth re-casing,
 * a number, or a named initialism.
 */
const isProtectedCapitals = (token: string) => {
  if (!isAllCapitals(token)) return false;
  const letters = lettersOf(token);
  return letters.length <= ALWAYS_KEEP_LETTERS || PROTECTED_ACRONYMS.has(letters) || isRomanNumeral(letters);
};

/**
 * A capitalised word that is shouting: long enough to be a word rather than initials, or short but
 * present in the shipped English word list.
 *
 * The word list is what a length threshold could not do. THE, LAST, PLUS and EXIT are four letters
 * or fewer and are plainly words; NTSC, DXPP, NOP and QUOD are the same length and are plainly not.
 * Nothing metrical separates them, so the module asks a dictionary instead — but only in the three-
 * and four-letter band, which is the only place neither of the length rules above decides. That is
 * what keeps the shipped list to 4,173 words and 9 KB gzipped rather than a 600 KB dictionary.
 */
const isShoutedWord = (token: string) => {
  if (!isAllCapitals(token) || isProtectedCapitals(token)) return false;
  const letters = lettersOf(token);
  return letters.length >= SHOUTING_LETTERS || SHORT_ENGLISH_WORDS.has(letters.toLowerCase());
};

/**
 * The narrower test used inside a name whose author chose the casing.
 *
 * There, a short capitalised word is emphasis rather than an absence of thought — HVSC's
 * `2_Hours_NOT_Enough` means the NOT, and its own header keeps it — so only length can convict.
 * A wholly-capitalised name has no emphasis to convey, which is why it gets the word list.
 */
const isShoutedByLength = (token: string) =>
  isAllCapitals(token) && !isProtectedCapitals(token) && lettersOf(token).length >= SHOUTING_LETTERS;

/**
 * Capitalise one hyphen-free run: `COMMANDO` becomes `Commando`.
 *
 * The letter test is Unicode-aware so an accented or non-Latin name is treated like any other —
 * `ünïcödé` becomes `Ünïcödé`, and a script without letter case is simply returned as it stands.
 *
 * A run that starts with a digit keeps the shape its author gave it — `3rd` does not become `3Rd`,
 * and a stylised handle such as `2hero` is left alone. It is still re-cased when it is plainly
 * shouting, because `4PIT` and `8BITWEAPON` are exactly as hard to read as the shouted words that
 * begin with a letter, and no rule should protect them merely for starting with a digit. The first
 * letter is raised rather than the whole run lowered, so the result reads as a word — `4Pit`, not
 * `4pit`.
 */
const capitaliseSegment = (segment: string) => {
  // A capital inside the word is a deliberate shape — MasterComposer, McDonald, DeFrag — and lowering
  // its tail would be exactly the vandalism this module is otherwise careful to avoid. Raise the
  // first letter if it needs it and change nothing else.
  if (/\p{Ll}/u.test(segment) && /.\p{Lu}/u.test(segment)) {
    return /^\p{L}/u.test(segment) ? segment[0].toUpperCase() + segment.slice(1) : segment;
  }
  if (/^\p{L}/u.test(segment)) return segment[0].toUpperCase() + segment.slice(1).toLowerCase();
  if (!isAllCapitals(segment)) return segment;
  const firstLetter = segment.search(/\p{L}/u);
  return segment.slice(0, firstLetter) + segment[firstLetter] + segment.slice(firstLetter + 1).toLowerCase();
};

/** Each side of a hyphen is its own word: `RE-ALIENATOR` becomes `Re-Alienator`. */
const capitaliseWord = (token: string) => token.split("-").map(capitaliseSegment).join("-");

const isSingleUppercaseLetter = (token: string) => token.length === 1 && token >= "A" && token <= "Z";

/**
 * One word of the title, and whether this module built it by joining an acronym run.
 *
 * The flag exists because a joined acronym must survive the casing pass untouched, and "contains a
 * dot" is not a safe test for that: `song.sid.sid` leaves a perfectly ordinary word `song.sid`
 * behind once the extension comes off, and it would have been mistaken for an acronym and left
 * lower-case.
 */
type TitleWord = { text: string; joinedAcronym: boolean };

/**
 * Rejoin runs of single upper-case letters as a dotted acronym: `M_U_L_E` reads as `M.U.L.E.`
 *
 * Only tokens that were separated by an underscore are eligible, because the underscore is the
 * separator this module introduced a space for. A name that already contained spaces was typed that
 * way by whoever named the file, and re-punctuating their spacing would be an invention rather than
 * a rendering.
 *
 * Measured over HVSC #85: of the 266 names carrying a run of two or more single upper-case letters,
 * the tune's own SID header writes 227 of them with dots and 11 with spaces, the rest with some
 * other punctuation. Runs of *lower-case* letters are left spaced, and the corpus agrees — the
 * header for `R_a_y_s.sid` is literally "R a y s", and for `F_i_s_h_e_s.sid` it is "F i s h e s".
 *
 * This runs **before** any re-casing, so the casing pass sees one indivisible `M.U.L.E.` rather than
 * four single letters. Without that ordering, `L_A_T_W_A_T` would have its two lone `A`s taken for
 * the article "a" and lowered, and the acronym would come apart into "L a T.W. a T".
 *
 * Anything that is not part of a run is split again on whitespace, because a file name that already
 * contains spaces has more than one word in a single underscore-delimited token, and the casing pass
 * works a word at a time.
 */
const toTitleWords = (tokens: string[]): TitleWord[] => {
  const out: TitleWord[] = [];
  let index = 0;
  while (index < tokens.length) {
    let end = index;
    while (end < tokens.length && isSingleUppercaseLetter(tokens[end])) end += 1;
    const runLength = end - index;
    if (runLength >= 2) {
      out.push({ text: `${tokens.slice(index, end).join(".")}.`, joinedAcronym: true });
      index = end;
      continue;
    }
    for (const word of tokens[index].split(/\s+/).filter((part) => part.length > 0)) {
      out.push({ text: word, joinedAcronym: false });
    }
    index += 1;
  }
  return out;
};

/**
 * Where the trailing variant marker starts, or the word count when there is none.
 *
 * Walks back over qualifier words, version markers and bare numbers, then drops any numbers that ran
 * on past the leftmost qualifier — so `Christmas_1989_tune_2` gives up "tune 2" and keeps its year,
 * and `1942_v2` gives up "v2" and keeps its year. A run is only a qualifier run if it actually
 * contains a qualifier: a title simply ending in a number has no marker to protect.
 */
const qualifierRunStart = (words: TitleWord[]): number => {
  let index = words.length;
  let leftmostQualifier = -1;
  while (index > 1) {
    const { text, joinedAcronym } = words[index - 1];
    if (joinedAcronym) break;
    const lowered = text.toLowerCase();
    const isQualifier = (QUALIFIER_WORDS.has(lowered) || VERSION_MARKER.test(text)) && !/[A-Z]/.test(text[0] ?? "");
    const isNumber = /^\d+$/.test(text);
    if (!isQualifier && !isNumber) break;
    index -= 1;
    if (isQualifier) leftmostQualifier = index;
  }
  if (leftmostQualifier === -1) return words.length;
  // What is left in front has to be a title. `the_end` is not "The" with a marker on it, and neither
  // is any other name whose every remaining word is an article or a preposition — there the marker
  // word IS the title, and lowering it would leave nothing to read.
  const remains = words.slice(0, leftmostQualifier);
  return remains.some(({ text }) => !SMALL_WORDS.has(text.toLowerCase())) ? leftmostQualifier : words.length;
};

/**
 * Set a name in English title case, for a file name whose casing says nothing about which words
 * matter.
 *
 * First and last word always capitalised; the small words of {@link SMALL_WORDS} lowered in between;
 * initialisms, roman numerals and already-joined dotted acronyms left exactly as they are. A
 * trailing variant marker — "tune 2", "part 4", "v2" — is left exactly as it was found, and does not
 * count as the last word, because raising it would turn HVSC's mark of a variant into part of the
 * title.
 */
const toTitleCase = (words: TitleWord[]): string[] => {
  const qualifierAt = qualifierRunStart(words);
  return words.map(({ text, joinedAcronym }, index) => {
    if (index >= qualifierAt) return text;
    if (joinedAcronym || isProtectedCapitals(text)) return text;
    const isEdge = index === 0 || index === qualifierAt - 1;
    const lowered = text.toLowerCase();
    if (!isEdge && SMALL_WORDS.has(lowered)) return lowered;
    return capitaliseWord(text);
  });
};

/**
 * Quieten words that are only shouting, leaving every other word as the author wrote it.
 *
 * Used on names whose author already distinguished capitals from lower case, where the casing is a
 * decision rather than an absence of one.
 */
const quietenShoutedWords = (words: TitleWord[]): string[] =>
  words.map(({ text, joinedAcronym }) => (joinedAcronym || !isShoutedByLength(text) ? text : capitaliseWord(text)));

const basename = (value: string) => value.split(/[/\\]/).filter(Boolean).pop() ?? value;

/**
 * Whether the file name's own casing says which words matter, and so should be left alone.
 *
 * Three shapes say nothing and get re-cased:
 *
 *  - wholly capitalised, but only when something in it is shouting rather than initials. `FRODIGI`
 *    and `THE_LAST_V8` are re-cased; `FLI_DXPP` and `4PIT` are left, because every word in them is a
 *    short non-word and re-casing would invent a name out of somebody's initials.
 *  - wholly lower case: `please_let_me_in`.
 *  - sentence case — a capital on the first word and on nothing else that matters. Measured over
 *    HVSC, 5.4% of names are shaped this way, and they are the CD sleeve's loss: "Please let me in"
 *    is a title, not a sentence. The trailing variant marker is protected separately, which is what
 *    makes this safe for the 2,091 names shaped like `Aces_High_tune_2`.
 *
 * Anything else — half or more of the corpus — already distinguishes its words and is kept.
 */
const hasAuthoredCasing = (words: TitleWord[], stem: string): boolean => {
  if (!/[a-z]/.test(stem)) return !words.some((word) => isShoutedWord(word.text));
  if (!/[A-Z]/.test(stem)) return false;
  // Sentence case: past the first word, nothing that could have been raised was raised.
  const qualifierAt = qualifierRunStart(words);
  const considered = words.slice(1, qualifierAt).filter(({ text }) => letterCount(text) >= 2);
  // A raised word anywhere is proof the author was casing this name, and that includes a small word:
  // `Shoot_em_Up` has only "Up" to go on, and lowering "em" to prove a point would be reading the one
  // piece of evidence as its own absence.
  if (considered.some(({ text }) => /^[A-Z]/.test(text))) return true;
  // Nothing was raised. That is only evidence of sentence case if something could have been — a title
  // whose every remaining word is a small word or a marker has said nothing either way.
  return !considered.some(({ text }) => !SMALL_WORDS.has(text.toLowerCase()));
};

/**
 * Turn a SID file name into something worth reading, and say whether it needs a chip marker.
 *
 * Deliberately takes a name and a number and nothing else: it has to give the same answer for a tune
 * side-loaded from a phone folder, one sitting on the Ultimate's filesystem, one from CommoServe and
 * one from HVSC. There is no catalogue lookup here and no path convention beyond the chip-count
 * marker described above.
 *
 * **How much casing it is willing to change.** A file name that mixes capitals and lower case was
 * cased by a person, and that casing carries meaning this module cannot recover once it is gone:
 * `Aces_High_tune_2` marks "tune 2" as a qualifier rather than part of the title, and 51% of HVSC is
 * already in correct title case. Those names keep their casing, and only a word that is purely
 * shouting is quietened inside them. A name written entirely in capitals or entirely in lower case
 * says nothing about which words matter — `FRODIGI`, `please_let_me_in` — so there the module sets
 * the whole title itself, in English title case.
 *
 * That split leaves roughly 98% of HVSC's casing untouched and re-cases the 1.7% that had none.
 *
 * One measurement is worth recording against this design, because it argues the other way. Each
 * tune's SID header carries a title written by the same author, and those headers keep all-capitals
 * words in capitals essentially always — over 99% at every word length. The header is therefore not
 * an independent judge of readability here: it is the same shouting, typed twice. Readability is the
 * product decision, and it is the one implemented.
 *
 * @param fileName A file name or a full path; only the last path segment is read.
 * @param chipCount The parsed SID header's `sidChipCount`, when the caller has the file's bytes.
 */
export const formatSidDisplayName = (fileName: string, chipCount?: number | null): SidDisplayName => {
  const base = basename(fileName);
  const withoutExtension = base.replace(SID_EXTENSION, "");

  const suffixMatch = CHIP_COUNT_SUFFIX.exec(withoutExtension);
  const suffixChipCount = suffixMatch ? Number(suffixMatch[1]) : null;
  // The marker is dropped from the title only because the badge puts the same fact back on screen in
  // a better place. Nothing else is removed from a name for being conventional — see the note on
  // `_BASIC` in the module tests.
  const stem = suffixMatch ? withoutExtension.slice(0, suffixMatch.index) : withoutExtension;

  const words = toTitleWords(stem.split("_").filter((token) => token.length > 0));
  const title = (hasAuthoredCasing(words, stem) ? quietenShoutedWords(words) : toTitleCase(words))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  const resolved = typeof chipCount === "number" && Number.isFinite(chipCount) ? chipCount : suffixChipCount;

  return {
    // A name made entirely of separators would otherwise render as an empty row that cannot be read
    // or reported. Falling back to what was actually on disk is worse-looking and strictly better
    // than showing nothing.
    title: title.length > 0 ? title : base,
    chipCount: resolved !== null && resolved >= 2 ? Math.floor(resolved) : null,
  };
};

export type TrackDisplayNameInput = {
  /** The raw label the playlist carries — normally the file name. Never modified in place. */
  label: string;
  category: PlayFileCategory;
  /** The user's "Friendly SID names" preference. */
  friendlyNames: boolean;
  /** The parsed SID header's `sidChipCount`, where the caller has it. */
  chipCount?: number | null;
};

/**
 * The single entry point every screen calls, so a tune is named the same way wherever it appears.
 *
 * Presentation only. The caller keeps matching, sorting, de-duplicating and persisting on the raw
 * `label`/`path`; this returns a string to draw and nothing that is ever stored.
 *
 * Non-SID entries are returned untouched — a PRG, a CRT or a disk image keeps precisely the name it
 * has always shown, whatever the preference says. The beautifier reads a SID naming convention, and
 * applying it to a program name would be a guess about a file it knows nothing about.
 *
 * Turning the preference off suppresses the chip badge as well as the renaming. The two arrived
 * together as one way of presenting a tune, and a user who asked for the file name back is asking
 * for the row the app has always drawn, not for a different subset of the new one.
 */
export const resolveTrackDisplayName = ({
  label,
  category,
  friendlyNames,
  chipCount,
}: TrackDisplayNameInput): SidDisplayName => {
  if (category !== "sid" || !friendlyNames) return { title: label, chipCount: null };
  return formatSidDisplayName(label, chipCount);
};

/** The badge text: `2SID`, `3SID`, and whatever a future header reports. */
export const sidChipBadgeLabel = (chipCount: SidChipCount) => `${chipCount}SID`;

const SPELLED_OUT = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

/** What a screen reader should hear instead of the badge, which reads aloud as nothing useful. */
export const sidChipBadgeDescription = (chipCount: SidChipCount) =>
  `Plays through ${SPELLED_OUT[chipCount] ?? chipCount} SID chips`;
