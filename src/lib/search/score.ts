/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { ResolvedSearchEntry, SearchGroup } from "@/lib/search/types";

/**
 * Matching and ranking (spec.md section 5.6).
 *
 * Prefix and substring matching, not fuzzy subsequence matching. On a T9 keypad every character
 * costs two to four presses, so a query is three or four characters rather than ten, and at that
 * length subsequence matching returns a large amount of noise — which is what the user then has to
 * read.
 */

/** Per-term scores, best available taken. */
export const TERM_SCORES = {
  exactTitle: 100,
  titleWordPrefix: 80,
  titleContains: 60,
  keyword: 40,
  subtitleContains: 20,
} as const;

/**
 * Group weight, added once. Actions and pages above content, so "radio" offers *Start SID Radio*
 * before a tune with "radio" in its title.
 */
export const GROUP_WEIGHTS: Readonly<Record<SearchGroup, number>> = {
  action: 60,
  page: 50,
  setting: 40,
  config: 30,
  docs: 20,
  disk: 10,
  music: 0,
};

/** Added for an entry this user has picked before, scaled by how recently. */
export const PICKED_BONUS_MAX = 45;

const DIACRITICS = /[̀-ͯ]/g;

/** Lowercased and stripped of diacritics. Query and entry text go through exactly this. */
export const normalize = (value: string): string => value.normalize("NFD").replace(DIACRITICS, "").toLowerCase();

/** Whitespace-split terms, empty ones dropped. */
export const splitTerms = (query: string): string[] => normalize(query).split(/\s+/).filter(Boolean);

/** An entry reduced to the strings the scorer reads, so scoring allocates nothing per entry. */
export interface ScorableText {
  readonly title: string;
  readonly titleWords: readonly string[];
  readonly subtitle: string;
  readonly keywords: readonly string[];
}

export const toScorableText = (input: {
  title: string;
  subtitle?: string;
  keywords?: readonly string[];
}): ScorableText => {
  const title = normalize(input.title);
  return {
    title,
    titleWords: title.split(/\s+/).filter(Boolean),
    subtitle: input.subtitle ? normalize(input.subtitle) : "",
    keywords: (input.keywords ?? []).map(normalize),
  };
};

/**
 * The best score one term can take from one entry, or 0 for no match.
 *
 * One pass over the entry's words and keywords per term, and no intermediate array: the strings are
 * pre-normalised in ScorableText, so this allocates nothing. `scoring.test.ts` asserts that, because
 * an accidental O(n squared) rewrite is the regression that actually matters.
 */
export const scoreTerm = (text: ScorableText, term: string): number => {
  if (text.title === term) return TERM_SCORES.exactTitle;
  for (const word of text.titleWords) {
    if (word.startsWith(term)) return TERM_SCORES.titleWordPrefix;
  }
  if (text.title.includes(term)) return TERM_SCORES.titleContains;
  for (const keyword of text.keywords) {
    if (keyword.startsWith(term) || keyword.includes(term)) return TERM_SCORES.keyword;
  }
  if (text.subtitle.includes(term)) return TERM_SCORES.subtitleContains;
  return 0;
};

export interface ScoredEntry {
  readonly resolved: ResolvedSearchEntry;
  readonly score: number;
  readonly title: string;
}

/** Newest first; a more recently picked id is worth more. */
export const pickedBonus = (pickedIds: readonly string[], entryId: string): number => {
  const index = pickedIds.indexOf(entryId);
  if (index < 0) return 0;
  return Math.round(PICKED_BONUS_MAX * (1 - index / Math.max(pickedIds.length, 1)));
};

export interface ScoreOptions {
  readonly pickedIds?: readonly string[];
}

/**
 * An entry matches when EVERY term matches something in it — "sid rad" finds *SID Radio*, "dark col"
 * finds the Appearance rows. One term that matches nothing rejects the entry outright.
 */
export const scoreEntry = (
  resolved: ResolvedSearchEntry,
  text: ScorableText,
  terms: readonly string[],
  options: ScoreOptions = {},
): number => {
  if (terms.length === 0) return 0;
  let total = 0;
  for (const term of terms) {
    const termScore = scoreTerm(text, term);
    if (termScore === 0) return 0;
    total += termScore;
  }
  return total + GROUP_WEIGHTS[resolved.entry.group] + pickedBonus(options.pickedIds ?? [], resolved.entry.id);
};

/**
 * Ties break on title length, then alphabetically, and an entry whose requirements are unmet sorts
 * last within its group — listed, disabled and explained, never hidden.
 */
export const compareScored = (left: ScoredEntry, right: ScoredEntry): number => {
  const leftGroup = GROUP_WEIGHTS[left.resolved.entry.group];
  const rightGroup = GROUP_WEIGHTS[right.resolved.entry.group];
  if (leftGroup === rightGroup && left.resolved.enabled !== right.resolved.enabled) {
    return left.resolved.enabled ? -1 : 1;
  }
  if (left.score !== right.score) return right.score - left.score;
  if (left.title.length !== right.title.length) return left.title.length - right.title.length;
  return left.title.localeCompare(right.title);
};

/** A resolved entry plus its pre-normalised text, so a caller can build the pair once and reuse it. */
export interface ScorableEntry {
  readonly resolved: ResolvedSearchEntry;
  readonly text: ScorableText;
  readonly title: string;
}

export const rank = (entries: readonly ScorableEntry[], query: string, options: ScoreOptions = {}): ScoredEntry[] => {
  const terms = splitTerms(query);
  if (terms.length === 0) return [];
  const scored: ScoredEntry[] = [];
  for (const entry of entries) {
    const score = scoreEntry(entry.resolved, entry.text, terms, options);
    if (score > 0) scored.push({ resolved: entry.resolved, score, title: entry.title });
  }
  return scored.sort(compareScored);
};
