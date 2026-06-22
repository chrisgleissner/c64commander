/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { DeviceDiscoveryState } from "@/lib/deviceDiscovery/types";

const persistDiscoveredDevice = vi.fn(() => ({
  deviceId: "saved-device",
  host: "192.168.1.13",
  httpPort: 80,
  deviceHost: "192.168.1.13",
}));
const setPasswordForDevice = vi.fn(async () => undefined);
const switchSavedDevice = vi.fn(async () => ({ ok: true, deviceInfo: { product: "Ultimate 64 Elite" } }));
const reportUserError = vi.fn();
const toast = vi.fn();

let discoveryState: DeviceDiscoveryState;
let connectionState: { state: string };
let savedDevices: { selectedDeviceId: string; devices: Array<{ id: string; hasPassword: boolean }> };

vi.mock("@/hooks/useDeviceDiscovery", () => ({
  useDeviceDiscovery: () => discoveryState,
}));

vi.mock("@/hooks/useConnectionState", () => ({
  useConnectionState: () => connectionState,
}));

vi.mock("@/hooks/useSavedDevices", () => ({
  useSavedDevices: () => savedDevices,
}));

vi.mock("@/hooks/useSavedDeviceSwitching", () => ({
  useSavedDeviceSwitching: () => switchSavedDevice,
}));

vi.mock("@/lib/deviceDiscovery/discoveryManager", () => ({
  persistDiscoveredDevice: (...args: unknown[]) => persistDiscoveredDevice(...args),
}));

vi.mock("@/lib/secureStorage", () => ({
  setPasswordForDevice: (...args: unknown[]) => setPasswordForDevice(...args),
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: (...args: unknown[]) => toast(...args),
}));

vi.mock("@/lib/uiErrors", () => ({
  reportUserError: (...args: unknown[]) => reportUserError(...args),
}));

import { DeviceDiscoveryInterstitial } from "@/components/DeviceDiscoveryInterstitial";

const candidate = (requiresPassword = false) => ({
  id: requiresPassword ? "address:192.168.1.14" : "id:38c1ba",
  address: requiresPassword ? "192.168.1.14" : "192.168.1.13",
  host: null,
  httpPort: 80,
  source: ["lan-scan" as const],
  product: requiresPassword ? "C64 Ultimate" : "Ultimate 64 Elite",
  firmwareVersion: requiresPassword ? null : "3.14e",
  fpgaVersion: requiresPassword ? null : "122",
  coreVersion: requiresPassword ? null : "1.4B",
  hostname: requiresPassword ? null : "u64",
  uniqueId: requiresPassword ? null : "38C1BA",
  requiresPassword,
  alreadySavedDeviceId: null,
  confidence: "verified" as const,
  lastSeenAt: "2026-06-21T00:00:00.000Z",
});

const renderDialog = () =>
  render(
    <MemoryRouter>
      <DeviceDiscoveryInterstitial />
    </MemoryRouter>,
  );

