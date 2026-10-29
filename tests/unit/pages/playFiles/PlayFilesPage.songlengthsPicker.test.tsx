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
  pickFile: vi.fn(),
  reportUserError: vi.fn(),
  panel: null as null | { onChooseSonglengthsFile: () => Promise<void> | void; activeSonglengthsPath?: string | null },
}));

vi.mock("@/lib/native/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/native/platform")>()),
  isNativePlatform: () => true,
  getPlatform: () => "android",
}));

vi.mock("@/lib/native/backgroundExecution", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/native/backgroundExecution")>();
  const resolved = async () => {};
  return {
    ...actual,
    BackgroundExecution: {
      start: resolved,
      stop: resolved,
      setPlaybackState: resolved,
      setNowPlaying: resolved,
      setDueAtMs: resolved,
      checkPermissions: async () => ({ notifications: "granted" }),
      requestPermissions: async () => ({ notifications: "granted" }),
      addListener: async () => ({ remove: resolved }),
    },
    onBackgroundAutoSkipDue: async () => ({ remove: resolved }),
    onBackgroundTransportCommand: async () => ({ remove: resolved }),
  };
});

vi.mock("@/lib/native/folderPicker", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/native/folderPicker")>();
  return { ...actual, FolderPicker: { ...actual.FolderPicker, pickFile: page.pickFile } };
});

vi.mock("@/lib/uiErrors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/uiErrors")>()),
  reportUserError: page.reportUserError,
}));

vi.mock("@/hooks/useFeatureFlags", () => ({
  useFeatureFlags: () => ({ flags: {}, resolved: {}, isLoaded: true }),
  useFeatureFlag: () => ({ value: false, isLoaded: true }),
  useFeatureFlagValue: () => false,
}));

vi.mock("@/components/itemSelection/ItemSelectionDialog", () => ({
  ItemSelectionDialog: () => null,
}));

vi.mock("@/pages/playFiles/components/PlaybackSettingsPanel", () => ({
  PlaybackSettingsPanel: (props: NonNullable<typeof page.panel>) => {
    page.panel = props;
    return null;
  },
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

const chooseSonglengthsFile = async () => {
  await waitFor(() => expect(page.panel).not.toBeNull());
  await act(async () => {
    await page.panel!.onChooseSonglengthsFile();
  });
};

describe("PlayFilesPage songlengths file picker on Android", () => {
  beforeEach(() => {
    localStorage.clear();
    page.pickFile.mockReset();
    page.reportUserError.mockReset();
    page.panel = null;
  });

  it("uses the picked file, named as the picker reports it, as the active songlengths file", async () => {
    page.pickFile.mockResolvedValue({
      uri: "content://docs/songlengths",
      name: "Songlengths.md5",
      permissionPersisted: true,
      sizeBytes: 1234,
      modifiedAt: "2026-10-01T00:00:00.000Z",
    });
    renderPage();

    await chooseSonglengthsFile();

    expect(page.pickFile).toHaveBeenCalledWith({ mimeTypes: ["text/plain", "application/octet-stream"] });
    await waitFor(() => expect(page.panel!.activeSonglengthsPath).toBe("/Songlengths.md5"));
    expect(page.reportUserError).not.toHaveBeenCalled();
  });

  it("names a picked file the picker reports no name for songlengths.md5", async () => {
    page.pickFile.mockResolvedValue({ uri: "content://docs/unnamed", permissionPersisted: true });
    renderPage();

    await chooseSonglengthsFile();

    await waitFor(() => expect(page.panel!.activeSonglengthsPath).toBe("/songlengths.md5"));
    expect(page.reportUserError).not.toHaveBeenCalled();
  });

  it("reports a pick whose access was not persisted as a failed selection", async () => {
    page.pickFile.mockResolvedValue({ uri: "content://docs/songlengths", name: "Songlengths.md5" });
    renderPage();

    await chooseSonglengthsFile();

    expect(page.reportUserError).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "SONGLENGTHS_PICK",
        title: "Songlengths file selection failed",
        description: "Songlengths file access was not granted.",
      }),
    );
    expect(page.panel!.activeSonglengthsPath).not.toBe("/Songlengths.md5");
  });

  it("treats a dismissed picker as a cancel, not an error", async () => {
    page.pickFile.mockRejectedValue(new Error("File selection canceled"));
    renderPage();

    await chooseSonglengthsFile();

    expect(page.reportUserError).not.toHaveBeenCalled();
  });
});
