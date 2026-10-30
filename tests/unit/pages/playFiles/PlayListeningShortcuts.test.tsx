/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FeatureFlagsProvider } from "@/hooks/useFeatureFlags";
import { MemoryRouter } from "react-router-dom";
import { PlayListeningShortcuts } from "@/pages/playFiles/components/PlayListeningShortcuts";
import { saveStartupModeByUser } from "@/lib/appMode/appModeStore";

const renderShortcuts = (playlistEmpty: boolean) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <FeatureFlagsProvider>
        <MemoryRouter>
          <PlayListeningShortcuts playlistEmpty={playlistEmpty} />
        </MemoryRouter>
      </FeatureFlagsProvider>
    </QueryClientProvider>,
  );

describe("PlayListeningShortcuts", () => {
  afterEach(() => saveStartupModeByUser("default"));

  it("SPM-HOME-03 an empty playlist in SID Player shows search and the listening tiles, without Live View", () => {
    saveStartupModeByUser("sid-player");
    renderShortcuts(true);

    expect(screen.getByTestId("home-search-field")).toBeInTheDocument();
    expect(screen.getByTestId("play-listening-shortcuts")).toBeInTheDocument();
    expect(screen.getByTestId("home-tile-action.sid-radio")).toBeInTheDocument();
    expect(screen.getByTestId("home-tile-action.resume-session")).toBeInTheDocument();
    expect(screen.getByTestId("home-tile-action.recently-played")).toBeInTheDocument();
    expect(screen.queryByTestId("home-tile-home.section.live-view")).toBeNull();
  });

  it("SPM-HOME-03 a playlist with tunes keeps search and drops the tiles", () => {
    saveStartupModeByUser("sid-player");
    renderShortcuts(false);

    expect(screen.getByTestId("home-search-field")).toBeInTheDocument();
    expect(screen.queryByTestId("play-listening-shortcuts")).toBeNull();
  });

  it("SPM-HOME-03 the Full App Play page gets neither", () => {
    renderShortcuts(true);

    expect(screen.queryByTestId("home-search-field")).toBeNull();
    expect(screen.queryByTestId("play-listening-shortcuts")).toBeNull();
  });
});
