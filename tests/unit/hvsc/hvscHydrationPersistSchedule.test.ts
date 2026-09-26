/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { createHydrationPersistSchedule, HYDRATION_PERSIST_INTERVAL_MS } from "@/lib/hvsc/hvscHydrationPersistSchedule";

const START_MS = 1_000_000;

describe("createHydrationPersistSchedule", () => {
  it("spaces hydration saves thirty seconds apart", () => {
    expect(HYDRATION_PERSIST_INTERVAL_MS).toBe(30_000);
  });

  it("does not save a changed chunk before the interval has passed since the run started", () => {
    const schedule = createHydrationPersistSchedule(START_MS);
    schedule.recordChange();
    expect(schedule.shouldPersist(false, START_MS + 5_000)).toBe(false);
    expect(schedule.shouldPersist(false, START_MS + HYDRATION_PERSIST_INTERVAL_MS - 1)).toBe(false);
    expect(schedule.shouldPersist(false, START_MS + HYDRATION_PERSIST_INTERVAL_MS)).toBe(true);
  });

  it("measures the next interval from the last save, not from the start of the run", () => {
    const schedule = createHydrationPersistSchedule(START_MS);
    schedule.recordChange();
    const firstSaveMs = START_MS + 40_000;
    schedule.recordPersisted(firstSaveMs);
    schedule.recordChange();
    expect(schedule.shouldPersist(false, firstSaveMs + HYDRATION_PERSIST_INTERVAL_MS - 1)).toBe(false);
    expect(schedule.shouldPersist(false, firstSaveMs + HYDRATION_PERSIST_INTERVAL_MS)).toBe(true);
  });

  it("always saves the final chunk of a run when it changed anything, however recent the last save", () => {
    const schedule = createHydrationPersistSchedule(START_MS);
    schedule.recordChange();
    expect(schedule.shouldPersist(true, START_MS + 1)).toBe(true);
  });

  it("skips a due save, final or not, when nothing changed since the last save", () => {
    const schedule = createHydrationPersistSchedule(START_MS);
    expect(schedule.shouldPersist(false, START_MS + 10 * HYDRATION_PERSIST_INTERVAL_MS)).toBe(false);
    expect(schedule.shouldPersist(true, START_MS + 1)).toBe(false);

    schedule.recordChange();
    schedule.recordPersisted(START_MS + 1);
    expect(schedule.shouldPersist(true, START_MS + 2)).toBe(false);
    expect(schedule.shouldPersist(false, START_MS + 10 * HYDRATION_PERSIST_INTERVAL_MS)).toBe(false);
  });
});
