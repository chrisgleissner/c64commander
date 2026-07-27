/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The ladder measures the audio that arrives, so the one thing it cannot afford is to not be
 * listening. It shipped taking an OPTIONAL session with no default while `AvSyncPanel` renders
 * without a session prop, so `session?.subscribeAudio(...)` quietly did nothing: every run graded an
 * empty capture. It reported "not measured" rather than inventing numbers, which is why it looked
 * plausible — and why only running it on the phone exposed it.
 */

const { subscribeAudio, subscribeFrames, playSidUpload } = vi.hoisted(() => ({
  subscribeAudio: vi.fn(() => () => {}),
  subscribeFrames: vi.fn(() => () => {}),
  playSidUpload: vi.fn(async () => ({ errors: [] })),
}));

vi.mock("@/lib/streams/avMirrorSession", () => ({
  avMirrorSession: { subscribeAudio, subscribeFrames },
  AvMirrorSession: class {},
}));
vi.mock("@/lib/c64api", () => ({ getC64API: () => ({ playSidUpload }) }));

import { useToneLadderTest } from "@/hooks/useToneLadderTest";

describe("useToneLadderTest", () => {
  beforeEach(() => {
    subscribeAudio.mockClear();
    subscribeFrames.mockClear();
    playSidUpload.mockClear();
  });

  it("listens to the shared session when given none", async () => {
    const { result } = renderHook(() => useToneLadderTest());

    await act(async () => {
      await result.current.run();
    });

    expect(playSidUpload).toHaveBeenCalledTimes(1);
    expect(subscribeAudio).toHaveBeenCalledTimes(1);
    expect(subscribeFrames).toHaveBeenCalledTimes(1);
  });

  it("stops listening once the run is reset", async () => {
    const unsubscribeAudio = vi.fn();
    subscribeAudio.mockReturnValueOnce(unsubscribeAudio);
    const { result } = renderHook(() => useToneLadderTest());

    await act(async () => {
      await result.current.run();
    });
    act(() => result.current.reset());

    // Leaving it subscribed would keep the Android audio bridge on after the measurement ended.
    expect(unsubscribeAudio).toHaveBeenCalled();
  });
});
