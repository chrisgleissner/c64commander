/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import { CensusAccumulator, runScrollCensus } from "../src/cta/census.js";
import type { ScrollDriver } from "../src/cta/census.js";

class FakeScrollDriver implements ScrollDriver {
  private readonly rows: string[];
  private readonly pageSize: number;
  private readonly step: number;
  private position = 0;
  readonly maxScrolls: number;

  constructor(rows: string[], pageSize: number, overlap: number, maxScrolls = 20) {
    this.rows = rows;
    this.pageSize = pageSize;
    this.step = Math.max(1, pageSize - overlap);
    this.maxScrolls = maxScrolls;
  }

  async capture(): Promise<string[]> {
    return this.rows.slice(this.position, this.position + this.pageSize);
  }

  async scroll(): Promise<{ atEnd: boolean }> {
    this.position += this.step;
    if (this.position + this.pageSize >= this.rows.length) {
      this.position = Math.max(0, this.rows.length - this.pageSize);
      return { atEnd: true };
    }
    return { atEnd: false };
  }
}

describe("CensusAccumulator fixed-point detection", () => {
  it("declares exhaustion after the required number of consecutive empty scrolls", () => {
    const acc = new CensusAccumulator({ requiredEmptyScrolls: 2 });
    acc.addSnapshot(["a", "b"], 0);
    const empty1 = acc.addSnapshot(["a", "b"], 1);
    expect(empty1.newlyDiscovered).toHaveLength(0);
    expect(empty1.exhausted).toBe(false);
    const empty2 = acc.addSnapshot(["a", "b"], 2);
    expect(empty2.exhausted).toBe(true);
  });

  it("resets the empty streak when new items appear", () => {
    const acc = new CensusAccumulator();
    acc.addSnapshot(["a"], 0);
    acc.addSnapshot(["a"], 1); // empty streak 1
    const withNew = acc.addSnapshot(["a", "b"], 2); // new item resets streak
    expect(withNew.newlyDiscovered).toEqual(["b"]);
    expect(withNew.exhausted).toBe(false);
  });

  it("treats a short list as done once the end is observed with one empty scroll", () => {
    const acc = new CensusAccumulator();
    acc.addSnapshot(["a", "b"], 0);
    const done = acc.addSnapshot(["a", "b"], 1, true);
    expect(done.exhausted).toBe(true);
  });

  it("preserves first-seen order of discovery", () => {
    const acc = new CensusAccumulator();
    acc.addSnapshot(["c", "a"], 0);
    acc.addSnapshot(["a", "b"], 1);
    expect(acc.all()).toEqual(["c", "a", "b"]);
    expect(acc.size()).toBe(3);
  });
});

describe("runScrollCensus", () => {
  it("enumerates a multi-page list and stops at the end", async () => {
    const rows = Array.from({ length: 10 }, (_, i) => `row-${i}`);
    const driver = new FakeScrollDriver(rows, 4, 1);
    const result = await runScrollCensus(driver);
    expect(result.discovered).toEqual(rows);
    expect(result.stopReason).toBe("at-end");
    expect(result.scrollAttempts).toBeGreaterThan(0);
  });

  it("handles a single non-scrolling page", async () => {
    const rows = ["only"];
    const driver = new FakeScrollDriver(rows, 4, 1);
    const result = await runScrollCensus(driver);
    expect(result.discovered).toEqual(["only"]);
    expect(result.stopReason).toBe("at-end");
  });

  it("returns an empty single-page result for an empty scope", async () => {
    const driver = new FakeScrollDriver([], 4, 1);
    const result = await runScrollCensus(driver);
    expect(result.discovered).toEqual([]);
    expect(result.stopReason).toBe("single-page");
  });

  it("reports max-scrolls when the cap is hit before completion", async () => {
    const rows = Array.from({ length: 50 }, (_, i) => `row-${i}`);
    const driver = new FakeScrollDriver(rows, 4, 1, 2);
    const result = await runScrollCensus(driver);
    expect(result.stopReason).toBe("max-scrolls");
    expect(result.discovered.length).toBeLessThan(rows.length);
  });
});
