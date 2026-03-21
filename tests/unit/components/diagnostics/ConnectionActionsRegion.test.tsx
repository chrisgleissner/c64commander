/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/diagnostics/recentTargets", () => ({
  getRecentTargets: vi.fn(() => []),
}));

import {
  ConnectionActionsRegion,
  isRecoveryFirstState,
  type ConnectionActionsCallbacks,
} from "@/components/diagnostics/ConnectionActionsRegion";
import { getRecentTargets } from "@/lib/diagnostics/recentTargets";

describe("isRecoveryFirstState", () => {
  it("treats demo mode as recovery-first so switching to real hardware stays prominent", () => {
    expect(isRecoveryFirstState("Demo")).toBe(true);
  });

  it("keeps online mode collapsed unless there was a recent failure", () => {
    expect(isRecoveryFirstState("Online")).toBe(false);
    expect(isRecoveryFirstState("Online", true)).toBe(true);
  });
});

describe("ConnectionActionsRegion", () => {
  const makeCallbacks = (overrides?: Partial<ConnectionActionsCallbacks>): ConnectionActionsCallbacks => ({
    onRetryConnection: vi.fn().mockResolvedValue({ success: true, message: "Connected" }),
    onSwitchDevice: vi.fn().mockResolvedValue({ success: true, message: "Switched" }),
    ...overrides,
  });

  it("keeps summary mode expanded without rendering the panel toggle", () => {
    render(
      <ConnectionActionsRegion connectivity="Online" currentHost="c64u" callbacks={makeCallbacks()} mode="summary" />,
    );

    expect(screen.queryByTestId("connection-actions-toggle")).not.toBeInTheDocument();
    expect(screen.getByTestId("connection-actions-expanded")).toBeInTheDocument();
  });

  it("surfaces non-Error retry failures as feedback", async () => {
    const callbacks = makeCallbacks({ onRetryConnection: vi.fn().mockRejectedValue("retry failed") });

    render(<ConnectionActionsRegion connectivity="Offline" currentHost="c64u" callbacks={callbacks} defaultExpanded />);

    fireEvent.click(screen.getByTestId("retry-connection-action"));

    await waitFor(() => {
      expect(screen.getByTestId("connection-feedback-message")).toHaveTextContent("retry failed");
    });
  });

  it("surfaces non-Error switch failures as feedback", async () => {
    const callbacks = makeCallbacks({ onSwitchDevice: vi.fn().mockRejectedValue("switch failed") });

    render(<ConnectionActionsRegion connectivity="Online" currentHost="c64u" callbacks={callbacks} defaultExpanded />);

    fireEvent.click(screen.getByTestId("switch-device-toggle"));
    fireEvent.click(screen.getByTestId("switch-device-connect"));

    await waitFor(() => {
      expect(screen.getByTestId("connection-feedback-message")).toHaveTextContent("switch failed");
    });
  });

  it("defaults invalid switch-device ports to 80 and closes the form after success", async () => {
    const callbacks = makeCallbacks();

    render(<ConnectionActionsRegion connectivity="Online" currentHost="c64u" callbacks={callbacks} defaultExpanded />);

    fireEvent.click(screen.getByTestId("switch-device-toggle"));
    fireEvent.change(screen.getByTestId("switch-device-host-input"), { target: { value: "backup-c64" } });
    fireEvent.change(screen.getByTestId("switch-device-port-input"), { target: { value: "0" } });
    fireEvent.click(screen.getByTestId("switch-device-connect"));

    await waitFor(() => {
      expect(callbacks.onSwitchDevice).toHaveBeenCalledWith("backup-c64", 80);
    });

    await waitFor(() => {
      expect(screen.queryByTestId("switch-device-form")).not.toBeInTheDocument();
    });
  });

  it("loads recent targets and connects immediately when one is selected", async () => {
    vi.mocked(getRecentTargets).mockReturnValue([{ host: "spare-c64", modelLabel: "Ultimate 64" }]);
    const callbacks = makeCallbacks();

    render(<ConnectionActionsRegion connectivity="Online" currentHost="c64u" callbacks={callbacks} defaultExpanded />);

    fireEvent.click(screen.getByTestId("switch-device-toggle"));
    fireEvent.click(screen.getByTestId("recent-target-spare-c64"));

    await waitFor(() => {
      expect(callbacks.onSwitchDevice).toHaveBeenCalledWith("spare-c64", 80);
    });
  });
});
