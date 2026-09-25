/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const page = vi.hoisted(() => ({
  flags: { hvsc_enabled: true } as Record<string, boolean>,
  preparationState: "NOT_PRESENT" as string,
  runHvscPreparation: vi.fn(async () => undefined),
  selectSource: null as null | ((source: { type: string; id: string }) => Promise<boolean>),
  sidRadioParams: null as null | { startPlaylist: (items: unknown[]) => unknown },
}));

vi.mock("@/hooks/useFeatureFlags", () => ({
  useFeatureFlags: () => ({ flags: page.flags, resolved: {}, isLoaded: true }),
  useFeatureFlag: (id: string) => ({ value: page.flags[id] ?? false, isLoaded: true }),
  useFeatureFlagValue: (id: string) => page.flags[id] ?? false,
}));

vi.mock("@/pages/playFiles/hooks/useHvscLibrary", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/pages/playFiles/hooks/useHvscLibrary")>();
  return {
    ...actual,
    useHvscLibrary: (enabled: boolean) => ({
      ...actual.useHvscLibrary(enabled),
      hvscPreparationState: page.preparationState,
      hvscUpdating: false,
      runHvscPreparation: page.runHvscPreparation,
    }),
  };
});

vi.mock("@/components/itemSelection/ItemSelectionDialog", () => ({
  ItemSelectionDialog: (props: { onSelectSource: typeof page.selectSource }) => {
    if (props.onSelectSource) page.selectSource = props.onSelectSource;
    return null;
  },
}));

vi.mock("@/pages/playFiles/hooks/useSidRadio", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/pages/playFiles/hooks/useSidRadio")>();
  return {
    ...actual,
    useSidRadio: (params: Parameters<typeof actual.useSidRadio>[0]) => {
      page.sidRadioParams = params;
      return actual.useSidRadio(params);
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

describe("PlayFilesPage wiring", () => {
  beforeEach(() => {
    page.flags = { hvsc_enabled: true };
    page.preparationState = "NOT_PRESENT";
    page.runHvscPreparation.mockClear();
    page.selectSource = null;
    page.sidRadioParams = null;
  });

  const openHvscSource = async () => {
    await waitFor(() => expect(page.selectSource).toBeTypeOf("function"));
    let browsed: boolean | undefined;
    await act(async () => {
      browsed = await page.selectSource!({ type: "hvsc", id: "hvsc-library" });
    });
    return browsed;
  };

  it("starts preparing HVSC by itself once its sheet opens on a library that is not ready", async () => {
    renderPage();
    expect(page.runHvscPreparation).not.toHaveBeenCalled();

    const browsed = await openHvscSource();

    expect(browsed).toBe(false);
    await waitFor(() => expect(page.runHvscPreparation).toHaveBeenCalledTimes(1));
  });

  it("leaves a failed HVSC preparation to the sheet's Retry button", async () => {
    page.preparationState = "ERROR";
    renderPage();

    const browsed = await openHvscSource();
    await act(async () => {
      await Promise.resolve();
    });

    expect(browsed).toBe(false);
    expect(page.runHvscPreparation).not.toHaveBeenCalled();
  });

  // SID Radio claims its station before starting the playlist, so it has to learn when the start did not happen.
  it("hands SID Radio the result of starting the station's playlist", async () => {
    renderPage();
    await waitFor(() => expect(page.sidRadioParams).not.toBeNull());

    await expect(page.sidRadioParams!.startPlaylist([])).resolves.toBe(false);
  });
});
