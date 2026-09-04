/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

const { plugin } = vi.hoisted(() => ({
  plugin: {
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    setPlaybackState: vi.fn(async () => undefined),
    setNowPlaying: vi.fn(async () => undefined),
    setDueAtMs: vi.fn(async () => undefined),
    checkPermissions: vi.fn(async () => ({ notifications: "granted" })),
    requestPermissions: vi.fn(async () => ({ notifications: "granted" })),
    addListener: vi.fn(async () => ({ remove: vi.fn() })),
  },
}));

vi.mock("@capacitor/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@capacitor/core")>()),
  registerPlugin: () => plugin,
}));

import { BackgroundExecution } from "@/lib/native/backgroundExecution";

/**
 * The two calls HARD27-007 and HARD27-040 added to the bridge. Each one forwards its options to
 * the plugin and stamps the active action's trace context onto them, the same as every other call
 * on this surface — a call that reached the plugin without one would be invisible in a trace of
 * the playback it belongs to.
 */
describe("background execution bridge", () => {
  afterEach(() => vi.clearAllMocks());

  it("forwards a playback-state publish with a trace context", async () => {
    await BackgroundExecution.setPlaybackState({ paused: true });

    expect(plugin.setPlaybackState).toHaveBeenCalledWith(
      expect.objectContaining({ paused: true, traceContext: expect.anything() }),
    );
  });

  it("forwards a now-playing publish with a trace context", async () => {
    const info = { title: "Commando", artist: "Rob Hubbard", durationMs: 214000 };

    await BackgroundExecution.setNowPlaying(info);

    expect(plugin.setNowPlaying).toHaveBeenCalledWith(
      expect.objectContaining({ ...info, traceContext: expect.anything() }),
    );
  });

  // Every field is nullable: a SID header names no author more often than not, and a length is
  // only known once the songlength database has been consulted.
  it("forwards a now-playing publish that names nothing", async () => {
    await BackgroundExecution.setNowPlaying({ title: null, artist: null, durationMs: null });

    expect(plugin.setNowPlaying).toHaveBeenCalledWith(
      expect.objectContaining({ title: null, artist: null, durationMs: null }),
    );
  });

  it("lets a rejected publish reach its caller, which reports it as a failed publish", async () => {
    plugin.setPlaybackState.mockRejectedValueOnce(new Error("service gone"));

    await expect(BackgroundExecution.setPlaybackState({ paused: false })).rejects.toThrow("service gone");
  });
});
