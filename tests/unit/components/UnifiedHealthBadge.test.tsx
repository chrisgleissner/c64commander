/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UnifiedHealthBadge } from "@/components/UnifiedHealthBadge";

// Mock health state hook
const mockHealthState = {
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
};

let currentProfile = "compact";
const mockConnectionStatus = {
  state: "REAL_CONNECTED",
  deviceInfo: { product: "C64 Ultimate", errors: [] as string[] },
};

vi.mock("@/hooks/useHealthState", () => ({
  useHealthState: () => mockHealthState,
}));

vi.mock("@/hooks/useDisplayProfile", () => ({
  useDisplayProfile: () => ({ profile: currentProfile }),
}));

vi.mock("@/hooks/useC64Connection", () => ({
  useC64Connection: () => ({
    status: mockConnectionStatus,
  }),
}));

vi.mock("@/lib/diagnostics/diagnosticsOverlay", () => ({
  requestDiagnosticsOpen: vi.fn(),
}));

describe("UnifiedHealthBadge", () => {
  beforeEach(() => {
    currentProfile = "compact";
    (mockHealthState as { state: string }).state = "Degraded";
    (mockHealthState as { connectivity: string }).connectivity = "Online";
    mockHealthState.connectedDeviceLabel = "C64U";
    mockHealthState.problemCount = 3;
    mockConnectionStatus.state = "REAL_CONNECTED";
    mockConnectionStatus.deviceInfo = { product: "C64 Ultimate", errors: [] };
  });

  it("renders capped counts exactly once on compact and medium profiles", () => {
    mockHealthState.problemCount = 1000;

    for (const profile of ["compact", "medium"] as const) {
      currentProfile = profile;
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
    currentProfile = "expanded";
    mockHealthState.problemCount = 12;
    render(<UnifiedHealthBadge />);

    const badge = screen.getByTestId("unified-health-badge");
    const textContent = badge.textContent ?? "";

    expect(textContent).toContain("Degraded · 12 problems");
    expect(textContent.match(/12/g)).toHaveLength(1);
    expect(badge.querySelectorAll('[data-overlay-critical="badge"]')).toHaveLength(3);
  });

  it("keeps connectivity text neutral while the health signal stays colored", () => {
    currentProfile = "medium";
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
    currentProfile = "medium";
    mockHealthState.problemCount = 1808;
    render(<UnifiedHealthBadge />);

    const badge = screen.getByTestId("unified-health-badge");
    expect(badge.className).toContain("min-w-0");
    expect(badge.className).toContain("max-w-full");
    expect(badge.className).toContain("overflow-hidden");
    expect(badge.querySelectorAll('[data-overlay-critical="badge"]')).toHaveLength(4);
    expect(badge.querySelector(".app-chrome-badge-surface")?.className).toContain("py-[0.3rem]");
    expect(badge.querySelector(".app-chrome-badge-surface span")?.className).toContain("whitespace-nowrap");
  });

  it("renders as a bordered chrome control while preserving the 44px hit target", () => {
    currentProfile = "medium";
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
    currentProfile = "medium";
    (mockHealthState as { state: string }).state = "Healthy";
    mockHealthState.problemCount = 0;
    mockHealthState.connectedDeviceLabel = "U64E2";
    mockConnectionStatus.deviceInfo = { product: "Ultimate 64-II", errors: [] };
    render(<UnifiedHealthBadge />);

    const badge = screen.getByTestId("unified-health-badge");
    expect(badge).toHaveAttribute("data-connected-device", "U64E2");
    expect(badge.querySelectorAll('[data-overlay-critical="badge"]')[0]?.textContent).toBe("U64E2");
  });

  it("makes the healthy glyph optically larger than the degraded glyph", () => {
    currentProfile = "medium";
    (mockHealthState as { state: string }).state = "Healthy";
    mockHealthState.problemCount = 0;
    const { unmount } = render(<UnifiedHealthBadge />);

    let glyph = screen.getByTestId("unified-health-badge").querySelectorAll('[data-overlay-critical="badge"]')[1];
    expect(glyph?.className).toContain("scale-[1.42]");
    expect(glyph?.className).toContain("translate-y-[-0.11em]");

    unmount();

    (mockHealthState as { state: string }).state = "Degraded";
    mockHealthState.problemCount = 3;
    render(<UnifiedHealthBadge />);

    glyph = screen.getByTestId("unified-health-badge").querySelectorAll('[data-overlay-critical="badge"]')[1];
    expect(glyph?.className).toContain("scale-100");
    expect(glyph?.className).toContain("translate-y-[-0.03em]");
  });

  it("keeps the badge data contract stable when online device labeling is unavailable", () => {
    currentProfile = "medium";
    (mockHealthState as { state: string }).state = "Healthy";
    mockHealthState.problemCount = 0;
    mockHealthState.connectedDeviceLabel = null;
    mockConnectionStatus.deviceInfo = { product: "Ultimate 64-II", errors: [] };
    render(<UnifiedHealthBadge />);

    expect(screen.getByTestId("unified-health-badge")).not.toHaveAttribute("data-connected-device");
  });

  it("renders offline and not-yet-connected special copy unchanged", () => {
    (mockHealthState as { connectivity: string }).connectivity = "Offline";
    (mockHealthState as { state: string }).state = "Unavailable";
    currentProfile = "expanded";
    const { unmount } = render(<UnifiedHealthBadge />);

    expect(screen.getByTestId("unified-health-badge").textContent).toContain("Offline ◌ Device not reachable");

    unmount();

    (mockHealthState as { connectivity: string }).connectivity = "Not yet connected";
    (mockHealthState as { state: string }).state = "Idle";
    currentProfile = "medium";
    render(<UnifiedHealthBadge />);

    expect(screen.getByTestId("unified-health-badge").textContent).toBe("Not connected ○");
  });

  it("clicking the badge calls requestDiagnosticsOpen with 'header'", async () => {
    const { requestDiagnosticsOpen } = await import("@/lib/diagnostics/diagnosticsOverlay");
    currentProfile = "compact";
    render(<UnifiedHealthBadge />);

    fireEvent.click(screen.getByTestId("unified-health-badge"));

    expect(requestDiagnosticsOpen).toHaveBeenCalledWith("header");
  });
});
