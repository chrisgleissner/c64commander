/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({ name: "android" }));
const audio = vi.hoisted(() => ({
  contexts: [] as Array<{ state: string; resume: ReturnType<typeof vi.fn>; suspend: ReturnType<typeof vi.fn> }>,
  sources: [] as Array<{
    offset: { value: number };
    connect: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock("@/lib/native/platform", () => ({ getPlatform: () => platform.name }));
vi.mock("@/lib/logging", () => ({ addLog: vi.fn() }));

class FakeAudioContext {
  state = "suspended";
  destination = { kind: "destination" };
  resume = vi.fn(async () => {
    this.state = "running";
  });
  suspend = vi.fn(async () => {
    this.state = "suspended";
  });
  constructor() {
    audio.contexts.push(this);
  }
  createConstantSource() {
    const source = { offset: { value: 1 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn(), disconnect: vi.fn() };
    audio.sources.push(source);
    return source;
  }
}

import {
  KEEP_ALIVE_LEVEL,
  isWebViewKeepAliveRunning,
  resetWebViewKeepAliveForTests,
  startWebViewKeepAlive,
  stopWebViewKeepAlive,
} from "@/lib/native/webViewKeepAlive";

describe("keeping the page awake during background playback", () => {
  beforeEach(() => {
    platform.name = "android";
    audio.contexts.length = 0;
    audio.sources.length = 0;
    vi.stubGlobal("AudioContext", FakeAudioContext);
    resetWebViewKeepAliveForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // With the screen off the page froze after a minute: the tune fell silent and a lost network went unnoticed.
  it("plays an offset above Chromium's silence level so the hidden page is not frozen", () => {
    startWebViewKeepAlive();
    startWebViewKeepAlive();

    expect(audio.sources).toHaveLength(1);
    const [source] = audio.sources;
    expect(source.offset.value).toBe(KEEP_ALIVE_LEVEL);
    expect(20 * Math.log10(KEEP_ALIVE_LEVEL)).toBeGreaterThan(-72);
    expect(source.connect).toHaveBeenCalledWith(audio.contexts[0].destination);
    expect(source.start).toHaveBeenCalledTimes(1);
    expect(audio.contexts[0].resume).toHaveBeenCalledTimes(1);
    expect(isWebViewKeepAliveRunning()).toBe(true);
  });

  it("stops the offset and suspends the context, and reuses the context on the next start", () => {
    startWebViewKeepAlive();
    stopWebViewKeepAlive();

    expect(audio.sources[0].stop).toHaveBeenCalledTimes(1);
    expect(audio.sources[0].disconnect).toHaveBeenCalledTimes(1);
    expect(audio.contexts[0].suspend).toHaveBeenCalledTimes(1);
    expect(isWebViewKeepAliveRunning()).toBe(false);

    startWebViewKeepAlive();

    expect(audio.contexts).toHaveLength(1);
    expect(audio.sources).toHaveLength(2);
  });

  it("warns when the page cannot be kept awake, and stops quietly when the source had already stopped", async () => {
    const { addLog } = await import("@/lib/logging");
    class RefusingContext extends FakeAudioContext {
      resume = vi.fn(async () => {
        throw new Error("not allowed to start");
      });
    }
    vi.stubGlobal("AudioContext", RefusingContext);

    startWebViewKeepAlive();

    await vi.waitFor(() =>
      expect(addLog).toHaveBeenCalledWith(
        "warn",
        "Background playback: could not keep the page awake with the screen off",
        {
          error: "not allowed to start",
        },
      ),
    );
    audio.sources[0].stop.mockImplementation(() => {
      throw new Error("already stopped");
    });
    stopWebViewKeepAlive();
    expect(addLog).toHaveBeenCalledWith("debug", "Background playback: the keep-awake source was already stopped", {
      error: "already stopped",
    });

    resetWebViewKeepAliveForTests();
    vi.stubGlobal(
      "AudioContext",
      class {
        constructor() {
          throw new Error("no audio output");
        }
      },
    );
    startWebViewKeepAlive();

    expect(isWebViewKeepAliveRunning()).toBe(false);
    expect(addLog).toHaveBeenCalledWith(
      "warn",
      "Background playback: could not keep the page awake with the screen off",
      {
        error: "no audio output",
      },
    );
  });

  it("reports a failure that is not an Error by its text", async () => {
    const { addLog } = await import("@/lib/logging");
    class RefusingContext extends FakeAudioContext {
      resume = vi.fn(() => Promise.reject("resume refused"));
    }
    vi.stubGlobal("AudioContext", RefusingContext);
    startWebViewKeepAlive();
    await vi.waitFor(() =>
      expect(addLog).toHaveBeenCalledWith("warn", expect.any(String), { error: "resume refused" }),
    );
    audio.sources[0].stop.mockImplementation(() => {
      throw "stop refused";
    });
    stopWebViewKeepAlive();
    expect(addLog).toHaveBeenCalledWith("debug", expect.any(String), { error: "stop refused" });

    resetWebViewKeepAliveForTests();
    vi.stubGlobal(
      "AudioContext",
      class {
        constructor() {
          throw "no output";
        }
      },
    );
    startWebViewKeepAlive();
    expect(addLog).toHaveBeenCalledWith("warn", expect.any(String), { error: "no output" });
  });

  it("does nothing outside Android, where no page is frozen this way", () => {
    platform.name = "ios";
    startWebViewKeepAlive();
    platform.name = "web";
    startWebViewKeepAlive();

    expect(audio.contexts).toHaveLength(0);
    expect(isWebViewKeepAliveRunning()).toBe(false);
  });
});
