/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DiagnosticsDialog } from "@/components/diagnostics/DiagnosticsDialog";
import { DisplayProfileProvider } from "@/hooks/useDisplayProfile";
import type { OverallHealthState } from "@/lib/diagnostics/healthModel";
import { buildBaseUrlFromDeviceHost, updateC64APIConfig } from "@/lib/c64api";
import { setStoredFtpPort } from "@/lib/ftp/ftpConfig";
import { setStoredTelnetPort } from "@/lib/telnet/telnetConfig";

const { mockGetTraceTitle } = vi.hoisted(() => ({
  mockGetTraceTitle: vi.fn(),
}));

vi.mock("@/lib/tracing/traceFormatter", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tracing/traceFormatter")>("@/lib/tracing/traceFormatter");
  return {
    ...actual,
    getTraceTitle: (entry: Parameters<typeof actual.getTraceTitle>[0]) => {
      mockGetTraceTitle(entry);
      return actual.getTraceTitle(entry);
    },
  };
});

type DiagnosticsDialogProps = ComponentProps<typeof DiagnosticsDialog>;

import { CURRENT_DEVICE_HOST_KEY as DEVICE_HOST_KEY } from "@/lib/c64api/hostConfig";
const FTP_PORT_KEY = "c64u_ftp_port";
const SAVED_DEVICES_STORAGE_KEY = "c64u_saved_devices:v1";
const TELNET_PORT_KEY = "c64u_telnet_port";

const setViewportWidth = (width: number) => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
};

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  });

const renderDialog = (props?: Partial<DiagnosticsDialogProps>) =>
  render(
    <MemoryRouter>
      <QueryClientProvider client={createTestQueryClient()}>
        <DisplayProfileProvider>
          <DiagnosticsDialog {...defaultProps} {...props} />
        </DisplayProfileProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );

const buildDeviceAttribution = (
  savedDeviceId: string,
  savedDeviceNameSnapshot: string,
  verifiedProduct: "C64U" | "U64" | "U64E" | "U64E2" = "U64",
) => ({
  savedDeviceId,
  savedDeviceNameSnapshot,
  savedDeviceHostSnapshot: savedDeviceNameSnapshot.toLowerCase().replace(/\s+/g, "-"),
  verifiedUniqueId: `UID-${savedDeviceId}`,
  verifiedHostname: savedDeviceNameSnapshot.toLowerCase().replace(/\s+/g, "-"),
  verifiedProduct,
});

const healthyHealthState: OverallHealthState = {
  state: "Healthy",
  connectivity: "Online",
  host: "c64u",
  connectedDeviceLabel: "C64U",
  problemCount: 0,
  contributors: {
    App: { state: "Healthy", problemCount: 0, totalOperations: 3, failedOperations: 0 },
    REST: { state: "Healthy", problemCount: 0, totalOperations: 4, failedOperations: 0 },
    FTP: { state: "Healthy", problemCount: 0, totalOperations: 2, failedOperations: 0 },
    TELNET: { state: "Healthy", problemCount: 0, totalOperations: 1, failedOperations: 0 },
  },
  lastRestActivity: { operation: "GET /v1/info", result: "200", timestampMs: Date.now() - 5_000 },
  lastFtpActivity: { operation: "LIST /Usb0", result: "success", timestampMs: Date.now() - 8_000 },
  lastTelnetActivity: { operation: "Reboot", result: "success", timestampMs: Date.now() - 3_000 },
  primaryProblem: null,
};

const unhealthyHealthState: OverallHealthState = {
  ...healthyHealthState,
  state: "Unhealthy",
  problemCount: 1,
  contributors: {
    ...healthyHealthState.contributors,
    REST: { state: "Unhealthy", problemCount: 1, totalOperations: 4, failedOperations: 2 },
  },
  primaryProblem: {
    id: "problem-1",
    title: "PUT /v1/configs/Audio/Volume failed",
    contributor: "REST",
    timestampMs: Date.now() - 10_000,
    impactLevel: 2,
    causeHint: "HTTP 403",
  },
};

const defaultProps: DiagnosticsDialogProps = {
  open: true,
  onOpenChange: vi.fn(),
  onFirstVisible: vi.fn(),
  healthState: healthyHealthState,
  logs: [
    {
      id: "log-1",
      level: "info" as const,
      message: "Configuration updated successfully",
      timestamp: new Date(Date.now() - 4_000).toISOString(),
    },
  ],
  errorLogs: [
    {
      id: "error-1",
      level: "error" as const,
      message: "Failed to save audio profile",
      timestamp: new Date(Date.now() - 6_000).toISOString(),
      details: { code: "E_AUDIO" },
    },
  ],
  traceEvents: [
    {
      id: "trace-1",
      timestamp: new Date(Date.now() - 5_000).toISOString(),
      relativeMs: 0,
      type: "rest-response" as const,
      origin: "user" as const,
      correlationId: "action-1",
      data: {
        lifecycleState: "foreground" as const,
        sourceKind: null,
        localAccessMode: null,
        trackInstanceId: null,
        playlistItemId: null,
        method: "GET",
        path: "/v1/info",
        status: 200,
      },
    },
  ],
  actionSummaries: [
    {
      correlationId: "action-1",
      actionName: "Configuration updated successfully",
      origin: "user" as const,
      originalOrigin: "user" as const,
      startTimestamp: new Date(Date.now() - 7_000).toISOString(),
      endTimestamp: new Date(Date.now() - 6_500).toISOString(),
      durationMs: 500,
      outcome: "success" as const,
      startRelativeMs: 0,
      effects: [
        {
          type: "REST" as const,
          label: "Save",
          method: "PUT",
          path: "/v1/configs",
          target: null,
          status: 200,
          durationMs: 500,
        },
      ],
    },
  ],
  onShareAll: vi.fn(),
  onShareFiltered: vi.fn(),
  onClearAll: vi.fn(),
  onRetryConnection: vi.fn(),
  connectionCallbacks: {
    onRetryConnection: vi.fn().mockResolvedValue({ success: true, message: "Connected to c64u" }),
    onSwitchDevice: vi.fn().mockResolvedValue({ success: true, message: "Switched to c64u-backup" }),
  },
  deviceInfo: null,
  healthCheckRunning: false,
  onRunHealthCheck: vi.fn(),
  lastHealthCheckResult: {
    runId: "hc-1",
    startTimestamp: new Date(Date.now() - 60_000).toISOString(),
    endTimestamp: new Date(Date.now() - 59_000).toISOString(),
    totalDurationMs: 1000,
    overallHealth: "Healthy" as const,
    probes: {
      REST: { probe: "REST" as const, outcome: "Success" as const, durationMs: 100, reason: null, startMs: 0 },
      FTP: { probe: "FTP" as const, outcome: "Success" as const, durationMs: 100, reason: null, startMs: 100 },
      TELNET: { probe: "TELNET" as const, outcome: "Success" as const, durationMs: 100, reason: null, startMs: 200 },
      CONFIG: { probe: "CONFIG" as const, outcome: "Success" as const, durationMs: 100, reason: null, startMs: 300 },
      RASTER: { probe: "RASTER" as const, outcome: "Success" as const, durationMs: 100, reason: null, startMs: 400 },
      JIFFY: { probe: "JIFFY" as const, outcome: "Success" as const, durationMs: 100, reason: null, startMs: 500 },
    },
    latency: { p50: 10, p90: 20, p99: 30 },
    deviceInfo: null,
  },
  liveHealthCheckProbes: null,
};

