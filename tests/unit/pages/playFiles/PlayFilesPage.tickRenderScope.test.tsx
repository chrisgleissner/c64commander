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
import { readStoredPlaybackSession } from "@/lib/playback/playbackSessionStore";
import { getPlaybackTraceSnapshot } from "@/pages/playFiles/playbackTraceStore";
import { PLAYBACK_SESSION_KEY, SHARED_PLAYLIST_STORAGE_KEY } from "@/pages/playFiles/playFilesUtils";

const pageRenders = vi.hoisted(() => ({ count: 0 }));

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
    usePlaybackController: (props: Parameters<typeof actual.usePlaybackController>[0]) => {
      pageRenders.count += 1;
      return actual.usePlaybackController(props);
    },
  };
});

import PlayFilesPage from "@/pages/PlayFilesPage";

const tune = { path: "/MUSICIANS/H/Hubbard_Rob/Commando.sid", name: "Commando.sid", durationMs: 236_000 };

const seedPlayingSessionAtTenSeconds = () => {
  localStorage.setItem(
    SHARED_PLAYLIST_STORAGE_KEY,
    JSON.stringify({
      items: [{ ...tune, source: "hvsc", sourceId: "hvsc-library", addedAt: "2026-01-01" }],
      currentIndex: 0,
    }),
  );
  sessionStorage.setItem(
    PLAYBACK_SESSION_KEY,
    JSON.stringify({
      playlistKey: SHARED_PLAYLIST_STORAGE_KEY,
      currentItemId: `hvsc:hvsc-library:${tune.path}`,
      currentIndex: 0,
      isPlaying: true,
      isPaused: false,
      elapsedMs: 10_000,
      playedMs: 10_000,
      durationMs: tune.durationMs,
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

const shownElapsed = () => screen.getByTestId("playback-elapsed").textContent?.replace(/^\D*/, "") ?? "";

const nextSecond = async () => {
  const before = shownElapsed();
  await waitFor(() => expect(shownElapsed()).not.toBe(before), { timeout: 2_000 });
};

const storedElapsedMs = () => readStoredPlaybackSession()?.elapsedMs ?? -1;

describe("PlayFilesPage per-second timeline tick", () => {
  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("moves the shown time each second without re-rendering the page, and still stores and traces it", async () => {
    seedPlayingSessionAtTenSeconds();
    renderPage();
    await waitFor(() => expect(screen.getByTestId("playback-remaining")).toHaveTextContent(/^-3:4\d$/));
    await nextSecond();
    const rendersAtTick = pageRenders.count;
    const shownAtTick = shownElapsed();
    const progressAtTick = Number(screen.getByTestId("playback-progress").getAttribute("aria-valuenow"));
    const storedAtTick = storedElapsedMs();
    const tracedAtTick = getPlaybackTraceSnapshot()?.elapsedMs ?? -1;

    await nextSecond();
    await nextSecond();

    expect(pageRenders.count - rendersAtTick).toBe(0);
    expect(shownElapsed()).not.toBe(shownAtTick);
    expect(Number(screen.getByTestId("playback-progress").getAttribute("aria-valuenow"))).toBeGreaterThan(
      progressAtTick,
    );
    expect(storedElapsedMs()).toBeGreaterThanOrEqual(storedAtTick + 1_500);
    expect(getPlaybackTraceSnapshot()?.elapsedMs ?? -1).toBeGreaterThanOrEqual(tracedAtTick + 1_500);
  }, 10_000);
});
