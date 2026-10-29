/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveSidRadioEnabled } from "@/lib/config/appSettings";
import { PLAYBACK_SESSION_KEY, SHARED_PLAYLIST_STORAGE_KEY } from "@/pages/playFiles/playFilesUtils";

const page = vi.hoisted(() => ({
  gameModeAvailable: true,
  seedInHvsc: true,
  startSongRadio: vi.fn(async () => undefined),
}));

const COMMANDO_MD5_48 = "0123456789ab";

vi.mock("@/hooks/useFeatureFlags", () => ({
  useFeatureFlags: () => ({ flags: { remote_input_enabled: true }, resolved: {}, isLoaded: true }),
  useFeatureFlag: (id: string) => ({ value: id === "remote_input_enabled", isLoaded: true }),
  useFeatureFlagValue: (id: string) => id === "remote_input_enabled",
}));

vi.mock("@/hooks/useGameModeAvailable", () => ({
  useGameModeAvailable: () => page.gameModeAvailable,
}));

vi.mock("@/components/itemSelection/ItemSelectionDialog", () => ({
  ItemSelectionDialog: () => null,
}));

vi.mock("@/lib/sidRadio/md5PathIndex", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sidRadio/md5PathIndex")>()),
  md548ForVirtualPath: (path: string) => (path.endsWith("Commando.sid") ? COMMANDO_MD5_48 : null),
  isMd548InHvsc: (md548: string | null) => page.seedInHvsc && md548 === COMMANDO_MD5_48,
}));

vi.mock("@/pages/playFiles/hooks/useSidRadio", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/pages/playFiles/hooks/useSidRadio")>();
  return {
    ...actual,
    useSidRadio: (params: Parameters<typeof actual.useSidRadio>[0]) => ({
      ...actual.useSidRadio(params),
      startSongRadio: page.startSongRadio,
    }),
  };
});

import PlayFilesPage from "@/pages/PlayFilesPage";

const restorePlaying = (item: {
  path: string;
  name: string;
  source: string;
  sourceId: string;
  subsongCount?: number;
}) => {
  localStorage.setItem(
    SHARED_PLAYLIST_STORAGE_KEY,
    JSON.stringify({ items: [{ ...item, durationMs: 120_000, addedAt: "2026-01-01" }], currentIndex: 0 }),
  );
  sessionStorage.setItem(
    PLAYBACK_SESSION_KEY,
    JSON.stringify({
      playlistKey: SHARED_PLAYLIST_STORAGE_KEY,
      currentItemId: `${item.source}:${item.sourceId}:${item.path}`,
      currentIndex: 0,
      isPlaying: true,
      isPaused: true,
      elapsedMs: 10_000,
      playedMs: 10_000,
      durationMs: 120_000,
      updatedAt: new Date().toISOString(),
    }),
  );
};

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/play"]}>
        <PlayFilesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

const sheetOpenerOrder = () =>
  Array.from(
    document.querySelectorAll<HTMLElement>("[data-testid='play-open-controller'], [data-testid='play-open-game-mode']"),
  ).map((button) => button.dataset.testid);

const tune = {
  path: "/MUSICIANS/H/Hubbard_Rob/Commando.sid",
  name: "Commando.sid",
  source: "hvsc",
  sourceId: "hvsc-library",
};

describe("PlayFilesPage action row while something plays", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    page.gameModeAvailable = true;
    page.seedInHvsc = true;
    page.startSongRadio.mockClear();
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("offers Remote Input and then Game Mode for a playing tune when SID Radio is turned off", async () => {
    saveSidRadioEnabled(false);
    restorePlaying(tune);
    renderPage();

    await waitFor(() => expect(sheetOpenerOrder()).toEqual(["play-open-controller", "play-open-game-mode"]));
    expect(screen.queryByTestId("sid-radio-launcher")).toBeNull();
    expect(screen.queryByTestId("sid-radio-start")).toBeNull();
  });

  it("leaves Game Mode out of the row on a device that cannot run it", async () => {
    saveSidRadioEnabled(false);
    page.gameModeAvailable = false;
    restorePlaying(tune);
    renderPage();

    await waitFor(() => expect(sheetOpenerOrder()).toEqual(["play-open-controller"]));
  });

  it.each([
    [true, ["play-open-game-mode", "play-open-controller"]],
    [false, ["play-open-controller"]],
  ])("puts Game Mode, when available (%s), ahead of Remote Input for a running program", async (available, order) => {
    saveSidRadioEnabled(false);
    page.gameModeAvailable = available;
    restorePlaying({
      path: "/GAMES/Jupiter_Lander.prg",
      name: "Jupiter_Lander.prg",
      source: "local",
      sourceId: "local",
    });
    renderPage();

    await waitFor(() => expect(sheetOpenerOrder()).toEqual(order));
  });

  it("queues every tune of a multi-tune file once and then withdraws the offer", async () => {
    saveSidRadioEnabled(true);
    restorePlaying({ ...tune, subsongCount: 3 });
    renderPage();

    const playAll = await screen.findByTestId("play-all-tunes");
    expect(playAll).toHaveTextContent("Play all 3 tunes");

    fireEvent.click(playAll);

    await waitFor(() => expect(screen.queryByTestId("play-all-tunes")).toBeNull());
    await waitFor(() => expect(screen.getAllByTestId("playlist-item")).toHaveLength(3));
  });

  it("starts a station seeded from the playing HVSC tune from Similar", async () => {
    saveSidRadioEnabled(true);
    restorePlaying(tune);
    renderPage();

    const similar = await screen.findByTestId("sid-radio-start");
    expect(similar).toBeEnabled();
    expect(similar.getAttribute("title")).toMatch(/^Start a station from /);

    fireEvent.click(similar);

    expect(page.startSongRadio).toHaveBeenCalledWith(COMMANDO_MD5_48, expect.stringMatching(/Commando/));
  });

  it("disables Similar and says why for a tune that is not in the HVSC library", async () => {
    saveSidRadioEnabled(true);
    page.seedInHvsc = false;
    restorePlaying(tune);
    renderPage();

    const similar = await screen.findByTestId("sid-radio-start");

    expect(similar).toBeDisabled();
    expect(similar).toHaveAttribute("title", "Not available: this tune is not in the HVSC library.");
  });
});
