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

  it("calls onDurationInputChange when input value changes", () => {
    const onDurationInputChange = vi.fn();
    render(<PlaybackSettingsPanel {...baseProps} onDurationInputChange={onDurationInputChange} />);

    fireEvent.change(screen.getByTestId("duration-input"), { target: { value: "03:00" } });
    expect(onDurationInputChange).toHaveBeenCalledWith("03:00");
  });

  // The tune picker that used to live in this panel has gone. There is one control for choosing a
  // tune now — "Tune x of y" on the credits line, which opens a list carrying each tune's name and
  // length — and it is covered by TuneListSheet's own tests. Two controls doing the same job, both
  // reading "Tune 1 of 19", was the redundancy this removed.

  it("displays songlengths error when provided", () => {
    render(<PlaybackSettingsPanel {...baseProps} songlengthsError="File not found" />);
    expect(screen.getByText("File not found")).toBeInTheDocument();
  });
});
