/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const connection = vi.hoisted(() => ({ state: "REAL_CONNECTED", listeners: new Set<() => void>() }));
const device = vi.hoisted(() => ({
  host: "c64u",
  remotePlaying: true,
  machineReset: vi.fn(async () => undefined),
}));
const engine = vi.hoisted(() => ({
  play: vi.fn(),
  seekTo: vi.fn(async () => undefined),
  stop: vi.fn(),
  muted: vi.fn(() => false),
  setMuted: vi.fn(),
}));

vi.mock("@/lib/connection/connectionManager", () => ({
  getConnectionSnapshot: () => ({ state: connection.state }),
  subscribeConnection: (listener: () => void) => {
    connection.listeners.add(listener);
    return () => connection.listeners.delete(listener);
  },
}));

vi.mock("@/lib/c64api", () => ({
  getC64API: () => ({ machineReset: device.machineReset }),
  getC64APIConfigSnapshot: () => ({ deviceHost: device.host }),
}));

vi.mock("@/lib/playback/activePlaybackSession", () => ({
  isRemotePlaybackActive: () => device.remotePlaying,
  markRemotePlaybackStopped: vi.fn(() => {
    device.remotePlaying = false;
  }),
}));

vi.mock("@/lib/playback/localSidPlaybackController", () => ({
  LocalSidPlaybackController: { isSupported: () => true },
  getSharedLocalSidPlaybackController: () => engine,
}));

vi.mock("@/lib/logging", () => ({ addLog: vi.fn() }));

import { addLog } from "@/lib/logging";
import { markRemotePlaybackStopped } from "@/lib/playback/activePlaybackSession";
import {
  installRemoteTuneHandover,
  noteTuneHandedOver,
  registerPageHandover,
  rememberRemoteTune,
  resetRemoteTuneHandoverForTests,
  takeTuneHandedOverWithoutPage,
  type RemoteTune,
} from "@/lib/playback/remoteTuneHandover";

const setConnection = (state: string) => {
  connection.state = state;
  connection.listeners.forEach((listener) => listener());
};

const tune = (overrides: Partial<RemoteTune> = {}): RemoteTune => ({
  itemId: "waltz",
  label: "Waltz.sid",
  tuneIndex: 0,
  renderKey: "waltz#0@6581/residfp",
  startedAt: Date.now() - 30_000,
  durationMs: 72_000,
  readBytes: vi.fn(async () => new Uint8Array([0x50, 0x53, 0x49, 0x44]).buffer),
  ...overrides,
});

