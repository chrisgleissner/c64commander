/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

    expect(screen.getByTestId("switch-device-dialog")).toBeVisible();

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

    expect(screen.queryByTestId("switch-device-dialog")).toBeNull();

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
      expect(screen.queryByTestId("switch-device-dialog")).toBeNull();
    });
  });
});
