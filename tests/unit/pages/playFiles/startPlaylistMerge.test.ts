/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Who owns the queue when a new set of items is started.
 *
 * A SID Radio station owns it outright; playing something from the browser does not. Merging for a
 * station was a defect measured on the Pixel 4: with a few hundred previously-added tunes in the
 * queue, a station contributed only its first ten entries. Its lookahead refill never fired, and
 * navigating past the tenth tune left the station without saying so, into tunes that had never been
 * through its admission rules — so tunes well under the configured minimum length played from a
 * station the listener believed was filtering them.
 */

import { describe, expect, it } from "vitest";

import { mergeStartedPlaylist } from "@/pages/playFiles/startPlaylistMerge";
import type { PlaylistItem } from "@/pages/playFiles/types";

const item = (id: string) => ({ id, path: `/${id}.sid` }) as unknown as PlaylistItem;

describe("mergeStartedPlaylist", () => {
  it("keeps the listener's other tunes behind the started ones by default", () => {
    const previous = [item("a"), item("b"), item("c")];
    const started = [item("x"), item("y")];

    expect(mergeStartedPlaylist(previous, started).map((i) => i.id)).toEqual(["x", "y", "a", "b", "c"]);
  });

  it("does not duplicate a started item that was already queued", () => {
    const previous = [item("a"), item("x")];
    const started = [item("x"), item("y")];

    expect(mergeStartedPlaylist(previous, started).map((i) => i.id)).toEqual(["x", "y", "a"]);
  });

  // The load-bearing case: a station must be the whole queue, not its first few entries.
  it("replaces the queue outright when the caller owns it", () => {
    const previous = [item("a"), item("b"), item("c")];
    const started = [item("x"), item("y")];

    expect(mergeStartedPlaylist(previous, started, { replaceQueue: true }).map((i) => i.id)).toEqual(["x", "y"]);
  });

  it("replaces even when none of the previous items would have been duplicates", () => {
    const previous = Array.from({ length: 300 }, (_, i) => item(`old${i}`));
    const started = [item("radio:1"), item("radio:2")];

    const merged = mergeStartedPlaylist(previous, started, { replaceQueue: true });

    expect(merged).toHaveLength(2);
    expect(merged.some((i) => i.id.startsWith("old"))).toBe(false);
  });

  it("starts from the given items when there was no queue, either way", () => {
    const started = [item("x")];

    expect(mergeStartedPlaylist([], started).map((i) => i.id)).toEqual(["x"]);
    expect(mergeStartedPlaylist([], started, { replaceQueue: true }).map((i) => i.id)).toEqual(["x"]);
  });

  it("never hands back the array it was given", () => {
    const previous = [item("a")];
    const started = [item("x")];

    expect(mergeStartedPlaylist(previous, started)).not.toBe(started);
    expect(mergeStartedPlaylist(previous, started, { replaceQueue: true })).not.toBe(started);
  });
});