describe("carrying a tune from the C64 on to the phone", () => {
  let uninstall: () => void;

  beforeEach(() => {
    connection.state = "REAL_CONNECTED";
    connection.listeners.clear();
    device.host = "c64u";
    device.remotePlaying = true;
    device.machineReset.mockReset();
    device.machineReset.mockResolvedValue(undefined);
    engine.play.mockReset();
    engine.play.mockResolvedValue({ started: true });
    engine.seekTo.mockClear();
    engine.stop.mockClear();
    engine.setMuted.mockClear();
    vi.mocked(markRemotePlaybackStopped).mockClear();
    vi.mocked(addLog).mockClear();
    resetRemoteTuneHandoverForTests();
    uninstall = installRemoteTuneHandover();
  });

  afterEach(() => uninstall());

  // Leaving home with the Home tab open: nothing took the tune over, and it stopped for the listener.
  it("plays the tune on the phone at the C64's position when the device goes and no Play page is open", async () => {
    rememberRemoteTune(tune());

    setConnection("OFFLINE_NO_DEMO");

    await vi.waitFor(() => expect(engine.seekTo).toHaveBeenCalledTimes(1));
    expect(engine.play).toHaveBeenCalledWith(expect.anything(), 0, undefined, {
      prerenderKey: "waltz#0@6581/residfp",
      durationSeconds: 72,
    });
    const [position] = engine.seekTo.mock.calls[0] as unknown as [number];
    expect(position).toBeGreaterThan(29);
    expect(position).toBeLessThan(31);
    expect(engine.setMuted.mock.calls).toEqual([[true], [false]]);
    expect(takeTuneHandedOverWithoutPage()).toBe("waltz");
    expect(takeTuneHandedOverWithoutPage()).toBeNull();
  });

  it("stops the tune on the phone at its end unless a Play page has taken it over", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      rememberRemoteTune(tune({ startedAt: Date.now() - 70_000 }));
      setConnection("OFFLINE_NO_DEMO");
      await vi.waitFor(() => expect(engine.seekTo).toHaveBeenCalled());

      vi.advanceTimersByTime(3_500);

      expect(engine.stop).toHaveBeenCalledTimes(1);

      engine.stop.mockClear();
      engine.seekTo.mockClear();
      setConnection("REAL_CONNECTED");
      rememberRemoteTune(tune({ startedAt: Date.now() - 69_000 }));
      setConnection("OFFLINE_NO_DEMO");
      await vi.waitFor(() => expect(engine.seekTo).toHaveBeenCalled());
      expect(takeTuneHandedOverWithoutPage()).toBe("waltz");

      vi.advanceTimersByTime(5_000);

      expect(engine.stop).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves the tune to an open Play page", async () => {
    const pageCarriesOn = vi.fn();
    const unregister = registerPageHandover(pageCarriesOn);
    rememberRemoteTune(tune());

    setConnection("OFFLINE_NO_DEMO");

    expect(pageCarriesOn).toHaveBeenCalledTimes(1);
    expect(engine.play).not.toHaveBeenCalled();
    unregister();
  });

  it("does not play a tune past its end, one no longer playing on the C64, or one it cannot read", async () => {
    rememberRemoteTune(tune({ startedAt: Date.now() - 80_000 }));
    setConnection("OFFLINE_NO_DEMO");
    setConnection("REAL_CONNECTED");

    device.remotePlaying = false;
    rememberRemoteTune(tune());
    setConnection("OFFLINE_NO_DEMO");
    setConnection("REAL_CONNECTED");

    device.remotePlaying = true;
    rememberRemoteTune(tune({ readBytes: vi.fn(async () => null) }));
    setConnection("OFFLINE_NO_DEMO");

    await vi.waitFor(() =>
      expect(addLog).toHaveBeenCalledWith(
        "info",
        "Playback: the C64 is out of reach and this tune cannot carry on here",
        {
          item: "Waltz.sid",
        },
      ),
    );
    expect(engine.play).not.toHaveBeenCalled();
  });

  it("warns when the phone cannot start the tune, and gives the listener their level back", async () => {
    engine.play.mockRejectedValueOnce(new Error("engine failed to open"));
    rememberRemoteTune(tune());

    setConnection("OFFLINE_NO_DEMO");

    await vi.waitFor(() =>
      expect(addLog).toHaveBeenCalledWith("warn", "Playback: could not carry on with the tune on this phone", {
        item: "Waltz.sid",
        error: "engine failed to open",
      }),
    );
    expect(engine.seekTo).not.toHaveBeenCalled();
    expect(engine.setMuted.mock.calls).toEqual([[true], [false]]);
  });

  it("warns when the C64 refuses the reset for a reason other than the reconnect", async () => {
    noteTuneHandedOver(Date.now() - 10_000);
    device.machineReset.mockRejectedValueOnce(new Error("HTTP 500"));
    setConnection("OFFLINE_NO_DEMO");

    setConnection("REAL_CONNECTED");

    await vi.waitFor(
      () =>
        expect(addLog).toHaveBeenCalledWith("warn", "Playback: could not stop the tune left playing on the C64", {
          error: "HTTP 500",
        }),
      { timeout: 3000 },
    );
    expect(device.machineReset).toHaveBeenCalledTimes(1);
    expect(markRemotePlaybackStopped).not.toHaveBeenCalled();
  });

  it("reports a failure that is not an Error by its text", async () => {
    engine.play.mockRejectedValueOnce("no engine");
    rememberRemoteTune(tune());
    setConnection("OFFLINE_NO_DEMO");
    await vi.waitFor(() =>
      expect(addLog).toHaveBeenCalledWith("warn", "Playback: could not carry on with the tune on this phone", {
        item: "Waltz.sid",
        error: "no engine",
      }),
    );

    noteTuneHandedOver(Date.now() - 10_000);
    device.machineReset.mockRejectedValueOnce("refused");
    setConnection("REAL_CONNECTED");
    await vi.waitFor(
      () =>
        expect(addLog).toHaveBeenCalledWith("warn", "Playback: could not stop the tune left playing on the C64", {
          error: "refused",
        }),
      { timeout: 3000 },
    );
  });

  it("resets the C64, still looping the tune, once the same device answers again", async () => {
    noteTuneHandedOver(Date.now() - 10_000);
    setConnection("OFFLINE_NO_DEMO");

    setConnection("REAL_CONNECTED");

    await vi.waitFor(() => expect(markRemotePlaybackStopped).toHaveBeenCalled(), { timeout: 3000 });
    expect(device.machineReset).toHaveBeenCalledTimes(1);
  });

  it("tries the reset again when reconnecting aborted it, without a warning", async () => {
    noteTuneHandedOver(Date.now() - 10_000);
    device.machineReset.mockRejectedValueOnce(new Error("The operation was aborted"));
    setConnection("OFFLINE_NO_DEMO");

    setConnection("REAL_CONNECTED");

    await vi.waitFor(() => expect(markRemotePlaybackStopped).toHaveBeenCalled(), { timeout: 4000 });
    expect(device.machineReset).toHaveBeenCalledTimes(2);
    expect(addLog).not.toHaveBeenCalledWith("warn", expect.anything(), expect.anything());
  });

  it("does not reset a different device the app reconnected to", async () => {
    noteTuneHandedOver(Date.now() - 10_000);
    setConnection("OFFLINE_NO_DEMO");
    device.host = "u64";

    setConnection("REAL_CONNECTED");
    await new Promise((resolve) => setTimeout(resolve, 1500));

    expect(device.machineReset).not.toHaveBeenCalled();
  });
});
