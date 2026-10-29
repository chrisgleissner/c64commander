/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveSidRadioEnabled } from "@/lib/config/appSettings";

const page = vi.hoisted(() => ({
  stationActive: false,
  onNotForMe: undefined as undefined | (() => void),
  rankingRendered: false,
  recordSkip: vi.fn(),
}));

vi.mock("@/hooks/useFeatureFlags", () => ({
  useFeatureFlags: () => ({ flags: {}, resolved: {}, isLoaded: true }),
  useFeatureFlag: () => ({ value: false, isLoaded: true }),
  useFeatureFlagValue: () => false,
}));

vi.mock("@/components/itemSelection/ItemSelectionDialog", () => ({
  ItemSelectionDialog: () => null,
}));

vi.mock("@/pages/playFiles/components/NowPlayingRanking", () => ({
  NowPlayingRanking: (props: { onNotForMe?: () => void }) => {
    page.rankingRendered = true;
    page.onNotForMe = props.onNotForMe;
    return null;
  },
}));

vi.mock("@/lib/sidRadio/sidRadioStats", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sidRadio/sidRadioStats")>()),
  recordSkip: page.recordSkip,
}));

vi.mock("@/pages/playFiles/hooks/useSidRadio", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/pages/playFiles/hooks/useSidRadio")>();
  return {
    ...actual,
    useSidRadio: (params: Parameters<typeof actual.useSidRadio>[0]) => {
      const radio = actual.useSidRadio(params);
      if (!page.stationActive) return radio;
      return {
        ...radio,
        active: true,
        stop: () => {
          page.stationActive = false;
          radio.stop();
        },
      };
    },
  };
});

import PlayFilesPage from "@/pages/PlayFilesPage";

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/play"]}>
        <PlayFilesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("PlayFilesPage playback section actions", () => {
  beforeEach(() => {
    localStorage.clear();
    page.stationActive = false;
    page.onNotForMe = undefined;
    page.rankingRendered = false;
    page.recordSkip.mockClear();
  });

  afterEach(() => localStorage.clear());

  it("shows no station chip, ranking or station actions when SID Radio is turned off", async () => {
    saveSidRadioEnabled(false);
    renderPage();

    await screen.findByTestId("playlist-play");

    expect(screen.queryByTestId("sid-radio-launcher")).toBeNull();
    expect(screen.queryByTestId("hvsc-search-open")).toBeNull();
    expect(screen.queryByTestId("sid-radio-liked-tunes-open")).toBeNull();
    expect(page.rankingRendered).toBe(false);
  });

  it("opens the HVSC search sheet from the Find button", async () => {
    saveSidRadioEnabled(true);
    renderPage();
    expect(screen.queryByTestId("hvsc-search-sheet")).toBeNull();

    fireEvent.click(await screen.findByTestId("hvsc-search-open"));

    expect(await screen.findByTestId("hvsc-search-sheet")).toBeInTheDocument();
  });

  it("turns Shuffle on directly when no station is running", async () => {
    saveSidRadioEnabled(true);
    renderPage();
    const shuffle = await screen.findByTestId("playback-shuffle");

    fireEvent.click(shuffle);

    await waitFor(() => expect(shuffle).toHaveAttribute("aria-pressed", "true"));
    expect(screen.queryByTestId("station-queue-edited-dialog")).toBeNull();
  });

  it("asks before shuffling a running station's tunes and turns Shuffle on only once they are kept", async () => {
    saveSidRadioEnabled(true);
    page.stationActive = true;
    renderPage();
    const shuffle = await screen.findByTestId("playback-shuffle");

    fireEvent.click(shuffle);

    expect(await screen.findByTestId("station-queue-edited-dialog")).toHaveTextContent("Shuffle these radio tunes?");
    expect(shuffle).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByTestId("station-queue-keep"));

    await waitFor(() => expect(shuffle).toHaveAttribute("aria-pressed", "true"));
    expect(page.stationActive).toBe(false);
  });

  it("offers Not for me only while a station is running", async () => {
    saveSidRadioEnabled(true);
    renderPage();

    await waitFor(() => expect(page.rankingRendered).toBe(true));
    expect(page.onNotForMe).toBeUndefined();
  });

  it("skips to the next tune on Not for me and records how long the skip took", async () => {
    saveSidRadioEnabled(true);
    page.stationActive = true;
    renderPage();
    await waitFor(() => expect(page.onNotForMe).toBeTypeOf("function"));

    await act(async () => {
      page.onNotForMe!();
    });

    await waitFor(() => expect(page.recordSkip).toHaveBeenCalledTimes(1));
    const [skipMs] = page.recordSkip.mock.calls[0];
    expect(skipMs).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(skipMs)).toBe(true);
  });
});
