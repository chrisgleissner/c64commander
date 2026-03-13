import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePlayFilesVolumeBindings } from "@/pages/playFiles/hooks/usePlayFilesVolumeBindings";

const useVolumePreviewIntervalMock = vi.fn(() => 275);
const useVolumeOverrideMock = vi.fn();

vi.mock("@/pages/playFiles/hooks/useVolumePreviewInterval", () => ({
  useVolumePreviewInterval: () => useVolumePreviewIntervalMock(),
}));

vi.mock("@/pages/playFiles/hooks/useVolumeOverride", () => ({
  useVolumeOverride: (...args: unknown[]) => useVolumeOverrideMock(...args),
}));

describe("usePlayFilesVolumeBindings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useVolumePreviewIntervalMock.mockReturnValue(275);
    useVolumeOverrideMock.mockReturnValue({
      volumeState: { index: 0, muted: false, reason: null },
      dispatchVolume: vi.fn(),
      volumeSteps: [{ label: "0" }, { label: "5" }],
      sidEnablement: {},
      enabledSidVolumeItems: [],
      resolveEnabledSidVolumeItems: vi.fn(),
      restoreVolumeOverrides: vi.fn(),
      applyAudioMixerUpdates: vi.fn(),
      pauseMuteSnapshotRef: { current: null },
      pausingFromPauseRef: { current: false },
      volumeSessionActiveRef: { current: false },
      captureSidMuteSnapshot: vi.fn(),
      snapshotToUpdates: vi.fn(),
      handleVolumeLocalChange: vi.fn(),
      handleVolumeAsyncChange: vi.fn(),
      handleVolumeCommit: vi.fn(),
      handleToggleMute: vi.fn(),
      resumingFromPauseRef: { current: false },
      ensureUnmuted: vi.fn(),
    });
  });

  it("wires the preview interval into volume override and returns it for the page", () => {
    const { result } = renderHook(() => usePlayFilesVolumeBindings({ isPlaying: false, isPaused: false }));

    expect(result.current.volumeSliderPreviewIntervalMs).toBe(275);
    expect(useVolumeOverrideMock).toHaveBeenCalledWith({
      isPlaying: false,
      isPaused: false,
      previewIntervalMs: 275,
    });
    expect(result.current.volumeSteps).toEqual([{ label: "0" }, { label: "5" }]);
  });
});
