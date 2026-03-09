/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import HomePage from "@/pages/HomePage";

const {
  toastSpy,
  reportUserErrorSpy,
  clearRamAndRebootSpy,
  selectRamDumpFolderSpy,
  saveRamDumpFolderConfigSpy,
  createSnapshotSpy,
  loadMemoryRangesSpy,
  deleteSnapshotFromStoreSpy,
  updateSnapshotLabelSpy,
  snapshotEntryToBytesSpy,
  getCurrentPlaybackSnapshotLabelSpy,
} = vi.hoisted(() => ({
  toastSpy: vi.fn(),
  reportUserErrorSpy: vi.fn(),
  clearRamAndRebootSpy: vi.fn(),
  selectRamDumpFolderSpy: vi.fn(),
  saveRamDumpFolderConfigSpy: vi.fn(),
  createSnapshotSpy: vi.fn(),
  loadMemoryRangesSpy: vi.fn(),
  deleteSnapshotFromStoreSpy: vi.fn(),
  updateSnapshotLabelSpy: vi.fn(),
  snapshotEntryToBytesSpy: vi.fn(),
  getCurrentPlaybackSnapshotLabelSpy: vi.fn(),
}));

vi.mock("@/hooks/useC64Connection", () => ({
  useC64Connection: () => ({
    status: {
      isConnected: true,
      isConnecting: false,
      deviceInfo: null,
    },
  }),
  useC64Drives: () => ({
    data: {
      drives: [{ a: { enabled: true } }, { b: { enabled: true } }],
    },
  }),
  useC64ConfigItem: () => ({ data: undefined, isLoading: false }),
  useC64ConfigItems: () => ({ data: undefined }),
  useC64MachineControl: () => ({
    reset: {
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
    },
    reboot: {
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
    },
    pause: {
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
    },
    resume: {
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
    },
    powerOff: {
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
    },
    menuButton: {
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
    },
    saveConfig: {
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
    },
    loadConfig: {
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
    },
    resetConfig: {
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
    },
  }),
}));

vi.mock("@/hooks/useAppConfigState", () => ({
  useAppConfigState: () => ({
    appConfigs: [],
    hasChanges: false,
    isApplying: false,
    isSaving: false,
    revertToInitial: vi.fn(),
    saveCurrentConfig: vi.fn(),
    loadAppConfig: vi.fn(),
    renameAppConfig: vi.fn(),
    deleteAppConfig: vi.fn(),
  }),
}));

vi.mock("@/hooks/useActionTrace", () => ({
  useActionTrace: () => Object.assign((fn: (...args: any[]) => any) => fn, { scope: vi.fn() }),
}));

vi.mock("@/components/ThemeProvider", () => ({
  useThemeContext: () => ({
    theme: "light",
    setTheme: vi.fn(),
  }),
}));

vi.mock("@/components/DiagnosticsActivityIndicator", () => ({
  DiagnosticsActivityIndicator: ({ onClick }: { onClick: () => void }) => (
    <button type="button" onClick={onClick} data-testid="diagnostics-activity-indicator" />
  ),
}));

const buildRouter = (ui: JSX.Element) =>
  createMemoryRouter([{ path: "*", element: ui }], {
    initialEntries: ["/"],
    future: {
      v7_startTransition: true,
      v7_relativeSplatPath: true,
    },
  });

const renderWithRouter = (ui: JSX.Element) =>
  render(
    <RouterProvider
      router={buildRouter(ui)}
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    />,
  );

const renderHomePage = () => renderWithRouter(<HomePage />);

vi.mock("@/hooks/use-toast", () => ({
  toast: toastSpy,
  useToast: () => ({ toasts: [], dismiss: vi.fn() }),
}));

vi.mock("@/lib/uiErrors", () => ({
  reportUserError: reportUserErrorSpy,
}));

vi.mock("@/lib/c64api", () => ({
  getC64API: () => ({}),
}));

vi.mock("@/lib/machine/ramOperations", () => ({
  FULL_RAM_SIZE_BYTES: 0x10000,
  clearRamAndReboot: clearRamAndRebootSpy,
  loadMemoryRanges: loadMemoryRangesSpy,
}));

vi.mock("@/lib/machine/ramDumpStorage", () => ({
  selectRamDumpFolder: selectRamDumpFolderSpy,
}));

