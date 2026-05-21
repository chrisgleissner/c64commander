/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { DisplayProfileProvider, useDisplayProfilePreference } from "@/hooks/useDisplayProfile";
import { CTA_PERSISTENT_ACTIVE_ATTR } from "@/lib/ui/buttonInteraction";
import { VolumeControls } from "@/pages/playFiles/components/VolumeControls";

type RenderOptions = {
  volumeMuted: boolean;
  canControlVolume?: boolean;
  profile?: "compact" | "medium" | "expanded";
  useNativeRangeInput?: boolean;
  onToggleMute?: () => void;
  onVolumeDraftChange?: (value: number) => void;
  onVolumePreview?: (value: number) => Promise<void> | void;
  onVolumeCommit?: (value: number) => Promise<void> | void;
};

const ProfileHarness = ({
  volumeMuted,
  canControlVolume = true,
  profile,
  useNativeRangeInput = false,
  onToggleMute = vi.fn(),
  onVolumeDraftChange = vi.fn(),
  onVolumePreview = vi.fn(),
  onVolumeCommit = vi.fn(),
}: RenderOptions) => {
  const { setOverride } = useDisplayProfilePreference();

  useEffect(() => {
    setOverride(profile ?? null);
  }, [profile, setOverride]);

  return (
    <VolumeControls
      volumeMuted={volumeMuted}
      canControlVolume={canControlVolume}
      onToggleMute={onToggleMute}
      volumeStepsCount={5}
      volumeIndex={2}
      onVolumeDraftChange={onVolumeDraftChange}
      onVolumePreview={onVolumePreview}
      onVolumeCommit={onVolumeCommit}
      previewIntervalMs={200}
      volumeLabel="0 dB"
      useNativeRangeInput={useNativeRangeInput}
    />
  );
};

const renderVolumeControls = (options: RenderOptions) =>
  render(
    <DisplayProfileProvider>
      <ProfileHarness {...options} />
    </DisplayProfileProvider>,
  );

describe("VolumeControls", () => {
  it("keeps the unmute button persistently highlighted while muted", () => {
    renderVolumeControls({ volumeMuted: true });

    expect(screen.getByTestId("volume-mute")).toHaveAttribute(CTA_PERSISTENT_ACTIVE_ATTR, "true");
    expect(screen.getByTestId("volume-mute")).toHaveTextContent("Unmute");
  });

  it("clears the persistent highlight when not muted", () => {
    renderVolumeControls({ volumeMuted: false });

    expect(screen.getByTestId("volume-mute")).not.toHaveAttribute(CTA_PERSISTENT_ACTIVE_ATTR);
    expect(screen.getByTestId("volume-mute")).toHaveTextContent("Mute");
  });

  it("uses the compact vertical layout and disables controls when playback volume is locked", () => {
    renderVolumeControls({ volumeMuted: false, canControlVolume: false, profile: "compact" });

    expect(screen.getByTestId("volume-mute")).toBeDisabled();
    expect(screen.getByTestId("volume-slider")).toHaveAttribute("data-disabled");
    expect(screen.getByTestId("volume-caption").parentElement?.parentElement).toHaveClass("flex-col", "items-stretch");
  });

  it("uses the expanded slider width on expanded displays", () => {
    renderVolumeControls({ volumeMuted: false, profile: "expanded" });

    expect(screen.getByTestId("volume-caption").parentElement).toHaveClass("min-w-[200px]");
  });

  it("renders an Android-friendly native range input that keeps drag feedback local until commit", () => {
    const onVolumeDraftChange = vi.fn();
    const onVolumePreview = vi.fn();
    const onVolumeCommit = vi.fn();

    renderVolumeControls({
      volumeMuted: false,
      useNativeRangeInput: true,
      onVolumeDraftChange,
      onVolumePreview,
      onVolumeCommit,
    });

    const nativeInput = screen.getByTestId("volume-slider-native-input");
    fireEvent.input(nativeInput, { target: { value: "4" } });
    fireEvent.change(nativeInput, { target: { value: "4" } });

    expect(onVolumeDraftChange).toHaveBeenCalledWith(4);
    expect(onVolumePreview).not.toHaveBeenCalled();
    expect(onVolumeCommit).toHaveBeenCalledWith(4);
    expect(nativeInput).toHaveAttribute("aria-label", "Playback volume");
  });
});
