/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";

import { buildFoundTuneItem, insertAfterCurrent } from "@/pages/playFiles/insertTuneNext";

/**
 * Playing one named tune without losing the station.
 *
 * The station keeps ten tunes queued ahead of the cursor, so appending to the tail would play the
 * tune that was asked for roughly half an hour later. Putting it directly after what is playing is
 * also what makes "return to the station afterwards" need no return logic: the station's own tunes
 * are still queued behind it, so carrying on is simply what the queue does next.
 */
describe("insertAfterCurrent", () => {
  const queue = ["a", "b", "c"];

  it("puts the tune directly after the one playing, not at the end", () => {
    const result = insertAfterCurrent(queue, 0, "x");

    expect(result.items).toEqual(["a", "x", "b", "c"]);
    expect(result.index).toBe(1);
  });

  it("leaves everything the station had queued behind it, in order", () => {
    const result = insertAfterCurrent(queue, 1, "x");

    expect(result.items).toEqual(["a", "b", "x", "c"]);
  });

  it("appends when nothing is playing", () => {
    expect(insertAfterCurrent(queue, -1, "x")).toEqual({ items: ["a", "b", "c", "x"], index: 3 });
  });

  it("appends when the cursor is past the end of the queue", () => {
    expect(insertAfterCurrent(queue, 9, "x").index).toBe(3);
  });

  it("starts an empty queue", () => {
    expect(insertAfterCurrent([], -1, "x")).toEqual({ items: ["x"], index: 0 });
  });

  it("does not mutate the queue it was given", () => {
    const original = [...queue];
    insertAfterCurrent(queue, 1, "x");
    expect(queue).toEqual(original);
  });
});

describe("buildFoundTuneItem", () => {
  it("routes the tune through HVSC at the subsong the archive names", () => {
    const item = buildFoundTuneItem({
      virtualPath: "/MUSICIANS/H/Hubbard_Rob/Commando.sid",
      title: "Commando",
      songNr: 2,
    });

    expect(item.request).toEqual({ source: "hvsc", path: "/MUSICIANS/H/Hubbard_Rob/Commando.sid", songNr: 2 });
    expect(item.category).toBe("sid");
  });

  it("defaults to the first subsong when the archive names none", () => {
    const item = buildFoundTuneItem({ virtualPath: "/A/x.sid", title: "x" });
    expect(item.request).toMatchObject({ songNr: 1 });
  });

  it("carries a known duration, so the transport is right from the first frame", () => {
    const item = buildFoundTuneItem({ virtualPath: "/A/x.sid", title: "x", durationMs: 221_000 });

    expect(item.durationMs).toBe(221_000);
    // Never marked as a default: a later songlengths load must not overwrite a resolved figure.
    expect(item.durationSource).toBeUndefined();
  });

  it("omits the duration entirely when it is unknown", () => {
    expect(buildFoundTuneItem({ virtualPath: "/A/x.sid", title: "x" })).not.toHaveProperty("durationMs");
  });

  it("gives each request its own id, so asking for the same tune twice is two rows", () => {
    const first = buildFoundTuneItem({ virtualPath: "/A/x.sid", title: "x" });
    const second = buildFoundTuneItem({ virtualPath: "/A/x.sid", title: "x" });

    expect(first.id).not.toBe(second.id);
  });
});
