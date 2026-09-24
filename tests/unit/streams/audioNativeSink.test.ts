/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";
import { claimNativeTrack, nextSerial, releaseNativeTrack } from "@/lib/audio/nativeTrackOwnership";
import { NativeAudioSink, type NativeAudioBackend } from "@/lib/streams/audioNativeSink";
import { addLog } from "@/lib/logging";

vi.mock("@/lib/logging", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/logging")>();
  return { ...actual, addLog: vi.fn() };
});

/** Flush the microtask queue. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
/** Wait past a poll interval (pollMs=5 in these tests) so the self-poll fires. */
const afterPoll = () => new Promise((resolve) => setTimeout(resolve, 25));

const fakeBackend = (overrides: Partial<NativeAudioBackend> = {}) => {
  let bufferedMs = 40;
  const underruns = 0;
  const backend: NativeAudioBackend = {
    openAudioTrack: vi.fn(async ({ sampleRate, bufferMs }) => ({ sampleRate, bufferMs: bufferMs ?? 52 })),
    readAudioStats: vi.fn(async () => {
      bufferedMs += 1;
      return { bufferedMs, underruns };
    }),
    closeAudioTrack: vi.fn(async () => {}),
    ...overrides,
  };
  return { backend };
};

describe("NativeAudioSink", () => {
  it("opens the native track at the source rate + requested buffer, and reports its capacity", async () => {
    const { backend } = fakeBackend();
    const sink = new NativeAudioSink(47982.88, backend, 60, 5);
    expect(await sink.open()).toBe(true);
    // Sample rate rounded to an int; the buffer target is passed through.
    expect(backend.openAudioTrack).toHaveBeenCalledWith({ sampleRate: 47983, bufferMs: 60 });
    expect(sink.bufferCapacityMs).toBe(60);
    await sink.close();
  });

  it("passes bufferMs undefined (platform min) when no target is set", async () => {
    const { backend } = fakeBackend();
    const sink = new NativeAudioSink(47983, backend, 0, 5);
    await sink.open();
    expect(backend.openAudioTrack).toHaveBeenCalledWith({ sampleRate: 47983, bufferMs: undefined });
    await sink.close();
  });

  it("polls the native track's buffer/underrun stats for the governor", async () => {
    const { backend } = fakeBackend();
    const sink = new NativeAudioSink(47983, backend, 60, 5);
    await sink.open();
    expect(sink.getStats()).toEqual({ bufferedMs: 0, underruns: 0 });
    await afterPoll();
    expect(backend.readAudioStats).toHaveBeenCalled();
    expect(sink.getStats().bufferedMs).toBeGreaterThan(0);
    await sink.close();
  });

  // Leaving home with Live View's sound on: the stop that closed the mirror's track reached the native side after
  // the tune carried on on the phone had opened it, so the tune played into a closed track and was never heard.
  it("leaves the native track alone on close once the on-device SID engine has taken it", async () => {
    const { backend } = fakeBackend();
    const sink = new NativeAudioSink(47983, backend, 60, 5);
    await sink.open();
    const localSid = {};
    claimNativeTrack(backend, localSid, nextSerial());

    await sink.close();

    expect(backend.closeAudioTrack).not.toHaveBeenCalled();
    releaseNativeTrack(backend, localSid);
  });

  it("stops polling and releases the track on close", async () => {
    const { backend } = fakeBackend();
    const sink = new NativeAudioSink(47983, backend, 60, 5);
    await sink.open();
    await afterPoll();
    await sink.close();
    const callsAfterClose = (backend.readAudioStats as ReturnType<typeof vi.fn>).mock.calls.length;
    await afterPoll();
    // No further polls once closed.
    expect((backend.readAudioStats as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAfterClose);
    expect(backend.closeAudioTrack).toHaveBeenCalledTimes(1);
  });

  it("logs a run of failing stats polls once at warn and once at info when the poll recovers", async () => {
    let calls = 0;
    const { backend } = fakeBackend({
      readAudioStats: vi.fn(async () => {
        calls += 1;
        if (calls <= 4) throw new Error("plugin busy");
        return { bufferedMs: 80, underruns: 0 };
      }),
    });
    vi.mocked(addLog).mockClear();
    const sink = new NativeAudioSink(47983, backend, 60, 5);
    await sink.open();
    await vi.waitFor(() => expect(sink.getStats().bufferedMs).toBe(80));
    await sink.close();

    const pollLogs = vi
      .mocked(addLog)
      .mock.calls.filter(([, message]) => message.startsWith("Native audio: stats poll"));
    expect(pollLogs).toEqual([
      [
        "warn",
        "Native audio: stats poll failed (last-known values retained)",
        expect.objectContaining({ error: "plugin busy" }),
      ],
      ["info", "Native audio: stats poll recovered", { consecutiveFailures: 4 }],
    ]);
  });

  it("returns false and never polls when the track cannot open", async () => {
    const { backend } = fakeBackend({
      openAudioTrack: vi.fn(async () => {
        throw new Error("no AudioTrack");
      }),
    });
    const sink = new NativeAudioSink(47983, backend, 60, 5);
    expect(await sink.open()).toBe(false);
    await tick();
    await tick();
    expect(backend.readAudioStats).not.toHaveBeenCalled();
  });
});
