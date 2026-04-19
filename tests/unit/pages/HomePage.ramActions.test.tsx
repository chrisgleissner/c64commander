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

vi.mock("@/hooks/useFeatureFlags", () => ({
  useFeatureFlag: () => ({ value: true }),
}));

const {
  toastSpy,
  reportUserErrorSpy,
  addErrorLogSpy,
  clearRamAndRebootSpy,
  executeTelnetActionSpy,
  rebootFullSpy,
  rebootKeepRamSpy,
  powerCycleSpy,
  toggleMenuSpy,
  selectRamDumpFolderSpy,
  saveRamDumpFolderConfigSpy,
  createSnapshotSpy,
  loadMemoryRangesSpy,
  deleteSnapshotFromStoreSpy,
  updateSnapshotLabelSpy,
  snapshotEntryToBytesSpy,
  getCurrentPlaybackSnapshotLabelSpy,
  reuWorkflowSaveSnapshotSpy,
  reuWorkflowRestoreSnapshotSpy,
  configWorkflowSaveSnapshotSpy,
  configWorkflowApplyLocalSnapshotSpy,
  pickConfigSnapshotFileSpy,
  telnetState,
  deviceControlErrorState,
} = vi.hoisted(() => ({
  toastSpy: vi.fn(),
  reportUserErrorSpy: vi.fn(),
  addErrorLogSpy: vi.fn(),
  clearRamAndRebootSpy: vi.fn(),
  executeTelnetActionSpy: vi.fn(),
  rebootFullSpy: vi.fn(),
  rebootKeepRamSpy: vi.fn(),
  powerCycleSpy: vi.fn(),
  toggleMenuSpy: vi.fn(),
  selectRamDumpFolderSpy: vi.fn(),
  saveRamDumpFolderConfigSpy: vi.fn(),
  createSnapshotSpy: vi.fn(),
  loadMemoryRangesSpy: vi.fn(),
  deleteSnapshotFromStoreSpy: vi.fn(),
  updateSnapshotLabelSpy: vi.fn(),
  snapshotEntryToBytesSpy: vi.fn(),
  getCurrentPlaybackSnapshotLabelSpy: vi.fn(),
  reuWorkflowSaveSnapshotSpy: vi.fn(),
  reuWorkflowRestoreSnapshotSpy: vi.fn(),
  configWorkflowSaveSnapshotSpy: vi.fn(),
  configWorkflowApplyLocalSnapshotSpy: vi.fn(),
  pickConfigSnapshotFileSpy: vi.fn(),
  telnetState: {
    isBusy: false,
    activeActionId: null as string | null,
    isAvailable: true,
    getActionSupport: vi.fn((actionId: string) => ({
      actionId,
      status: "supported" as const,
      reason: null,
      target: {
        categoryLabel:
          actionId === "saveReuMemory"
            ? "C64 Machine"
            : actionId === "saveConfigToFile" || actionId === "clearFlashConfig"
              ? "Configuration"
              : "Power & Reset",
        actionLabel:
          actionId === "saveReuMemory"
            ? "Save REU Memory"
            : actionId === "saveConfigToFile"
              ? "Save to File"
              : actionId === "clearFlashConfig"
                ? "Clear Flash Config"
                : "Power Cycle",
        source: "initial" as const,
      },
    })),
  },
  deviceControlErrorState: {
    isDeviceControlError: (error: unknown) =>
      error instanceof Error && "operation" in error && "transport" in error && "endpoint" in error,
  },
}));

