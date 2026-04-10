/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UnifiedHealthBadge } from "@/components/UnifiedHealthBadge";

const mockState = vi.hoisted(() => ({
  healthState: {
    state: "Degraded" as const,
    connectivity: "Online" as const,
    connectedDeviceLabel: "C64U",
    problemCount: 3,
    host: "c64u",
    contributors: {
      App: { state: "Idle" as const, problemCount: 0, totalOperations: 0, failedOperations: 0 },
      REST: { state: "Degraded" as const, problemCount: 3, totalOperations: 10, failedOperations: 3 },
      FTP: { state: "Idle" as const, problemCount: 0, totalOperations: 0, failedOperations: 0 },
    },
    lastRestActivity: null,
    lastFtpActivity: null,
    primaryProblem: null,
  },
  currentProfile: "compact",
  connectionStatus: {
    state: "REAL_CONNECTED",
    deviceInfo: { product: "C64 Ultimate", errors: [] as string[] },
  },
  savedDevices: {
    devices: [
      {
        id: "device-office",
        name: "Office U64",
        host: "c64u",
        httpPort: 80,
        ftpPort: 21,
        telnetPort: 23,
        hasPassword: false,
        lastKnownProduct: "U64",
        lastKnownHostname: "office-u64",
        lastKnownUniqueId: "UID-OFFICE",
      },
      {
        id: "device-backup",
        name: "Backup Lab",
        host: "backup-c64",
        httpPort: 8080,
        ftpPort: 2021,
        telnetPort: 2323,
        hasPassword: false,
        lastKnownProduct: "U64E",
        lastKnownHostname: "backup-lab",
        lastKnownUniqueId: "UID-BACKUP",
      },
    ],
    selectedDeviceId: "device-office",
    verifiedByDeviceId: {
      "device-office": {
        product: "U64",
        hostname: "office-u64",
        unique_id: "UID-OFFICE",
      },
      "device-backup": {
        product: "U64E",
        hostname: "backup-lab",
        unique_id: "UID-BACKUP",
      },
    },
    switchSummaryByDeviceId: {},
    summaryOrder: [],
  },
  switchSavedDevice: vi.fn(),
  requestDiagnosticsOpen: vi.fn(),
  savedDeviceHealthChecks: {
    byDeviceId: {
      "device-office": {
        running: false,
        latestResult: {
          runId: "hcr-0001",
          startTimestamp: "2026-01-01T12:00:00.000Z",
          endTimestamp: "2026-01-01T12:00:01.000Z",
          totalDurationMs: 1000,
          overallHealth: "Healthy",
          connectivity: "Online",
          probes: {
            REST: { probe: "REST", outcome: "Success", durationMs: 100, reason: null, startMs: 1 },
            FTP: { probe: "FTP", outcome: "Success", durationMs: 100, reason: null, startMs: 2 },
            TELNET: { probe: "TELNET", outcome: "Success", durationMs: 100, reason: null, startMs: 3 },
            CONFIG: { probe: "CONFIG", outcome: "Skipped", durationMs: null, reason: "Passive", startMs: 4 },
            RASTER: { probe: "RASTER", outcome: "Success", durationMs: 100, reason: null, startMs: 5 },
            JIFFY: { probe: "JIFFY", outcome: "Success", durationMs: 100, reason: null, startMs: 6 },
          },
          latency: { p50: 100, p90: 100, p99: 100 },
          deviceInfo: {
            firmware: "3.11",
            fpga: "1.42",
            core: "C64",
            uptimeSeconds: 256,
            product: "Ultimate 64 Elite",
          },
        },
        liveProbes: null,
        probeStates: {
          REST: { state: "PENDING", outcome: null, startedAt: null, endedAt: null, durationMs: null, reason: null },
          FTP: { state: "PENDING", outcome: null, startedAt: null, endedAt: null, durationMs: null, reason: null },
          TELNET: { state: "PENDING", outcome: null, startedAt: null, endedAt: null, durationMs: null, reason: null },
          CONFIG: { state: "PENDING", outcome: null, startedAt: null, endedAt: null, durationMs: null, reason: null },
          RASTER: { state: "PENDING", outcome: null, startedAt: null, endedAt: null, durationMs: null, reason: null },
          JIFFY: { state: "PENDING", outcome: null, startedAt: null, endedAt: null, durationMs: null, reason: null },
        },
        lastStartedAt: "2026-01-01T12:00:00.000Z",
        lastCompletedAt: "2026-01-01T12:00:01.000Z",
        error: null,
      },
      "device-backup": {
        running: true,
        latestResult: null,
        liveProbes: {
          REST: { probe: "REST", outcome: "Success", durationMs: 80, reason: null, startMs: 1 },
          FTP: { probe: "FTP", outcome: "Success", durationMs: 50, reason: null, startMs: 2 },
        },
        probeStates: {
          REST: {
            state: "SUCCESS",
            outcome: "Success",
            startedAt: "2026-01-01T12:00:00.000Z",
            endedAt: "2026-01-01T12:00:00.080Z",
            durationMs: 80,
            reason: null,
          },
          FTP: {
            state: "SUCCESS",
            outcome: "Success",
            startedAt: "2026-01-01T12:00:00.081Z",
            endedAt: "2026-01-01T12:00:00.130Z",
            durationMs: 50,
            reason: null,
          },
          TELNET: {
            state: "RUNNING",
            outcome: null,
            startedAt: "2026-01-01T12:00:00.131Z",
            endedAt: null,
            durationMs: null,
            reason: null,
          },
          CONFIG: { state: "PENDING", outcome: null, startedAt: null, endedAt: null, durationMs: null, reason: null },
          RASTER: { state: "PENDING", outcome: null, startedAt: null, endedAt: null, durationMs: null, reason: null },
          JIFFY: { state: "PENDING", outcome: null, startedAt: null, endedAt: null, durationMs: null, reason: null },
        },
        lastStartedAt: "2026-01-01T12:00:00.000Z",
        lastCompletedAt: null,
        error: null,
      },
    },
    cycle: {
      running: true,
      lastStartedAt: "2026-01-01T12:00:00.000Z",
      lastCompletedAt: "2026-01-01T11:59:50.000Z",
    },
    refreshAll: vi.fn(),
    totalProbeCount: 6,
  },
}));