describe("DiagnosticsDialog", () => {
  beforeEach(async () => {
    localStorage.clear();
    localStorage.setItem(
      SAVED_DEVICES_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        selectedDeviceId: "device-office",
        devices: [
          {
            id: "device-office",
            name: "Office U64",
            host: "c64u",
            httpPort: 80,
            ftpPort: 21,
            telnetPort: 23,
            lastKnownProduct: "U64",
            lastKnownHostname: "office-u64",
            lastKnownUniqueId: "UID-OFFICE",
            lastSuccessfulConnectionAt: null,
            lastUsedAt: null,
            hasPassword: false,
          },
        ],
        summaries: {},
        summaryLru: [],
      }),
    );
    const store = await import("@/lib/savedDevices/store");
    const snapshot = store.getSavedDevicesSnapshot();
    const primaryDevice = snapshot.devices[0]!;

    for (const device of snapshot.devices.slice(1)) {
      store.removeSavedDevice(device.id);
    }

    store.updateSavedDevice(primaryDevice.id, {
      name: "Office U64",
      host: "c64u",
      httpPort: 80,
      ftpPort: 21,
      telnetPort: 23,
      lastKnownProduct: "U64",
      lastKnownHostname: "office-u64",
      lastKnownUniqueId: "UID-OFFICE",
      hasPassword: false,
    });
    store.selectSavedDevice(primaryDevice.id);

    vi.clearAllMocks();
    mockGetTraceTitle.mockClear();
    updateC64APIConfig(buildBaseUrlFromDeviceHost("c64u:80"), undefined, "c64u:80");
    setStoredFtpPort(21);
    setStoredTelnetPort(23);
  });

  it("reports the first visible paint once per open cycle", async () => {
    const onFirstVisible = vi.fn();
    const view = renderDialog({ onFirstVisible });

    await waitFor(() => {
      expect(onFirstVisible).toHaveBeenCalledTimes(1);
    });

    view.rerender(
      <MemoryRouter>
        <QueryClientProvider client={createTestQueryClient()}>
          <DisplayProfileProvider>
            <DiagnosticsDialog {...defaultProps} onFirstVisible={onFirstVisible} />
          </DisplayProfileProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(onFirstVisible).toHaveBeenCalledTimes(1);
    });

    view.rerender(
      <MemoryRouter>
        <QueryClientProvider client={createTestQueryClient()}>
          <DisplayProfileProvider>
            <DiagnosticsDialog {...defaultProps} open={false} onFirstVisible={onFirstVisible} />
          </DisplayProfileProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    view.rerender(
      <MemoryRouter>
        <QueryClientProvider client={createTestQueryClient()}>
          <DisplayProfileProvider>
            <DiagnosticsDialog {...defaultProps} onFirstVisible={onFirstVisible} />
          </DisplayProfileProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(onFirstVisible).toHaveBeenCalledTimes(2);
    });
  });

  it("does not build the unified evidence list while closed", () => {
    renderDialog({ open: false });

    expect(mockGetTraceTitle).not.toHaveBeenCalled();
  });

  it("does not build raw trace rows while the Traces filter remains disabled", () => {
    renderDialog();

    expect(mockGetTraceTitle).not.toHaveBeenCalled();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows evidence immediately with a collapsed filter bar and corrected wording", () => {
    setViewportWidth(600);

    renderDialog();

    expect(screen.getByTestId("diagnostics-header")).toBeVisible();
    expect(screen.getByTestId("evidence-panel")).toBeVisible();
    expect(screen.getByTestId("evidence-heading")).toHaveTextContent("Activity");
    expect(screen.getByTestId("activity-kinds-line")).toHaveTextContent(
      "Problems, actions, logs, and traces across App, REST, FTP, and Telnet",
    );
    expect(screen.getByTestId("filters-collapsed-bar")).toBeVisible();
    expect(screen.queryByText(/in view/i)).toBeNull();
    expect(screen.queryByTestId("filters-editor-surface")).toBeNull();
  });

  it("shows Telnet filters and Telnet action badges in the evidence list", () => {
    setViewportWidth(600);

    renderDialog({
      traceEvents: [
        {
          id: "trace-telnet-1",
          timestamp: new Date(Date.now() - 3_000).toISOString(),
          relativeMs: 0,
          type: "telnet-operation",
          origin: "user",
          correlationId: "telnet-action-1",
          data: {
            lifecycleState: "foreground",
            sourceKind: null,
            localAccessMode: null,
            trackInstanceId: null,
            playlistItemId: null,
            actionId: "saveDebugLog",
            actionLabel: "Save Debug Log",
            menuPath: ["Developer", "Save Debug Log"],
            result: "success",
            durationMs: 120,
          },
        },
      ],
      actionSummaries: [
        {
          correlationId: "telnet-action-1",
          actionName: "Save Debug Log",
          origin: "user",
          originalOrigin: "user",
          startTimestamp: new Date(Date.now() - 3_500).toISOString(),
          endTimestamp: new Date(Date.now() - 3_200).toISOString(),
          durationMs: 300,
          outcome: "success",
          startRelativeMs: 0,
          effects: [
            {
              type: "TELNET",
              label: "Save Debug Log",
              actionId: "saveDebugLog",
              actionLabel: "Save Debug Log",
              menuPath: ["Developer", "Save Debug Log"],
              target: null,
              result: "success",
              durationMs: 120,
            },
          ],
        },
      ],
    });

    fireEvent.click(screen.getByTestId("open-filters-editor"));
    expect(within(screen.getByTestId("filters-editor-surface")).getByRole("button", { name: "TELNET" })).toBeVisible();
    expect(screen.getByTestId("evidence-list")).toHaveTextContent("Save Debug Log");
    expect(screen.getByTestId("diagnostics-last-check-line")).toHaveTextContent(/ago/i);
  });

  it("hides compact device attribution and device filters for true single-device users", () => {
    setViewportWidth(600);

    renderDialog({
      defaultEvidenceTypes: new Set(["Logs"]),
      logs: [
        {
          id: "log-attributed",
          level: "info",
          message: "Office activity",
          timestamp: new Date(Date.now() - 4_000).toISOString(),
          device: buildDeviceAttribution("device-office", "Office U64"),
        },
      ],
      errorLogs: [],
      traceEvents: [],
      actionSummaries: [],
    });

    expect(within(screen.getByTestId("evidence-row-log-log-attributed")).queryByText("Office U64")).toBeNull();

    fireEvent.click(screen.getByTestId("open-filters-editor"));
    const surface = screen.getByTestId("filters-editor-surface");
    expect(within(surface).queryByText("Device")).toBeNull();
    expect(within(surface).queryByText("All devices")).toBeNull();
  });

  it("keeps device attribution UI unlocked after a prior multi-device setup falls back to one", async () => {
    setViewportWidth(600);
    const store = await import("@/lib/savedDevices/store");
    store.addSavedDevice({
      id: "device-backup",
      name: "Backup Lab",
      host: "backup-c64",
      httpPort: 8080,
      ftpPort: 2021,
      telnetPort: 2323,
      lastKnownProduct: "U64E",
      lastKnownHostname: "backup-lab",
      lastKnownUniqueId: "UID-BACKUP",
      hasPassword: false,
    });
    store.removeSavedDevice("device-backup");

    expect(store.getSavedDevicesSnapshot().hasEverHadMultipleDevices).toBe(true);

    renderDialog({
      defaultEvidenceTypes: new Set(["Logs"]),
      logs: [
        {
          id: "log-unlocked",
          level: "info",
          message: "Office activity",
          timestamp: new Date(Date.now() - 4_000).toISOString(),
          device: buildDeviceAttribution("device-office", "Office U64"),
        },
      ],
      errorLogs: [],
      traceEvents: [],
      actionSummaries: [],
    });

    expect(screen.getByTestId("evidence-row-log-log-unlocked")).toHaveTextContent("Office U64");

    fireEvent.click(screen.getByTestId("open-filters-editor"));
    const surface = screen.getByTestId("filters-editor-surface");
    expect(within(surface).getByText("Device")).toBeVisible();
    expect(within(surface).getByRole("button", { name: /All devices/ })).toBeVisible();
    expect(within(surface).getByRole("button", { name: /Office U64/ })).toBeVisible();
  });

  it("filters by saved-device display name and leaves legacy unattributed rows out of specific device filters", async () => {
    setViewportWidth(600);
    const store = await import("@/lib/savedDevices/store");
    store.addSavedDevice({
      id: "device-backup",
      name: "Backup Lab",
      host: "backup-c64",
      httpPort: 8080,
      ftpPort: 2021,
      telnetPort: 2323,
      lastKnownProduct: "U64E",
      lastKnownHostname: "backup-lab",
      lastKnownUniqueId: "UID-BACKUP",
      hasPassword: false,
    });

    expect(store.getSavedDevicesSnapshot().hasEverHadMultipleDevices).toBe(true);

    renderDialog({
      defaultEvidenceTypes: new Set(["Logs"]),
      logs: [
        {
          id: "log-office",
          level: "info",
          message: "Office log",
          timestamp: new Date(Date.now() - 6_000).toISOString(),
          device: buildDeviceAttribution("device-office", "Office U64"),
        },
        {
          id: "log-backup",
          level: "info",
          message: "Backup log",
          timestamp: new Date(Date.now() - 5_000).toISOString(),
          device: buildDeviceAttribution("device-backup", "Backup Lab", "U64E"),
        },
        {
          id: "log-legacy",
          level: "info",
          message: "Legacy log",
          timestamp: new Date(Date.now() - 4_000).toISOString(),
        },
      ],
      errorLogs: [],
      traceEvents: [],
      actionSummaries: [],
    });

    fireEvent.click(screen.getByTestId("open-filters-editor"));
    fireEvent.click(screen.getByRole("button", { name: /Backup Lab/ }));

    const list = screen.getByTestId("evidence-list");
    expect(list).toHaveTextContent("Backup log");
    expect(list).not.toHaveTextContent("Office log");
    expect(list).not.toHaveTextContent("Legacy log");
  });

  it("falls back to the stored saved-device name snapshot when the referenced device was deleted", async () => {
    setViewportWidth(600);
    const store = await import("@/lib/savedDevices/store");
    store.addSavedDevice({
      id: "device-retired-temp",
      name: "Retired Lab",
      host: "retired-lab",
      httpPort: 80,
      ftpPort: 21,
      telnetPort: 23,
      lastKnownProduct: "U64E",
      lastKnownHostname: "retired-lab",
      lastKnownUniqueId: "UID-RETIRED",
      hasPassword: false,
    });
    store.removeSavedDevice("device-retired-temp");

    renderDialog({
      defaultEvidenceTypes: new Set(["Logs"]),
      logs: [
        {
          id: "log-deleted-device",
          level: "info",
          message: "Retired device log",
          timestamp: new Date(Date.now() - 4_000).toISOString(),
          device: {
            savedDeviceId: "device-retired",
            savedDeviceNameSnapshot: "Retired Lab",
            savedDeviceHostSnapshot: "retired-lab",
            verifiedUniqueId: "UID-RETIRED",
            verifiedHostname: "retired-lab",
            verifiedProduct: "U64E",
          },
        },
      ],
      errorLogs: [],
      traceEvents: [],
      actionSummaries: [],
    });

    expect(within(screen.getByTestId("evidence-row-log-log-deleted-device")).getByText(/Retired Lab/)).toBeVisible();
  });

  it("keeps diagnostics focused on evidence and removes the old devices section", () => {
    setViewportWidth(600);

    renderDialog();

    expect(screen.queryByTestId("diagnostics-devices")).toBeNull();
    expect(screen.queryByTestId("diagnostics-devices-toggle")).toBeNull();
    expect(screen.queryByTestId("manage-devices-button")).toBeNull();
    expect(screen.queryByText("Switch saved devices from diagnostics.")).toBeNull();
  });

  it("opens connection view on tap and connection edit on long press", async () => {
    setViewportWidth(600);
    vi.useFakeTimers();

    renderDialog();

    fireEvent.pointerDown(screen.getByTestId("diagnostics-device-line"));
    fireEvent.pointerUp(screen.getByTestId("diagnostics-device-line"));

    expect(screen.getByTestId("connection-view-surface")).toBeVisible();
    expect(within(screen.getByTestId("connection-view-surface")).getByText("Name")).toBeVisible();
    expect(within(screen.getByTestId("connection-view-surface")).getByText("Type")).toBeVisible();
    expect(within(screen.getByTestId("connection-view-surface")).getAllByText("c64u").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByTestId("connection-view-edit"));
    expect(screen.getByTestId("connection-edit-surface")).toBeVisible();

    fireEvent.click(within(screen.getByTestId("connection-edit-surface")).getByRole("button", { name: "Close" }));

    fireEvent.pointerDown(screen.getByTestId("diagnostics-device-line"));
    await vi.advanceTimersByTimeAsync(500);

    expect(screen.getByTestId("connection-edit-surface")).toBeVisible();

    vi.useRealTimers();
  });

  it("shows the effective host-derived inferred name in connection details and in the edit field", async () => {
    setViewportWidth(600);
    const store = await import("@/lib/savedDevices/store");
    const snapshot = store.getSavedDevicesSnapshot();
    const primaryDevice = snapshot.devices[0]!;

    for (const device of snapshot.devices.slice(1)) {
      store.removeSavedDevice(device.id);
    }

    store.updateSavedDevice(primaryDevice.id, {
      name: "",
      host: "u64-primary",
      httpPort: 80,
      ftpPort: 21,
      telnetPort: 23,
      lastKnownProduct: "U64",
      lastKnownHostname: "u64-primary",
      lastKnownUniqueId: "UID-U64-1",
      hasPassword: false,
    });
    store.addSavedDevice({
      id: "device-u64-secondary",
      name: "",
      host: "u64-secondary",
      httpPort: 80,
      ftpPort: 2021,
      telnetPort: 2323,
      lastKnownProduct: "U64",
      lastKnownHostname: "u64-secondary",
      lastKnownUniqueId: "UID-U64-2",
      hasPassword: false,
    });
    store.selectSavedDevice("device-u64-secondary");

    renderDialog();

    fireEvent.pointerDown(screen.getByTestId("diagnostics-device-line"));
    fireEvent.pointerUp(screen.getByTestId("diagnostics-device-line"));

    const connectionView = screen.getByTestId("connection-view-surface");
    expect(connectionView).toBeVisible();
    expect(within(connectionView).getAllByText("u64-secondary").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByTestId("connection-view-edit"));
    expect(screen.getByLabelText(/device name/i)).toHaveValue("u64-secondary");
  });

  it("persists connection edits and retries the connection", async () => {
    setViewportWidth(600);
    const onRetryConnection = vi.fn();

    renderDialog({ onRetryConnection });

    fireEvent.contextMenu(screen.getByTestId("diagnostics-device-line"));

    fireEvent.change(screen.getByLabelText(/device name/i), { target: { value: "Lab U64" } });
    fireEvent.change(screen.getByTestId("connection-edit-host"), { target: { value: "ultimate.local" } });
    fireEvent.change(screen.getByTestId("connection-edit-http"), { target: { value: "8081" } });
    fireEvent.change(screen.getByTestId("connection-edit-ftp"), { target: { value: "2121" } });
    fireEvent.change(screen.getByTestId("connection-edit-telnet"), { target: { value: "2323" } });
    fireEvent.click(screen.getByTestId("connection-edit-save"));

    await waitFor(() => {
      expect(onRetryConnection).toHaveBeenCalledTimes(1);
    });

    expect(localStorage.getItem(DEVICE_HOST_KEY)).toBe("ultimate.local:8081");
    expect(localStorage.getItem(FTP_PORT_KEY)).toBe("2121");
    expect(localStorage.getItem(TELNET_PORT_KEY)).toBe("2323");

    const persisted = JSON.parse(localStorage.getItem(SAVED_DEVICES_STORAGE_KEY) ?? "{}");
    expect(persisted.devices.find((device: { host?: string }) => device.host === "ultimate.local")).toMatchObject({
      name: "Lab U64",
      host: "ultimate.local",
      httpPort: 8081,
      ftpPort: 2121,
      telnetPort: 2323,
    });
  });

  it("does not repeat the product code when the saved device name already matches it", async () => {
    const store = await import("@/lib/savedDevices/store");
    const primaryDeviceId = store.getSavedDevicesSnapshot().selectedDeviceId;
    store.updateSavedDevice(primaryDeviceId, {
      name: "U64",
      host: "c64u",
      httpPort: 80,
      ftpPort: 21,
      telnetPort: 23,
      lastKnownProduct: "U64",
      lastKnownHostname: "office-u64",
      lastKnownUniqueId: "UID-OFFICE",
    });

    renderDialog();

    expect(screen.getByTestId("diagnostics-device-line")).toHaveTextContent(/^U64$/);
  });

  it("uses live device info as the diagnostics product fallback when the saved snapshot is empty", async () => {
    const store = await import("@/lib/savedDevices/store");
    const primaryDeviceId = store.getSavedDevicesSnapshot().selectedDeviceId;
    store.updateSavedDevice(primaryDeviceId, {
      host: "u64-live",
      type: "",
      lastKnownProduct: null,
    });

    renderDialog({
      deviceInfo: {
        product: "Ultimate 64 Elite",
        firmware: "3.14e",
        fpga: null,
        core: null,
        uptimeSeconds: null,
      },
    });

    expect(screen.getByTestId("diagnostics-device-line")).toHaveTextContent("Office U64 · Ultimate 64 Elite");
  });

  it("keeps the diagnostics header focused on device health and timing", () => {
    renderDialog();

    expect(screen.queryByTestId("diagnostics-safety-line")).toBeNull();
    expect(screen.getByTestId("diagnostics-last-check-line")).toHaveTextContent(/Last check/i);
  });

  it("keeps filter configuration separate from filter visibility", () => {
    setViewportWidth(600);

    renderDialog();

    fireEvent.click(screen.getByTestId("open-filters-editor"));

    expect(screen.getByTestId("filters-editor-surface")).toBeVisible();
    fireEvent.click(within(screen.getByTestId("filters-editor-surface")).getByRole("button", { name: "Logs" }));
    fireEvent.click(within(screen.getByTestId("filters-editor-surface")).getByRole("button", { name: "✓ Problems" }));

    expect(screen.getByTestId("filters-collapsed-bar")).toHaveTextContent("Actions");
  });

  it("opens latency and history screens without descriptive copy and closes them when the sheet closes", async () => {
    setViewportWidth(600);
    const { rerender } = renderDialog({ healthState: unhealthyHealthState });

    fireEvent.click(screen.getByTestId("diagnostics-overflow-menu"));
    fireEvent.click(screen.getByTestId("open-latency-screen"));
    expect(screen.getByTestId("latency-analysis-popup")).toBeVisible();

    fireEvent.click(screen.getByTestId("analytic-popup-close"));
    fireEvent.click(screen.getByTestId("diagnostics-overflow-menu"));
    fireEvent.click(screen.getByTestId("open-timeline-screen"));
    expect(screen.getByTestId("health-history-popup")).toBeVisible();

    rerender(
      <MemoryRouter>
        <QueryClientProvider client={createTestQueryClient()}>
          <DisplayProfileProvider>
            <DiagnosticsDialog {...defaultProps} open={false} />
          </DisplayProfileProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.queryByTestId("health-history-popup")).toBeNull();
    });
  });

  it("surfaces config drift and heat maps from the main diagnostics controls", () => {
    setViewportWidth(600);

    renderDialog();

    fireEvent.click(screen.getByTestId("diagnostics-overflow-menu"));
    fireEvent.click(screen.getByTestId("open-config-drift-screen"));
    expect(screen.getByTestId("config-drift-surface")).toBeVisible();

    fireEvent.click(screen.getByTestId("diagnostics-overflow-menu"));
    fireEvent.click(screen.getByTestId("open-rest-heatmap-screen"));
    expect(screen.getByTestId("heat-map-popup-rest")).toBeVisible();

    fireEvent.click(screen.getByTestId("analytic-popup-close"));
    fireEvent.click(screen.getByTestId("diagnostics-overflow-menu"));
    fireEvent.click(screen.getByTestId("open-config-heatmap-screen"));
    expect(screen.getByTestId("heat-map-popup-config")).toBeVisible();
  });

  it("keeps the primary diagnostics menu controls uniquely addressable", () => {
    setViewportWidth(600);

    renderDialog();

    expect(screen.getAllByTestId("diagnostics-overflow-menu")).toHaveLength(1);

    fireEvent.click(screen.getByTestId("diagnostics-overflow-menu"));

    expect(screen.getAllByTestId("diagnostics-share-all")).toHaveLength(1);
    expect(screen.getAllByTestId("diagnostics-share-filtered")).toHaveLength(1);
    expect(screen.getAllByTestId("diagnostics-clear-all-trigger")).toHaveLength(1);
    expect(screen.getAllByTestId("open-latency-screen")).toHaveLength(1);
    expect(screen.getAllByTestId("open-timeline-screen")).toHaveLength(1);
    expect(screen.getAllByTestId("open-config-drift-screen")).toHaveLength(1);
    expect(screen.getAllByTestId("open-rest-heatmap-screen")).toHaveLength(1);
    expect(screen.getAllByTestId("open-config-heatmap-screen")).toHaveLength(1);
  });

  it("dismisses the overflow menu on an outside pointerdown but excludes its own trigger (BUG-032 hardening)", async () => {
    setViewportWidth(600);

    renderDialog();

    const openMenu = () => fireEvent.click(screen.getByTestId("diagnostics-overflow-menu"));
    // DismissableLayer attaches its outside-pointerdown listener on a setTimeout(0),
    // so let that microtask/timer settle before dispatching the pointerdown.
    const settleDismissLayer = () => new Promise((resolve) => setTimeout(resolve, 0));

    // An outside pointerdown closes the menu via the DismissableLayer dismiss path.
    openMenu();
    expect(screen.getByTestId("diagnostics-share-all")).toBeVisible();
    await settleDismissLayer();
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.queryByTestId("diagnostics-share-all")).toBeNull());

    // A pointerdown on the trigger itself must NOT auto-dismiss — the trigger is
    // excluded so its own click can toggle the menu shut. Without that exclusion
    // (and with disableOutsidePointerEvents disabling the trigger), a re-tap would
    // be swallowed instead of closing the menu.
    openMenu();
    await settleDismissLayer();
    fireEvent.pointerDown(screen.getByTestId("diagnostics-overflow-menu"));
    expect(screen.getByTestId("diagnostics-share-all")).toBeVisible();
    fireEvent.click(screen.getByTestId("diagnostics-overflow-menu"));
    expect(screen.queryByTestId("diagnostics-share-all")).toBeNull();
  });

  it("anchors the compact diagnostics overflow panel flush to the viewport edge", () => {
    setViewportWidth(360);

    renderDialog();

    fireEvent.click(screen.getByTestId("diagnostics-overflow-menu"));

    const panel = screen.getByTestId("diagnostics-overflow-panel");
    expect(panel.className).toContain("fixed");
    expect(panel.className).toContain("inset-x-4");
    expect(panel).toHaveTextContent("Health history");
  });

  it("opens decision-state and FTP heat map views from the compact overflow menu", () => {
    setViewportWidth(360);

    renderDialog();

    fireEvent.click(screen.getByTestId("diagnostics-overflow-menu"));
    fireEvent.click(screen.getByTestId("open-decision-state-screen"));
    expect(screen.getByTestId("decision-state-surface")).toBeVisible();

    fireEvent.click(screen.getByTestId("diagnostics-overflow-menu"));
    fireEvent.click(screen.getByTestId("open-ftp-heatmap-screen"));
    expect(screen.getByTestId("heat-map-popup-ftp")).toBeVisible();
  });

  it("shares only the filtered evidence set", () => {
    setViewportWidth(600);
    const onShareFiltered = vi.fn();

    renderDialog({ onShareFiltered });

    fireEvent.click(screen.getByTestId("open-filters-editor"));
    fireEvent.click(within(screen.getByTestId("filters-editor-surface")).getByRole("button", { name: "Logs" }));
    fireEvent.click(within(screen.getByTestId("filters-editor-surface")).getByRole("button", { name: "✓ Problems" }));
    fireEvent.click(within(screen.getByTestId("filters-editor-surface")).getByRole("button", { name: "✓ Actions" }));

    fireEvent.click(screen.getByTestId("diagnostics-overflow-menu"));
    fireEvent.click(screen.getByTestId("diagnostics-share-filtered"));

    expect(onShareFiltered).toHaveBeenCalledTimes(1);
    expect(onShareFiltered.mock.calls[0][0]).toHaveLength(1);
    expect(onShareFiltered.mock.calls[0][0][0]).toMatchObject({ message: "Configuration updated successfully" });
  });

  it("expands and collapses activity rows when extra detail exists", () => {
    setViewportWidth(600);

    renderDialog();

    const row = screen.getByTestId("evidence-row-action-action-1");
    expect(row).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(row);

    expect(row).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("evidence-detail-action-action-1")).toHaveTextContent("PUT /v1/configs");
    expect(screen.getByTestId("evidence-detail-action-action-1")).toHaveTextContent("status: 200");

    fireEvent.click(row);

    expect(row).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("evidence-detail-action-action-1")).toBeNull();
  });

  it("shows TELNET request and response detail in expanded action rows", () => {
    setViewportWidth(600);

    renderDialog({
      defaultEvidenceTypes: new Set(["Actions"]),
      logs: [],
      errorLogs: [],
      traceEvents: [],
      actionSummaries: [
        {
          correlationId: "telnet-action-detail",
          actionName: "Save Debug Log",
          origin: "user" as const,
          originalOrigin: "user" as const,
          startTimestamp: new Date(Date.now() - 3_500).toISOString(),
          endTimestamp: new Date(Date.now() - 3_200).toISOString(),
          durationMs: 300,
          outcome: "success" as const,
          startRelativeMs: 0,
          effects: [
            {
              type: "TELNET" as const,
              label: "Save Debug Log",
              actionId: "saveDebugLog",
              actionLabel: "Save Debug Log",
              menuPath: ["Developer", "Save Debug Log"],
              hostname: "u64",
              port: 23,
              target: "real-device" as const,
              result: "success",
              durationMs: 120,
              requestPayload: {
                steps: [{ type: "send-key", key: "F5", sequence: "\u001b[15~" }],
              },
              requestPayloadPreview: {
                byteCount: 16,
                previewByteCount: 16,
                hex: "7b 7d",
                ascii: '{"key":"F5"}',
                truncated: false,
              },
              responsePayload: {
                steps: [{ type: "visible-text", text: "Developer menu visible" }],
              },
              responsePayloadPreview: {
                byteCount: 28,
                previewByteCount: 28,
                hex: "7b 7d",
                ascii: '{"text":"Developer menu visible"}',
                truncated: false,
              },
            },
          ],
        },
      ],
    });

    const row = screen.getByTestId("evidence-row-action-telnet-action-detail");
    fireEvent.click(row);

    const detail = screen.getByTestId("evidence-detail-action-telnet-action-detail");
    expect(detail).toHaveTextContent("endpoint: u64:23");
    expect(detail).toHaveTextContent("Request payload");
    expect(detail).toHaveTextContent("Response payload");
    expect(detail).toHaveTextContent("Developer menu visible");
  });

  it("hides activity expand affordance when no additional detail exists", () => {
    setViewportWidth(600);

    renderDialog({
      defaultEvidenceTypes: new Set(["Logs"]),
      logs: [
        {
          id: "log-plain",
          level: "info" as const,
          message: "Background refresh complete",
          timestamp: new Date(Date.now() - 2_000).toISOString(),
        },
      ],
      errorLogs: [],
      traceEvents: [],
      actionSummaries: [],
    });

    const row = screen.getByTestId("evidence-row-log-log-plain");
    expect(row.tagName).toBe("DIV");
    expect(row.querySelector("svg")).toBeNull();
    expect(row).not.toHaveAttribute("aria-expanded");
  });

  it("renders canonical app log lines with exception details and stack traces", () => {
    setViewportWidth(600);

    renderDialog({
      defaultEvidenceTypes: new Set(["Logs"]),
      logs: [
        {
          id: "log-stack",
          level: "error" as const,
          message: "FTP disk import failed",
          timestamp: new Date(Date.now() - 2_000).toISOString(),
          details: {
            path: "/Usb0/Games/Corrupt.d64",
            error: {
              name: "FtpDiskImportError",
              message: "550 Corrupt disk image",
              stack: "FtpDiskImportError: 550 Corrupt disk image\n    at importDisk (ftpDiskImport.ts:75:11)",
            },
            errorName: "FtpDiskImportError",
            errorStack: "FtpDiskImportError: 550 Corrupt disk image\n    at importDisk (ftpDiskImport.ts:75:11)",
          },
        },
      ],
      errorLogs: [],
      traceEvents: [],
      actionSummaries: [],
    });

    const row = screen.getByTestId("evidence-row-log-log-stack");
    expect(row).toHaveTextContent("ERROR FTP disk import failed");
    expect(row).toHaveTextContent("FtpDiskImportError");

    fireEvent.click(row);

    const detail = screen.getByTestId("evidence-detail-log-log-stack");
    expect(detail).toHaveTextContent("ERROR FTP disk import failed");
    expect(detail).toHaveTextContent("Exception: FtpDiskImportError: 550 Corrupt disk image");
    expect(detail).toHaveTextContent("Stack trace:");
    expect(detail).toHaveTextContent("at importDisk (ftpDiskImport.ts:75:11)");
  });

  it("shows problem entries from both app logs and trace failures", () => {
    setViewportWidth(600);

    renderDialog({
      defaultEvidenceTypes: new Set(["Problems"]),
      logs: [],
      errorLogs: [
        {
          id: "problem-log",
          level: "error" as const,
          message: "FTP disk import failed",
          timestamp: new Date(Date.now() - 2_000).toISOString(),
          details: {
            errorName: "FtpDiskImportError",
          },
        },
      ],
      traceEvents: [
        {
          id: "trace-problem",
          timestamp: new Date(Date.now() - 4_000).toISOString(),
          relativeMs: 0,
          type: "rest-response" as const,
          origin: "user" as const,
          correlationId: "trace-problem-correlation",
          data: {
            lifecycleState: "foreground" as const,
            sourceKind: null,
            localAccessMode: null,
            trackInstanceId: null,
            playlistItemId: null,
            method: "GET",
            path: "/v1/runners/script/status",
            status: 503,
            error: "Script runner unavailable",
          },
        },
      ],
      actionSummaries: [],
    });

    expect(screen.getByTestId("evidence-row-problem-log-problem-log")).toHaveTextContent(
      "ERROR FTP disk import failed",
    );
    expect(screen.getByTestId("evidence-row-problem-trace-trace-problem")).toHaveTextContent(
      "GET /v1/runners/script/status",
    );
  });

  it("hides expected cancellation trace failures from the Problems list", () => {
    setViewportWidth(600);

    renderDialog({
      defaultEvidenceTypes: new Set(["Problems"]),
      logs: [],
      errorLogs: [],
      traceEvents: [
        {
          id: "trace-abort",
          timestamp: new Date(Date.now() - 4_000).toISOString(),
          relativeMs: 0,
          type: "rest-response" as const,
          origin: "system" as const,
          correlationId: "trace-abort-correlation",
          data: {
            lifecycleState: "foreground" as const,
            sourceKind: null,
            localAccessMode: null,
            trackInstanceId: null,
            playlistItemId: null,
            method: "GET",
            path: "/v1/info",
            status: null,
            error: "signal is aborted without reason",
            expectedFailure: true,
          },
        },
      ],
      actionSummaries: [],
    });

    expect(screen.queryByTestId("evidence-row-problem-trace-trace-abort")).not.toBeInTheDocument();
    expect(screen.queryByText("signal is aborted without reason")).not.toBeInTheDocument();
  });

  it("auto-expands the health detail view when a health check starts", () => {
    setViewportWidth(600);
    const onRunHealthCheck = vi.fn();

    renderDialog({
      onRunHealthCheck,
      lastHealthCheckResult: null,
      liveHealthCheckProbes: {},
      healthCheckRunning: true,
    });

    expect(screen.getByTestId("diagnostics-header-expanded")).toBeVisible();
    expect(screen.getByTestId("health-check-detail-view")).toBeVisible();
    expect(screen.getByTestId("health-check-probe-raster")).toHaveTextContent("Pending");
    expect(screen.getByTestId("health-check-probe-jiffy")).toHaveTextContent("Pending");

    fireEvent.click(screen.getByTestId("run-health-check"));
    expect(onRunHealthCheck).toHaveBeenCalledTimes(1);
  });

  it("opens the latest health detail when the run button is pressed", () => {
    setViewportWidth(600);
    const onRunHealthCheck = vi.fn();

    renderDialog({ onRunHealthCheck });

    expect(screen.queryByTestId("diagnostics-header-expanded")).toBeNull();

    fireEvent.click(screen.getByTestId("run-health-check"));

    expect(onRunHealthCheck).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("diagnostics-header-expanded")).toBeVisible();
    expect(screen.getByTestId("health-check-probe-raster")).toHaveTextContent("Success");
    expect(screen.getByTestId("health-check-probe-jiffy")).toHaveTextContent("Success");
  });

  it("pages through all filtered activity and resets pagination when quick filters change", () => {
    setViewportWidth(600);
    const now = Date.now();
    const actionSummaries = Array.from({ length: 25 }, (_, index) => ({
      correlationId: `rest-${index}`,
      actionName: `REST action ${index}`,
      origin: "user" as const,
      originalOrigin: "user" as const,
      startTimestamp: new Date(now - index * 1000).toISOString(),
      endTimestamp: new Date(now - index * 1000 + 50).toISOString(),
      durationMs: 50,
      outcome: "success" as const,
      startRelativeMs: index,
      effects: [
        {
          type: "REST" as const,
          label: "GET /v1/info",
          method: "GET",
          path: "/v1/info",
          target: null,
          status: 200,
          durationMs: 50,
        },
      ],
    }));

    renderDialog({ actionSummaries, errorLogs: [], logs: [], traceEvents: [] });

    expect(screen.getByTestId("filters-result-count")).toHaveTextContent("25 of 25");
    expect(screen.getByTestId("evidence-list")).toHaveTextContent("REST action 19");
    expect(screen.queryByTestId("evidence-row-action-rest-24")).toBeNull();

    fireEvent.click(screen.getByTestId("load-more-activity"));

    expect(screen.getByTestId("evidence-row-action-rest-24")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("open-filters-editor"));
    fireEvent.click(screen.getByTestId("quick-filter-ftp"));

    expect(screen.getAllByTestId("filters-result-count").map((element) => element.textContent)).toContain("0 of 25");
    expect(screen.queryByTestId("evidence-row-action-rest-24")).toBeNull();
    expect(screen.getByTestId("evidence-list")).toHaveTextContent("No matching activity.");
  });

  it("adds REST and FTP quick filters that narrow activity by contributor", () => {
    setViewportWidth(600);
    const now = Date.now();

    renderDialog({
      errorLogs: [],
      logs: [],
      traceEvents: [],
      actionSummaries: [
        {
          correlationId: "rest-action",
          actionName: "REST refresh",
          origin: "user" as const,
          originalOrigin: "user" as const,
          startTimestamp: new Date(now).toISOString(),
          endTimestamp: new Date(now + 10).toISOString(),
          durationMs: 10,
          outcome: "success" as const,
          startRelativeMs: 0,
          effects: [
            {
              type: "REST" as const,
              label: "GET /v1/info",
              method: "GET",
              path: "/v1/info",
              target: null,
              status: 200,
              durationMs: 10,
            },
          ],
        },
        {
          correlationId: "ftp-action",
          actionName: "FTP list",
          origin: "user" as const,
          originalOrigin: "user" as const,
          startTimestamp: new Date(now - 1000).toISOString(),
          endTimestamp: new Date(now - 990).toISOString(),
          durationMs: 10,
          outcome: "success" as const,
          startRelativeMs: 1,
          effects: [
            {
              type: "FTP" as const,
              label: "LIST /USB0",
              operation: "LIST",
              command: "LIST",
              hostname: "c64u",
              port: 21,
              path: "/USB0",
              target: null,
              result: "success",
              durationMs: 10,
            },
          ],
        },
      ],
    });

    fireEvent.click(screen.getByTestId("open-filters-editor"));
    fireEvent.click(screen.getByTestId("quick-filter-rest"));
    expect(screen.getByTestId("evidence-list")).toHaveTextContent("REST refresh");
    expect(screen.getByTestId("evidence-list")).not.toHaveTextContent("FTP list");

    fireEvent.click(screen.getByTestId("quick-filter-ftp"));
    expect(screen.getByTestId("evidence-list")).toHaveTextContent("FTP list");
    expect(screen.getByTestId("evidence-list")).not.toHaveTextContent("REST refresh");

    fireEvent.click(screen.getByTestId("quick-filter-reset"));
    expect(screen.getByTestId("evidence-list")).toHaveTextContent("REST refresh");
    expect(screen.getByTestId("evidence-list")).toHaveTextContent("FTP list");
  });

  it("filters REST, FTP, and TELNET traces by contributor and shows their transport detail", () => {
    setViewportWidth(600);
    const now = Date.now();

    renderDialog({
      defaultEvidenceTypes: new Set(["Traces"]),
      errorLogs: [],
      logs: [],
      actionSummaries: [],
      traceEvents: [
        {
          id: "trace-rest-info",
          timestamp: new Date(now + 500).toISOString(),
          relativeMs: 0,
          type: "rest-response",
          origin: "system",
          correlationId: "health-check-rest",
          data: {
            lifecycleState: "foreground",
            sourceKind: null,
            localAccessMode: null,
            trackInstanceId: null,
            playlistItemId: null,
            method: "GET",
            hostname: "u64",
            port: 80,
            path: "/v1/info",
            query: "?detail=full",
            status: 200,
            durationMs: 42,
            body: { product: "Ultimate 64" },
          },
        },
        {
          id: "trace-telnet-health",
          timestamp: new Date(now).toISOString(),
          relativeMs: 1,
          type: "telnet-operation",
          origin: "system",
          correlationId: "health-check-telnet",
          data: {
            lifecycleState: "foreground",
            sourceKind: null,
            localAccessMode: null,
            trackInstanceId: null,
            playlistItemId: null,
            actionId: "health-check",
            actionLabel: "Health check TELNET probe",
            menuPath: ["Diagnostics", "Health check"],
            hostname: "u64",
            port: 23,
            requestPayload: {
              steps: [{ type: "connect", host: "u64", port: 23 }],
            },
            responsePayload: {
              steps: [{ type: "visible-text", text: "No telnet response" }],
            },
            durationMs: 180,
            result: "failure",
            error: "No telnet response",
          },
        },
        {
          id: "trace-ftp-list",
          timestamp: new Date(now - 1000).toISOString(),
          relativeMs: 2,
          type: "ftp-operation",
          origin: "system",
          correlationId: "health-check-ftp",
          data: {
            lifecycleState: "foreground",
            sourceKind: null,
            localAccessMode: null,
            trackInstanceId: null,
            playlistItemId: null,
            operation: "list",
            command: "LIST",
            hostname: "c64u",
            port: 21,
            path: "/",
            requestPayload: { path: "/" },
            responsePayload: { entries: [] },
            durationMs: 90,
            result: "success",
            error: null,
          },
        },
      ],
    });

    fireEvent.click(screen.getByTestId("open-filters-editor"));
    const contributorSection = within(screen.getByTestId("filters-editor-surface"))
      .getByText("Contributor")
      .closest("section");
    if (!contributorSection) {
      throw new Error("Contributor section not found");
    }

    fireEvent.click(within(contributorSection).getByRole("button", { name: "REST" }));

    expect(screen.getByTestId("evidence-list")).toHaveTextContent("Response 200 (42ms)");
    expect(screen.getByTestId("evidence-list")).not.toHaveTextContent("Health check TELNET probe");
    expect(screen.getByTestId("evidence-list")).not.toHaveTextContent("FTP LIST /");

    fireEvent.click(screen.getByTestId("evidence-row-trace-trace-rest-info"));
    expect(screen.getByTestId("evidence-detail-trace-trace-rest-info")).toHaveTextContent('"hostname": "u64"');
    expect(screen.getByTestId("evidence-detail-trace-trace-rest-info")).toHaveTextContent('"query": "?detail=full"');

    fireEvent.click(within(contributorSection).getByRole("button", { name: "FTP" }));

    expect(screen.getByTestId("evidence-list")).toHaveTextContent("FTP LIST /");
    expect(screen.getByTestId("evidence-list")).not.toHaveTextContent("Health check TELNET probe");
    expect(screen.getByTestId("evidence-list")).not.toHaveTextContent("Response 200 (42ms)");

    fireEvent.click(screen.getByTestId("evidence-row-trace-trace-ftp-list"));
    expect(screen.getByTestId("evidence-detail-trace-trace-ftp-list")).toHaveTextContent('"requestPayload"');
    expect(screen.getByTestId("evidence-detail-trace-trace-ftp-list")).toHaveTextContent('"responsePayload"');

    fireEvent.click(within(contributorSection).getByRole("button", { name: "TELNET" }));

    expect(screen.getByTestId("evidence-list")).toHaveTextContent("Health check TELNET probe");
    expect(screen.getByTestId("evidence-list")).not.toHaveTextContent("FTP LIST /");

    fireEvent.click(screen.getByTestId("evidence-row-trace-trace-telnet-health"));
    expect(screen.getByTestId("evidence-detail-trace-trace-telnet-health")).toHaveTextContent('"hostname": "u64"');
    expect(screen.getByTestId("evidence-detail-trace-trace-telnet-health")).toHaveTextContent('"requestPayload"');
    expect(screen.getByTestId("evidence-detail-trace-trace-telnet-health")).toHaveTextContent('"No telnet response"');
  });

  it("suppresses routine system health checks that remain in progress", () => {
    setViewportWidth(600);
    const now = Date.now();

    renderDialog({
      errorLogs: [],
      logs: [],
      traceEvents: [],
      actionSummaries: [
        {
          correlationId: "health-check",
          actionName: "click Connected to 192.168.1.13, system healthy",
          origin: "system" as const,
          originalOrigin: "automatic" as const,
          startTimestamp: new Date(now).toISOString(),
          endTimestamp: null,
          durationMs: null,
          outcome: "in_progress" as const,
          startRelativeMs: 0,
          effects: [],
        },
      ],
    });

    expect(screen.queryByTestId("evidence-row-action-health-check")).toBeNull();
    expect(screen.getByTestId("evidence-list")).toHaveTextContent("No matching activity.");
  });
});
