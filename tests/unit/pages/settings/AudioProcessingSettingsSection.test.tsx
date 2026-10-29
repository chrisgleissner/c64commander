/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const available = vi.hoisted(() => ({ value: true }));
vi.mock("@/lib/audio/useAudioFxAvailable", () => ({ useAudioFxAvailable: () => available.value }));
const requestSectionOpen = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ui/collapsibleSectionStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ui/collapsibleSectionStore")>()),
  requestSectionOpen,
}));

import { readSectionStates } from "@/lib/ui/collapsibleSectionStore";
import { AudioProcessingSettingsSection } from "@/pages/settings/AudioProcessingSettingsSection";
import { applySoundPreset, saveAudioEnabled } from "@/lib/config/audioProcessingSettings";

const renderSection = () =>
  render(
    <MemoryRouter initialEntries={["/settings"]}>
      <Routes>
        <Route path="/settings" element={<AudioProcessingSettingsSection />} />
        <Route path="/play" element={<p data-testid="play-page">Play</p>} />
      </Routes>
    </MemoryRouter>,
  );

const openSection = () => {
  renderSection();
  if (!screen.queryByTestId("settings-audio-open-card")) {
    fireEvent.click(within(screen.getByTestId("settings-audio-processing")).getAllByRole("button")[0]);
  }
};

describe("AudioProcessingSettingsSection", () => {
  beforeEach(() => {
    localStorage.clear();
    available.value = true;
    requestSectionOpen.mockClear();
  });

  it("renders nothing where the phone cannot process its own sound", () => {
    available.value = false;
    renderSection();
    expect(screen.queryByTestId("settings-audio-processing")).not.toBeInTheDocument();
  });

  it("holds no copy of the sound controls", () => {
    openSection();
    for (const id of ["sound-body", "sound-tone-plot", "sound-switch", "sound-chip-hall"]) {
      expect(screen.queryByTestId(id)).not.toBeInTheDocument();
    }
  });

  it("names the current sound, and Off while the switch is off", () => {
    applySoundPreset("warm");
    renderSection();
    expect(screen.getByTestId("settings-audio-processing-state")).toHaveTextContent("Warm");
    act(() => saveAudioEnabled(false));
    expect(screen.getByTestId("settings-audio-processing-state")).toHaveTextContent("Off");
  });

  it("opens the Sound card on the Play page", () => {
    openSection();
    fireEvent.click(screen.getByTestId("settings-audio-open-card"));
    expect(requestSectionOpen).toHaveBeenCalledWith("play", "sound");
    expect(readSectionStates("play").get("sound")).toBe(true);
    expect(screen.getByTestId("play-page")).toBeInTheDocument();
  });
});
