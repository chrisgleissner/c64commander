/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaylistItem } from "@/pages/playFiles/types";

const connection = vi.hoisted(() => ({ state: "REAL_CONNECTED", listeners: new Set<() => void>() }));
const device = vi.hoisted(() => ({ remotePlaying: true }));

vi.mock("@/lib/connection/connectionManager", () => ({
  getConnectionSnapshot: () => ({ state: connection.state }),
  subscribeConnection: (listener: () => void) => {
    connection.listeners.add(listener);
    return () => connection.listeners.delete(listener);
  },
}));

vi.mock("@/lib/c64api", () => ({
  getC64API: () => ({ machineReset: vi.fn(async () => undefined) }),
  getC64APIConfigSnapshot: () => ({ deviceHost: "c64u" }),
}));

vi.mock("@/lib/playback/activePlaybackSession", () => ({
  isRemotePlaybackActive: () => device.remotePlaying,
  markRemotePlaybackStopped: vi.fn(),
}));

vi.mock("@/lib/playback/localSidPlaybackController", () => ({
  LocalSidPlaybackController: { isSupported: () => true },
  getSharedLocalSidPlaybackController: vi.fn(),
}));

vi.mock("@/lib/playback/playbackRouter", () => ({
  getRememberedUltimateSidBlob: vi.fn(() => null),
  tryFetchUltimateSidBlob: vi.fn(async () => new Blob([new Uint8Array([0x50, 0x53, 0x49, 0x44])])),
}));

vi.mock("@/lib/logging", () => ({ addLog: vi.fn() }));

const handedOverWithoutPage = vi.hoisted(() => ({ itemId: null as string | null }));
vi.mock("@/lib/playback/remoteTuneHandover", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/playback/remoteTuneHandover")>();
  return {
    ...actual,
    rememberRemoteTune: vi.fn(actual.rememberRemoteTune),
    takeTuneHandedOverWithoutPage: () => {
      const itemId = handedOverWithoutPage.itemId;
      handedOverWithoutPage.itemId = null;
      return itemId;
    },
  };
});

import { getRememberedUltimateSidBlob, tryFetchUltimateSidBlob } from "@/lib/playback/playbackRouter";
import { addLog } from "@/lib/logging";
import {
  installRemoteTuneHandover,
  rememberRemoteTune,
  resetRemoteTuneHandoverForTests,
  wasTuneHandedOver,
} from "@/lib/playback/remoteTuneHandover";
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

const renderHandover = (playlist: PlaylistItem[], startedAt: number, engineActive = false) => {
  const engine = {
    muted: vi.fn(() => false),
    setMuted: vi.fn(),
    positionSeconds: vi.fn(() => 0.2),
    preload: vi.fn(),
    prerender: vi.fn(),
    isActive: vi.fn(() => engineActive),
  };
  const currentPlaybackIsLocalRef = { current: false };
  const setCurrentPlaybackIsLocal = vi.fn((isLocal: boolean) => {
    currentPlaybackIsLocalRef.current = isLocal;
  });
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
    setCurrentPlaybackIsLocal,
    resolveHvscRuntimeRequest: vi.fn(async () => null),
    resolveNextIndex: (from: number) => (from + 1 < playlist.length ? from + 1 : null),
    playItem,
    seekBy,
  };
  renderHook(() => useRemotePlaybackHandover(options));
  return { engine, playItem, seekBy, setCurrentPlaybackIsLocal, options };
};

