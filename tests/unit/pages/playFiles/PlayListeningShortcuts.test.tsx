/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { recordNetworkStatus, resetNetworkStatusWatchForTests } from "@/lib/connection/networkStatusWatch";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FeatureFlagsProvider } from "@/hooks/useFeatureFlags";
import { MemoryRouter, useLocation } from "react-router-dom";
import { PlayListeningShortcuts, startListeningActions } from "@/pages/playFiles/components/PlayListeningShortcuts";
import { saveStartupModeByUser } from "@/lib/appMode/appModeStore";

const Where = () => {
  const location = useLocation();
  return <span data-testid="location">{location.pathname + location.search}</span>;
};

const renderShortcuts = (playlistEmpty: boolean, hvscInstalled = false) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <FeatureFlagsProvider>
        <MemoryRouter>
          <PlayListeningShortcuts playlistEmpty={playlistEmpty} hvscInstalled={hvscInstalled} />
          <Where />
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

describe("Start listening", () => {
  const ONLINE = { hvscEnabled: true, hvscInstalled: false, radioEnabled: true, archiveEnabled: true, online: true };
  const ids = (overrides: Partial<typeof ONLINE>) =>
    startListeningActions({ ...ONLINE, ...overrides }).map((action) => `${action.id}${action.primary ? "*" : ""}`);

  it("SPM-START-01 Start listening offers the collection first when it is not installed", () => {
    expect(ids({})).toEqual(["collection*", "add-files", "archive"]);
  });

  it("SPM-START-01 Start listening offers a station first once the collection is installed", () => {
    expect(ids({ hvscInstalled: true })).toEqual(["station*", "add-files", "archive"]);
  });

  it("SPM-START-01 offline Start listening offers own files first and drops the archive", () => {
    expect(ids({ online: false })).toEqual(["add-files*"]);
  });

  it("SPM-START-01 without SID Radio or HVSC the person can still add files or browse the archive", () => {
    expect(ids({ hvscInstalled: true, radioEnabled: false })).toEqual(["add-files*", "archive"]);
    expect(ids({ hvscEnabled: false })).toEqual(["add-files*", "archive"]);
    expect(ids({ archiveEnabled: false, hvscEnabled: false })).toEqual(["add-files*"]);
  });

  const renderStart = (hvscInstalled: boolean) => {
    saveStartupModeByUser("sid-player");
    return renderShortcuts(true, hvscInstalled);
  };

  it("SPM-START-01 the rendered area names the actions and mentions no ROM", () => {
    renderStart(false);

    const area = screen.getByTestId("start-listening");
    expect(area).toHaveTextContent("Start listening");
    expect(screen.getByTestId("start-listening-collection")).toHaveTextContent("Get the free C64 music collection");
    expect(screen.getByTestId("start-listening-add-files")).toHaveTextContent("Add your own SID files");
    expect(screen.getByTestId("start-listening-archive")).toHaveTextContent("Browse the online archive");
    expect(area.textContent).not.toMatch(/ROM|KERNAL|BASIC/);
  });

  it("SPM-START-01 pressing an action asks Play to open the matching sheet through its link", () => {
    renderStart(true);
    fireEvent.click(screen.getByTestId("start-listening-station"));
    expect(screen.getByTestId("location")).toHaveTextContent("/play?radio=1");
  });

  it("SPM-START-01 offline, the missing collection is explained", () => {
    recordNetworkStatus({ online: false, supported: true });
    try {
      renderStart(false);
      expect(screen.getByTestId("start-listening-offline-note")).toHaveTextContent(
        "The free collection needs an internet connection.",
      );
      expect(screen.queryByTestId("start-listening-collection")).toBeNull();
      expect(screen.queryByTestId("start-listening-archive")).toBeNull();
    } finally {
      resetNetworkStatusWatchForTests();
    }
  });
});
