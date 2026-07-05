/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { act, render, waitFor } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { shouldDetachPlaybackOnSavedDeviceSwitch } from "@/pages/playFiles/playFilesUtils";

/**
 * HARD11-002: switching saved devices (via the always-visible health-badge
 * switcher) while a track is playing must NOT keep firing transport controls
 * / auto-advance at the newly-selected device. PlayFilesPage.tsx wires this
 * via a `useSavedDevices()`-driven effect keyed only on the selected device
 * id, gated by the shared, directly-tested `shouldDetachPlaybackOnSavedDeviceSwitch`
 * predicate. This harness reimplements the wiring (not the full page, which
 * has too large a dependency graph to render standalone) so the effect
 * ordering/gating is exercised behaviorally, and asserts the real source
 * calls the same predicate/cleanup so the harness cannot drift from it.
 */
const testFilePath = fileURLToPath(import.meta.url);
const pagePath = resolve(dirname(testFilePath), "../../../../src/pages/PlayFilesPage.tsx");
const pageSource = readFileSync(pagePath, "utf8");

type HarnessProps = {
  selectedDeviceId: string;
  isPlaying: boolean;
  isPaused: boolean;
  onDetach: () => void;
};

function Harness({ selectedDeviceId, isPlaying, isPaused, onDetach }: HarnessProps) {
  const playbackDeviceIdRef = useRef<string | null>(null);
  useEffect(() => {
    const previousDeviceId = playbackDeviceIdRef.current;
    playbackDeviceIdRef.current = selectedDeviceId;
    if (
      !shouldDetachPlaybackOnSavedDeviceSwitch({
        previousDeviceId,
        nextDeviceId: selectedDeviceId,
        isPlaying,
        isPaused,
      })
    ) {
      return;
    }
    onDetach();
  }, [selectedDeviceId]);

  return null;
}

describe("PlayFilesPage saved-device switch detach (HARD11-002)", () => {
  it("wires the detach effect off the shared predicate, keyed only on the saved-device id", () => {
    expect(pageSource).toContain("const selectedSavedDeviceId = useSavedDevices().selectedDeviceId;");
    expect(pageSource).toContain("shouldDetachPlaybackOnSavedDeviceSwitch({");
    expect(pageSource).toContain("}, [selectedSavedDeviceId]);");
    // The old device's volume-override snapshot must be discarded locally,
    // never restored (which would write it to the new device's mixer).
    expect(pageSource).toContain('discardVolumeSession("saved-device-switch");');
  });

  it("does not detach on the initial mount", async () => {
    const onDetach = vi.fn();
    render(<Harness selectedDeviceId="device-a" isPlaying={true} isPaused={false} onDetach={onDetach} />);
    await waitFor(() => {});
    expect(onDetach).not.toHaveBeenCalled();
  });

  it("detaches when the device actually changes while playing", () => {
    const onDetach = vi.fn();
    const { rerender } = render(
      <Harness selectedDeviceId="device-a" isPlaying={true} isPaused={false} onDetach={onDetach} />,
    );

    act(() => {
      rerender(<Harness selectedDeviceId="device-b" isPlaying={true} isPaused={false} onDetach={onDetach} />);
    });

    expect(onDetach).toHaveBeenCalledTimes(1);
  });

  it("detaches when the device actually changes while paused", () => {
    const onDetach = vi.fn();
    const { rerender } = render(
      <Harness selectedDeviceId="device-a" isPlaying={false} isPaused={true} onDetach={onDetach} />,
    );

    act(() => {
      rerender(<Harness selectedDeviceId="device-b" isPlaying={false} isPaused={true} onDetach={onDetach} />);
    });

    expect(onDetach).toHaveBeenCalledTimes(1);
  });

  it("does not detach when re-selecting the same device", () => {
    const onDetach = vi.fn();
    const { rerender } = render(
      <Harness selectedDeviceId="device-a" isPlaying={true} isPaused={false} onDetach={onDetach} />,
    );

    act(() => {
      rerender(<Harness selectedDeviceId="device-a" isPlaying={true} isPaused={false} onDetach={onDetach} />);
    });

    expect(onDetach).not.toHaveBeenCalled();
  });

  it("does not detach on a real device change while nothing is playing", () => {
    const onDetach = vi.fn();
    const { rerender } = render(
      <Harness selectedDeviceId="device-a" isPlaying={false} isPaused={false} onDetach={onDetach} />,
    );

    act(() => {
      rerender(<Harness selectedDeviceId="device-b" isPlaying={false} isPaused={false} onDetach={onDetach} />);
    });

    expect(onDetach).not.toHaveBeenCalled();
  });
});