describe("useRemotePlaybackHandover", () => {
  let uninstall: () => void;

  beforeEach(() => {
    connection.state = "REAL_CONNECTED";
    connection.listeners.clear();
    device.remotePlaying = true;
    handedOverWithoutPage.itemId = null;
    resetRemoteTuneHandoverForTests();
    uninstall = installRemoteTuneHandover();
    vi.mocked(getRememberedUltimateSidBlob).mockReturnValue(null);
    vi.mocked(tryFetchUltimateSidBlob).mockClear();
    vi.mocked(rememberRemoteTune).mockClear();
    vi.mocked(addLog).mockClear();
  });

  afterEach(() => uninstall());

  it("reads the tune playing on the C64 and the ones after it, renders the one playing, and describes it", async () => {
    const startedAt = Date.now();
    const { engine } = renderHandover([ultimateSid("one"), ultimateSid("two"), ultimateSid("three")], startedAt);

    await waitFor(() => expect(vi.mocked(tryFetchUltimateSidBlob)).toHaveBeenCalledTimes(3));
    expect(engine.prerender).toHaveBeenCalledWith(expect.stringMatching(/^one#0@/), expect.anything(), 0, 180);
    expect(engine.preload).toHaveBeenCalled();
    expect(vi.mocked(tryFetchUltimateSidBlob)).toHaveBeenCalledWith("/USB2/MUSICIANS/three.sid");
    // Described for the case where the page is closed when the device goes.
    expect(rememberRemoteTune).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: "one", startedAt, durationMs: 180_000 }),
    );
  });

  // A tap on the track already current left the index, duration and playing state as they were, so it was never read.
  it("reads the tune again when the same track is started again", async () => {
    const playlist = [ultimateSid("one")];
    const trackStartedAtRef = { current: null as number | null };
    const hookOptions = (startedAt: number | null) => {
      trackStartedAtRef.current = startedAt;
      return startedAt;
    };
    const engine = { preload: vi.fn(), prerender: vi.fn(), isActive: vi.fn(() => false) };
    const { rerender } = renderHook(
      ({ startedAt }: { startedAt: number | null }) =>
        useRemotePlaybackHandover({
          playlistRef: { current: playlist },
          currentIndexRef: { current: 0 },
          isPlayingRef: { current: true },
          isPausedRef: { current: false },
          currentPlaybackIsLocalRef: { current: false },
          trackStartedAtRef: { current: hookOptions(startedAt) },
          durationMsRef: { current: 180_000 },
          isPlaying: true,
          isPaused: false,
          currentIndex: 0,
          localEngineActive: false,
          durationMs: 180_000,
          getLocalSidPlayback: () => engine as never,
          setCurrentPlaybackIsLocal: vi.fn(),
          resolveHvscRuntimeRequest: vi.fn(async () => null),
          resolveNextIndex: () => null,
          playItem: vi.fn(),
          seekBy: vi.fn(),
        }),
      { initialProps: { startedAt: null as number | null } },
    );
    expect(engine.prerender).not.toHaveBeenCalled();

    rerender({ startedAt: Date.now() });

    await waitFor(() => expect(engine.prerender).toHaveBeenCalledTimes(1));
  });

  it("carries the tune on on the phone from where the C64 was when the device goes", async () => {
    vi.mocked(getRememberedUltimateSidBlob).mockReturnValue(new Blob([new Uint8Array(4)]));
    const startedAt = Date.now() - 42_000;
    const { engine, playItem, seekBy } = renderHandover([ultimateSid("one"), ultimateSid("two")], startedAt);

    setConnection("OFFLINE_NO_DEMO");

    await waitFor(() => expect(seekBy).toHaveBeenCalledTimes(1));
    expect(playItem).toHaveBeenCalledWith(expect.objectContaining({ id: "one" }), { playlistIndex: 0, origin: "auto" });
    const [delta] = seekBy.mock.calls[0] as unknown as [number];
    expect(delta).toBeGreaterThan(41);
    expect(delta).toBeLessThan(43);
    // Silent while the phone opens the tune and seeks, then back to what the listener had.
    expect(engine.setMuted.mock.calls).toEqual([[true], [false]]);
    // Recorded, so the C64 is reset when it is back.
    expect(wasTuneHandedOver(startedAt)).toBe(true);
  });

  it("warns and gives the listener their level back when the phone cannot start the tune", async () => {
    vi.mocked(getRememberedUltimateSidBlob).mockReturnValue(new Blob([new Uint8Array(4)]));
    const { engine, playItem, seekBy } = renderHandover([ultimateSid("one")], Date.now() - 20_000);
    playItem.mockRejectedValueOnce(new Error("engine failed to open"));

    setConnection("OFFLINE_NO_DEMO");

    await waitFor(() =>
      expect(vi.mocked(addLog)).toHaveBeenCalledWith(
        "warn",
        "Playback: could not carry on with the tune on this phone",
        {
          item: "one.sid",
          error: "engine failed to open",
        },
      ),
    );
    expect(seekBy).not.toHaveBeenCalled();
    expect(engine.setMuted.mock.calls).toEqual([[true], [false]]);
  });

  it("reads a tune from the phone's library ahead, and logs a read that fails without stopping the tune", async () => {
    const hvscSid = {
      id: "hvsc-one",
      category: "sid",
      label: "hvsc-one.sid",
      path: "/MUSICIANS/one.sid",
      request: { source: "hvsc", path: "/MUSICIANS/one.sid", songNr: 1 },
    } as unknown as PlaylistItem;
    const bytes = new ArrayBuffer(8);
    const { engine, options } = renderHandover([hvscSid], Date.now() - 5_000);
    vi.mocked(options.resolveHvscRuntimeRequest).mockResolvedValue({
      request: { file: { arrayBuffer: async () => bytes } },
    } as never);
    const rerendered = renderHook(() => useRemotePlaybackHandover({ ...options, durationMs: 170_000 }));

    await waitFor(() => expect(engine.prerender).toHaveBeenCalledWith(expect.any(String), bytes, 0, 170));
    rerendered.unmount();

    vi.mocked(tryFetchUltimateSidBlob).mockRejectedValueOnce(new Error("Host unreachable"));
    renderHandover([ultimateSid("two")], Date.now() - 5_000);

    await waitFor(() =>
      expect(vi.mocked(addLog)).toHaveBeenCalledWith(
        "debug",
        "Playback: could not read ahead for carrying on without the C64",
        { item: "two.sid", error: "Host unreachable" },
      ),
    );
  });

  it("does not seek when the tune did not start on the phone, and reports failures that are not Errors", async () => {
    vi.mocked(getRememberedUltimateSidBlob).mockReturnValue(new Blob([new Uint8Array(4)]));
    const { playItem, seekBy } = renderHandover([ultimateSid("one")], Date.now() - 20_000);
    playItem.mockImplementationOnce(async () => undefined);

    setConnection("OFFLINE_NO_DEMO");

    await waitFor(() => expect(playItem).toHaveBeenCalledTimes(1));
    await act(async () => {
      await Promise.resolve();
    });
    expect(seekBy).not.toHaveBeenCalled();

    setConnection("REAL_CONNECTED");
    vi.mocked(tryFetchUltimateSidBlob).mockRejectedValueOnce("read refused");
    renderHandover([ultimateSid("two")], Date.now() - 5_000);
    await waitFor(() =>
      expect(vi.mocked(addLog)).toHaveBeenCalledWith(
        "debug",
        "Playback: could not read ahead for carrying on without the C64",
        { item: "two.sid", error: "read refused" },
      ),
    );

    resetRemoteTuneHandoverForTests();
    const third = renderHandover([ultimateSid("three")], Date.now() - 30_000);
    third.playItem.mockRejectedValueOnce("open refused");
    setConnection("OFFLINE_NO_DEMO");
    await waitFor(() =>
      expect(vi.mocked(addLog)).toHaveBeenCalledWith(
        "warn",
        "Playback: could not carry on with the tune on this phone",
        {
          item: "three.sid",
          error: "open refused",
        },
      ),
    );
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

  it("makes a tune the phone took over while the page was closed its own", async () => {
    handedOverWithoutPage.itemId = "one";
    connection.state = "OFFLINE_NO_DEMO";

    const { playItem, setCurrentPlaybackIsLocal } = renderHandover([ultimateSid("one")], Date.now() - 20_000, true);

    expect(setCurrentPlaybackIsLocal).toHaveBeenCalledWith(true);
    await act(async () => undefined);
    expect(playItem).not.toHaveBeenCalled();
  });
});
