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
  volumeLabel?: string;
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
  volumeLabel = "0 dB",
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
      volumeLabel={volumeLabel}
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
  // These assertions used to be about the caption element and the button's text. Neither exists any
  // more: the row now reads as [speaker] [slider] [-6 dB], so the state a listener can see is the
  // speaker glyph and the accessible name behind it, and that is what is checked instead. The
  // behaviour a user cares about is unchanged — the control still says whether it is muted, and
  // still says so to a screen reader and to Android's accessibility tree.
  it("shows the muted state on the speaker button and names the action it offers", () => {
    renderVolumeControls({ volumeMuted: true });

    const mute = screen.getByTestId("volume-mute");
    expect(mute).toHaveAttribute(CTA_PERSISTENT_ACTIVE_ATTR, "true");
    expect(mute).toHaveAttribute("aria-label", "Unmute");
    expect(mute).toHaveAttribute("title", "Unmute");
    // The crossed-out speaker: the icon shows the state, not the action, which is the idiom
    // everywhere else a person plays music.
    expect(mute.querySelector(".lucide-volume-x")).not.toBeNull();
  });

  it("shows the unmuted state and offers Mute", () => {
    renderVolumeControls({ volumeMuted: false });

    const mute = screen.getByTestId("volume-mute");
    expect(mute).not.toHaveAttribute(CTA_PERSISTENT_ACTIVE_ATTR);
    expect(mute).toHaveAttribute("aria-label", "Mute");
    expect(mute.querySelector(".lucide-volume-2")).not.toBeNull();
  });

  it("keeps mute, slider and readout on one row whatever the display profile", () => {
    // The point of the row: it used to be three lines, and on the narrow profile the button and the
    // slider were stacked on top of that. Vertical space on the Play page belongs to the playlist.
    for (const profile of ["compact", "medium", "expanded"] as const) {
      const { unmount } = renderVolumeControls({ volumeMuted: false, profile });

      const row = screen.getByTestId("volume-row");
      expect(row.className).toContain("flex");
      expect(row.className).not.toContain("flex-col");
      expect(row).toContainElement(screen.getByTestId("volume-mute"));
      expect(row).toContainElement(screen.getByTestId("volume-slider"));
      expect(row).toContainElement(screen.getByTestId("volume-label"));
      // No caption line, and no word standing in for what the readout already says.
      expect(row.textContent).not.toContain("Playback volume");
      expect(row.textContent).not.toContain("Vol");

      unmount();
    }
  });

  it("reserves the readout's width so a dragging finger does not resize the slider under it", () => {
    // A row that reflows while it is being touched has already cost this project a run of automated
    // taps that landed on the wrong control, so the width is fixed rather than fitted to the text.
    const short = renderVolumeControls({ volumeMuted: false, volumeLabel: "0 dB" });
    const shortClass = screen.getByTestId("volume-label").className;
    short.unmount();

    const long = renderVolumeControls({ volumeMuted: false, volumeLabel: "-42 dB" });
    const longLabel = screen.getByTestId("volume-label");

    expect(longLabel.className).toBe(shortClass);
    expect(longLabel.className).toContain("w-[52px]");
    expect(longLabel.className).toContain("shrink-0");
    // Proportional digits are a second source of width jitter, one figure to the next.
    expect(longLabel.className).toContain("tabular-nums");
    long.unmount();
  });

  it("keeps a 44px touch target on both controls even though the row is shorter", () => {
    renderVolumeControls({ volumeMuted: false });

    // h-11 is 44px in this project's scale, and the same size the transport buttons above use.
    expect(screen.getByTestId("volume-mute").className).toContain("h-11");
    expect(screen.getByTestId("volume-mute").className).toContain("w-11");
    // The slider's hit area is the whole row height, not just the 20px the thumb occupies; on Android
    // the transparent range input that receives the touch is sized from this element.
    expect(screen.getByTestId("volume-slider").className).toContain("h-11");
  });

  it("disables both controls when playback volume is locked", () => {
    renderVolumeControls({ volumeMuted: false, canControlVolume: false, profile: "compact" });

    expect(screen.getByTestId("volume-mute")).toBeDisabled();
    expect(screen.getByTestId("volume-slider")).toHaveAttribute("data-disabled");
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
    // The caption is gone, so this is now the control's only name.
    expect(nativeInput).toHaveAttribute("aria-label", "Playback volume");
  });
});