vi.mock("@/lib/config/ramDumpFolderStore", () => ({
  loadRamDumpFolderConfig: () => null,
  saveRamDumpFolderConfig: saveRamDumpFolderConfigSpy,
  deriveRamDumpFolderDisplayPath: (treeUri: string) => treeUri,
}));

vi.mock("@/lib/snapshot/snapshotCreation", () => ({
  createSnapshot: createSnapshotSpy,
}));

vi.mock("@/lib/snapshot/snapshotStore", () => ({
  useSnapshotStore: () => ({ snapshots: [], snapshotsByType: vi.fn().mockReturnValue([]) }),
  deleteSnapshotFromStore: deleteSnapshotFromStoreSpy,
  updateSnapshotLabel: updateSnapshotLabelSpy,
  snapshotEntryToBytes: snapshotEntryToBytesSpy,
  saveSnapshotToStore: vi.fn(),
  loadSnapshotStore: vi.fn().mockReturnValue([]),
}));

vi.mock("@/lib/snapshot/currentPlaybackSnapshotLabel", () => ({
  getCurrentPlaybackSnapshotLabel: getCurrentPlaybackSnapshotLabelSpy,
}));

vi.mock("@/lib/snapshot/snapshotFormat", () => ({
  decodeSnapshot: vi.fn().mockReturnValue({
    version: 1,
    snapshotType: "program",
    timestamp: 0,
    ranges: [],
    blocks: [],
    metadata: { snapshot_type: "program", display_ranges: [], created_at: "" },
  }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
    fetchQuery: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("@/pages/home/SidCard", () => ({
  SidCard: () => <div data-testid="sid-card" />,
}));

vi.mock("@/pages/home/DriveCard", () => ({
  DriveCard: () => <div data-testid="drive-card" />,
}));

describe("HomePage RAM actions", () => {
  vi.setConfig({ testTimeout: 15000 });

  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).__APP_VERSION__ = "test";
    (globalThis as any).__GIT_SHA__ = "deadbeef";
    (globalThis as any).__BUILD_TIME__ = "";
    clearRamAndRebootSpy.mockResolvedValue(undefined);
    createSnapshotSpy.mockResolvedValue({ displayTimestamp: "2026-01-01 12:00:00" });
    getCurrentPlaybackSnapshotLabelSpy.mockReturnValue(undefined);
    loadMemoryRangesSpy.mockResolvedValue(undefined);
  });

  it("runs reboot clear memory action", async () => {
    renderHomePage();

    fireEvent.click(screen.getByRole("button", { name: /reboot \(Clear RAM\)/i }));

    await waitFor(() => expect(clearRamAndRebootSpy).toHaveBeenCalledTimes(1));
    expect(toastSpy).toHaveBeenCalledWith({
      title: "Machine rebooting",
      description: "RAM cleared (excluding I/O region).",
    });
  }, 15000);

  it("opens Save RAM dialog when Save RAM button is clicked", async () => {
    renderHomePage();

    fireEvent.click(screen.getByRole("button", { name: /save ram/i }));

    await waitFor(() => expect(screen.getByTestId("save-ram-dialog")).toBeInTheDocument());
  }, 15000);

  it("saves program snapshot and shows toast when Program type is selected", async () => {
    renderHomePage();

    fireEvent.click(screen.getByRole("button", { name: /save ram/i }));
    await waitFor(() => expect(screen.getByTestId("save-ram-dialog")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("save-ram-type-program"));

    await waitFor(() =>
      expect(createSnapshotSpy).toHaveBeenCalledWith(
        {},
        {
          type: "program",
          customRanges: undefined,
          label: undefined,
          contentName: undefined,
        },
      ),
    );
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Snapshot saved" }));
  }, 15000);

  it("opens Snapshot Manager dialog when Load RAM button is clicked", async () => {
    renderHomePage();

    fireEvent.click(screen.getByRole("button", { name: /load ram/i }));

    await waitFor(() => expect(screen.getByTestId("snapshot-manager-dialog")).toBeInTheDocument());
  }, 15000);

  it("shows empty state in Snapshot Manager when no snapshots exist", async () => {
    renderHomePage();

    fireEvent.click(screen.getByRole("button", { name: /load ram/i }));

    await waitFor(() => expect(screen.getByTestId("snapshot-empty")).toBeInTheDocument());
  }, 15000);
});
