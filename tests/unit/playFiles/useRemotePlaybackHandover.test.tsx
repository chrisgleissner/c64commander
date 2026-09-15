/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaylistItem } from "@/pages/playFiles/types";

const connection = vi.hoisted(() => ({ state: "REAL_CONNECTED", listeners: new Set<() => void>() }));
const device = vi.hoisted(() => ({ host: "c64u", remotePlaying: true, machineReset: vi.fn(async () => undefined) }));

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
}));

vi.mock("@/lib/playback/playbackRouter", () => ({
  getRememberedUltimateSidBlob: vi.fn(() => null),
  tryFetchUltimateSidBlob: vi.fn(async () => new Blob([new Uint8Array([0x50, 0x53, 0x49, 0x44])])),
}));

vi.mock("@/lib/logging", () => ({ addLog: vi.fn() }));

import { getRememberedUltimateSidBlob, tryFetchUltimateSidBlob } from "@/lib/playback/playbackRouter";
import { markRemotePlaybackStopped } from "@/lib/playback/activePlaybackSession";
import { addLog } from "@/lib/logging";
import { useRemotePlaybackHandover } from "@/pages/playFiles/hooks/useRemotePlaybackHandover";

const ultimateSid = (id: string) =>
  ({
    id,
    category: "sid",
    label: `${id}.sid`,
    path: `/USB2/MUSICIANS/${id}.sid`,
    request: { source: "ultimate", path: `/USB2/MUSICIANS/${id}.sid`, songNr: 1 },
  }) as unknown as PlaylistItem;

const setConnection = (state: string) => {
  connection.state = state;
  act(() => connection.listeners.forEach((listener) => listener()));
};

const renderHandover = (playlist: PlaylistItem[], startedAt: number) => {
  const engine = {
    muted: vi.fn(() => false),
    setMuted: vi.fn(),
    positionSeconds: vi.fn(() => 0.2),
    preload: vi.fn(),
    prerender: vi.fn(),
  };
  const currentPlaybackIsLocalRef = { current: false };
  const playItem = vi.fn(async () => {
    currentPlaybackIsLocalRef.current = true;
  });
  const seekBy = vi.fn(async () => undefined);
  const options = {
    playlistRef: { current: playlist },
    currentIndexRef: { current: 0 },
    isPlayingRef: { current: true },
    isPausedRef: { current: false },
    currentPlaybackIsLocalRef,
    trackStartedAtRef: { current: startedAt },
    durationMsRef: { current: 180_000 as number | undefined },
    isPlaying: true,
    isPaused: false,
    currentIndex: 0,
    localEngineActive: false,
    durationMs: 180_000,
    getLocalSidPlayback: () => engine as never,
    resolveHvscRuntimeRequest: vi.fn(async () => null),
    resolveNextIndex: (from: number) => (from + 1 < playlist.length ? from + 1 : null),
    playItem,
    seekBy,
  };
  renderHook(() => useRemotePlaybackHandover(options));
  return { engine, playItem, seekBy, currentPlaybackIsLocalRef };
};

