/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { useRef, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  commit: vi.fn<(input: { playlistId: string; items: unknown[] }) => Promise<unknown>>(),
  toast: vi.fn(),
  addErrorLog: vi.fn(),
  addLog: vi.fn(),
}));

vi.mock("@/pages/playFiles/playlistRepositorySync", () => ({
  commitPlaylistSnapshot: (input: { playlistId: string; items: unknown[] }) => hoisted.commit(input),
}));
vi.mock("@/hooks/use-toast", () => ({ toast: hoisted.toast }));
vi.mock("@/lib/logging", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/logging")>()),
  addErrorLog: hoisted.addErrorLog,
  addLog: hoisted.addLog,
}));

import { mergeStartedPlaylist } from "@/pages/playFiles/startPlaylistMerge";
import {
  readHandoverRecord,
  rememberedHandover,
  resetStationHandoverSession,
  writeHandoverRecord,
} from "@/pages/playFiles/stationPlaylistHandover";
import { useStationPlaylistHandover } from "@/pages/playFiles/hooks/useStationPlaylistHandover";
import type { PlaylistItem } from "@/pages/playFiles/types";

const item = (id: string) => ({ id, path: `/${id}.sid`, category: "sid" }) as unknown as PlaylistItem;
const ids = (items: readonly PlaylistItem[]) => items.map((entry) => entry.id);
const mine = [item("a"), item("b")];

type Props = {
  stationActive: boolean;
  startSucceeds?: boolean;
  readSavedPlaylist?: (playlistId: string) => Promise<PlaylistItem[]>;
};

const stationStop = vi.fn();

const useHarness = (props: Props) => {
  const [playlist, setPlaylist] = useState<PlaylistItem[]>(mine);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedPlaylistIds, setSelectedPlaylistIds] = useState(new Set(["b"]));
  const stationActiveRef = useRef(false);
  const startPlaylist = async (items: PlaylistItem[], startIndex: number, options: { replaceQueue: boolean }) => {
    if (props.startSucceeds === false) return false;
    setPlaylist((prev) => mergeStartedPlaylist(prev, items, options));
    setCurrentIndex(startIndex);
    return true;
  };
  const handover = useStationPlaylistHandover({
    queue: { playlist, setPlaylist, currentIndex, setCurrentIndex, selectedPlaylistIds, setSelectedPlaylistIds },
    playback: {
      isPlaying: true,
      isPaused: false,
      playlistEnded: false,
      startPlaylist,
      stopPlayback: vi.fn(),
      stationActiveRef,
    },
    persistence: { ready: true, readSavedPlaylist: props.readSavedPlaylist ?? (async () => []) },
    station: { active: props.stationActive, resumeSettled: true, stop: stationStop },
  });
  return { playlist, setPlaylist, selectedPlaylistIds, handover };
};

beforeEach(() => {
  localStorage.clear();
  resetStationHandoverSession();
  hoisted.commit.mockReset().mockResolvedValue({});
  hoisted.toast.mockReset();
  hoisted.addErrorLog.mockReset();
  hoisted.addLog.mockReset();
  stationStop.mockReset();
});

