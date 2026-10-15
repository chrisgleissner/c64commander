/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { beginLocalPlayOut, endLocalPlayOut } from "@/lib/playback/localPlayOut";
import { PLAYBACK_SESSION_KEY, SHARED_PLAYLIST_STORAGE_KEY } from "@/pages/playFiles/playFilesUtils";

const manager = vi.hoisted(() => ({ setCurrentIndex: null as null | ((index: number) => void) }));
const nowPlaying = vi.hoisted(() => ({ titles: [] as (string | null)[] }));

vi.mock("@/hooks/useFeatureFlags", () => ({
  useFeatureFlags: () => ({ flags: {}, resolved: {}, isLoaded: true }),
  useFeatureFlag: () => ({ value: false, isLoaded: true }),
  useFeatureFlagValue: () => false,
}));

vi.mock("@/components/itemSelection/ItemSelectionDialog", () => ({
  ItemSelectionDialog: () => null,
}));

vi.mock("@/lib/native/backgroundExecutionManager", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/native/backgroundExecutionManager")>();
  return {
    ...actual,
    setBackgroundExecutionNowPlaying: async (meta: { title: string | null }) => {
      nowPlaying.titles.push(meta.title);
    },
  };
});

// The playback controller moves the playlist on by setting the current index; the test does the same.
vi.mock("@/pages/playFiles/hooks/usePlaylistManager", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/pages/playFiles/hooks/usePlaylistManager")>();
  return {
    ...actual,
    usePlaylistManager: (...args: Parameters<typeof actual.usePlaylistManager>) => {
      const result = actual.usePlaylistManager(...args);
      manager.setCurrentIndex = result.setCurrentIndex;
      return result;
    },
  };
});

import PlayFilesPage from "@/pages/PlayFilesPage";

const tunes = [
  { path: "/MUSICIANS/H/Hubbard_Rob/Commando.sid", name: "Commando.sid", durationMs: 236_000 },
  { path: "/MUSICIANS/H/Hubbard_Rob/Monty_on_the_Run.sid", name: "Monty_on_the_Run.sid", durationMs: 350_000 },
];

const seedSessionOnFirstTune = () => {
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

/** The playlist row marked as playing, by its first line of text. */
const playingRowText = () =>
  document.querySelector('[data-testid="playlist-item"][data-playing="true"]')?.textContent ?? "";

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/play"]}>
        <PlayFilesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("PlayFilesPage while the phone plays out the previous tune", () => {
  afterEach(() => {
    act(() => endLocalPlayOut());
    localStorage.clear();
    sessionStorage.clear();
    nowPlaying.titles.length = 0;
  });

  it("names the tune that is heard, not the one the playlist has moved on to, until the play-out ends", async () => {
    seedSessionOnFirstTune();
    renderPage();
    await waitFor(() => expect(screen.getByTestId("playback-current-title")).toHaveTextContent(/Commando/));
    await waitFor(() => expect(screen.getByTestId("playback-remaining")).toHaveTextContent("-3:46"));

    act(() => beginLocalPlayOut(2.4));
    act(() => manager.setCurrentIndex!(1));

    expect(screen.getByTestId("playback-current-title")).toHaveTextContent(/Commando/);
    // Commando's 3:56 less the ten seconds it had played, not Monty on the Run's 5:50 from zero.
    expect(screen.getByTestId("playback-remaining")).toHaveTextContent(/-3:4[56]/);
    expect(nowPlaying.titles.at(-1)).toMatch(/Commando/);
    expect(playingRowText()).toMatch(/Commando/);

    act(() => endLocalPlayOut());

    await waitFor(() => expect(screen.getByTestId("playback-current-title")).toHaveTextContent(/Monty/));
    await waitFor(() => expect(nowPlaying.titles.at(-1)).toMatch(/Monty/));
    expect(playingRowText()).toMatch(/Monty/);
  });
});
