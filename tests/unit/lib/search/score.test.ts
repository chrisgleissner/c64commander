/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  GROUP_WEIGHTS,
  TERM_SCORES,
  normalize,
  rank,
  scoreTerm,
  splitTerms,
  toScorableText,
  type ScorableEntry,
} from "@/lib/search/score";
import type { ResolvedSearchEntry, SearchEntry, SearchGroup } from "@/lib/search/types";

const entry = (
  id: string,
  title: string,
  group: SearchGroup,
  extra: { subtitle?: string; keywords?: readonly string[]; enabled?: boolean } = {},
): ScorableEntry => {
  const searchEntry: SearchEntry = {
    id,
    titleKey: `test.${id}`,
    titleDefault: title,
    group,
    target: { kind: "route", path: "/" },
    ...(extra.subtitle ? { subtitleKey: `test.${id}.sub`, subtitleDefault: extra.subtitle } : {}),
    ...(extra.keywords ? { keywords: extra.keywords } : {}),
  };
  const resolved: ResolvedSearchEntry = {
    entry: searchEntry,
    enabled: extra.enabled ?? true,
    disabledReason: (extra.enabled ?? true) ? null : "Needs a connected C64 Ultimate",
  };
  return {
    resolved,
    title,
    text: toScorableText({ title, subtitle: extra.subtitle, keywords: extra.keywords }),
  };
};

/** A fixed index, the same shape the real one has, so the ranking table below is readable. */
const INDEX: ScorableEntry[] = [
  entry("action.sid-radio", "Start SID Radio", "action", {
    subtitle: "Thousands of tunes, played on this device",
    keywords: ["radio", "station", "shuffle"],
  }),
  entry("page.play", "Play files", "page", { keywords: ["music", "tunes", "playlist"] }),
  entry("page.settings", "Settings", "page"),
  entry("settings.control.app-style", "Style", "setting", {
    subtitle: "Seven colour styles on top of Light and Dark",
    keywords: ["palette", "colour", "dark"],
  }),
  entry("settings.control.text-size", "Text size", "setting", { keywords: ["font", "bigger"] }),
  entry("home.section.cpu-ram", "CPU & RAM", "config", { keywords: ["turbo", "speed", "reu"] }),
  entry("music.radio-gaga", "Radio Gaga", "music", { subtitle: "A tune with radio in its title" }),
  entry("music.dark-forces", "Dark Forces", "music"),
  entry("disk.turbo-outrun", "Turbo Outrun", "disk"),
];

describe("normalize and splitTerms", () => {
  it("lowercases and strips diacritics identically for query and entry text", () => {
    expect(normalize("Pöpcørn")).toBe(normalize("popcørn".toUpperCase()));
    expect(normalize("Café")).toBe("cafe");
  });

  it("splits on whitespace and drops empty terms", () => {
    expect(splitTerms("  sid   rad ")).toEqual(["sid", "rad"]);
    expect(splitTerms("   ")).toEqual([]);
  });
});

describe("scoreTerm", () => {
  const text = toScorableText({
    title: "Start SID Radio",
    subtitle: "Plays tunes on this device",
    keywords: ["station"],
  });

  it("scores an exact title match highest", () => {
    expect(scoreTerm(toScorableText({ title: "Style" }), "style")).toBe(TERM_SCORES.exactTitle);
  });

  it("scores a title word prefix above a title substring", () => {
    expect(scoreTerm(text, "rad")).toBe(TERM_SCORES.titleWordPrefix);
    expect(scoreTerm(text, "adio")).toBe(TERM_SCORES.titleContains);
  });

  it("scores a keyword below any title match", () => {
    expect(scoreTerm(text, "stat")).toBe(TERM_SCORES.keyword);
  });

  it("scores a subtitle match lowest", () => {
    expect(scoreTerm(text, "device")).toBe(TERM_SCORES.subtitleContains);
  });

  it("returns zero when the term matches nothing", () => {
    expect(scoreTerm(text, "printer")).toBe(0);
  });
});

