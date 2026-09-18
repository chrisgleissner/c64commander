/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PlaybackConfigSheet } from "@/pages/playFiles/components/PlaybackConfigSheet";
import type { PlaylistItem } from "@/pages/playFiles/types";

const item = (overrides: Partial<PlaylistItem> = {}): PlaylistItem => ({
  id: "item-1",
  request: { source: "ultimate", path: "/PROGRAMS/Game.prg" },
  category: "prg",
  label: "Game.prg",
  path: "/PROGRAMS/Game.prg",
  ...overrides,
});

const renderSheet = (playlistItem: PlaylistItem) =>
  render(
    <PlaybackConfigSheet
      item={playlistItem}
      open
      canRediscover
      onOpenChange={vi.fn()}
      onAttachLocalConfig={vi.fn()}
      onAttachUltimateConfig={vi.fn()}
      onChooseCandidate={vi.fn()}
      onRemoveConfig={vi.fn()}
      onRediscover={vi.fn()}
      onUpdateOverrides={vi.fn()}
    />,
  );

/*
 * The sentence is the first thing the sheet says, and the rows under it only explain how the
 * choice was reached. A reader who stops after the first line must already know what the machine
 * will be told, so each state is asserted on the rendered sheet rather than on the sentence
 * function alone.
 */
describe("the playback config sheet's outcome sentence", () => {
  it("names the file that will be applied", () => {
    renderSheet(
      item({
        configRef: { kind: "ultimate", fileName: "Game.cfg", path: "/PROGRAMS/Game.cfg" },
        configOrigin: "auto-exact",
      }),
    );

    expect(screen.getByTestId("playback-config-outcome")).toHaveTextContent(
      "Game.cfg will be applied before this plays.",
    );
  });

  it("counts the changed settings alongside the file", () => {
    renderSheet(
      item({
        configRef: { kind: "ultimate", fileName: "Game.cfg", path: "/PROGRAMS/Game.cfg" },
        configOrigin: "manual",
        configOverrides: [{ category: "Drive A Settings", item: "Drive Type", value: "1541" }],
      }),
    );

    expect(screen.getByTestId("playback-config-outcome")).toHaveTextContent(
      "Game.cfg will be applied before this plays, with 1 changed setting.",
    );
  });

  it("says nothing will be applied when a file was only found nearby", () => {
    renderSheet(
      item({
        configCandidates: [
          {
            ref: { kind: "ultimate", fileName: "Other.cfg", path: "/PROGRAMS/Other.cfg" },
            strategy: "directory",
            distance: 0,
            confidence: "medium",
          },
        ],
      }),
    );

    expect(screen.getByTestId("playback-config-outcome")).toHaveTextContent(
      "No config file will be applied. One was found nearby",
    );
  });

  it("says nothing was found when the item carries no config at all", () => {
    renderSheet(item());

    expect(screen.getByTestId("playback-config-outcome")).toHaveTextContent(
      "No config file will be applied. None was found beside this one.",
    );
  });
});