describe("useStationPlaylistHandover failure paths", () => {
  it("drops the saved copy and keeps the playlist when the first station fails to start", async () => {
    const harness = renderHook((props: Props) => useHarness(props), {
      initialProps: { stationActive: true, startSucceeds: false },
    });

    let started: boolean | undefined;
    await act(async () => {
      started = await harness.result.current.handover.startStationQueue([item("radio:1")]);
    });

    expect(started).toBe(false);
    expect(rememberedHandover()).toBeNull();
    expect(readHandoverRecord()).toBeNull();
    expect(ids(harness.result.current.playlist)).toEqual(["a", "b"]);
    expect([...harness.result.current.selectedPlaylistIds]).toEqual(["b"]);
  });

  it("keeps the earlier saved copy when a second station fails to start", async () => {
    const harness = renderHook((props: Props) => useHarness(props), { initialProps: { stationActive: true } });
    await act(async () => {
      await harness.result.current.handover.startStationQueue([item("radio:1")]);
    });
    const firstSaved = rememberedHandover();

    harness.rerender({ stationActive: true, startSucceeds: false });
    await act(async () => {
      await harness.result.current.handover.startStationQueue([item("radio:9")]);
    });

    expect(rememberedHandover()).toEqual(firstSaved);
    expect(ids(rememberedHandover()!.items ?? [])).toEqual(["a", "b"]);
  });

  it("appends a station's refill to the queue and counts it as the station's own", async () => {
    const harness = renderHook((props: Props) => useHarness(props), { initialProps: { stationActive: true } });
    await act(async () => {
      await harness.result.current.handover.startStationQueue([item("radio:1")]);
    });

    act(() => harness.result.current.handover.appendStationItems([item("radio:2")]));

    expect(ids(harness.result.current.playlist)).toEqual(["radio:1", "radio:2"]);
    expect(rememberedHandover()!.stationItemIds).toEqual(["radio:1", "radio:2"]);
  });

  it("logs a failure to store the saved playlist instead of losing it silently", async () => {
    hoisted.commit.mockRejectedValue(new Error("IndexedDB quota"));
    const harness = renderHook((props: Props) => useHarness(props), { initialProps: { stationActive: true } });

    await act(async () => {
      await harness.result.current.handover.startStationQueue([item("radio:1")]);
    });

    await waitFor(() =>
      expect(hoisted.addErrorLog).toHaveBeenCalledWith(
        "Failed to store the playlist saved before SID Radio",
        expect.objectContaining({ itemCount: 2, error: "IndexedDB quota" }),
      ),
    );
  });

  it("closes the edited-queue prompt without stopping the station when it is dismissed", async () => {
    const harness = renderHook((props: Props) => useHarness(props), { initialProps: { stationActive: true } });
    await act(async () => {
      await harness.result.current.handover.startStationQueue([item("radio:1")]);
    });
    act(() => harness.result.current.setPlaylist((prev) => [...prev, item("mine")]));
    act(() => harness.result.current.handover.requestStop());
    expect(harness.result.current.handover.editedPrompt.open).toBe(true);

    act(() => harness.result.current.handover.editedPrompt.onDismiss());

    expect(harness.result.current.handover.editedPrompt.open).toBe(false);
    expect(stationStop).not.toHaveBeenCalled();
  });

  it("does not put back a read-back that arrives after the handover ended", async () => {
    writeHandoverRecord({
      items: null,
      currentItemId: "a",
      currentIndex: 0,
      selectedIds: [],
      stationItemIds: ["radio:1"],
      phase: "station",
    });
    let finishRead: (items: PlaylistItem[]) => void = () => undefined;
    const harness = renderHook((props: Props) => useHarness(props), {
      initialProps: {
        stationActive: true,
        readSavedPlaylist: () => new Promise<PlaylistItem[]>((resolve) => (finishRead = resolve)),
      },
    });

    await act(async () => {
      await harness.result.current.handover.startStationQueue([]);
    });
    act(() => harness.result.current.handover.editedPrompt.onKeepStationTunes());
    await act(async () => finishRead([item("a")]));

    expect(rememberedHandover()).toBeNull();
    expect(hoisted.addLog).not.toHaveBeenCalledWith(
      "info",
      "SID Radio: read back the playlist saved before the station",
      expect.anything(),
    );
  });

  it("logs a non-Error failure to store the saved playlist by its text", async () => {
    hoisted.commit.mockRejectedValue("disk full");
    const harness = renderHook((props: Props) => useHarness(props), { initialProps: { stationActive: true } });

    await act(async () => {
      await harness.result.current.handover.startStationQueue([item("radio:1")]);
    });

    await waitFor(() =>
      expect(hoisted.addErrorLog).toHaveBeenCalledWith(
        "Failed to store the playlist saved before SID Radio",
        expect.objectContaining({ error: "disk full" }),
      ),
    );
  });

  it("appends items without a handover when no station saved the playlist", () => {
    const harness = renderHook((props: Props) => useHarness(props), { initialProps: { stationActive: false } });

    act(() => harness.result.current.handover.appendStationItems([item("radio:5")]));

    expect(ids(harness.result.current.playlist)).toEqual(["a", "b", "radio:5"]);
    expect(rememberedHandover()).toBeNull();
  });
});
