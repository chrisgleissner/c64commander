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
 * The mood a Song station is constrained to is chosen here, so the sheet has to offer the
 * unconstrained station as an explicit option rather than as the absence of one — otherwise a
 * listener who picks a mood has no way back to "similar to this tune" short of stopping the station
 * and starting it again, which throws the seed away.
 */
describe("SidRadioLauncherSheet Song moods", () => {
  const setupSong = (
    overrides: Partial<{
      songSeedLabel: string | null;
      songStyleBit: number | null;
      stylePopulations: SidRadioStylePopulations | null;
    }> = {},
  ) => {
    const onStartSong = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <SidRadioLauncherSheet
        open
        onOpenChange={onOpenChange}
        likeCount={0}
        stylePopulations={overrides.stylePopulations ?? null}
        onStartStyle={vi.fn()}
        onStartTaste={vi.fn()}
        onSurprise={vi.fn()}
        songSeedLabel={"songSeedLabel" in overrides ? overrides.songSeedLabel : "Bouncy_Balls.sid"}
        songStyleBit={overrides.songStyleBit ?? null}
        onStartSong={onStartSong}
      />,
    );
    return { onStartSong, onOpenChange };
  };

  it("offers All moods plus one option per style tile, named after the tune", () => {
    setupSong();
    expect(screen.getByTestId("sid-radio-song-section")).toHaveTextContent("Similar to Bouncy_Balls.sid");
    expect(screen.getByTestId("sid-radio-song-mood-all")).toBeInTheDocument();
    for (const tile of SID_RADIO_STYLE_TILES) {
      expect(screen.getByTestId(`sid-radio-song-mood-${tile.bit}`)).toHaveTextContent(tile.label);
    }
  });

  it("starts the Song station constrained to the chosen mood and closes the sheet", () => {
    const { onStartSong, onOpenChange } = setupSong();
    fireEvent.click(screen.getByTestId("sid-radio-song-mood-2"));
    expect(onStartSong).toHaveBeenCalledWith(2);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("offers the unconstrained station as an explicit choice", () => {
    const { onStartSong } = setupSong({ songStyleBit: 2 });
    expect(screen.getByTestId("sid-radio-song-mood-2")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("sid-radio-song-mood-all")).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByTestId("sid-radio-song-mood-all"));
    expect(onStartSong).toHaveBeenCalledWith(null);
  });

  it("disables a mood the export left empty, exactly as the style tiles do", () => {
    const { onStartSong } = setupSong({ stylePopulations: populationsWith({ theme_hunter: 0 }) });
    const empty = screen.getByTestId("sid-radio-song-mood-8");
    expect(empty).toBeDisabled();
    fireEvent.click(empty);
    expect(onStartSong).not.toHaveBeenCalled();
  });

  it("hides the section when there is no tune to seed a Song station from", () => {
    setupSong({ songSeedLabel: null });
    expect(screen.queryByTestId("sid-radio-song-section")).toBeNull();
    expect(screen.queryByTestId("sid-radio-song-mood-all")).toBeNull();
  });
});

/**
 * The release preceding the pinned 0.8.0 shipped `theme_hunter` with 0 members and
 * `composer_focus` with 673 of 87,868, so the launcher offered a station that could
 * never play anything and gave no way to tell it from one covering half the corpus.
 * These fixtures keep those populations deliberately: the guard has to hold for any
 * export, not only for the one that happens to be pinned.
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
