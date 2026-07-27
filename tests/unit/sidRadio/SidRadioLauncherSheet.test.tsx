/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { SidRadioStylePopulations } from "@/lib/sidRadio/sidRadioWorkerProtocol";
import { SidRadioLauncherSheet } from "@/pages/playFiles/components/SidRadioLauncherSheet";
import { SID_RADIO_STYLE_TILES } from "@/pages/playFiles/hooks/useSidRadio";

const populationsWith = (overrides: Record<string, number>): SidRadioStylePopulations =>
  Object.fromEntries(SID_RADIO_STYLE_TILES.map((tile) => [tile.key, overrides[tile.key] ?? 1000]));

const setup = (likeCount: number, stylePopulations: SidRadioStylePopulations | null = null) => {
  const onStartStyle = vi.fn();
  const onStartTaste = vi.fn();
  const onSurprise = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <SidRadioLauncherSheet
      open
      onOpenChange={onOpenChange}
      likeCount={likeCount}
      stylePopulations={stylePopulations}
      onStartStyle={onStartStyle}
      onStartTaste={onStartTaste}
      onSurprise={onSurprise}
    />,
  );
  return { onStartStyle, onStartTaste, onSurprise, onOpenChange };
};

describe("SidRadioLauncherSheet", () => {
  it("renders the 9 style tiles", () => {
    setup(0);
    for (let bit = 0; bit < 9; bit += 1) {
      expect(screen.getByTestId(`sid-radio-style-${bit}`)).toBeInTheDocument();
    }
  });

  it("starts a broad style station and closes the sheet", () => {
    const { onStartStyle, onOpenChange } = setup(0);
    fireEvent.click(screen.getByTestId("sid-radio-style-0"));
    expect(onStartStyle).toHaveBeenCalledWith(0, "Fast-Paced", false);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("composes 'from my likes' when the toggle is on (D10)", () => {
    const { onStartStyle } = setup(3);
    fireEvent.click(screen.getByTestId("sid-radio-likes-toggle"));
    fireEvent.click(screen.getByTestId("sid-radio-style-0"));
    expect(onStartStyle).toHaveBeenCalledWith(0, "Fast-Paced", true);
  });

  it("locks Taste below the like threshold with a hint (D1)", () => {
    const locked = setup(3);
    expect(screen.getByTestId("sid-radio-taste")).toBeDisabled();
    expect(screen.getByTestId("sid-radio-taste-hint")).toHaveTextContent("3/5");
    fireEvent.click(screen.getByTestId("sid-radio-taste"));
    expect(locked.onStartTaste).not.toHaveBeenCalled();
  });

  it("unlocks Taste at the like threshold (D1)", () => {
    const unlocked = setup(5);
    expect(screen.getByTestId("sid-radio-taste")).not.toBeDisabled();
    expect(screen.queryByTestId("sid-radio-taste-hint")).toBeNull();
    fireEvent.click(screen.getByTestId("sid-radio-taste"));
    expect(unlocked.onStartTaste).toHaveBeenCalledTimes(1);
  });

  it("fires Surprise", () => {
    const { onSurprise } = setup(0);
    fireEvent.click(screen.getByTestId("sid-radio-surprise"));
    expect(onSurprise).toHaveBeenCalledTimes(1);
  });
});

/**
 * The export shipped `theme_hunter` with 0 members and `composer_focus` with 673
 * of 87,868, so the launcher offered a station that could never play anything
 * and gave no way to tell it from one covering half the corpus.
 */
describe("SidRadioLauncherSheet station populations", () => {
  const populations = populationsWith({ fast_paced: 41648, composer_focus: 673, theme_hunter: 0 });

  it("shows each station's size once the populations are known", () => {
    setup(0, populations);
    expect(screen.getByTestId("sid-radio-style-0-size")).toHaveTextContent("41,648 tracks");
    expect(screen.getByTestId("sid-radio-style-5-size")).toHaveTextContent("673 tracks");
  });

  it("disables a style the export left empty instead of offering a dead station", () => {
    const { onStartStyle } = setup(0, populations);
    const emptyTile = screen.getByTestId("sid-radio-style-8");
    expect(emptyTile).toBeDisabled();
    expect(screen.getByTestId("sid-radio-style-8-size")).toHaveTextContent("None in this release");
    fireEvent.click(emptyTile);
    expect(onStartStyle).not.toHaveBeenCalled();
  });

  it("keeps every tile enabled and unlabelled while the populations are unread", () => {
    setup(0);
    for (let bit = 0; bit < 9; bit += 1) {
      expect(screen.getByTestId(`sid-radio-style-${bit}`)).not.toBeDisabled();
      expect(screen.queryByTestId(`sid-radio-style-${bit}-size`)).toBeNull();
    }
  });
});
