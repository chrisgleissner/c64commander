/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// jsdom environment so typeof window !== "undefined", allowing the catch fallback
// in safeAddLog / safeAddErrorLog to emit console.warn instead of returning early.
import { beforeEach, describe, expect, it, vi } from "vitest";

const addLogMock = vi.fn();
const addErrorLogMock = vi.fn();

vi.mock("@/lib/logging", () => ({
  addLog: (...args: unknown[]) => addLogMock(...args),
  addErrorLog: (...args: unknown[]) => addErrorLogMock(...args),
}));

describe("SongLengthServiceFacade logging fallback (jsdom)", () => {
  beforeEach(() => {
    vi.resetModules();
    addLogMock.mockReset();
    addErrorLogMock.mockReset();
  });

  it("falls back to console.warn when addLog throws during a service call", async () => {
    addLogMock.mockImplementation(() => {
      throw new Error("log-exploded");
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const { SongLengthServiceFacade, InMemoryTextBackend } = await import("@/lib/songlengths");
    const service = new SongLengthServiceFacade(new InMemoryTextBackend(), { serviceId: "test" });
    await service.loadOnColdStart(null, async () => [], "test-label");

    expect(warnSpy).toHaveBeenCalledWith(
      "SongLengthServiceFacade logging failed",
      expect.objectContaining({ error: "log-exploded" }),
    );
    warnSpy.mockRestore();
  });

  it("falls back to console.warn when addErrorLog throws during a service call", async () => {
    addLogMock.mockImplementation(() => {
      throw new Error("log-exploded");
    });
    addErrorLogMock.mockImplementation(() => {
      throw new Error("errlog-exploded");
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const { SongLengthServiceFacade, InMemoryTextBackend } = await import("@/lib/songlengths");
    const service = new SongLengthServiceFacade(new InMemoryTextBackend(), { serviceId: "test" });

    // loadOnColdStart with a throwing loader triggers addErrorLog path
    await service.loadOnColdStart(
      null,
      async () => {
        throw new Error("source-failed");
      },
      "test-label",
    );

    expect(warnSpy).toHaveBeenCalledWith(
      "SongLengthServiceFacade error logging failed",
      expect.objectContaining({ error: "errlog-exploded" }),
    );
    warnSpy.mockRestore();
  });
  // A reset is part of installing or clearing an HVSC library, and every install logged it as a warning.
  it("logs a resolve strategy when it changes, not once per tune resolved", async () => {
    const { SongLengthServiceFacade, InMemoryTextBackend } = await import("@/lib/songlengths");
    const service = new SongLengthServiceFacade(new InMemoryTextBackend(), { serviceId: "test" });
    await service.loadOnColdStart(
      "/Songlengths.md5",
      async () => [
        {
          path: "/Songlengths.md5",
          content: [
            "; /MUSICIANS/A/a1.sid",
            "0123456789abcdef0123456789abcdef=0:30",
            "; /MUSICIANS/A/a2.sid",
            "fedcba9876543210fedcba9876543210=0:40",
          ].join("\n"),
        },
      ],
      "test-label",
    );
    const strategyLogs = () =>
      addLogMock.mock.calls.filter(([, message]) => message === "Songlengths resolve strategy");

    for (let i = 0; i < 50; i += 1) service.resolveDurationSeconds({ virtualPath: "/MUSICIANS/A/a1.sid" });
    service.resolveDurationSeconds({ virtualPath: "/MUSICIANS/B/missing.sid" });

    expect(strategyLogs()).toHaveLength(2);
    expect(strategyLogs()[1][2]).toMatchObject({ resolvesSincePrevious: 50 });
  });

  it("logs a reset at info", async () => {
    const { SongLengthServiceFacade, InMemoryTextBackend } = await import("@/lib/songlengths");
    const service = new SongLengthServiceFacade(new InMemoryTextBackend(), { serviceId: "test" });

    service.reset("hvsc-filesystem-reset");

    expect(addLogMock).toHaveBeenCalledWith(
      "info",
      "Songlengths reset",
      expect.objectContaining({ reason: "hvsc-filesystem-reset" }),
    );
    expect(addLogMock).not.toHaveBeenCalledWith("warn", "Songlengths reset", expect.anything());
  });
});
