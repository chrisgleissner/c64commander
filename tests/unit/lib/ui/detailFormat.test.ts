/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("formatDetailDate", () => {
  it("formats a date in the viewer's locale and says — for a missing or unusable one", async () => {
    const { formatDetailDate, UNKNOWN_VALUE } = await import("@/lib/ui/detailFormat");
    const expected = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "2-digit" }).format(
      new Date("2026-02-12T00:00:00.000Z"),
    );
    expect(formatDetailDate("2026-02-12T00:00:00.000Z")).toBe(expected);
    expect(formatDetailDate(null)).toBe(UNKNOWN_VALUE);
    expect(formatDetailDate("not a date")).toBe(UNKNOWN_VALUE);
  });

  it("builds its date formatter once however many rows it formats", async () => {
    const { formatDetailDate } = await import("@/lib/ui/detailFormat");
    const RealDateTimeFormat = Intl.DateTimeFormat;
    const constructor = vi.fn(function (...args: ConstructorParameters<typeof Intl.DateTimeFormat>) {
      return new RealDateTimeFormat(...args);
    });
    vi.stubGlobal("Intl", { ...Intl, DateTimeFormat: constructor });
    for (let day = 1; day <= 20; day += 1) formatDetailDate(`2026-02-${String(day).padStart(2, "0")}T00:00:00Z`);
    expect(constructor).toHaveBeenCalledTimes(1);
  });
});
