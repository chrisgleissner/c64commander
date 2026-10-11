/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Competition placings, read out of STIL's free-text comments.
 *
 * STIL has no field for a placing. The HVSC editors write it as a sentence ("Won first place at the
 * X'2016 party.", "Won the Datastorm 2012 music competition.") and composers write it in their own
 * words inside a quote ("Got 1st place at The Party 1994."). The traps are the sentences that place
 * something other than the tune: the demo it was used in, a 4K intro, a song contest the original
 * won, or nobody at all. See `docs/plans/sid-station/stil-collections.md` for the measured rules.
 */

export type CompetitionPlacing = {
  /** 1 for a win, the ordinal for any other placing; {@link LAST_PLACE} for "dead last". */
  rank: number;
  sentence: string;
  /** Why the sentence is not this tune's placing in a music competition, or null when it is. */
  rejection: string | null;
};

export const LAST_PLACE = 99;

const ORDINAL_WORDS: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
};

const ORDINAL = String.raw`(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d{1,2}(?:st|nd|rd|th)|#\d{1,2})`;

const ordinalValue = (word: string): number => {
  const normalized = word.toLowerCase().replace(/^#/, "");
  return ORDINAL_WORDS[normalized] ?? Number.parseInt(normalized, 10);
};

/** "compo" as a word, never as the start of "composed" or "composer". */
const COMPETITION_CONTEXT =
  /\bcompo(?:s|'s)?\b|\bcompetition|\bcontest\b|\w+compo\d*\b|compo ?#?\d|\bparty|\bvoting\b/i;

const NOT_THIS_TUNE: ReadonlyArray<readonly [RegExp, string]> = [
  [
    /\b(?:demo|intro|trackmo|game|production|logo|graphics?|gfx|diskmag|4k|one-?filer?)\b[^.]{0,80}?\b(?:that|which|who)\b[^.]{0,20}?\b(?:won|winning|placed|got|came|reached|finished)\b/i,
    "a production that used the tune won",
  ],
  [
    /\b(?:the|our|this) (?:demo|intro|trackmo|game)\b[^.]{0,40}\b(?:got|won|placed|reached|finished|came)\b/i,
    "the demo placed",
  ],
  [
    /\b(?:demo|intro|graphics|gfx|game|4k|one-?file|wild) (?:compo|competition)\b(?![^.]{0,40}\bmusic)/i,
    "not a music competition",
  ],
  [/\b4k (?:\w+ )?(?:1st|first|2nd|3rd)\b|\b4k shorty\b/i, "a 4K intro placed"],
  [/\bwinning (?:trackmo|demo|intro|compotune)\b/i, "a winning production"],
  [
    /\beurovision|song contest|singing contest|tour de france|championship|\bf1\b|won the battle|\bpcw show\b|barrel of beer|power cartridge|\baward\b/i,
    "not a scene music competition",
  ],
  [/\b(?:none of them|not|never|didn'?t|did not|nobody|no one)\b[^.]{0,30}\b(?:won|win|placed?)\b/i, "negated"],
  [/\bnot sure\b|\bor first\b|\bfirst or second\b/i, "uncertain"],
  [
    /\b(?:who|which) (?:place|won)\b|don'?t know which place|other guy won|let him win|stealing us the first place|\bhülsbeck won\b|won with his/i,
    "someone else placed",
  ],
];

const WON_NTH = new RegExp(String.raw`\bwon (?:the |a )?(?:shared |joint )?(${ORDINAL}) (?:place|prize)`, "i");

const WIN: readonly RegExp[] = [
  /\b(?:won|winning) (?:both )?(?:the |a )?(?:(?:[^.]|\.(?=\S)){0,90}?)\b(?:compos?|competition|contest|voting)\b/i,
  /\b(?:won|winning) it\b/i,
  /\bwon (?:the )?(?:[A-Z][\w'&.-]*\s?){1,6}(?:party|\d{4}|'?\d{2})\b/,
  /\bwinner of\b|\b(?:shared |the |voted the |overall )winner\b/i,
  /\b(?:placed|ranked|ranking|came|finished|ended up(?: on)?|got|reached(?: the)?|declared|made it(?: to)?)\s+(?:the\s+)?(?:first|1st|#1)\b/i,
  /\b(?:1st|first) place (?:in|at|on)\b/i,
  /^"?1st (?:in|at)\b/i,
  /\bplace\s*#\s*1\b/i,
  /\bcame first\b/i,
];

const PLACE: readonly RegExp[] = [
  new RegExp(String.raw`\b(${ORDINAL}) place\b`, "i"),
  new RegExp(String.raw`\bplaced? (?:as )?(${ORDINAL})\b`, "i"),
  new RegExp(
    String.raw`\b(?:ranked|ranking|came|finished|ended up(?: on)?|reached(?: the)?|got|resulting|made it(?: to)?)\s+(?:the\s+|an?\s+average\s+)?(${ORDINAL})\b`,
    "i",
  ),
  new RegExp(String.raw`^"?(${ORDINAL}) (?:in|at|out of)\b`, "i"),
  new RegExp(String.raw`\bplace ?(#\d{1,2})\b`, "i"),
  new RegExp(String.raw`: (#\d{1,2})\b`, "i"),
  new RegExp(String.raw`\bvoted (${ORDINAL})\b`, "i"),
  /\b(?:dead last|finished last)\b/i,
];

/** The editors' own sentence, which names a party but not always the word "competition". */
const EDITORIAL_WIN = /^won (?:the )?(?:shared )?(?:first|1st) (?:place at\b|prize)/i;
const TUNE_AS_SUBJECT =
  /^"?(?:it|this (?:tune|song|sid|music|track)|the (?:tune|song|sid)|placed|ranked|won|came|got|reached)\b/i;
const NOT_A_PLACING = /\b(?:was|were|just) finished\b/i;

/** Split at sentence ends only before a capital, so "www.c64.sk" and "Was That Rob Hubbard? compo" stay whole. */
const SENTENCE_BREAK = /(?<=[.!?])\s+(?=["(]?[A-Z0-9])/;

/** A cheap test that lets the classifier skip the nine comments in ten that mention no placing at all. */
const MAY_MENTION_PLACING = /won|winner|place|ranked|1st|2nd|3rd|first|second|third|#\d|finished|last/i;

const rankOf = (sentence: string): number | null => {
  const wonNth = WON_NTH.exec(sentence);
  if (wonNth) return ordinalValue(wonNth[1]);
  if (WIN.some((pattern) => pattern.test(sentence))) return 1;
  for (const pattern of PLACE) {
    const match = pattern.exec(sentence);
    if (match) return match[1] ? ordinalValue(match[1]) : LAST_PLACE;
  }
  return null;
};

export const classifyCompetitionPlacings = (comment: string): CompetitionPlacing[] => {
  if (!MAY_MENTION_PLACING.test(comment)) return [];
  const commentNamesCompetition = COMPETITION_CONTEXT.test(comment);
  const placings: CompetitionPlacing[] = [];
  for (const raw of comment.split(SENTENCE_BREAK)) {
    const sentence = raw.replace(/\bwon't\b/gi, "will not");
    const rank = rankOf(sentence);
    if (rank === null) continue;
    const inContext =
      EDITORIAL_WIN.test(sentence) ||
      COMPETITION_CONTEXT.test(sentence) ||
      /\bplaced?\b/i.test(sentence) ||
      (commentNamesCompetition && TUNE_AS_SUBJECT.test(sentence) && !NOT_A_PLACING.test(sentence));
    const rejection = inContext
      ? (NOT_THIS_TUNE.find(([pattern]) => pattern.test(sentence))?.[1] ?? null)
      : "no competition named";
    placings.push({ rank, sentence: raw, rejection });
  }
  return placings;
};

/** The best accepted placing in a comment, or null when it records none. */
export const bestCompetitionRank = (comment: string | undefined): number | null => {
  if (!comment) return null;
  let best: number | null = null;
  for (const placing of classifyCompetitionPlacings(comment)) {
    if (placing.rejection === null && (best === null || placing.rank < best)) best = placing.rank;
  }
  return best;
};
