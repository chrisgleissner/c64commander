/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_RESERVE_RATIO,
  MIN_RESERVE_MS,
  computeReserveMs,
  formatRemaining,
  hasDeadlinePassed,
  planFuzzDeadline,
  remainingMs,
  shouldStartWork,
} from "../../../scripts/fuzzDeadline.mjs";

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const START = 1_000_000;

describe("planFuzzDeadline", () => {
  it("treats the budget as a deadline for the whole run", () => {
    const plan = planFuzzDeadline({
      budgetMs: TWO_HOURS_MS,
      startedAtMs: START,
      nowMs: START,
    });
    expect(plan.deadlineMs).toBe(START + TWO_HOURS_MS);
    expect(plan.shardBudgetMs + plan.reserveMs).toBe(TWO_HOURS_MS);
  });

  it("charges time already spent before the shards against the shard budget", () => {
    const buildMs = 90_000;
    const plan = planFuzzDeadline({
      budgetMs: TWO_HOURS_MS,
      startedAtMs: START,
      nowMs: START + buildMs,
    });
    expect(plan.elapsedMs).toBe(buildMs);
    expect(plan.shardBudgetMs).toBe(TWO_HOURS_MS - buildMs - plan.reserveMs);
    expect(plan.expired).toBe(false);
  });

  it("reserves time for teardown and artifact writing", () => {
    const plan = planFuzzDeadline({
      budgetMs: TWO_HOURS_MS,
      startedAtMs: START,
      nowMs: START,
    });
    expect(plan.reserveMs).toBe(TWO_HOURS_MS * DEFAULT_RESERVE_RATIO);
    expect(plan.shardBudgetMs).toBeLessThan(TWO_HOURS_MS);
  });

  it("stops shards before the deadline so the reserve is left for reporting", () => {
    const plan = planFuzzDeadline({
      budgetMs: TWO_HOURS_MS,
      startedAtMs: START,
      nowMs: START,
    });
    expect(plan.shardHardStopMs).toBeGreaterThan(START + plan.shardBudgetMs);
    expect(plan.shardHardStopMs).toBeLessThan(plan.deadlineMs);
  });

  it("starts no further work when the budget is already exceeded", () => {
    const plan = planFuzzDeadline({
      budgetMs: TWO_HOURS_MS,
      startedAtMs: START,
      nowMs: START + TWO_HOURS_MS + 1,
    });
    expect(plan.expired).toBe(true);
    expect(plan.shardBudgetMs).toBe(0);
    expect(hasDeadlinePassed(plan.deadlineMs, START + TWO_HOURS_MS + 1)).toBe(true);
    expect(shouldStartWork(plan.deadlineMs, START + TWO_HOURS_MS + 1)).toBe(false);
  });

  it("starts no further work when only the reserve is left", () => {
    const plan = planFuzzDeadline({
      budgetMs: TWO_HOURS_MS,
      startedAtMs: START,
      nowMs: START + TWO_HOURS_MS - MIN_RESERVE_MS,
    });
    expect(plan.expired).toBe(true);
    expect(plan.shardBudgetMs).toBe(0);
  });
});

describe("computeReserveMs", () => {
  it("never reserves less than the floor", () => {
    expect(computeReserveMs(120_000)).toBe(MIN_RESERVE_MS);
  });

  it("caps the reserve for very long budgets", () => {
    expect(computeReserveMs(12 * 60 * 60 * 1000)).toBe(40 * 60_000);
  });
});

describe("remaining time helpers", () => {
  it("never reports negative time left", () => {
    expect(remainingMs(START, START + 5_000)).toBe(0);
    expect(formatRemaining(START, START + 5_000)).toBe("0m00s");
  });

  it("formats the time left for the run log", () => {
    expect(formatRemaining(START + 125_000, START)).toBe("2m05s");
  });
});
