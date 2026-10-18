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

vi.mock("@/hooks/useFeatureFlags", () => ({
  useFeatureFlags: () => ({ flags: {}, resolved: {}, isLoaded: true }),
  useFeatureFlag: () => ({ value: false, isLoaded: true }),
  useFeatureFlagValue: () => false,
}));

vi.mock("@/components/itemSelection/ItemSelectionDialog", () => ({
  ItemSelectionDialog: () => null,
}));

import PlayFilesPage from "@/pages/PlayFilesPage";

const renderPage = (entry: string) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[entry]}>
        <PlayFilesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("PlayFilesPage Liked tunes entry points", () => {
  beforeEach(() => {
    localStorage.clear();
    saveSidRadioEnabled(true);
  });

  afterEach(() => localStorage.clear());

  it("opens the Liked tunes sheet from the Liked button", async () => {
    renderPage("/play");
    expect(screen.queryByTestId("liked-tunes-sheet")).toBeNull();

    fireEvent.click(await screen.findByTestId("sid-radio-liked-tunes-open"));

    expect(await screen.findByTestId("liked-tunes-sheet")).toBeInTheDocument();
  });

  it("opens the Liked tunes sheet when Play is reached with the liked deep link", async () => {
    renderPage("/play?liked=1");

    await waitFor(() => expect(screen.getByTestId("liked-tunes-sheet")).toBeInTheDocument());
  });
});
