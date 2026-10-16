/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type { ConfigCandidate } from "@/lib/config/playbackConfig";
import type { PlaybackConfigSheet } from "@/pages/playFiles/components/PlaybackConfigSheet";
import type { PlaylistItem } from "@/pages/playFiles/types";
import { SHARED_PLAYLIST_STORAGE_KEY } from "@/pages/playFiles/playFilesUtils";

type ConfigSheetProps = ComponentProps<typeof PlaybackConfigSheet>;

const configSheet = vi.hoisted(() => ({ props: null as ConfigSheetProps | null }));

vi.mock("@/hooks/useFeatureFlags", () => ({
  useFeatureFlags: () => ({ flags: {}, resolved: {}, isLoaded: true }),
  useFeatureFlag: () => ({ value: false, isLoaded: true }),
  useFeatureFlagValue: () => false,
}));

vi.mock("@/components/itemSelection/ItemSelectionDialog", () => ({
  ItemSelectionDialog: () => null,
}));

vi.mock("@/pages/playFiles/components/PlaybackConfigSheet", () => ({
  PlaybackConfigSheet: (props: ConfigSheetProps) => {
    configSheet.props = props;
    return null;
  },
}));

import PlayFilesPage from "@/pages/PlayFilesPage";

const tune = { path: "/MUSICIANS/H/Hubbard_Rob/Commando.sid", name: "Commando.sid", durationMs: 236_000 };
const tuneId = "tune-with-custom-edits";
const attachedConfig = { kind: "ultimate" as const, fileName: "Commando.cfg", path: "/USB0/Commando.cfg" };
const otherConfig = { kind: "ultimate" as const, fileName: "Other.cfg", path: "/USB0/Other.cfg" };

const seedTuneWithCustomEdits = () => {
  localStorage.setItem(
    SHARED_PLAYLIST_STORAGE_KEY,
    JSON.stringify({
      items: [
        {
          ...tune,
          id: tuneId,
          source: "hvsc",
          sourceId: "hvsc-library",
          addedAt: "2026-01-01",
          configRef: attachedConfig,
          configOrigin: "manual",
          configOverrides: [{ category: "Audio Mixer", item: "Vol Socket 1", value: "0 dB" }],
        },
      ],
      currentIndex: 0,
    }),
  );
};

describe("PlayFilesPage's Clear custom edits confirmation", () => {
  afterEach(() => {
    configSheet.props = null;
    localStorage.clear();
    sessionStorage.clear();
  });

  it("opens on Cancel when choosing another config would clear the custom edits", async () => {
    seedTuneWithCustomEdits();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/play"]}>
          <PlayFilesPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getAllByText(/Commando/).length).toBeGreaterThan(0));

    act(() => {
      const candidate: ConfigCandidate = { ref: otherConfig, strategy: "exact-name", distance: 0, confidence: "high" };
      configSheet.props!.onChooseCandidate({ id: tuneId } as PlaylistItem, candidate);
    });

    const dialog = await screen.findByRole("alertdialog", { name: "Clear custom edits?" });
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Cancel" })));
  });
});
