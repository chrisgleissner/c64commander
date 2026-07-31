/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PlaybackSettingsPanel } from "@/pages/playFiles/components/PlaybackSettingsPanel";

const baseProps = {
  durationSliderMax: 600,
  durationSliderValue: 120,
  durationInput: "02:00",
  onDurationSliderChange: vi.fn(),
  onDurationSliderCommit: vi.fn(),
  onDurationInputChange: vi.fn(),
  onDurationInputBlur: vi.fn(),
  onChooseSonglengthsFile: vi.fn(),
  activeSonglengthsPath: null,
  songlengthsName: null,
  songlengthsSizeLabel: null,
  songlengthsEntryCount: null,
  songlengthsError: null,
  songSelectorVisible: false,
  songPickerOpen: false,
  onSongPickerPointerDown: vi.fn(),
  onSongPickerClick: vi.fn(),
  clampedSongNr: 1,
  subsongCount: 1,
  onSelectSong: vi.fn(),
  onCloseSongPicker: vi.fn(),
};

describe("PlaybackSettingsPanel", () => {
  it("renders compact songlengths summary with path metadata and change action", () => {
    render(
      <PlaybackSettingsPanel
        {...baseProps}
        activeSonglengthsPath="/C64Music/DOCUMENTS/songlengths.md5"
        songlengthsName="songlengths.md5"
        songlengthsSizeLabel="240 KB"
        songlengthsEntryCount={1024}
      />,
    );

    expect(screen.getByTestId("songlengths-path-label")).toBeInTheDocument();
    expect(screen.getByText("1024 Entries, 240 KB")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change" })).toBeInTheDocument();
  });

  it("invokes change handler from compact action button", () => {
    const onChooseSonglengthsFile = vi.fn();
    render(<PlaybackSettingsPanel {...baseProps} onChooseSonglengthsFile={onChooseSonglengthsFile} />);

    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(onChooseSonglengthsFile).toHaveBeenCalledTimes(1);
  });

  // Amended deliberately: the pieces inside a SID file are called tunes on screen now, everywhere,
  // because "subsong" is format jargon and a listener is choosing between tunes. The now-playing line
  // above this panel says "Tune 2 of 5"; a picker underneath it saying "Subsong 2/5" for the same
  // thing would be two names for one idea on one page. The behaviour under test is unchanged.
  it("uses Tune terminology for a file that holds more than one", () => {
    render(
      <PlaybackSettingsPanel {...baseProps} songSelectorVisible songPickerOpen clampedSongNr={2} subsongCount={5} />,
    );

    expect(screen.getByRole("button", { name: "Tune 2 of 5" })).toBeInTheDocument();
    expect(screen.getByText("Tunes available: 1–5")).toBeInTheDocument();
    expect(screen.queryByText(/Subsong/)).toBeNull();
  });

  it("calls onDurationInputChange when input value changes", () => {
    const onDurationInputChange = vi.fn();
    render(<PlaybackSettingsPanel {...baseProps} onDurationInputChange={onDurationInputChange} />);

    fireEvent.change(screen.getByTestId("duration-input"), { target: { value: "03:00" } });
    expect(onDurationInputChange).toHaveBeenCalledWith("03:00");
  });

  it("calls onSelectSong when a tune button is clicked in the picker", () => {
    const onSelectSong = vi.fn();
    render(
      <PlaybackSettingsPanel
        {...baseProps}
        songSelectorVisible
        songPickerOpen
        clampedSongNr={1}
        subsongCount={3}
        onSelectSong={onSelectSong}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Tune 2" }));
    expect(onSelectSong).toHaveBeenCalledWith(2);
  });

  it("displays songlengths error when provided", () => {
    render(<PlaybackSettingsPanel {...baseProps} songlengthsError="File not found" />);
    expect(screen.getByText("File not found")).toBeInTheDocument();
  });
});
