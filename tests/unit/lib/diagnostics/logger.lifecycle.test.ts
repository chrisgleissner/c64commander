/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// jsdom environment — covers document.hidden branches in buildLogContext
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const addLog = vi.fn();
const getActiveAction = vi.fn(() => null);
const getPlaybackTraceSnapshot = vi.fn(() => null);

vi.mock("@/lib/logging", () => ({
  addLog: (...args: unknown[]) => addLog(...args),
  addErrorLog: vi.fn(),
}));

vi.mock("@/lib/tracing/actionTrace", () => ({
  getActiveAction: () => getActiveAction(),
}));

vi.mock("@/pages/playFiles/playbackTraceStore", () => ({
  getPlaybackTraceSnapshot: () => getPlaybackTraceSnapshot(),
}));

describe("logger lifecycle state (jsdom)", () => {
  beforeEach(() => {
    vi.resetModules();
    addLog.mockReset();
    getActiveAction.mockReturnValue(null);
    getPlaybackTraceSnapshot.mockReturnValue(null);
  });

  afterEach(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
  });

  it("records lifecycleState as background when document.hidden is true", async () => {
    const spyInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
    getPlaybackTraceSnapshot.mockReturnValue({
      sourceKind: "hvsc",
      localAccessMode: "file",
      trackInstanceId: "track-bg",
      playlistItemId: "item-bg",
    });
    Object.defineProperty(document, "hidden", { configurable: true, value: true });

    const { logger } = await import("@/lib/diagnostics/logger");
    logger.info("bg-test");

    const logged = addLog.mock.calls[0][2];
    expect(logged.lifecycleState).toBe("background");
    spyInfo.mockRestore();
  });

  it("records lifecycleState as foreground when document is visible and focused", async () => {
    const spyInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
    getPlaybackTraceSnapshot.mockReturnValue({
      sourceKind: "hvsc",
      localAccessMode: "file",
      trackInstanceId: "track-fg",
      playlistItemId: "item-fg",
    });
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    vi.spyOn(document, "hasFocus").mockReturnValue(true);

    const { logger } = await import("@/lib/diagnostics/logger");
    logger.info("fg-test");

    const logged = addLog.mock.calls[0][2];
    expect(logged.lifecycleState).toBe("foreground");
    spyInfo.mockRestore();
  });
});
