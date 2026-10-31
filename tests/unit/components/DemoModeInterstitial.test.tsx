/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

let demoInterstitialVisible = true;
let demoInterstitialReason: "discovery-failed" | "no-network" | null = "discovery-failed";

const declineDemoMode = vi.fn();
const pinDemoModeByUserChoice = vi.fn();
const updateC64APIConfig = vi.fn();
const buildBaseUrlFromDeviceHost = vi.fn((host: string) => `http://${host}`);
const resolveDeviceHostFromStorage = vi.fn(() => "mydevice.local");
const getC64APIConfigSnapshot = vi.fn(() => ({
  baseUrl: "http://mydevice.local",
  password: "saved-pass",
  deviceHost: "mydevice.local",
}));

vi.mock("@/hooks/useConnectionState", () => ({
  useConnectionState: () => ({ demoInterstitialVisible, demoInterstitialReason }),
}));

vi.mock("@/lib/connection/connectionManager", () => ({
  declineDemoMode: (...args: unknown[]) => declineDemoMode(...args),
  pinDemoModeByUserChoice: (...args: unknown[]) => pinDemoModeByUserChoice(...args),
  discoverConnection: vi.fn(),
}));

vi.mock("@/lib/c64api", () => ({
  buildBaseUrlFromDeviceHost: (...args: unknown[]) => buildBaseUrlFromDeviceHost(args[0] as string),
  normalizeDeviceHost: (host?: string) => {
    const value = (host ?? "").toString().trim();
    if (!value) return "c64u";
    return value.replace(/^https?:\/\//i, "").split("/")[0];
  },
  resolveDeviceHostFromStorage: () => resolveDeviceHostFromStorage(),
  updateC64APIConfig: (...args: unknown[]) => updateC64APIConfig(...args),
  getC64APIConfigSnapshot: () => getC64APIConfigSnapshot(),
}));

let neverConnected = false;
vi.mock("@/lib/connection/demoOfferMemory", () => ({ hasNeverConnectedDevice: () => neverConnected }));

const enterSidPlayer = vi.fn(async () => undefined);
vi.mock("@/lib/appMode/appModeTransitions", () => ({ enterSidPlayer: () => enterSidPlayer() }));

let profileName = "medium";
vi.mock("@/hooks/useDisplayProfile", () => ({ useDisplayProfile: () => ({ profile: profileName }) }));

import { DemoModeInterstitial } from "@/components/DemoModeInterstitial";
import { MODE_COPY } from "@/lib/appMode/copy";
import { saveStartupModeByUser } from "@/lib/appMode/appModeStore";

describe("DemoModeInterstitial", () => {
  beforeEach(() => {
    neverConnected = false;
    profileName = "medium";
    enterSidPlayer.mockClear();
    demoInterstitialVisible = true;
    demoInterstitialReason = "discovery-failed";
    resolveDeviceHostFromStorage.mockReturnValue("mydevice.local");
    getC64APIConfigSnapshot.mockReturnValue({
      baseUrl: "http://mydevice.local",
      password: "saved-pass",
      deviceHost: "mydevice.local",
    });
    declineDemoMode.mockReset();
    pinDemoModeByUserChoice.mockReset();
    updateC64APIConfig.mockReset();
    buildBaseUrlFromDeviceHost.mockImplementation((host: string) => `http://${host}`);
  });

  it("shows the attempted hostname in the description", () => {
    render(<DemoModeInterstitial />);
    expect(screen.getByTestId("demo-interstitial-hostname")).toHaveTextContent("mydevice.local");
    expect(screen.getByTestId("demo-interstitial-message")).toHaveTextContent("mydevice.local");
  });

  it("pre-fills the hostname input with the stored device host", () => {
    render(<DemoModeInterstitial />);
    const input = screen.getByTestId("demo-interstitial-host-input") as HTMLInputElement;
    expect(input.value).toBe("mydevice.local");
  });

  it("Save & retry persists the edited hostname and triggers settings discovery", () => {
    render(<DemoModeInterstitial />);
    const input = screen.getByTestId("demo-interstitial-host-input");
    fireEvent.change(input, { target: { value: "192.0.2.100" } });
    fireEvent.click(screen.getByRole("button", { name: /Save & retry/i }));
    expect(updateC64APIConfig).toHaveBeenCalledWith("http://192.0.2.100", "saved-pass", "192.0.2.100");
    // Choosing a host is turning the simulated device down, and retrying with it.
    expect(declineDemoMode).toHaveBeenCalledWith({ retry: "settings" });
  });

  it("Save & retry with unchanged input uses stored hostname and preserves password", () => {
    render(<DemoModeInterstitial />);
    fireEvent.click(screen.getByRole("button", { name: /Save & retry/i }));
    expect(updateC64APIConfig).toHaveBeenCalledWith("http://mydevice.local", "saved-pass", "mydevice.local");
    expect(declineDemoMode).toHaveBeenCalledWith({ retry: "settings" });
  });

  it("Retry connection declines Demo Mode and retries discovery without persisting hostname", () => {
    render(<DemoModeInterstitial />);
    fireEvent.click(screen.getByRole("button", { name: /Retry connection/i }));
    expect(declineDemoMode).toHaveBeenCalledWith({ retry: "manual" });
    expect(updateC64APIConfig).not.toHaveBeenCalled();
  });

  it("closing the offer declines Demo Mode", () => {
    // Closing used to hide the offer and leave the simulated device standing in.
    render(<DemoModeInterstitial />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(declineDemoMode).toHaveBeenCalledWith();
    expect(pinDemoModeByUserChoice).not.toHaveBeenCalled();
  });

  it("Continue in Demo Mode dismisses without retrying", () => {
    render(<DemoModeInterstitial />);
    fireEvent.click(screen.getByRole("button", { name: /Continue in Demo Mode/i }));
    expect(pinDemoModeByUserChoice).toHaveBeenCalled();
    expect(declineDemoMode).not.toHaveBeenCalled();
    expect(updateC64APIConfig).not.toHaveBeenCalled();
  });

  it("with no network, explains the network is missing instead of naming a host", () => {
    demoInterstitialReason = "no-network";
    render(<DemoModeInterstitial />);

    // The description element is sr-only in this app, so the words the user actually sees are the
    // ones that matter: a confirmation dialog whose visible body is empty asks nothing.
    expect(screen.getByTestId("demo-interstitial-message")).toHaveTextContent(/no network connection/i);
    expect(screen.getByTestId("demo-interstitial-description")).toHaveTextContent(/no network connection/i);
    expect(screen.queryByTestId("demo-interstitial-hostname")).toBeNull();
  });

  it("with no network, drops the hostname field and Save & retry", () => {
    demoInterstitialReason = "no-network";
    render(<DemoModeInterstitial />);

    // Editing a hostname or re-saving it cannot make a device reachable while the platform
    // reports no network at all, so neither control is offered.
    expect(screen.queryByTestId("demo-interstitial-host-input")).toBeNull();
    expect(screen.queryByTestId("demo-interstitial-save-retry")).toBeNull();
  });

  it("with no network, Continue in Demo Mode still confirms entry", () => {
    demoInterstitialReason = "no-network";
    render(<DemoModeInterstitial />);

    fireEvent.click(screen.getByTestId("demo-interstitial-continue"));

    expect(pinDemoModeByUserChoice).toHaveBeenCalledTimes(1);
  });

  it("with no network, Try again re-runs discovery", () => {
    demoInterstitialReason = "no-network";
    render(<DemoModeInterstitial />);

    fireEvent.click(screen.getByTestId("demo-interstitial-retry"));

    expect(declineDemoMode).toHaveBeenCalledTimes(1);
    expect(declineDemoMode).toHaveBeenCalledWith({ retry: "manual" });
  });

  it("renders nothing when interstitial is not visible", () => {
    demoInterstitialVisible = false;
    const { container } = render(<DemoModeInterstitial />);
    expect(container.firstChild).toBeNull();
  });

  it("shows validation error when Save & retry throws", () => {
    updateC64APIConfig.mockImplementationOnce(() => {
      throw new Error("connection refused");
    });
    render(<DemoModeInterstitial />);
    fireEvent.click(screen.getByRole("button", { name: /Save & retry/i }));
    expect(screen.getByTestId("demo-interstitial-host-error")).toHaveTextContent("connection refused");
  });

  it("shows stringified error when Save & retry throws a non-Error value", () => {
    updateC64APIConfig.mockImplementationOnce(() => {
      throw "network timeout";
    });
    render(<DemoModeInterstitial />);
    fireEvent.click(screen.getByRole("button", { name: /Save & retry/i }));
    expect(screen.getByTestId("demo-interstitial-host-error")).toHaveTextContent("network timeout");
  });

  describe("the first run without a device", () => {
    beforeEach(() => {
      neverConnected = true;
    });

    it("SPM-FRST-01 first run offers SID Player first, then Demo Mode, then a retry", () => {
      render(<DemoModeInterstitial />);

      expect(screen.getByRole("heading")).toHaveTextContent(MODE_COPY.firstRun.title);
      expect(screen.getByTestId("demo-interstitial-message")).toHaveTextContent(MODE_COPY.firstRun.body);
      const labels = screen
        .getAllByRole("button")
        .map((button) => button.textContent)
        .filter((text) => text && !/close/i.test(text));
      expect(labels.slice(0, 2)).toEqual([MODE_COPY.firstRun.useSidPlayer, MODE_COPY.firstRun.tryDemoMode]);
      expect(labels).toContain(MODE_COPY.firstRun.retry);
    });

    it("SPM-FRST-01 first run with no network says the phone has no network", () => {
      demoInterstitialReason = "no-network";
      render(<DemoModeInterstitial />);

      expect(screen.getByTestId("demo-interstitial-message")).toHaveTextContent(MODE_COPY.firstRun.noNetworkBody);
      expect(screen.getByTestId("demo-interstitial-message")).not.toHaveTextContent("switched on");
    });

    it("SPM-FRST-01 Use SID Player enters SID Player, Try Demo Mode pins Demo Mode, Retry connection retries", () => {
      const { rerender } = render(<DemoModeInterstitial />);
      fireEvent.click(screen.getByTestId("demo-interstitial-use-sid-player"));
      expect(enterSidPlayer).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByTestId("demo-interstitial-continue"));
      expect(pinDemoModeByUserChoice).toHaveBeenCalledTimes(1);

      rerender(<DemoModeInterstitial />);
      fireEvent.click(screen.getByTestId("demo-interstitial-retry"));
      expect(declineDemoMode).toHaveBeenCalledWith({ retry: "manual" });
    });

    it("SPM-FRST-01 the compact profile uses the short body and drops the host field and Save & retry", () => {
      profileName = "compact";
      render(<DemoModeInterstitial />);

      expect(screen.getByTestId("demo-interstitial-message")).toHaveTextContent(MODE_COPY.firstRun.compactBody);
      expect(screen.queryByTestId("demo-interstitial-host-input")).toBeNull();
      expect(screen.queryByTestId("demo-interstitial-save-retry")).toBeNull();
    });

    it("SPM-FRST-01 a larger profile keeps the host field and Save & retry", () => {
      render(<DemoModeInterstitial />);

      expect(screen.getByTestId("demo-interstitial-host-input")).toBeInTheDocument();
      expect(screen.getByTestId("demo-interstitial-save-retry")).toBeInTheDocument();
    });

    it("SPM-FRST-01 closing the offer keeps today's decline semantics", () => {
      render(<DemoModeInterstitial />);
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
      expect(declineDemoMode).toHaveBeenCalledTimes(1);
      expect(enterSidPlayer).not.toHaveBeenCalled();
    });

    it("SPM-FRST-01 a Demo Mode start-up is never offered SID Player first", () => {
      saveStartupModeByUser("demo");
      try {
        render(<DemoModeInterstitial />);
        expect(screen.queryByTestId("demo-interstitial-use-sid-player")).toBeNull();
      } finally {
        saveStartupModeByUser("default");
      }
    });
  });

  it("SPM-FRST-01 a user whose device connected before is not offered SID Player first", () => {
    render(<DemoModeInterstitial />);

    expect(screen.queryByTestId("demo-interstitial-use-sid-player")).toBeNull();
    expect(screen.getByTestId("demo-interstitial-continue")).toHaveTextContent("Continue in Demo Mode");
  });
});
