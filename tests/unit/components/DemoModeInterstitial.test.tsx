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

const dismissDemoInterstitial = vi.fn();
const discoverConnection = vi.fn();
const updateC64APIConfig = vi.fn();
const buildBaseUrlFromDeviceHost = vi.fn((host: string) => `http://${host}`);
const resolveDeviceHostFromStorage = vi.fn(() => "mydevice.local");
const getC64APIConfigSnapshot = vi.fn(() => ({
  baseUrl: "http://mydevice.local",
  password: "saved-pass",
  deviceHost: "mydevice.local",
}));

vi.mock("@/hooks/useConnectionState", () => ({
  useConnectionState: () => ({ demoInterstitialVisible }),
}));

vi.mock("@/lib/connection/connectionManager", () => ({
  dismissDemoInterstitial: (...args: unknown[]) =>
    dismissDemoInterstitial(...args),
  discoverConnection: (...args: unknown[]) => discoverConnection(...args),
}));

vi.mock("@/lib/c64api", () => ({
  buildBaseUrlFromDeviceHost: (...args: unknown[]) =>
    buildBaseUrlFromDeviceHost(args[0] as string),
  normalizeDeviceHost: (host?: string) => {
    const value = (host ?? "").toString().trim();
    if (!value) return "c64u";
    return value.replace(/^https?:\/\//i, "").split("/")[0];
  },
  resolveDeviceHostFromStorage: () => resolveDeviceHostFromStorage(),
  updateC64APIConfig: (...args: unknown[]) => updateC64APIConfig(...args),
  getC64APIConfigSnapshot: () => getC64APIConfigSnapshot(),
}));

import { DemoModeInterstitial } from "@/components/DemoModeInterstitial";

describe("DemoModeInterstitial", () => {
  beforeEach(() => {
    demoInterstitialVisible = true;
    resolveDeviceHostFromStorage.mockReturnValue("mydevice.local");
    getC64APIConfigSnapshot.mockReturnValue({
      baseUrl: "http://mydevice.local",
      password: "saved-pass",
      deviceHost: "mydevice.local",
    });
    dismissDemoInterstitial.mockReset();
    discoverConnection.mockReset();
    updateC64APIConfig.mockReset();
    buildBaseUrlFromDeviceHost.mockImplementation(
      (host: string) => `http://${host}`,
    );
  });

  it("shows the attempted hostname in the description", () => {
    render(<DemoModeInterstitial />);
    expect(screen.getByTestId("demo-interstitial-hostname")).toHaveTextContent(
      "mydevice.local",
    );
  });

  it("pre-fills the hostname input with the stored device host", () => {
    render(<DemoModeInterstitial />);
    const input = screen.getByTestId(
      "demo-interstitial-host-input",
    ) as HTMLInputElement;
    expect(input.value).toBe("mydevice.local");
  });

  it("Save & Retry persists the edited hostname and triggers settings discovery", () => {
    render(<DemoModeInterstitial />);
    const input = screen.getByTestId("demo-interstitial-host-input");
    fireEvent.change(input, { target: { value: "192.168.1.100" } });
    fireEvent.click(screen.getByRole("button", { name: /Save & Retry/i }));
    expect(updateC64APIConfig).toHaveBeenCalledWith(
      "http://192.168.1.100",
      "saved-pass",
      "192.168.1.100",
    );
    expect(dismissDemoInterstitial).toHaveBeenCalled();
    expect(discoverConnection).toHaveBeenCalledWith("settings");
  });

  it("Save & Retry with unchanged input uses stored hostname and preserves password", () => {
    render(<DemoModeInterstitial />);
    fireEvent.click(screen.getByRole("button", { name: /Save & Retry/i }));
    expect(updateC64APIConfig).toHaveBeenCalledWith(
      "http://mydevice.local",
      "saved-pass",
      "mydevice.local",
    );
    expect(discoverConnection).toHaveBeenCalledWith("settings");
  });

  it("Retry connection dismisses and triggers manual discovery without persisting hostname", () => {
    render(<DemoModeInterstitial />);
    fireEvent.click(screen.getByRole("button", { name: /Retry connection/i }));
    expect(dismissDemoInterstitial).toHaveBeenCalled();
    expect(discoverConnection).toHaveBeenCalledWith("manual");
    expect(updateC64APIConfig).not.toHaveBeenCalled();
  });

  it("Continue in Demo Mode dismisses without retrying", () => {
    render(<DemoModeInterstitial />);
    fireEvent.click(
      screen.getByRole("button", { name: /Continue in Demo Mode/i }),
    );
    expect(dismissDemoInterstitial).toHaveBeenCalled();
    expect(discoverConnection).not.toHaveBeenCalled();
    expect(updateC64APIConfig).not.toHaveBeenCalled();
  });

  it("renders nothing when interstitial is not visible", () => {
    demoInterstitialVisible = false;
    const { container } = render(<DemoModeInterstitial />);
    expect(container.firstChild).toBeNull();
  });
});
