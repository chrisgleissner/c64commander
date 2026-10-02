/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useFeatureFlags", () => ({
  useFeatureFlags: () => ({ flags: {}, resolved: {}, isLoaded: true }),
  useFeatureFlag: () => ({ value: false, isLoaded: true }),
  useFeatureFlagValue: () => false,
}));

vi.mock("@/components/itemSelection/ItemSelectionDialog", () => ({
  ItemSelectionDialog: () => null,
}));

import PlayFilesPage from "@/pages/PlayFilesPage";

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/play"]}>
        <PlayFilesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("PlayFilesPage Default duration", () => {
  afterEach(() => {
    localStorage.removeItem("c64u_default_song_duration_ms");
  });

  it("comes back after a restart showing the default its untimed tracks were given", async () => {
    localStorage.setItem("c64u_default_song_duration_ms", "12000");

    renderPage();

    expect(await screen.findByTestId("duration-input")).toHaveValue("0:12");
  });

  it("keeps the default the listener commits, so the next start can show it", async () => {
    renderPage();
    const input = await screen.findByTestId("duration-input");

    fireEvent.change(input, { target: { value: "0:20" } });
    fireEvent.blur(input);

    expect(localStorage.getItem("c64u_default_song_duration_ms")).toBe("20000");
  });

  it("shows three minutes when no default has been chosen", async () => {
    renderPage();

    expect(await screen.findByTestId("duration-input")).toHaveValue("3:00");
  });
});
