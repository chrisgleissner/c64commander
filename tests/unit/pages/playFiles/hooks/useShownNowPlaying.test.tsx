/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOCAL_PLAY_OUT_GRACE_MS, beginLocalPlayOut, endLocalPlayOut } from "@/lib/playback/localPlayOut";
import { createPlaybackTimeStore } from "@/pages/playFiles/playbackTimeStore";
import { useShownNowPlaying } from "@/pages/playFiles/hooks/useShownNowPlaying";
import type { PlaylistItem } from "@/pages/playFiles/types";

const tune = (id: string) => ({ id, label: `${id}.sid`, path: `/${id}.sid`, category: "sid" }) as PlaylistItem;
const playlist = [tune("outgoing"), tune("next")];

const renderShown = () => {
  const playbackTime = createPlaybackTimeStore({ elapsedMs: 23_600, playedMs: 50_000 });
  const rendered: { id: string | undefined; elapsedMs: number }[] = [];
  const hook = renderHook(
    (props: { currentIndex: number; durationMs: number }) => {
      const shown = useShownNowPlaying({ playlist, playbackTime, ...props });
      rendered.push({ id: shown.item?.id, elapsedMs: shown.time.read().elapsedMs });
      return shown;
    },
    { initialProps: { currentIndex: 0, durationMs: 26_000 } },
  );
  // The playlist moves on at the start of the play-out, as `runTransition` does.
  const moveOn = () => {
    act(() => beginLocalPlayOut(2.4));
    act(() => {
      playbackTime.setElapsedMs(0);
      hook.rerender({ currentIndex: 1, durationMs: 63_000 });
    });
  };
  return { ...hook, playbackTime, moveOn, rendered };
};

describe("useShownNowPlaying", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    act(() => endLocalPlayOut());
    vi.useRealTimers();
  });

  it("keeps naming the outgoing tune, with its duration and running clock, while the phone plays it out", () => {
    const { result, moveOn } = renderShown();

    moveOn();
    expect(result.current.item?.id).toBe("outgoing");
    expect(result.current.index).toBe(0);
    expect(result.current.durationMs).toBe(26_000);
    expect(result.current.time.read().elapsedMs).toBe(23_600);

    act(() => vi.advanceTimersByTime(1_000));
    expect(result.current.time.read().elapsedMs).toBe(24_600);
    act(() => vi.advanceTimersByTime(1_800));
    expect(result.current.time.read().elapsedMs).toBe(26_000);
  });

  it("names the next tune once its first sample is heard, never drawing it with the held tune's clock", () => {
    const { result, playbackTime, moveOn, rendered } = renderShown();
    moveOn();
    act(() => vi.advanceTimersByTime(2_000));

    act(() => endLocalPlayOut());
    expect(rendered.filter((render) => render.id === "next" && render.elapsedMs > 0)).toEqual([]);
    expect(result.current.item?.id).toBe("next");
    expect(result.current.durationMs).toBe(63_000);
    expect(result.current.time.read().elapsedMs).toBe(0);
    act(() => playbackTime.setElapsedMs(1_000));
    expect(result.current.time.read().elapsedMs).toBe(1_000);
  });

  it("names the next tune at the play-out's deadline when the report of its first sample never comes", () => {
    const { result, moveOn } = renderShown();
    moveOn();

    act(() => vi.advanceTimersByTime(2_400 + LOCAL_PLAY_OUT_GRACE_MS));
    expect(result.current.item?.id).toBe("next");
  });

  it("follows the playlist when no play-out is running", () => {
    const { result, rerender } = renderShown();

    act(() => rerender({ currentIndex: 1, durationMs: 63_000 }));
    expect(result.current.item?.id).toBe("next");
    expect(result.current.time.read().elapsedMs).toBe(23_600);
  });
});