vi.mock("@/hooks/useHealthState", () => ({
  useHealthState: () => mockState.healthState,
}));

vi.mock("@/hooks/useDisplayProfile", () => ({
  useDisplayProfile: () => ({ profile: mockState.currentProfile }),
}));

vi.mock("@/hooks/useC64Connection", () => ({
  useC64Connection: () => ({
    status: mockState.connectionStatus,
  }),
}));

vi.mock("@/hooks/useSavedDevices", () => ({
  useSavedDevices: () => mockState.savedDevices,
}));

vi.mock("@/hooks/useSavedDeviceSwitching", () => ({
  useSavedDeviceSwitching: () => mockState.switchSavedDevice,
}));

vi.mock("@/hooks/useSavedDeviceHealthChecks", () => ({
  useSavedDeviceHealthChecks: () => mockState.savedDeviceHealthChecks,
}));

vi.mock("@/lib/diagnostics/diagnosticsOverlay", () => ({
  requestDiagnosticsOpen: mockState.requestDiagnosticsOpen,
}));

describe("UnifiedHealthBadge", () => {
  beforeEach(() => {
    mockState.currentProfile = "compact";
    (mockState.healthState as { state: string }).state = "Degraded";
    (mockState.healthState as { connectivity: string }).connectivity = "Online";
    mockState.healthState.connectedDeviceLabel = "C64U";
    mockState.healthState.problemCount = 3;
    mockState.connectionStatus.state = "REAL_CONNECTED";
    mockState.connectionStatus.deviceInfo = { product: "C64 Ultimate", errors: [] };
    mockState.savedDevices.selectedDeviceId = "device-office";
    mockState.switchSavedDevice.mockReset();
    mockState.requestDiagnosticsOpen.mockReset();
    mockState.savedDeviceHealthChecks.refreshAll.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders capped counts exactly once on compact and medium profiles", () => {
    mockState.healthState.problemCount = 1000;

    for (const profile of ["compact", "medium"] as const) {
      mockState.currentProfile = profile;
      const { unmount } = render(<UnifiedHealthBadge />);
      const badge = screen.getByTestId("unified-health-badge");
      const textContent = badge.textContent ?? "";

      expect(textContent).toContain("999+");
      expect(textContent).toMatch(/C64U\s+\S+\s+999\+/);
      expect(textContent).not.toContain("1000");
      expect(textContent.match(/999\+/g)).toHaveLength(1);

      unmount();
    }
  });

  it("renders the expanded problem suffix without a separate count span", () => {
    mockState.currentProfile = "expanded";
    mockState.healthState.problemCount = 12;
    render(<UnifiedHealthBadge />);

    const badge = screen.getByTestId("unified-health-badge");
    const textContent = badge.textContent ?? "";

    expect(textContent).toContain("Degraded · 12 problems");
    expect(textContent.match(/12/g)).toHaveLength(1);
    expect(badge.querySelectorAll('[data-overlay-critical="badge"]')).toHaveLength(3);
  });

  it("keeps connectivity text neutral while the health signal stays colored", () => {
    mockState.currentProfile = "medium";
    render(<UnifiedHealthBadge />);

    const badge = screen.getByTestId("unified-health-badge");
    const spans = badge.querySelectorAll('[data-overlay-critical="badge"]');

    expect(spans[0]?.className).toContain("text-foreground");
    expect(spans[1]?.className).toContain("text-amber-500");
    expect(spans[1]?.className).toContain("h-[1em]");
    expect(spans[2]?.className).toContain("text-amber-500");
    expect(spans[3]?.className).toContain("text-foreground");
  });

  it("keeps nowrap and overflow containment classes on the badge", () => {
    mockState.currentProfile = "medium";
    mockState.healthState.problemCount = 1808;
    render(<UnifiedHealthBadge />);

    const badge = screen.getByTestId("unified-health-badge");
    expect(badge.className).toContain("min-w-0");
    expect(badge.className).toContain("max-w-full");
    expect(badge.className).toContain("overflow-hidden");
    expect(badge.querySelectorAll('[data-overlay-critical="badge"]')).toHaveLength(4);
    expect(badge.querySelector(".app-chrome-badge-surface")?.className).toContain("py-[0.3rem]");
    expect(badge.querySelector(".app-chrome-badge-surface span")?.className).toContain("whitespace-nowrap");
    expect(badge.querySelector('[data-overlay-critical="badge"]')?.className).toContain("truncate");
  });

  it("caps compact badge width so the app bar can shrink without overflowing", () => {
    mockState.currentProfile = "compact";
    mockState.healthState.connectedDeviceLabel = "Ultimate-64-Elite-Living-Room";
    render(<UnifiedHealthBadge />);

    const badge = screen.getByTestId("unified-health-badge");

    expect(badge.className).toContain("max-w-[min(48vw,12rem)]");
    expect(badge.className).toContain("shrink");
  });

  it("renders as a bordered chrome control while preserving the 44px hit target", () => {
    mockState.currentProfile = "medium";
    render(<UnifiedHealthBadge />);

    const badge = screen.getByTestId("unified-health-badge");
    const surface = badge.querySelector(".app-chrome-badge-surface");

    expect(badge.className).toContain("app-chrome-badge");
    expect(badge.className).toContain("bg-transparent");
    expect(badge.className).toContain("min-h-[44px]");
    expect(surface?.className).toContain("app-chrome-badge-surface");
    expect(surface?.className).toContain("px-2");
  });

  it("keeps the leading device label visible", () => {
    mockState.currentProfile = "medium";
    (mockState.healthState as { state: string }).state = "Healthy";
    mockState.healthState.problemCount = 0;
    mockState.healthState.connectedDeviceLabel = "U64E2";
    mockState.connectionStatus.deviceInfo = { product: "Ultimate 64-II", errors: [] };
    render(<UnifiedHealthBadge />);

    const badge = screen.getByTestId("unified-health-badge");
    expect(badge).toHaveAttribute("data-connected-device", "U64E2");
    expect(badge.querySelectorAll('[data-overlay-critical="badge"]')[0]?.textContent).toBe("U64E2");
  });

  it("makes the healthy glyph optically larger than the degraded glyph", () => {
    mockState.currentProfile = "medium";
    (mockState.healthState as { state: string }).state = "Healthy";
    mockState.healthState.problemCount = 0;
    const { unmount } = render(<UnifiedHealthBadge />);

    let glyph = screen.getByTestId("unified-health-badge").querySelectorAll('[data-overlay-critical="badge"]')[1];
    expect(glyph?.className).toContain("scale-[1.42]");
    expect(glyph?.className).toContain("translate-y-[-0.11em]");

    unmount();

    (mockState.healthState as { state: string }).state = "Degraded";
    mockState.healthState.problemCount = 3;
    render(<UnifiedHealthBadge />);

    glyph = screen.getByTestId("unified-health-badge").querySelectorAll('[data-overlay-critical="badge"]')[1];
    expect(glyph?.className).toContain("scale-100");
    expect(glyph?.className).toContain("translate-y-[-0.03em]");
  });

  it("keeps the badge data contract stable when online device labeling is unavailable", () => {
    mockState.currentProfile = "medium";
    (mockState.healthState as { state: string }).state = "Healthy";
    mockState.healthState.problemCount = 0;
    mockState.healthState.connectedDeviceLabel = null;
    mockState.connectionStatus.deviceInfo = { product: "Ultimate 64-II", errors: [] };
    render(<UnifiedHealthBadge />);

    expect(screen.getByTestId("unified-health-badge")).not.toHaveAttribute("data-connected-device");
  });

  it("renders offline and not-yet-connected special copy unchanged", () => {
    (mockState.healthState as { connectivity: string }).connectivity = "Offline";
    (mockState.healthState as { state: string }).state = "Unavailable";
    mockState.currentProfile = "expanded";
    const { unmount } = render(<UnifiedHealthBadge />);

    expect(screen.getByTestId("unified-health-badge").textContent).toContain("Offline ◌ Device not reachable");

    unmount();

    (mockState.healthState as { connectivity: string }).connectivity = "Not yet connected";
    (mockState.healthState as { state: string }).state = "Idle";
    mockState.currentProfile = "medium";
    render(<UnifiedHealthBadge />);

    expect(screen.getByTestId("unified-health-badge").textContent).toBe("Not connected ○");
  });

  it("clicking the badge calls requestDiagnosticsOpen with 'header'", () => {
    mockState.currentProfile = "compact";
    render(<UnifiedHealthBadge />);

    fireEvent.click(screen.getByTestId("unified-health-badge"));

    expect(mockState.requestDiagnosticsOpen).toHaveBeenCalledWith("header");
  });

  it("opens the switch picker on long press without also opening diagnostics", async () => {
    vi.useFakeTimers();
    render(<UnifiedHealthBadge />);

    const badge = screen.getByTestId("unified-health-badge");
    fireEvent.pointerDown(badge);
    await vi.advanceTimersByTimeAsync(450);

    expect(screen.getByTestId("switch-device-sheet")).toBeVisible();

    fireEvent.pointerUp(badge);
    fireEvent.click(badge);

    expect(mockState.requestDiagnosticsOpen).not.toHaveBeenCalled();
  });

  it("keeps the switcher hidden when only one saved device exists", async () => {
    vi.useFakeTimers();
    const originalDevices = mockState.savedDevices.devices;
    mockState.savedDevices.devices = [originalDevices[0]];

    render(<UnifiedHealthBadge />);

    const badge = screen.getByTestId("unified-health-badge");
    fireEvent.pointerDown(badge);
    await vi.advanceTimersByTimeAsync(450);

    expect(screen.queryByTestId("switch-device-sheet")).toBeNull();

    mockState.savedDevices.devices = originalDevices;
  });

  it("switches devices from the picker and closes the dialog", async () => {
    vi.useFakeTimers();
    mockState.switchSavedDevice.mockResolvedValueOnce(undefined);
    render(<UnifiedHealthBadge />);

    const badge = screen.getByTestId("unified-health-badge");
    fireEvent.pointerDown(badge);
    await vi.advanceTimersByTimeAsync(450);

    fireEvent.click(screen.getByTestId("switch-device-row-device-backup"));
    expect(mockState.switchSavedDevice).toHaveBeenCalledWith("device-backup");

    vi.useRealTimers();
    await waitFor(() => {
      expect(screen.queryByTestId("switch-device-sheet")).toBeNull();
    });
  });

  it("still lets users switch to an unhealthy saved device", async () => {
    vi.useFakeTimers();
    const previousSnapshot = mockState.savedDeviceHealthChecks.byDeviceId["device-backup"];
    const healthyReference = mockState.savedDeviceHealthChecks.byDeviceId["device-office"].latestResult;

    mockState.savedDeviceHealthChecks.byDeviceId["device-backup"] = {
      ...previousSnapshot,
      running: false,
      latestResult: {
        ...healthyReference,
        runId: "hcr-0002",
        overallHealth: "Unhealthy",
        probes: {
          ...healthyReference.probes,
          FTP: {
            ...healthyReference.probes.FTP,
            outcome: "Fail",
            durationMs: 240,
            reason: "FTP timeout",
          },
          RASTER: {
            ...healthyReference.probes.RASTER,
            outcome: "Fail",
            durationMs: 180,
            reason: "Raster probe mismatch",
          },
        },
      },
      liveProbes: null,
      lastCompletedAt: "2026-01-01T12:00:02.000Z",
      error: null,
    };
    mockState.switchSavedDevice.mockResolvedValueOnce(undefined);

    render(<UnifiedHealthBadge />);

    const badge = screen.getByTestId("unified-health-badge");
    fireEvent.pointerDown(badge);
    await vi.advanceTimersByTimeAsync(450);

    expect(screen.getByTestId("switch-device-status-device-backup").textContent).toContain("Unhealthy");

    fireEvent.click(screen.getByTestId("switch-device-row-device-backup"));
    expect(mockState.switchSavedDevice).toHaveBeenCalledWith("device-backup");

    vi.useRealTimers();
    await waitFor(() => {
      expect(screen.queryByTestId("switch-device-sheet")).toBeNull();
    });

    mockState.savedDeviceHealthChecks.byDeviceId["device-backup"] = previousSnapshot;
  });

  it("renders collapsed switcher health summaries and auto-refreshes on open", async () => {
    vi.useFakeTimers();
    render(<UnifiedHealthBadge />);

    const badge = screen.getByTestId("unified-health-badge");
    fireEvent.pointerDown(badge);
    await vi.advanceTimersByTimeAsync(450);

    expect(screen.queryByText("Checking all saved devices")).toBeNull();
    expect(screen.queryByText("Saved-device health")).toBeNull();
    expect(mockState.savedDeviceHealthChecks.refreshAll).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("switch-device-refresh-all")).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(screen.getByTestId("switch-device-status-device-office").textContent).toContain("Online");
    expect(screen.getByTestId("switch-device-status-device-office").textContent).toContain("Healthy");
    expect(screen.getByTestId("switch-device-status-device-backup").textContent).toContain("Checking");
    expect(screen.getByTestId("switch-device-status-device-backup").textContent).not.toContain("Idle");
    expect(screen.getByTestId("switch-device-row-device-office").textContent).toContain("Last check");
    expect(screen.getByTestId("switch-device-row-device-backup").textContent).toContain("2/6 probes");
  });

  it("uses the app's stronger selected treatment for the active switch-device card", async () => {
    vi.useFakeTimers();
    render(<UnifiedHealthBadge />);

    const badge = screen.getByTestId("unified-health-badge");
    fireEvent.pointerDown(badge);
    await vi.advanceTimersByTimeAsync(450);

    const selectedCard = screen.getByTestId("switch-device-row-device-office").closest("[data-selected]");
    const otherCard = screen.getByTestId("switch-device-row-device-backup").closest("[data-selected]");

    expect(selectedCard).toHaveAttribute("data-selected", "true");
    expect(selectedCard?.className).toContain("bg-primary/10");
    expect(selectedCard?.className).toContain("ring-1");
    expect(selectedCard?.className).toContain("ring-primary/35");
    expect(otherCard).toHaveAttribute("data-selected", "false");
  });

  it("keeps switcher badges on their own line for compact and medium profiles", async () => {
    vi.useFakeTimers();

    for (const profile of ["compact", "medium"] as const) {
      mockState.currentProfile = profile;
      const { unmount } = render(<UnifiedHealthBadge />);

      const badge = screen.getByTestId("unified-health-badge");
      fireEvent.pointerDown(badge);
      await vi.advanceTimersByTimeAsync(450);

      const row = screen.getByTestId("switch-device-row-device-office");
      expect(row).toHaveAttribute("data-badge-layout", "stacked");
      expect(row.className).toContain("flex-col");
      expect(row.className).not.toContain("justify-between");

      unmount();
      vi.clearAllTimers();
    }
  });

  it("keeps switcher badges inline on expanded profile", async () => {
    vi.useFakeTimers();
    mockState.currentProfile = "expanded";
    render(<UnifiedHealthBadge />);

    const badge = screen.getByTestId("unified-health-badge");
    fireEvent.pointerDown(badge);
    await vi.advanceTimersByTimeAsync(450);

    const row = screen.getByTestId("switch-device-row-device-office");
    expect(row).toHaveAttribute("data-badge-layout", "inline");
    expect(row.className).toContain("justify-between");
    expect(row.className).not.toContain("flex-col");
  });

  it("expands a device row into the shared health detail view", async () => {
    vi.useFakeTimers();
    render(<UnifiedHealthBadge />);

    const badge = screen.getByTestId("unified-health-badge");
    fireEvent.pointerDown(badge);
    await vi.advanceTimersByTimeAsync(450);

    const expandButton = screen.getByTestId("switch-device-expand-device-office");
    expect(expandButton).toHaveAttribute("aria-label", "Expand device health detail");

    fireEvent.click(expandButton);

    expect(screen.getByTestId("health-check-detail-view")).toBeVisible();
    expect(screen.getByText("Device health detail")).toBeVisible();
    expect(screen.queryByTestId("health-check-detail-back")).toBeNull();
    expect(screen.getByTestId("switch-device-expand-device-office")).toHaveAttribute(
      "aria-label",
      "Collapse device health detail",
    );
    expect(screen.getByTestId("health-check-probe-config").textContent).toContain("Passive");
  });

  it("resets expanded device details when the picker closes", async () => {
    vi.useFakeTimers();
    render(<UnifiedHealthBadge />);

    const badge = screen.getByTestId("unified-health-badge");
    fireEvent.pointerDown(badge);
    await vi.advanceTimersByTimeAsync(450);

    fireEvent.click(screen.getByTestId("switch-device-expand-device-office"));
    expect(screen.getByTestId("health-check-detail-view")).toBeVisible();

    fireEvent.click(within(screen.getByTestId("switch-device-sheet")).getByRole("button", { name: "Close" }));

    vi.useRealTimers();
    await waitFor(() => {
      expect(screen.queryByTestId("switch-device-sheet")).toBeNull();
    });

    vi.useFakeTimers();
    fireEvent.pointerDown(badge);
    await vi.advanceTimersByTimeAsync(450);

    expect(screen.queryByTestId("health-check-detail-view")).toBeNull();
    expect(screen.getByTestId("switch-device-expand-device-office")).toHaveAttribute("aria-expanded", "false");
  });
});
