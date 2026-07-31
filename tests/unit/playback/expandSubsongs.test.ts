/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";

import { expandSubsongs, hasAllTunesQueued, MIN_TUNES_TO_EXPAND } from "@/pages/playFiles/expandSubsongs";
import type { PlaylistItem } from "@/pages/playFiles/types";

/**
 * A SID file is a small album, and the app only ever played one track of it.
 *
 * The credits line has always said "Tune 1 of 19" while the control that acts on it sat in the
 * settings panel below the fold, picking them off one at a time. Putting the whole file in the queue
 * turns every control that already exists — next, previous, shuffle, repeat, the playlist panel —
 * onto it, without adding a surface or a concept.
 */

const item = (overrides: Partial<PlaylistItem> = {}): PlaylistItem =>
  ({
    id: "hvsc:/MUSICIANS/H/Hubbard_Rob/Commando.sid",
    request: { source: "hvsc", path: "/MUSICIANS/H/Hubbard_Rob/Commando.sid", songNr: 1 },
    category: "sid",
    label: "Commando.sid",
    path: "/MUSICIANS/H/Hubbard_Rob/Commando.sid",
    ...overrides,
  }) as PlaylistItem;

const other = (id: string): PlaylistItem => item({ id, path: `/${id}.sid` });

describe("expandSubsongs", () => {
  it("puts one entry in the queue for every tune in the file", () => {
    const { items } = expandSubsongs([item()], 0, 5);

    expect(items).toHaveLength(5);
    expect(items.map((entry) => entry.request.songNr)).toEqual([1, 2, 3, 4, 5]);
  });

  it("replaces the file's entry rather than appending to it", () => {
    // The item being expanded IS one of the tunes; appending would queue the first one twice.
    const { items } = expandSubsongs([other("before"), item(), other("after")], 1, 3);

    expect(items).toHaveLength(5);
    expect(items[0]?.id).toBe("before");
    expect(items[4]?.id).toBe("after");
  });

  it("leaves playback on the tune that was already selected", () => {
    // Expanding from tune 4 of 9 puts all nine in and keeps playing the fourth.
    const { items, index } = expandSubsongs(
      [other("before"), item({ request: { source: "hvsc", path: "/x", songNr: 4 } as never })],
      1,
      9,
    );

    expect(index).toBe(4);
    expect(items[index]?.request.songNr).toBe(4);
  });

  it("keeps the playing tune's own entry untouched, so the transport does not lose it", () => {
    const playing = item({ durationMs: 221_000 });
    const { items, index } = expandSubsongs([playing], 0, 4);

    expect(items[index]).toBe(playing);
    expect(items[index]?.durationMs).toBe(221_000);
  });

  it("does not carry one tune's duration onto the others", () => {
    // They are different lengths. Copying would auto-advance in the wrong place on every tune but
    // the one that was resolved.
    const { items, index } = expandSubsongs([item({ durationMs: 221_000, durationSource: "default" })], 0, 3);

    for (const [position, entry] of items.entries()) {
      if (position === index) continue;
      expect(entry.durationMs).toBeUndefined();
      expect(entry.durationSource).toBeNull();
    }
  });

  it("gives every added tune its own id", () => {
    const { items } = expandSubsongs([item()], 0, 6);

    expect(new Set(items.map((entry) => entry.id)).size).toBe(6);
  });

  it("tells every entry how many tunes the file holds", () => {
    const { items } = expandSubsongs([item()], 0, 7);

    expect(items.every((entry) => entry.subsongCount === 7 || entry.subsongCount === undefined)).toBe(true);
  });

  it("does nothing for a file with only one tune", () => {
    const playlist = [item()];
    const result = expandSubsongs(playlist, 0, 1);

    expect(result.items).toEqual(playlist);
    expect(result.index).toBe(0);
  });

  it("does nothing when the item is not there", () => {
    expect(expandSubsongs([], 0, 5)).toEqual({ items: [], index: 0 });
  });

  it("clamps a selected tune beyond the file's count", () => {
    const { index } = expandSubsongs([item({ request: { source: "hvsc", path: "/x", songNr: 99 } as never })], 0, 3);

    expect(index).toBe(2);
  });

  it("needs at least two tunes to be worth offering", () => {
    expect(MIN_TUNES_TO_EXPAND).toBe(2);
  });

  it("gives each tune its own length", () => {
    // They differ wildly inside one file — a nineteen-tune SID holds five-minute pieces and
    // one-second jingles — and an item with no length falls back to the three-minute default, which
    // is what ends the track. Without this, most tunes are followed by minutes of silence.
    const { items } = expandSubsongs([item()], 0, 3, [350_000, 12_000, 164_000]);

    expect(items.map((entry) => entry.durationMs)).toEqual([undefined, 12_000, 164_000]);
  });

  it("leaves a length unset rather than guessing when it is not known", () => {
    // Unset lets the songlengths pass still fill it in; a wrong number would pin the wrong end here.
    const { items } = expandSubsongs([item()], 0, 3, [350_000, null, 0]);

    expect(items[1]?.durationMs).toBeUndefined();
    expect(items[2]?.durationMs).toBeUndefined();
  });

  it("does not mutate the playlist it was given", () => {
    const playlist = [item()];
    expandSubsongs(playlist, 0, 4);
    expect(playlist).toHaveLength(1);
  });
});

