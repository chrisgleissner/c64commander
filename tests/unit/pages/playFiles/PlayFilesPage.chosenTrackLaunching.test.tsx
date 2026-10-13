/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PLAYBACK_SESSION_KEY, SHARED_PLAYLIST_STORAGE_KEY } from "@/pages/playFiles/playFilesUtils";

const launch = vi.hoisted(() => ({ chosenTrackLaunching: false }));

vi.mock("@/hooks/useFeatureFlags", () => ({
  useFeatureFlags: () => ({ flags: {}, resolved: {}, isLoaded: true }),
  useFeatureFlag: () => ({ value: false, isLoaded: true }),
  useFeatureFlagValue: () => false,
}));

vi.mock("@/components/itemSelection/ItemSelectionDialog", () => ({
  ItemSelectionDialog: () => null,
}));

vi.mock("@/pages/playFiles/hooks/usePlaybackController", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/pages/playFiles/hooks/usePlaybackController")>();
  return {
    ...actual,
    usePlaybackController: (props: Parameters<typeof actual.usePlaybackController>[0]) => ({
      ...actual.usePlaybackController(props),
      chosenTrackLaunching: launch.chosenTrackLaunching,
    }),
  };
});

import PlayFilesPage from "@/pages/PlayFilesPage";

const tunes = [
  { path: "/MUSICIANS/H/Hubbard_Rob/Commando.sid", name: "Commando.sid", durationMs: 236_000 },
  { path: "/MUSICIANS/H/Hubbard_Rob/Monty_on_the_Run.sid", name: "Monty_on_the_Run.sid", durationMs: 350_000 },
];

const seedPausedSessionAtTenSeconds = () => {
  localStorage.setItem(
    SHARED_PLAYLIST_STORAGE_KEY,
    JSON.stringify({
      items: tunes.map((tune) => ({ ...tune, source: "hvsc", sourceId: "hvsc-library", addedAt: "2026-01-01" })),
      currentIndex: 0,
    }),
  );
  sessionStorage.setItem(
    PLAYBACK_SESSION_KEY,
    JSON.stringify({
      playlistKey: SHARED_PLAYLIST_STORAGE_KEY,
      currentItemId: `hvsc:hvsc-library:${tunes[0].path}`,
      currentIndex: 0,
      isPlaying: true,
      isPaused: true,
      elapsedMs: 10_000,
      playedMs: 10_000,
      durationMs: tunes[0].durationMs,
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

describe("PlayFilesPage while a skip's chosen track launches", () => {
  afterEach(() => {
    launch.chosenTrackLaunching = false;
    localStorage.clear();
    sessionStorage.clear();
  });

  it("shows the elapsed time of the track that is playing", async () => {
    seedPausedSessionAtTenSeconds();

    renderPage();

    await waitFor(() => expect(screen.getByTestId("playback-remaining")).toHaveTextContent("-3:46"));
    expect(screen.getByTestId("playback-elapsed")).toHaveTextContent("0:10");
  });

  it("does not count the previous track's elapsed time against the chosen track", async () => {
    seedPausedSessionAtTenSeconds();
    launch.chosenTrackLaunching = true;

    renderPage();

    await waitFor(() => expect(screen.getByTestId("playback-remaining")).toHaveTextContent("-3:56"));
    expect(screen.getByTestId("playback-elapsed")).toHaveTextContent("0:00");
  });
});