describe("DeviceDiscoveryInterstitial", () => {
  beforeEach(() => {
    discoveryState = {
      phase: "complete",
      trigger: "startup",
      startedAt: "2026-06-21T00:00:00.000Z",
      completedAt: "2026-06-21T00:00:08.000Z",
      candidates: [candidate()],
      scannedHosts: 254,
      elapsedMs: 8000,
      error: null,
      unsupported: false,
    };
    connectionState = { state: "OFFLINE_NO_DEMO" };
    savedDevices = { selectedDeviceId: "device-1", devices: [] };
    persistDiscoveredDevice.mockClear();
    setPasswordForDevice.mockClear();
    switchSavedDevice.mockClear();
    reportUserError.mockClear();
    toast.mockClear();
  });

  it("shows automatic startup discovery results while the app is offline", () => {
    renderDialog();

    expect(screen.getByText("C64 Ultimate devices found")).toBeInTheDocument();
    expect(screen.getByText("Ultimate 64 Elite · u64")).toBeInTheDocument();
    expect(screen.getByText("192.168.1.13 · fw 3.14e · ID 38C1BA")).toBeInTheDocument();
    expect(screen.getByTestId("startup-use-discovered-device-id:38c1ba")).toBeInTheDocument();
  });

  it("keeps automatic startup discovery results visible if a background probe already connected", () => {
    connectionState = { state: "REAL_CONNECTED" };

    renderDialog();

    expect(screen.getByText("C64 Ultimate devices found")).toBeInTheDocument();
    expect(screen.getByTestId("startup-use-discovered-device-id:38c1ba")).toBeInTheDocument();
  });

  it("does not show settings-triggered discovery results as a startup popup", () => {
    discoveryState = { ...discoveryState, trigger: "settings" };

    const { container } = renderDialog();

    expect(container).toBeEmptyDOMElement();
  });

  it("saves a discovered device without switching to it", async () => {
    renderDialog();

    fireEvent.click(screen.getByTestId("startup-save-discovered-device-id:38c1ba"));

    await waitFor(() => {
      expect(persistDiscoveredDevice).toHaveBeenCalledWith(discoveryState.candidates[0], {
        select: false,
        passwordPresent: false,
      });
    });
    expect(switchSavedDevice).not.toHaveBeenCalled();
    expect(screen.getByTestId("startup-save-discovered-device-id:38c1ba")).toHaveTextContent("Saved");
  });

  it("selects a discovered device through the saved-device switching path", async () => {
    renderDialog();

    fireEvent.click(screen.getByTestId("startup-use-discovered-device-id:38c1ba"));

    await waitFor(() => {
      expect(persistDiscoveredDevice).toHaveBeenCalledWith(discoveryState.candidates[0], {
        select: true,
        passwordPresent: false,
      });
      expect(switchSavedDevice).toHaveBeenCalledWith("saved-device");
    });
  });

  it("asks for a password before using a password-protected discovered device", async () => {
    discoveryState = {
      ...discoveryState,
      candidates: [candidate(true)],
    };
    renderDialog();

    fireEvent.click(screen.getByTestId("startup-use-discovered-device-address:192.168.1.14"));

    expect(screen.getByTestId("startup-device-password-panel")).toBeInTheDocument();
    expect(persistDiscoveredDevice).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("startup-device-password-confirm"));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter the network password");

    fireEvent.change(screen.getByTestId("startup-device-password-input"), { target: { value: "secret" } });
    fireEvent.click(screen.getByTestId("startup-device-password-confirm"));

    await waitFor(() => {
      expect(persistDiscoveredDevice).toHaveBeenCalledWith(discoveryState.candidates[0], {
        select: true,
        passwordPresent: true,
      });
      expect(setPasswordForDevice).toHaveBeenCalledWith("saved-device", "secret");
      expect(switchSavedDevice).toHaveBeenCalledWith("saved-device");
    });
  });

  it("uses a password-protected device without prompting when a saved password exists", async () => {
    discoveryState = {
      ...discoveryState,
      candidates: [{ ...candidate(true), alreadySavedDeviceId: "known" }],
    };
    savedDevices = { selectedDeviceId: "device-1", devices: [{ id: "known", hasPassword: true }] };
    renderDialog();

    fireEvent.click(screen.getByTestId("startup-use-discovered-device-address:192.168.1.14"));

    await waitFor(() => {
      expect(persistDiscoveredDevice).toHaveBeenCalledWith(discoveryState.candidates[0], {
        select: true,
        passwordPresent: false,
      });
    });
    expect(screen.queryByTestId("startup-device-password-panel")).not.toBeInTheDocument();
    expect(setPasswordForDevice).not.toHaveBeenCalled();
  });

  it("saves a password-protected device and stores the entered password", async () => {
    discoveryState = { ...discoveryState, candidates: [candidate(true)] };
    renderDialog();

    fireEvent.click(screen.getByTestId("startup-save-discovered-device-address:192.168.1.14"));
    expect(screen.getByTestId("startup-device-password-panel")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("startup-device-password-input"), { target: { value: "hunter2" } });
    fireEvent.click(screen.getByTestId("startup-device-password-confirm"));

    await waitFor(() => {
      expect(persistDiscoveredDevice).toHaveBeenCalledWith(discoveryState.candidates[0], {
        select: false,
        passwordPresent: true,
      });
      expect(setPasswordForDevice).toHaveBeenCalledWith("saved-device", "hunter2");
    });
    expect(switchSavedDevice).not.toHaveBeenCalled();
    expect(screen.queryByTestId("startup-device-password-panel")).not.toBeInTheDocument();
  });

  it("reports an error when saving a discovered device fails", async () => {
    persistDiscoveredDevice.mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    renderDialog();

    fireEvent.click(screen.getByTestId("startup-save-discovered-device-id:38c1ba"));

    await waitFor(() => {
      expect(reportUserError).toHaveBeenCalledWith(
        expect.objectContaining({ operation: "DEVICE_DISCOVERY_SAVE", deviceHost: "192.168.1.13" }),
      );
    });
    expect(screen.getByTestId("startup-save-discovered-device-id:38c1ba")).toHaveTextContent("Save");
  });

  it("reports an error when the follow-up connection check fails", async () => {
    switchSavedDevice.mockResolvedValueOnce({ ok: false, error: "device did not answer" });
    renderDialog();

    fireEvent.click(screen.getByTestId("startup-use-discovered-device-id:38c1ba"));

    await waitFor(() => {
      expect(reportUserError).toHaveBeenCalledWith(
        expect.objectContaining({ operation: "DEVICE_DISCOVERY_SELECT", deviceHost: "192.168.1.13" }),
      );
    });
  });

  it("cancels the password prompt without saving", () => {
    discoveryState = { ...discoveryState, candidates: [candidate(true)] };
    renderDialog();

    fireEvent.click(screen.getByTestId("startup-use-discovered-device-address:192.168.1.14"));
    expect(screen.getByTestId("startup-device-password-panel")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("startup-device-password-cancel"));
    expect(screen.queryByTestId("startup-device-password-panel")).not.toBeInTheDocument();
    expect(persistDiscoveredDevice).not.toHaveBeenCalled();
  });

  it("dismisses and routes to Settings from the footer action", () => {
    renderDialog();

    fireEvent.click(screen.getByTestId("startup-device-discovery-open-settings"));

    expect(screen.queryByText("C64 Ultimate devices found")).not.toBeInTheDocument();
  });

  it("dismisses on dialog close (Escape)", () => {
    renderDialog();
    expect(screen.getByText("C64 Ultimate devices found")).toBeInTheDocument();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

    expect(screen.queryByText("C64 Ultimate devices found")).not.toBeInTheDocument();
  });
});
