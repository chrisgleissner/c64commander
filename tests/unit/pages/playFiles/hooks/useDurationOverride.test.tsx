import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { useDurationOverride } from "@/pages/playFiles/hooks/useDurationOverride";
import { loadDefaultSongDurationMs } from "@/lib/config/appSettings";
import { DURATION_MAX_SECONDS, DURATION_MIN_SECONDS } from "@/pages/playFiles/playFilesUtils";
import type { PlaylistItem } from "@/pages/playFiles/types";

const setup = () =>
  renderHook(() => {
    const [playlist, setPlaylist] = useState<PlaylistItem[]>([]);
    const [durationMs, setDurationMs] = useState<number | undefined>();
    return { ...useDurationOverride(setPlaylist, setDurationMs), durationMs, playlist };
  });

describe("default duration controls", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("updates the playing duration immediately and saves the edited default after the debounce", () => {
    const { result } = setup();
    act(() => result.current.handleDurationInputChange("02:15"));
    expect(result.current.durationMs).toBe(135000);
    expect(result.current.pendingDurationOverrideMs).toBe(135000);
    act(() => vi.advanceTimersByTime(500));
    expect(loadDefaultSongDurationMs(0)).toBe(135000);
    act(() => result.current.handleDurationInputBlur());
    expect(result.current.durationInput).toBe("2:15");
    expect(result.current.pendingDurationOverrideMs).toBeUndefined();
  });

  it("restores the previous valid value when an invalid draft loses focus", () => {
    const { result } = setup();
    const previous = result.current.durationInput;
    act(() => result.current.handleDurationInputChange(""));
    expect(result.current.durationMs).toBeUndefined();
    act(() => result.current.handleDurationInputBlur());
    expect(result.current.durationInput).toBe(previous);
  });

  it("clamps an out-of-range draft to the supported maximum on blur", () => {
    const { result } = setup();
    act(() => result.current.handleDurationInputChange("99:59"));
    act(() => result.current.handleDurationInputBlur());
    expect(result.current.durationMs).toBe(DURATION_MAX_SECONDS * 1000);
    expect(loadDefaultSongDurationMs(0)).toBe(DURATION_MAX_SECONDS * 1000);
  });

  it("commits the slider default immediately and clears the pending override", () => {
    const { result } = setup();
    act(() => result.current.handleDurationSliderChange([100]));
    expect(result.current.pendingDurationOverrideMs).toBe(result.current.durationMs);
    act(() => result.current.handleDurationSliderCommit([0]));
    expect(result.current.durationMs).toBe(DURATION_MIN_SECONDS * 1000);
    expect(result.current.pendingDurationOverrideMs).toBeUndefined();
    expect(loadDefaultSongDurationMs(0)).toBe(DURATION_MIN_SECONDS * 1000);
  });

  it("uses the slider minimum when a slider callback supplies no value", () => {
    const { result } = setup();
    act(() => result.current.handleDurationSliderChange([]));
    expect(result.current.durationMs).toBe(DURATION_MIN_SECONDS * 1000);
    act(() => result.current.handleDurationSliderCommit([]));
    expect(loadDefaultSongDurationMs(0)).toBe(DURATION_MIN_SECONDS * 1000);
  });
});
