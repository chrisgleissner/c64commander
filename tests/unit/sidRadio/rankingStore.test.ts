/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  RANKING_CHANGED_EVENT,
  clearAllRankings,
  clearRanking,
  getLikedMd5s,
  getRanking,
  getRankingSnapshot,
  loadRankings,
  setRanking,
  simulateRankingRestartForTests,
} from "@/lib/sidRadio/rankingStore";

const MD5_A = "0123456789abcdef0123456789abcdef";
const MD5_B = "fedcba9876543210fedcba9876543210";
const MD5_C = "11112222333344445555666677778888";

beforeEach(async () => {
  localStorage.clear();
  await clearAllRankings();
});

describe("rankingStore", () => {
  it("stores like / not-for-me keyed by full MD5 and reads them back", async () => {
    await setRanking(MD5_A, "like");
    await setRanking(MD5_B, "notForMe");
    expect(getRanking(MD5_A)).toBe("like");
    expect(getRanking(MD5_B)).toBe("notForMe");
    expect(getRanking(MD5_C)).toBeNull();
    // Keyed by full MD5, case-insensitive.
    expect(getRanking(MD5_A.toUpperCase())).toBe("like");
  });

  it("lists only liked MD5s", async () => {
    await setRanking(MD5_A, "like");
    await setRanking(MD5_B, "notForMe");
    await setRanking(MD5_C, "like");
    expect(getLikedMd5s().sort()).toEqual([MD5_A, MD5_C].sort());
  });

  it("clears a single ranking and all rankings", async () => {
    await setRanking(MD5_A, "like");
    await setRanking(MD5_B, "like");
    await clearRanking(MD5_A);
    expect(getRanking(MD5_A)).toBeNull();
    expect(getRanking(MD5_B)).toBe("like");
    await clearAllRankings();
    expect(getRanking(MD5_B)).toBeNull();
    expect(getLikedMd5s()).toEqual([]);
  });

  it("survives a simulated app restart (persisted durably)", async () => {
    await setRanking(MD5_A, "like");
    await setRanking(MD5_B, "notForMe");
    await simulateRankingRestartForTests(); // drop in-memory cache; keep durable store
    await loadRankings();
    expect(getRanking(MD5_A)).toBe("like");
    expect(getRanking(MD5_B)).toBe("notForMe");
  });

  it("re-setting the same signal is idempotent; changing it updates", async () => {
    await setRanking(MD5_A, "like");
    await setRanking(MD5_A, "like");
    expect(getRanking(MD5_A)).toBe("like");
    await setRanking(MD5_A, "notForMe");
    expect(getRanking(MD5_A)).toBe("notForMe");
    expect(getLikedMd5s()).toEqual([]);
  });

  it("broadcasts a change event on every mutation", async () => {
    const events: unknown[] = [];
    const listener = () => events.push(1);
    window.addEventListener(RANKING_CHANGED_EVENT, listener);
    await setRanking(MD5_A, "like");
    await clearRanking(MD5_A);
    await clearAllRankings();
    window.removeEventListener(RANKING_CHANGED_EVENT, listener);
    expect(events.length).toBeGreaterThanOrEqual(2);
  });

  it("produces a deterministic snapshot id: stable when unchanged, different when changed", async () => {
    await setRanking(MD5_A, "like");
    await setRanking(MD5_B, "notForMe");
    const first = getRankingSnapshot();
    // Order of insertion must not matter for the id.
    await clearAllRankings();
    await setRanking(MD5_B, "notForMe");
    await setRanking(MD5_A, "like");
    const second = getRankingSnapshot();
    expect(second.id).toBe(first.id);
    expect([...second.likes]).toEqual([MD5_A]);
    expect([...second.notForMe]).toEqual([MD5_B]);
    await setRanking(MD5_C, "like");
    expect(getRankingSnapshot().id).not.toBe(first.id);
  });
});