describe("hasAllTunesQueued", () => {
  const tune = (songNr: number) =>
    item({
      id: `t${songNr}`,
      request: { source: "hvsc", path: "/A/multi.sid", songNr } as never,
      path: "/A/multi.sid",
    });

  it("is false while only some of the file's tunes are queued", () => {
    expect(hasAllTunesQueued([tune(1), tune(2)], "/A/multi.sid", 5)).toBe(false);
  });

  it("is true once they all are, so the offer can be withdrawn", () => {
    // Expanding again would queue a second copy of all of them.
    expect(hasAllTunesQueued([tune(1), tune(2), tune(3)], "/A/multi.sid", 3)).toBe(true);
  });

  it("counts only this file's tunes", () => {
    const otherFile = item({ id: "x", path: "/B/other.sid" });
    expect(hasAllTunesQueued([tune(1), otherFile, otherFile], "/A/multi.sid", 3)).toBe(false);
  });
});

describe("expandSubsongs tune titles", () => {
  const multi = () =>
    item({
      id: "seed",
      path: "/MUSICIANS/H/Hubbard_Rob/Commando.sid",
      request: { source: "hvsc", path: "/MUSICIANS/H/Hubbard_Rob/Commando.sid", songNr: 1 } as never,
    });

  it("gives each tune its own name, so the rows are not nineteen copies", () => {
    const { items } = expandSubsongs([multi()], 0, 3, [], ["BGM1", "Base", "Level Complete"]);
    expect(items.map((entry) => entry.tuneTitle)).toEqual(["BGM1", "Base", "Level Complete"]);
  });

  it("leaves a tune STIL did not name without one, rather than borrowing a neighbour's", () => {
    const { items } = expandSubsongs([multi()], 0, 3, [], ["BGM1", "", undefined]);
    expect(items.map((entry) => entry.tuneTitle)).toEqual(["BGM1", undefined, undefined]);
  });

  it("names the tune that is already playing without disturbing its identity", () => {
    // Its id and duration are what the transport and the session store are holding.
    const seed = multi();
    const { items, index } = expandSubsongs([seed], 0, 3, [], ["BGM1", "Base", "Level Complete"]);
    expect(items[index]?.id).toBe(seed.id);
    expect(items[index]?.tuneTitle).toBe("BGM1");
  });

  it("expands with no titles at all, which is the case for most of the archive", () => {
    const { items } = expandSubsongs([multi()], 0, 3);
    expect(items.map((entry) => entry.tuneTitle)).toEqual([undefined, undefined, undefined]);
  });
});