vi.mock("@/hooks/useC64Connection", () => ({
  VISIBLE_C64_QUERY_OPTIONS: {
    intent: "user",
    refetchOnMount: "always",
  },
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

vi.mock("@/lib/logging", async () => {
  const actual = await vi.importActual<typeof import("@/lib/logging")>("@/lib/logging");
  return {
    ...actual,
    addErrorLog: addErrorLogSpy,
  };
});

vi.mock("@/lib/c64api", () => ({
  getC64API: () => ({}),
  resolveDeviceHostFromStorage: () => "c64u",
}));

vi.mock("@/hooks/useInteractiveConfigWrite", () => ({
  useInteractiveConfigWrite: () => ({ write: vi.fn(), isPending: false }),
}));

vi.mock("@/lib/native/platform", () => ({
  getPlatform: () => "android",
  isNativePlatform: () => true,
}));

vi.mock("@/lib/machine/ramOperations", () => ({
  FULL_RAM_SIZE_BYTES: 0x10000,
  clearRamAndReboot: clearRamAndRebootSpy,
  loadMemoryRanges: loadMemoryRangesSpy,
}));

vi.mock("@/lib/machine/ramDumpStorage", () => ({
  selectRamDumpFolder: selectRamDumpFolderSpy,
  ensureRamDumpFolder: vi.fn().mockResolvedValue({
    treeUri: "content://ram-dumps",
    rootName: "RAM DUMPS",
    selectedAt: "2026-01-01T00:00:00.000Z",
    displayPath: "content://ram-dumps",
  }),
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

vi.mock("@/lib/reu/reuSnapshotStore", () => ({
  useReuSnapshotStore: () => ({ snapshots: [] }),
  deleteReuSnapshotFromStore: vi.fn(),
  updateReuSnapshotLabel: vi.fn(),
}));

vi.mock("@/lib/reu/reuSnapshotStorage", () => ({
  deleteReuSnapshotFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/reu/reuWorkflow", () => ({
  createReuWorkflow: () => ({
    saveSnapshot: reuWorkflowSaveSnapshotSpy,
    restoreSnapshot: reuWorkflowRestoreSnapshotSpy,
  }),
}));

vi.mock("@/lib/reu/reuTelnetWorkflow", () => ({
  saveRemoteReuFromTemp: vi.fn(),
  restoreRemoteReuFromTemp: vi.fn(),
}));

vi.mock("@/lib/config/configWorkflow", () => ({
  createConfigWorkflow: () => ({
    saveSnapshot: configWorkflowSaveSnapshotSpy,
    applyLocalSnapshot: configWorkflowApplyLocalSnapshotSpy,
    applyRemoteSnapshot: vi.fn(),
  }),
}));

vi.mock("@/lib/config/configTelnetWorkflow", () => ({
  saveRemoteConfigFromTemp: vi.fn(),
  applyRemoteConfigFromTemp: vi.fn(),
  applyRemoteConfigFromPath: vi.fn(),
}));

vi.mock("@/lib/config/configSnapshotStorage", () => ({
  persistConfigSnapshotFile: vi.fn(),
  pickConfigSnapshotFile: pickConfigSnapshotFileSpy,
}));

vi.mock("@/lib/ftp/ftpClient", () => ({
  listFtpDirectory: vi.fn(),
  readFtpFile: vi.fn(),
  writeFtpFile: vi.fn(),
}));

vi.mock("@/lib/ftp/ftpConfig", () => ({
  getStoredFtpPort: () => 21,
}));

vi.mock("@/lib/secureStorage", () => ({
  getPassword: vi.fn().mockResolvedValue("secret"),
}));

vi.mock("@/lib/c64api/hostConfig", () => ({
  stripPortFromDeviceHost: (host: string) => host,
}));

vi.mock("@/lib/telnet/telnetSession", () => ({
  createTelnetSession: vi.fn(),
}));

vi.mock("@/lib/telnet/telnetClient", () => ({
  createTelnetClient: vi.fn(),
}));

vi.mock("@/lib/telnet/telnetConfig", () => ({
  getStoredTelnetPort: () => 23,
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

vi.mock("@/hooks/useTelnetActions", () => ({
  useTelnetActions: () => ({
    isBusy: telnetState.isBusy,
    activeActionId: telnetState.activeActionId,
    executeAction: executeTelnetActionSpy,
    isAvailable: telnetState.isAvailable,
    discoveryState: "ready",
    discoveryError: null,
    actionSupport: {},
    getActionSupport: telnetState.getActionSupport,
  }),
}));

vi.mock("@/lib/deviceControl/deviceControl", () => ({
  useDeviceControl: () => ({
    toggleMenu: toggleMenuSpy,
    rebootKeepRam: rebootKeepRamSpy,
    rebootFull: rebootFullSpy,
    powerCycle: powerCycleSpy,
    resetMenuState: vi.fn(),
    getMenuState: vi.fn().mockReturnValue(false),
    describePowerCycleFallback: vi
      .fn()
      .mockReturnValue("PUT /v1/machine:pause -> PUT /v1/machine:writemem -> PUT /v1/machine:reboot"),
  }),
  isDeviceControlError: deviceControlErrorState.isDeviceControlError,
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onSelect,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { onSelect?: () => void }) => (
    <button type="button" onClick={onSelect} {...props}>
      {children}
    </button>
  ),
}));

describe("HomePage RAM actions", () => {
  vi.setConfig({ testTimeout: 15000 });

  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).__APP_VERSION__ = "test";
    (globalThis as any).__GIT_SHA__ = "deadbeef";
    (globalThis as any).__BUILD_TIME__ = "";
    clearRamAndRebootSpy.mockResolvedValue(undefined);
    executeTelnetActionSpy.mockResolvedValue(undefined);
    rebootFullSpy.mockResolvedValue({
      operation: "rebootFull",
      transport: "REST",
      endpoint: ["PUT /v1/machine:pause", "PUT /v1/machine:writemem", "PUT /v1/machine:reboot"],
      response: { errors: [] },
      menuOpen: false,
    });
    rebootKeepRamSpy.mockResolvedValue({
      operation: "rebootKeepRam",
      transport: "REST",
      endpoint: "PUT /v1/machine:reboot",
      response: { errors: [] },
      menuOpen: false,
    });
    powerCycleSpy.mockResolvedValue({
      operation: "powerCycle",
      transport: "REST_FALLBACK_FULL_REBOOT",
      endpoint: ["PUT /v1/machine:pause", "PUT /v1/machine:writemem", "PUT /v1/machine:reboot"],
      response: { errors: [], fallback: true },
      menuOpen: false,
    });
    toggleMenuSpy.mockResolvedValue({
      operation: "toggleMenu",
      transport: "REST",
      endpoint: "PUT /v1/machine:menu_button",
      response: { errors: [] },
      menuOpen: true,
    });
    createSnapshotSpy.mockResolvedValue({ displayTimestamp: "2026-01-01 12:00:00" });
    reuWorkflowSaveSnapshotSpy.mockResolvedValue({
      metadata: { content_name: "capture.reu" },
      snapshotType: "reu",
    });
    reuWorkflowRestoreSnapshotSpy.mockResolvedValue(undefined);
    configWorkflowSaveSnapshotSpy.mockResolvedValue({
      fileName: "c64u-config-2026-03-29.cfg",
      createdAt: "2026-03-29T00:00:00.000Z",
      sizeBytes: 42,
      remoteFileName: "CONFIG.CFG",
      storage: { kind: "android-tree", treeUri: "content://cfg", path: "/c64u-config-2026-03-29.cfg" },
    });
    configWorkflowApplyLocalSnapshotSpy.mockResolvedValue({
      remoteFileName: "picked.cfg",
      remotePath: "/Temp/picked.cfg",
    });
    pickConfigSnapshotFileSpy.mockResolvedValue({
      name: "picked.cfg",
      sizeBytes: 16,
      modifiedAt: "2026-03-29T00:00:00.000Z",
      bytes: new Uint8Array([1, 2, 3]),
    });
    getCurrentPlaybackSnapshotLabelSpy.mockReturnValue(undefined);
    loadMemoryRangesSpy.mockResolvedValue(undefined);
    telnetState.isBusy = false;
    telnetState.activeActionId = null;
    telnetState.isAvailable = true;
    telnetState.getActionSupport.mockImplementation((actionId: string) => ({
      actionId,
      status: "supported",
      reason: null,
      target: {
        categoryLabel: actionId === "saveReuMemory" ? "C64 Machine" : "Power & Reset",
        actionLabel:
          actionId === "saveReuMemory"
            ? "Save REU Memory"
            : actionId === "saveConfigToFile"
              ? "Save to File"
              : actionId === "clearFlashConfig"
                ? "Clear Flash Config"
                : "Power Cycle",
        source: "initial",
      },
    }));
  });

  it("runs quick reboot through REST without telnet", async () => {
    renderHomePage();

    fireEvent.click(screen.getByRole("button", { name: /^reboot$/i }));

    await waitFor(() => expect(rebootKeepRamSpy).toHaveBeenCalled(), { timeout: 5000 });
    expect(executeTelnetActionSpy).not.toHaveBeenCalled();
    await waitFor(
      () =>
        expect(toastSpy).toHaveBeenCalledWith({
          title: "Machine rebooting",
        }),
      { timeout: 5000 },
    );
  }, 15000);

  it("keeps quick reboot and clear-ram reboot visibly distinct", async () => {
    renderHomePage();

    expect(screen.getByRole("button", { name: /^reboot$/i })).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("home-machine-overflow-trigger"));

    expect(await screen.findByTestId("home-machine-overflow-rebootClearMemory")).toHaveTextContent(
      /^Reboot \(Clear RAM\)$/,
    );
  });

  it("disables reboot while a telnet action is already busy", () => {
    telnetState.isBusy = true;
    renderHomePage();

    const rebootButton = screen.getByRole("button", { name: /^reboot$/i });
    expect(rebootButton).toBeDisabled();

    fireEvent.click(rebootButton);

    expect(executeTelnetActionSpy).not.toHaveBeenCalled();
    expect(rebootKeepRamSpy).not.toHaveBeenCalled();
  });

  it("runs power cycle through telnet", async () => {
    renderHomePage();

    fireEvent.click(screen.getByRole("button", { name: /^power cycle$/i }));

    await waitFor(() => expect(executeTelnetActionSpy).toHaveBeenCalledWith("powerCycle"), { timeout: 5000 });
    expect(powerCycleSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith({ title: "Power cycled" }), { timeout: 5000 });
  });

  it("runs clear-ram reboot from the overflow menu through telnet when available", async () => {
    renderHomePage();

    fireEvent.click(screen.getByTestId("home-machine-overflow-trigger"));
    fireEvent.click(await screen.findByTestId("home-machine-overflow-rebootClearMemory"));

    await waitFor(() => expect(executeTelnetActionSpy).toHaveBeenCalledWith("rebootClearMemory"), { timeout: 5000 });
    expect(rebootFullSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith({ title: "Machine rebooting" }), { timeout: 5000 });
  });

  it("falls back to REST clear-ram reboot when telnet is unavailable", async () => {
    telnetState.isAvailable = false;
    renderHomePage();

    fireEvent.click(screen.getByTestId("home-machine-overflow-trigger"));
    fireEvent.click(await screen.findByTestId("home-machine-overflow-rebootClearMemory"));

    await waitFor(() => expect(rebootFullSpy).toHaveBeenCalled(), { timeout: 5000 });
    expect(executeTelnetActionSpy).not.toHaveBeenCalled();
  });

  it("hides telnet-only home controls when telnet is unavailable", () => {
    telnetState.isAvailable = false;
    renderHomePage();

    expect(screen.queryByRole("button", { name: /^power cycle$/i })).toBeNull();
    expect(screen.queryByTestId("home-config-clear-flash")).toBeNull();
  });

  it("renders Power Cycle disabled with an explanatory note when discovery marks it unsupported", () => {
    telnetState.getActionSupport.mockImplementation((actionId: string) => {
      if (actionId === "powerCycle") {
        return {
          actionId,
          status: "unsupported",
          reason: "Power Cycle is not available on Ultimate 64 Elite 3.14e.",
          target: null,
        };
      }
      return {
        actionId,
        status: "supported",
        reason: null,
        target: {
          categoryLabel: "C64 Machine",
          actionLabel: "Save REU Memory",
          source: "initial",
        },
      };
    });

    renderHomePage();

    expect(screen.getByRole("button", { name: /^power cycle$/i })).toBeDisabled();
    expect(screen.getByTestId("home-machine-note-powerCycle")).toHaveTextContent(
      "Power Cycle: Power Cycle is not available on Ultimate 64 Elite 3.14e.",
    );
  });

  it("falls back to REST clear-ram reboot when telnet execution fails", async () => {
    executeTelnetActionSpy.mockRejectedValueOnce(new Error("telnet offline"));
    renderHomePage();

    fireEvent.click(screen.getByTestId("home-machine-overflow-trigger"));
    fireEvent.click(await screen.findByTestId("home-machine-overflow-rebootClearMemory"));

    await waitFor(() => expect(executeTelnetActionSpy).toHaveBeenCalledWith("rebootClearMemory"), { timeout: 5000 });
    await waitFor(() => expect(rebootFullSpy).toHaveBeenCalled(), { timeout: 5000 });
    expect(addErrorLogSpy).toHaveBeenCalledWith(
      "Reboot clear memory telnet failed; falling back to REST",
      expect.objectContaining({
        error: expect.objectContaining({ message: "telnet offline" }),
      }),
    );
  });

  it("opens Save RAM dialog when Save RAM button is clicked", async () => {
    renderHomePage();

    fireEvent.click(screen.getByRole("button", { name: /save ram/i }));

    await waitFor(() => expect(screen.getByTestId("save-ram-dialog")).toBeInTheDocument());
  }, 15000);

  it("saves config to a local file through the shared config workflow", async () => {
    renderHomePage();

    fireEvent.click(screen.getByTestId("home-config-save-file"));

    await waitFor(() => expect(configWorkflowSaveSnapshotSpy).toHaveBeenCalled(), { timeout: 5000 });
    expect(executeTelnetActionSpy).not.toHaveBeenCalledWith("saveConfigToFile");
    expect(toastSpy).toHaveBeenCalledWith({
      title: "Config saved to file",
      description: "c64u-config-2026-03-29.cfg",
    });
  });

  it("loads config from a local file through the shared config workflow", async () => {
    renderHomePage();

    fireEvent.click(screen.getByTestId("home-config-load-file"));

    await waitFor(() => expect(pickConfigSnapshotFileSpy).toHaveBeenCalled(), { timeout: 5000 });
    await waitFor(
      () => expect(configWorkflowApplyLocalSnapshotSpy).toHaveBeenCalledWith("picked.cfg", new Uint8Array([1, 2, 3])),
      { timeout: 5000 },
    );
    expect(toastSpy).toHaveBeenCalledWith({
      title: "Config loaded from file",
      description: "picked.cfg",
    });
  });

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

  it("runs Save REU through the REU workflow instead of the generic Telnet action", async () => {
    renderHomePage();

    fireEvent.click(screen.getByTestId("home-machine-overflow-trigger"));
    fireEvent.click(await screen.findByTestId("home-machine-overflow-saveReuMemory"));

    await waitFor(() => expect(reuWorkflowSaveSnapshotSpy).toHaveBeenCalled(), { timeout: 5000 });
    expect(executeTelnetActionSpy).not.toHaveBeenCalledWith("saveReuMemory");
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "REU snapshot saved",
      }),
    );
  });

  it("shows the REU progress dialog while save is running and closes it after success", async () => {
    let resolveSave: ((value: { metadata: { content_name: string }; snapshotType: "reu" }) => void) | undefined;
    reuWorkflowSaveSnapshotSpy.mockImplementationOnce((onProgress?: (state: any) => void) => {
      onProgress?.({
        step: "saving-reu",
        title: "Saving REU on the Ultimate",
        description: "The menu action is running in /Temp.",
        progress: 20,
      });
      return new Promise((resolve) => {
        resolveSave = resolve;
      });
    });

    renderHomePage();

    fireEvent.click(screen.getByTestId("home-machine-overflow-trigger"));
    fireEvent.click(await screen.findByTestId("home-machine-overflow-saveReuMemory"));

    const dialog = await screen.findByTestId("reu-progress-dialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText("Saving REU on the Ultimate")).toBeInTheDocument();
    expect(screen.getByText("This can take around 30 seconds.")).toBeInTheDocument();

    resolveSave?.({
      metadata: { content_name: "capture.reu" },
      snapshotType: "reu",
    });

    await waitFor(() => expect(screen.queryByTestId("reu-progress-dialog")).not.toBeInTheDocument());
  });

  it("closes the REU progress dialog and reports the error when save fails", async () => {
    reuWorkflowSaveSnapshotSpy.mockImplementationOnce(async (onProgress?: (state: any) => void) => {
      onProgress?.({
        step: "waiting-for-file",
        title: "Waiting for REU file",
        description: "The Ultimate can take around 30 seconds to finish saving the REU image.",
        progress: 40,
      });
      throw new Error("Timed out waiting for the new REU file in /Temp.");
    });

    renderHomePage();

    fireEvent.click(screen.getByTestId("home-machine-overflow-trigger"));
    fireEvent.click(await screen.findByTestId("home-machine-overflow-saveReuMemory"));

    await waitFor(() =>
      expect(reportUserErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: "HOME_SAVE_REU",
          title: "Save REU failed",
          description: "Timed out waiting for the new REU file in /Temp.",
        }),
      ),
    );
    expect(screen.queryByTestId("reu-progress-dialog")).not.toBeInTheDocument();
  });
});
