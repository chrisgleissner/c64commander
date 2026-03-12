/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CTA_PERSISTENT_ACTIVE_ATTR } from "@/lib/ui/buttonInteraction";
import { VolumeControls } from "./VolumeControls";

const renderVolumeControls = (volumeMuted: boolean) =>
  render(
    <VolumeControls
      volumeMuted={volumeMuted}
      canControlVolume
      isPending={false}
      onToggleMute={vi.fn()}
      volumeStepsCount={5}
      volumeIndex={2}
      onVolumeChange={vi.fn()}
      onVolumeChangeAsync={vi.fn()}
      onVolumeCommit={vi.fn()}
      previewIntervalMs={200}
      volumeLabel="0 dB"
    />,
  );

describe("VolumeControls", () => {
  it("keeps the unmute button persistently highlighted while muted", () => {
    renderVolumeControls(true);

    expect(screen.getByTestId("volume-mute")).toHaveAttribute(CTA_PERSISTENT_ACTIVE_ATTR, "true");
  });

  it("clears the persistent highlight when not muted", () => {
    renderVolumeControls(false);

    expect(screen.getByTestId("volume-mute")).not.toHaveAttribute(CTA_PERSISTENT_ACTIVE_ATTR);
  });
});