describe("useRemotePlaybackHandover", () => {
  beforeEach(() => {
    connection.state = "REAL_CONNECTED";
    connection.listeners.clear();
    device.host = "c64u";
    device.remotePlaying = true;
    device.machineReset.mockClear();
    vi.mocked(getRememberedUltimateSidBlob).mockReturnValue(null);
    vi.mocked(tryFetchUltimateSidBlob).mockClear();
    vi.mocked(markRemotePlaybackStopped).mockClear();
    vi.mocked(addLog).mockClear();
  });

  it("reads the tune playing on the C64 and the ones after it, and renders the one playing", async () => {
    const { engine } = renderHandover([ultimateSid("one"), ultimateSid("two"), ultimateSid("three")], Date.now());

    await waitFor(() => expect(vi.mocked(tryFetchUltimateSidBlob)).toHaveBeenCalledTimes(3));
    expect(engine.prerender).toHaveBeenCalledWith(expect.stringMatching(/^one#0@/), expect.anything(), 0, 180);
    expect(engine.preload).toHaveBeenCalled();
    expect(vi.mocked(tryFetchUltimateSidBlob)).toHaveBeenCalledWith("/USB2/MUSICIANS/three.sid");
  });

  it("carries the tune on on the phone from where the C64 was when the device goes", async () => {
    vi.mocked(getRememberedUltimateSidBlob).mockReturnValue(new Blob([new Uint8Array(4)]));
    const { engine, playItem, seekBy } = renderHandover([ultimateSid("one"), ultimateSid("two")], Date.now() - 42_000);

    setConnection("OFFLINE_NO_DEMO");

    await waitFor(() => expect(seekBy).toHaveBeenCalledTimes(1));
    expect(playItem).toHaveBeenCalledWith(expect.objectContaining({ id: "one" }), { playlistIndex: 0, origin: "auto" });
    const [delta] = seekBy.mock.calls[0] as unknown as [number];
    expect(delta).toBeGreaterThan(41);
    expect(delta).toBeLessThan(43);
    // Silent while the phone opens the tune and seeks, then back to what the listener had.
    expect(engine.setMuted.mock.calls).toEqual([[true], [false]]);
  });

  it("leaves a tune it could not read before the device went, and says why", async () => {
    const { playItem } = renderHandover([ultimateSid("one")], Date.now() - 10_000);

    setConnection("OFFLINE_NO_DEMO");

    await waitFor(() =>
      expect(vi.mocked(addLog)).toHaveBeenCalledWith(
        "info",
        "Playback: the C64 is out of reach and this tune cannot carry on here",
        { item: "one.sid" },
      ),
    );
    expect(playItem).not.toHaveBeenCalled();
  });

  it("stops the tune left looping on the C64 once the device is back", async () => {
    vi.mocked(getRememberedUltimateSidBlob).mockReturnValue(new Blob([new Uint8Array(4)]));
    const { seekBy } = renderHandover([ultimateSid("one")], Date.now() - 5_000);
    setConnection("OFFLINE_NO_DEMO");
    await waitFor(() => expect(seekBy).toHaveBeenCalled());

    setConnection("REAL_CONNECTED");

    await waitFor(() => expect(vi.mocked(markRemotePlaybackStopped)).toHaveBeenCalled(), { timeout: 3000 });
    expect(device.machineReset).toHaveBeenCalledTimes(1);
  });

  it("tries the reset again when reconnecting aborted it", async () => {
    vi.mocked(getRememberedUltimateSidBlob).mockReturnValue(new Blob([new Uint8Array(4)]));
    const { seekBy } = renderHandover([ultimateSid("one")], Date.now() - 5_000);
    setConnection("OFFLINE_NO_DEMO");
    await waitFor(() => expect(seekBy).toHaveBeenCalled());
    device.machineReset.mockRejectedValueOnce(new Error("The operation was aborted"));

    setConnection("REAL_CONNECTED");

    await waitFor(() => expect(vi.mocked(markRemotePlaybackStopped)).toHaveBeenCalled(), { timeout: 4000 });
    expect(device.machineReset).toHaveBeenCalledTimes(2);
    expect(vi.mocked(addLog)).not.toHaveBeenCalledWith("warn", expect.anything(), expect.anything());
  });

  it("does not reset a different device the app reconnected to", async () => {
    vi.mocked(getRememberedUltimateSidBlob).mockReturnValue(new Blob([new Uint8Array(4)]));
    const { seekBy } = renderHandover([ultimateSid("one")], Date.now() - 5_000);
    setConnection("OFFLINE_NO_DEMO");
    await waitFor(() => expect(seekBy).toHaveBeenCalled());

    device.host = "u64";
    setConnection("REAL_CONNECTED");
    await act(() => new Promise((resolve) => setTimeout(resolve, 1500)));

    expect(device.machineReset).not.toHaveBeenCalled();
  });
});
