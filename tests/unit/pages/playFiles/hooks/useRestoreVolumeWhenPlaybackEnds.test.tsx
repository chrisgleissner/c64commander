/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useRestoreVolumeWhenPlaybackEnds } from "@/pages/playFiles/hooks/useRestoreVolumeWhenPlaybackEnds";

const { addErrorLog } = vi.hoisted(() => ({ addErrorLog: vi.fn() }));
vi.mock("@/lib/logging", () => ({ addErrorLog }));

type Props = { sessionRestoreSettled: boolean; isPlaying: boolean; isPaused: boolean };

const renderRestore = (initialProps: Props) => {
  const restoreVolumeOverrides = vi.fn(async () => undefined);
  const volumeSessionActiveRef = { current: true };
  const view = renderHook(
    (props: Props) => useRestoreVolumeWhenPlaybackEnds({ ...props, volumeSessionActiveRef, restoreVolumeOverrides }),
    { initialProps },
  );
  return { ...view, restoreVolumeOverrides };
};

describe("useRestoreVolumeWhenPlaybackEnds", () => {
  it("leaves a re-owned volume session alone while the stored playback session is still being restored", () => {
    const { rerender, restoreVolumeOverrides } = renderRestore({
      sessionRestoreSettled: false,
      isPlaying: false,
      isPaused: false,
    });
    expect(restoreVolumeOverrides).not.toHaveBeenCalled();

    rerender({ sessionRestoreSettled: true, isPlaying: true, isPaused: false });

    expect(restoreVolumeOverrides).not.toHaveBeenCalled();
  });

  it("restores the mixer once the restored session turns out to have ended", () => {
    const { rerender, restoreVolumeOverrides } = renderRestore({
      sessionRestoreSettled: false,
      isPlaying: false,
      isPaused: false,
    });

    rerender({ sessionRestoreSettled: true, isPlaying: false, isPaused: false });

    expect(restoreVolumeOverrides).toHaveBeenCalledWith("playback-ended");
  });

  it("restores the mixer when playback stops after the session was restored", () => {
    const { rerender, restoreVolumeOverrides } = renderRestore({
      sessionRestoreSettled: true,
      isPlaying: true,
      isPaused: false,
    });
    expect(restoreVolumeOverrides).not.toHaveBeenCalled();

    rerender({ sessionRestoreSettled: true, isPlaying: false, isPaused: false });

    expect(restoreVolumeOverrides).toHaveBeenCalledTimes(1);
  });
  it("logs a rejected mixer restore with its stack instead of leaving an unhandled rejection", async () => {
    const error = new Error("C64U disconnected during mixer restore");
    const restoreVolumeOverrides = vi.fn().mockRejectedValue(error);
    renderHook(() =>
      useRestoreVolumeWhenPlaybackEnds({
        sessionRestoreSettled: true,
        isPlaying: false,
        isPaused: false,
        volumeSessionActiveRef: { current: true },
        restoreVolumeOverrides,
      }),
    );
    await waitFor(() =>
      expect(addErrorLog).toHaveBeenCalledWith("Volume restore failed after playback ended", {
        error: error.message,
        stack: error.stack,
      }),
    );
  });
});
