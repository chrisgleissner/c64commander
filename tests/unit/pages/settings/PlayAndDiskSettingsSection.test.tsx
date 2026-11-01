/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { FeatureFlagsProvider } from "@/hooks/useFeatureFlags";
import { PlayAndDiskSettingsSection } from "@/pages/settings/PlayAndDiskSettingsSection";
import { writeSectionState } from "@/lib/ui/collapsibleSectionStore";
import { saveStartupModeByUser } from "@/lib/appMode/appModeStore";

const renderOpen = () => {
  writeSectionState("settings", "play-and-disk", true);
  return render(
    <FeatureFlagsProvider>
      <PlayAndDiskSettingsSection />
    </FeatureFlagsProvider>,
  );
};

describe("PlayAndDiskSettingsSection", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => saveStartupModeByUser("default"));

  it("SPM-SET-02 SID Player keeps list preview and friendly names only, under the title Play", () => {
    saveStartupModeByUser("sid-player");
    renderOpen();

    expect(screen.getByText("Play")).toBeInTheDocument();
    expect(screen.queryByText("Play and disk")).toBeNull();
    expect(screen.getByLabelText("List preview limit")).toBeInTheDocument();
    expect(screen.getByTestId("settings-friendly-sid-names")).toBeInTheDocument();
    expect(screen.queryByLabelText("Disk first-PRG load")).toBeNull();
    expect(screen.queryByTestId("settings-autofire-rate-slider")).toBeNull();
    expect(screen.queryByTestId("settings-launch-safety")).toBeNull();
    expect(screen.queryByText(/Autofire rate/)).toBeNull();
  });

  it("SPM-SET-02 the Full App keeps every row under Play and disk", () => {
    renderOpen();

    expect(screen.getByText("Play and disk")).toBeInTheDocument();
    expect(screen.getByLabelText("List preview limit")).toBeInTheDocument();
    expect(screen.getByText("Disk first-PRG load")).toBeInTheDocument();
    expect(screen.getByTestId("settings-autofire-rate-slider")).toBeInTheDocument();
  });
});
