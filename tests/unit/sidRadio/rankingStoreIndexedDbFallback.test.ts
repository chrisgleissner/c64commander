/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MD5_A = "0123456789abcdef0123456789abcdef";
const MD5_B = "fedcba9876543210fedcba9876543210";

type FakeTx = {
  oncomplete: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
  error: Error | null;
  objectStore: () => unknown;
};

const createFakeIndexedDb = () => {
  const records = new Map<string, unknown>();
  const control = { failNextPut: false };
  const db = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => undefined,
    close: () => undefined,
    transaction: () => {
      const tx: FakeTx = { oncomplete: null, onerror: null, onabort: null, error: null, objectStore: () => store };
      const store = {
        get: (key: string) => {
          const request = { result: undefined as unknown, onsuccess: null as (() => void) | null, onerror: null };
          setTimeout(() => {
            request.result = structuredClone(records.get(key));
            request.onsuccess?.();
          });
          return request;
        },
        put: (value: unknown, key: string) => {
          setTimeout(() => {
            if (control.failNextPut) {
              control.failNextPut = false;
              tx.error = new Error("QuotaExceededError");
              tx.onabort?.();
              return;
            }
            records.set(key, structuredClone(value));
            tx.oncomplete?.();
          });
        },
      };
      return tx;
    },
  };
  const indexedDb = {
    open: () => {
      const request = { result: db, onsuccess: null as (() => void) | null, onerror: null, onupgradeneeded: null };
      setTimeout(() => request.onsuccess?.());
      return request;
    },
  };
  return { indexedDb, control };
};

const importFreshStore = async () => {
  vi.resetModules();
  return import("@/lib/sidRadio/rankingStore");
};

describe("SID Radio rankings after one IndexedDB write failure", () => {
  let fake: ReturnType<typeof createFakeIndexedDb>;

  beforeEach(() => {
    localStorage.clear();
    fake = createFakeIndexedDb();
    vi.stubGlobal("indexedDB", fake.indexedDb);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("still has a like recorded after the fallback to localStorage when the next launch reads IndexedDB again", async () => {
    const firstSession = await importFreshStore();
    await firstSession.setRanking(MD5_A, "like");
    fake.control.failNextPut = true;
    await firstSession.setRanking(MD5_B, "like");

    const nextLaunch = await importFreshStore();
    await nextLaunch.loadRankings();

    expect(nextLaunch.getLikedMd5s().sort()).toEqual([MD5_A, MD5_B].sort());
  });

  it("keeps the recovered likes in IndexedDB once the fallback copy has been folded back in", async () => {
    const firstSession = await importFreshStore();
    await firstSession.setRanking(MD5_A, "like");
    fake.control.failNextPut = true;
    await firstSession.setRanking(MD5_B, "like");

    await (await importFreshStore()).loadRankings();
    expect(localStorage.getItem("c64u_sid_rankings")).toBeNull();

    const thirdLaunch = await importFreshStore();
    await thirdLaunch.loadRankings();
    expect(thirdLaunch.getRanking(MD5_B)).toBe("like");
  });
});
