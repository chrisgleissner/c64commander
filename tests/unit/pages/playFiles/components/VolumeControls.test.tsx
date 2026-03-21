/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { DisplayProfileProvider, useDisplayProfilePreference } from "@/hooks/useDisplayProfile";
import { CTA_PERSISTENT_ACTIVE_ATTR } from "@/lib/ui/buttonInteraction";
import { VolumeControls } from "@/pages/playFiles/components/VolumeControls";

type RenderOptions = {
  volumeMuted: boolean;
  canControlVolume?: boolean;
  profile?: "compact" | "medium" | "expanded";
};

const ProfileHarness = ({ volumeMuted, canControlVolume = true, profile }: RenderOptions) => {
  const { setOverride } = useDisplayProfilePreference();

  useEffect(() => {
    setOverride(profile ?? null);
  }, [profile, setOverride]);

  return (
    <VolumeControls
      volumeMuted={volumeMuted}
      canControlVolume={canControlVolume}
      isPending={false}
      onToggleMute={vi.fn()}
      volumeStepsCount={5}
      volumeIndex={2}
      onVolumeChange={vi.fn()}
      onVolumeChangeAsync={vi.fn()}
      onVolumeCommit={vi.fn()}
      previewIntervalMs={200}
      volumeLabel="0 dB"
    />
  );
};

const renderVolumeControls = ({ volumeMuted, canControlVolume = true, profile }: RenderOptions) =>
  render(
    <DisplayProfileProvider>
      <ProfileHarness volumeMuted={volumeMuted} canControlVolume={canControlVolume} profile={profile} />
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
});
