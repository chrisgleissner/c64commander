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

  it("renders connectivity before the health signal on medium profile", () => {
    currentProfile = "medium";
    render(<UnifiedHealthBadge />);

    const badge = screen.getByTestId("unified-health-badge");
    expect(badge.textContent).toContain("C64U▲3Degraded");
  });

  it("renders count digit exactly once on compact profile (no duplication)", () => {
    currentProfile = "compact";
    render(<UnifiedHealthBadge />);

    const badge = screen.getByTestId("unified-health-badge");
    const textContent = badge.textContent ?? "";
    // Count "3" should appear exactly once, not twice
    const matches = textContent.match(/3/g);
    expect(matches).toHaveLength(1);
  });

  it("renders count digit exactly once on medium profile (no duplication)", () => {
    currentProfile = "medium";
    render(<UnifiedHealthBadge />);

    const badge = screen.getByTestId("unified-health-badge");
    const textContent = badge.textContent ?? "";
    // The expanded "3 problems" is NOT rendered on medium — only the digit "3"
    const matches = textContent.match(/3/g);
    expect(matches).toHaveLength(1);
  });

  it("does not render count digit on expanded profile (uses spelled-out form)", () => {
    currentProfile = "expanded";
    render(<UnifiedHealthBadge />);

    const badge = screen.getByTestId("unified-health-badge");
    const textContent = badge.textContent ?? "";
    // Expanded: "3 problems" appears once, no standalone digit
    expect(textContent).toContain("3 problems");
  });

  it("keeps connectivity text neutral while the health signal stays colored", () => {
    currentProfile = "medium";
    render(<UnifiedHealthBadge />);

    const badge = screen.getByTestId("unified-health-badge");
    const spans = badge.querySelectorAll("span");

    expect(spans[0]?.className).toContain("text-foreground");
    expect(spans[1]?.className).toContain("text-amber-500");
    expect(spans[2]?.className).toContain("text-amber-500");
    expect(spans[3]?.className).toContain("text-foreground");
  });

  it("has whitespace-nowrap to prevent badge wrapping", () => {
    currentProfile = "compact";
    render(<UnifiedHealthBadge />);

    const badge = screen.getByTestId("unified-health-badge");
    expect(badge.className).toContain("whitespace-nowrap");
  });

  it("caps count at 99 on compact", () => {
    const original = mockHealthState.problemCount;
    mockHealthState.problemCount = 200;
    currentProfile = "compact";

    render(<UnifiedHealthBadge />);

    const badge = screen.getByTestId("unified-health-badge");
    const textContent = badge.textContent ?? "";
    expect(textContent).toContain("99");
    expect(textContent).not.toContain("200");

    mockHealthState.problemCount = original;
  });

  it("renders Healthy label on medium profile", () => {
    const original = mockHealthState.state;
    (mockHealthState as { state: string }).state = "Healthy";
    mockHealthState.problemCount = 0;
    currentProfile = "medium";

    render(<UnifiedHealthBadge />);

    const badge = screen.getByTestId("unified-health-badge");
    expect(badge.textContent).toContain("Healthy");
    expect(badge.textContent).toContain("C64U●Healthy");

    (mockHealthState as { state: string }).state = original;
  });

  it("renders Idle label on medium profile", () => {
    const original = mockHealthState.state;
    (mockHealthState as { state: string }).state = "Idle";
    mockHealthState.problemCount = 0;
    currentProfile = "medium";

    render(<UnifiedHealthBadge />);

    const badge = screen.getByTestId("unified-health-badge");
    expect(badge.textContent).toContain("Idle");

    (mockHealthState as { state: string }).state = original;
  });

  it("renders Unavailable as ? label on medium profile", () => {
    const original = mockHealthState.state;
    (mockHealthState as { state: string }).state = "Unavailable";
    mockHealthState.problemCount = 0;
    currentProfile = "medium";

    render(<UnifiedHealthBadge />);

    const badge = screen.getByTestId("unified-health-badge");
    expect(badge.textContent).toContain("C64U◌?");

    (mockHealthState as { state: string }).state = original;
  });

  it("renders Unhealthy label on medium profile", () => {
    const original = mockHealthState.state;
    (mockHealthState as { state: string }).state = "Unhealthy";
    mockHealthState.problemCount = 5;
    currentProfile = "medium";

    render(<UnifiedHealthBadge />);

    const badge = screen.getByTestId("unified-health-badge");
    expect(badge.textContent).toContain("Unhealthy");

    (mockHealthState as { state: string }).state = original;
    mockHealthState.problemCount = 3;
  });

  it("renders Unhealthy label on expanded profile", () => {
    const original = mockHealthState.state;
    (mockHealthState as { state: string }).state = "Unhealthy";
    mockHealthState.problemCount = 2;
    currentProfile = "expanded";

    render(<UnifiedHealthBadge />);

    const badge = screen.getByTestId("unified-health-badge");
    expect(badge.textContent).toContain("Unhealthy");
    expect(badge.textContent).toContain("2 problems");

    (mockHealthState as { state: string }).state = original;
    mockHealthState.problemCount = 3;
  });

  it("renders Demo connectivity label on medium profile", () => {
    const original = mockHealthState.connectivity;
    (mockHealthState as { connectivity: string }).connectivity = "Demo";
    currentProfile = "medium";

    render(<UnifiedHealthBadge />);

    const badge = screen.getByTestId("unified-health-badge");
    expect(badge.textContent).toContain("DEMO");
    expect(badge.textContent).toContain("DEMO▲3Degraded");

    (mockHealthState as { connectivity: string }).connectivity = original;
  });

  it("renders Offline label on medium profile", () => {
    const original = mockHealthState.connectivity;
    const originalState = mockHealthState.state;
    (mockHealthState as { connectivity: string }).connectivity = "Offline";
    (mockHealthState as { state: string }).state = "Unavailable";
    currentProfile = "medium";

    render(<UnifiedHealthBadge />);

    const badge = screen.getByTestId("unified-health-badge");
    expect(badge.textContent).toBe("Offline◌");

    (mockHealthState as { connectivity: string }).connectivity = original;
    (mockHealthState as { state: string }).state = originalState;
  });

  it("renders expanded Offline with 'Device not reachable' on expanded profile", () => {
    const original = mockHealthState.connectivity;
    const originalState = mockHealthState.state;
    (mockHealthState as { connectivity: string }).connectivity = "Offline";
    (mockHealthState as { state: string }).state = "Unavailable";
    currentProfile = "expanded";

    render(<UnifiedHealthBadge />);

    const badge = screen.getByTestId("unified-health-badge");
    expect(badge.textContent).toContain("Device not reachable");
    expect(badge.textContent).toContain("Offline◌");

    (mockHealthState as { connectivity: string }).connectivity = original;
    (mockHealthState as { state: string }).state = originalState;
  });

  it("renders not-yet-connected labels before the glyph", () => {
    const original = mockHealthState.connectivity;
    const originalState = mockHealthState.state;
    (mockHealthState as { connectivity: string }).connectivity = "Not yet connected";
    (mockHealthState as { state: string }).state = "Idle";
    currentProfile = "medium";

    render(<UnifiedHealthBadge />);

    const badge = screen.getByTestId("unified-health-badge");
    expect(badge.textContent).toBe("Not connected○");

    (mockHealthState as { connectivity: string }).connectivity = original;
    (mockHealthState as { state: string }).state = originalState;
  });

  it("renders inferred connected-device model instead of a hardcoded C64U label", () => {
    currentProfile = "medium";
    (mockHealthState as { state: string }).state = "Healthy";
    mockHealthState.problemCount = 0;
    mockHealthState.connectedDeviceLabel = "U64E";
    mockConnectionStatus.deviceInfo = { product: "Ultimate 64 Elite", errors: [] };
    render(<UnifiedHealthBadge />);

    const badge = screen.getByTestId("unified-health-badge");
    expect(badge.textContent).toContain("U64E");
    expect(badge).toHaveAttribute("data-connected-device", "U64E");
  });

  it("clicking the badge calls requestDiagnosticsOpen with 'header'", async () => {
    const { requestDiagnosticsOpen } = await import("@/lib/diagnostics/diagnosticsOverlay");
    currentProfile = "compact";
    render(<UnifiedHealthBadge />);

    fireEvent.click(screen.getByTestId("unified-health-badge"));

    expect(requestDiagnosticsOpen).toHaveBeenCalledWith("header");
  });
});