describe("ranking", () => {
  const top = (query: string, count = 3) =>
    rank(INDEX, query)
      .slice(0, count)
      .map((scored) => scored.resolved.entry.id);

  /*
   * The table the spec calls for: a fixed index, a list of queries, the expected top three. The
   * "rad" row is the one that matters most — an action must beat a tune with the same word in its
   * title, which is what the group weight is for.
   */
  const CASES: ReadonlyArray<{ query: string; expected: readonly string[] }> = [
    { query: "rad", expected: ["action.sid-radio", "music.radio-gaga"] },
    { query: "radio", expected: ["action.sid-radio", "music.radio-gaga"] },
    { query: "sid rad", expected: ["action.sid-radio"] },
    { query: "dark col", expected: ["settings.control.app-style"] },
    { query: "play", expected: ["page.play"] },
    // A title match on content outranks a keyword match on a setting: a keyword is the
    // weaker signal, and 80 + the disk weight beats 40 + the config weight.
    { query: "turbo", expected: ["disk.turbo-outrun", "home.section.cpu-ram"] },
    { query: "text", expected: ["settings.control.text-size"] },
    { query: "settings", expected: ["page.settings"] },
  ];

  it.each(CASES)("$query ranks as expected", ({ query, expected }) => {
    expect(top(query, expected.length)).toEqual([...expected]);
  });

  it("puts Start SID Radio above any tune with radio in its title", () => {
    const ids = rank(INDEX, "radio").map((scored) => scored.resolved.entry.id);
    expect(ids.indexOf("action.sid-radio")).toBeLessThan(ids.indexOf("music.radio-gaga"));
  });

  it("requires EVERY term to match something in the entry", () => {
    expect(rank(INDEX, "sid printer")).toEqual([]);
  });

  it("returns nothing for an empty query", () => {
    expect(rank(INDEX, "   ")).toEqual([]);
  });

  it("sorts an entry whose requirements are unmet last within its group", () => {
    const index = [
      entry("action.enabled", "Radio one", "action"),
      entry("action.disabled", "Radio", "action", { enabled: false }),
    ];
    const ids = rank(index, "radio").map((scored) => scored.resolved.entry.id);
    // "Radio" would otherwise win on the exact-title score and the shorter title.
    expect(ids).toEqual(["action.enabled", "action.disabled"]);
  });

  it("lifts an entry this user has picked before", () => {
    const withoutBonus = rank(INDEX, "radio").map((scored) => scored.resolved.entry.id);
    const withBonus = rank(INDEX, "radio", { pickedIds: ["music.radio-gaga"] }).map(
      (scored) => scored.resolved.entry.id,
    );
    expect(withoutBonus[0]).toBe("action.sid-radio");
    // The bonus is worth less than the gap between the action and music group weights, so it lifts
    // a tune within its own group rather than over an action.
    expect(withBonus[0]).toBe("action.sid-radio");
    const lifted = rank([entry("music.a", "Radio alpha", "music"), entry("music.b", "Radio beta", "music")], "radio", {
      pickedIds: ["music.b"],
    }).map((scored) => scored.resolved.entry.id);
    expect(lifted[0]).toBe("music.b");
  });

  it("breaks a tie on title length, then alphabetically", () => {
    const index = [
      entry("z.long", "Radio zulu long", "music"),
      entry("a.short", "Radio ab", "music"),
      entry("b.short", "Radio aa", "music"),
    ];
    expect(rank(index, "radio").map((scored) => scored.resolved.entry.id)).toEqual(["b.short", "a.short", "z.long"]);
  });

  it("weights actions and pages above content", () => {
    expect(GROUP_WEIGHTS.action).toBeGreaterThan(GROUP_WEIGHTS.music);
    expect(GROUP_WEIGHTS.page).toBeGreaterThan(GROUP_WEIGHTS.music);
  });
});

/*
 * The deterministic work gate of spec section 5.5. It asserts the WORK, not the time: a wall-clock
 * threshold on a shared CI runner is a flake generator, and the regression that actually matters is
 * an accidental rewrite that goes quadratic or allocates per entry.
 */
describe("scoring cost", () => {
  const SYNTHETIC_SIZE = 2_000;

  const synthetic = (): ScorableEntry[] =>
    Array.from({ length: SYNTHETIC_SIZE }, (_, index) =>
      entry(`music.tune-${index}`, `Tune number ${index}`, "music", {
        subtitle: `Composer ${index % 97}`,
        keywords: [`kw${index % 41}`, `alt${index % 13}`],
      }),
    );

  it("touches each entry's text at most once per term", () => {
    const entries = synthetic();
    let reads = 0;
    const counted = entries.map((candidate) => ({
      ...candidate,
      text: new Proxy(candidate.text, {
        get(target, property, receiver) {
          reads += 1;
          return Reflect.get(target, property, receiver) as unknown;
        },
      }),
    }));

    rank(counted, "tune 7");
    // Four fields at most per term per entry (title, titleWords, keywords, subtitle), two terms.
    expect(reads).toBeLessThanOrEqual(SYNTHETIC_SIZE * 4 * 2);
  });

  it("is linear in the index size, not quadratic", () => {
    const small = synthetic().slice(0, 250);
    const large = synthetic();
    let smallReads = 0;
    let largeReads = 0;
    const count = (entries: ScorableEntry[], onRead: () => void) =>
      entries.map((candidate) => ({
        ...candidate,
        text: new Proxy(candidate.text, {
          get(target, property, receiver) {
            onRead();
            return Reflect.get(target, property, receiver) as unknown;
          },
        }),
      }));

    rank(
      count(small, () => {
        smallReads += 1;
      }),
      "tune",
    );
    rank(
      count(large, () => {
        largeReads += 1;
      }),
      "tune",
    );

    const growth = largeReads / smallReads;
    const sizeRatio = large.length / small.length;
    // Linear growth lands on the size ratio. Quadratic would land on its square (64x here).
    expect(growth).toBeLessThan(sizeRatio * 1.5);
  });

  it("stays under a loose wall-clock ceiling — a smoke alarm, not a stopwatch", () => {
    const entries = synthetic();
    const started = performance.now();
    rank(entries, "tune 7");
    const elapsedMs = performance.now() - started;
    expect(elapsedMs).toBeLessThan(150);
  });
});
