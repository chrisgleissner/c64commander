/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockVerifyCurrentConnectionTarget,
  mockSetStoredFtpPort,
  mockSetStoredTelnetPort,
  mockInvalidateForSavedDeviceSwitch,
  mockGetPasswordForDevice,
  mockResetInteractionState,
  mockIsMdnsAvailable,
  mockIsBareHostname,
} = vi.hoisted(() => ({
  mockVerifyCurrentConnectionTarget: vi.fn(),
  mockSetStoredFtpPort: vi.fn(),
  mockSetStoredTelnetPort: vi.fn(),
  mockInvalidateForSavedDeviceSwitch: vi.fn(),
  mockGetPasswordForDevice: vi.fn(),
  mockResetInteractionState: vi.fn(),
  mockIsMdnsAvailable: vi.fn(() => false),
  mockIsBareHostname: vi.fn((host: string) => !host.includes(".") && !host.includes(":")),
}));

vi.mock("@/lib/connection/connectionManager", () => ({
  verifyCurrentConnectionTarget: mockVerifyCurrentConnectionTarget,
}));

vi.mock("@/lib/ftp/ftpConfig", () => ({
  setStoredFtpPort: mockSetStoredFtpPort,
}));

vi.mock("@/lib/telnet/telnetConfig", () => ({
  setStoredTelnetPort: mockSetStoredTelnetPort,
}));

vi.mock("@/lib/deviceInteraction/deviceInteractionManager", () => ({
  resetInteractionState: mockResetInteractionState,
}));

vi.mock("@/lib/logging", () => ({
  addLog: vi.fn(),
}));

vi.mock("@/lib/native/mdnsResolver", () => ({
  isMdnsAvailable: mockIsMdnsAvailable,
  isBareHostname: mockIsBareHostname,
  resolveMdnsHost: vi.fn(),
}));

vi.mock("@/lib/query/c64QueryInvalidation", async () => {
  const actual = await vi.importActual<typeof import("@/lib/query/c64QueryInvalidation")>(
    "@/lib/query/c64QueryInvalidation",
  );
  return {
    ...actual,
    invalidateForSavedDeviceSwitch: mockInvalidateForSavedDeviceSwitch,
  };
});

vi.mock("@/lib/secureStorage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/secureStorage")>("@/lib/secureStorage");
  return {
    ...actual,
    getPasswordForDevice: mockGetPasswordForDevice,
  };
});

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const createWrapper = (initialPathname = "/play") => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initialPathname]}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
};

describe("useSavedDeviceSwitching", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    vi.clearAllMocks();
    mockIsMdnsAvailable.mockReturnValue(false);
  });

  it("updates local selection immediately, then persists verified identity and route invalidation on success", async () => {
    const store = await import("@/lib/savedDevices/store");
    const metrics = await import("@/lib/savedDevices/savedDeviceSwitchMetrics");
    metrics.clearSavedDeviceSwitchMetrics();
    const c64api = await import("@/lib/c64api");
    const initialDeviceId = store.getSavedDevicesSnapshot().selectedDeviceId;
    store.updateSavedDevice(initialDeviceId, {
      name: "Office U64",
      host: "c64u",
      httpPort: 80,
      ftpPort: 21,
      telnetPort: 23,
      hasPassword: false,
    });
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
      hasPassword: true,
    });

    const { useSavedDeviceSwitching } = await import("@/hooks/useSavedDeviceSwitching");
    const verification = createDeferred<{
      ok: boolean;
      deviceInfo: { product: string; hostname: string; unique_id: string };
    }>();
    mockGetPasswordForDevice.mockResolvedValueOnce("super-secret");
    mockVerifyCurrentConnectionTarget.mockReturnValueOnce(verification.promise);

    const { result } = renderHook(() => useSavedDeviceSwitching(), {
      wrapper: createWrapper("/play"),
    });

    let switchPromise!: Promise<unknown>;
    act(() => {
      switchPromise = result.current("device-backup");
    });

    expect(store.getSavedDevicesSnapshot().selectedDeviceId).toBe("device-backup");
    expect(store.getSavedDeviceSwitchStatus("device-backup")).toBe("verifying");
    expect(mockSetStoredFtpPort).toHaveBeenCalledWith(2021);
    expect(mockSetStoredTelnetPort).toHaveBeenCalledWith(2323);
    expect(mockResetInteractionState).toHaveBeenCalledWith("saved-device-switch");
    expect(mockGetPasswordForDevice).toHaveBeenCalledWith("device-backup");
    expect(c64api.getC64APIConfigSnapshot()).toMatchObject({
      baseUrl: "http://backup-c64:8080",
      deviceHost: "backup-c64:8080",
    });

    verification.resolve({
      ok: true,
      deviceInfo: {
        product: "U64E",
        hostname: "backup-lab",
        unique_id: "UID-BACKUP",
      },
    });

    await act(async () => {
      await switchPromise;
    });

    expect(store.getSavedDeviceSwitchStatus("device-backup")).toBe("connected");
    expect(store.getSavedDevicesSnapshot().verifiedByDeviceId["device-backup"]).toMatchObject({
      product: "U64E",
      hostname: "backup-lab",
      uniqueId: "UID-BACKUP",
    });
    expect(store.getSavedDevicesSnapshot().summaries["device-backup"]?.lastResolvedAddress).toBeNull();
    expect(mockInvalidateForSavedDeviceSwitch).toHaveBeenCalledWith(expect.any(QueryClient), "/play");

    expect(metrics.getSavedDeviceSwitchMetricsSnapshot().attempts[0]).toMatchObject({
      fromDeviceId: initialDeviceId,
      toDeviceId: "device-backup",
      routePath: "/play",
      outcome: "success",
      verificationOk: true,
    });
  });

  it("prefers a saved resolved address on Android before retrying the raw bare hostname", async () => {
    mockIsMdnsAvailable.mockReturnValue(true);

    const store = await import("@/lib/savedDevices/store");
    const c64api = await import("@/lib/c64api");
    const initialDeviceId = store.getSavedDevicesSnapshot().selectedDeviceId;
    store.updateSavedDevice(initialDeviceId, {
      name: "Office U64",
      host: "c64u",
      httpPort: 80,
      ftpPort: 21,
      telnetPort: 23,
      hasPassword: false,
    });
    store.addSavedDevice({
      id: "device-backup",
      name: "Backup Lab",
      host: "u64",
      httpPort: 80,
      ftpPort: 2021,
      telnetPort: 2323,
      lastKnownProduct: "U64E",
      lastKnownHostname: "backup-lab",
      lastKnownUniqueId: "UID-BACKUP",
      hasPassword: false,
    });
    store.completeSavedDeviceVerification(
      "device-backup",
      {
        product: "U64E",
        hostname: "backup-lab",
        unique_id: "UID-BACKUP",
      },
      "192.168.1.13",
    );

    const { useSavedDeviceSwitching } = await import("@/hooks/useSavedDeviceSwitching");
    mockVerifyCurrentConnectionTarget.mockResolvedValueOnce({
      ok: true,
      deviceInfo: {
        product: "U64E",
        hostname: "backup-lab",
        unique_id: "UID-BACKUP",
      },
      resolvedAddress: "192.168.1.13",
    });

    const { result } = renderHook(() => useSavedDeviceSwitching(), {
      wrapper: createWrapper("/play"),
    });

    await act(async () => {
      await result.current("device-backup");
    });

    expect(mockVerifyCurrentConnectionTarget).toHaveBeenCalledWith({
      deviceHost: "u64",
      password: null,
      preferResolvedAddress: "192.168.1.13",
    });
    expect(c64api.getC64APIConfigSnapshot()).toMatchObject({
      baseUrl: "http://192.168.1.13",
      deviceHost: "192.168.1.13",
    });
  });

  it("falls back to the raw bare hostname when no resolved address has been verified yet", async () => {
    mockIsMdnsAvailable.mockReturnValue(true);

    const store = await import("@/lib/savedDevices/store");
    const c64api = await import("@/lib/c64api");
    const initialDeviceId = store.getSavedDevicesSnapshot().selectedDeviceId;
    store.updateSavedDevice(initialDeviceId, {
      name: "Office U64",
      host: "c64u",
      httpPort: 80,
      ftpPort: 21,
      telnetPort: 23,
      hasPassword: false,
    });
    store.addSavedDevice({
      id: "device-backup",
      name: "Backup Lab",
      host: "u64",
      httpPort: 80,
      ftpPort: 2021,
      telnetPort: 2323,
      lastKnownProduct: "U64E",
      lastKnownHostname: null,
      lastKnownUniqueId: null,
      hasPassword: false,
    });

    const { useSavedDeviceSwitching } = await import("@/hooks/useSavedDeviceSwitching");
    mockVerifyCurrentConnectionTarget.mockResolvedValueOnce({ ok: false, deviceInfo: null, resolvedAddress: null });

    const { result } = renderHook(() => useSavedDeviceSwitching(), {
      wrapper: createWrapper("/play"),
    });

    await act(async () => {
      await result.current("device-backup");
    });

    expect(mockVerifyCurrentConnectionTarget).toHaveBeenCalledWith({
      deviceHost: "u64",
      password: null,
      preferResolvedAddress: null,
    });
    expect(c64api.getC64APIConfigSnapshot()).toMatchObject({
      baseUrl: "http://u64",
      deviceHost: "u64",
    });
  });

  it("dispatches a saved-device-switch reason with runtime connection changes", async () => {
    const store = await import("@/lib/savedDevices/store");
    const initialDeviceId = store.getSavedDevicesSnapshot().selectedDeviceId;
    store.updateSavedDevice(initialDeviceId, {
      name: "Office U64",
      host: "c64u",
      httpPort: 80,
      ftpPort: 21,
      telnetPort: 23,
      hasPassword: false,
    });
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

    const detailSpy = vi.fn();
    const handler = (event: Event) => detailSpy((event as CustomEvent).detail);
    window.addEventListener("c64u-connection-change", handler as EventListener);

    const { useSavedDeviceSwitching } = await import("@/hooks/useSavedDeviceSwitching");
    mockVerifyCurrentConnectionTarget.mockResolvedValueOnce({ ok: false, deviceInfo: null, resolvedAddress: null });

    const { result } = renderHook(() => useSavedDeviceSwitching(), {
      wrapper: createWrapper("/play"),
    });

    await act(async () => {
      await result.current("device-backup");
    });

    expect(detailSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "saved-device-switch",
      }),
    );

    window.removeEventListener("c64u-connection-change", handler as EventListener);
  });

  it("keeps the selected device and records offline state when verification fails", async () => {
    const store = await import("@/lib/savedDevices/store");
    const metrics = await import("@/lib/savedDevices/savedDeviceSwitchMetrics");
    metrics.clearSavedDeviceSwitchMetrics();
    const initialDeviceId = store.getSavedDevicesSnapshot().selectedDeviceId;
    store.updateSavedDevice(initialDeviceId, {
      name: "Office U64",
      host: "c64u",
      httpPort: 80,
      ftpPort: 21,
      telnetPort: 23,
      hasPassword: false,
    });
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

    const { useSavedDeviceSwitching } = await import("@/hooks/useSavedDeviceSwitching");
    mockVerifyCurrentConnectionTarget.mockResolvedValueOnce({ ok: false, deviceInfo: null });

    const { result } = renderHook(() => useSavedDeviceSwitching(), {
      wrapper: createWrapper("/config"),
    });

    await act(async () => {
      await result.current("device-backup");
    });

    expect(store.getSavedDevicesSnapshot().selectedDeviceId).toBe("device-backup");
    expect(store.getSavedDeviceSwitchStatus("device-backup")).toBe("offline");
    expect(mockInvalidateForSavedDeviceSwitch).not.toHaveBeenCalled();

    expect(metrics.getSavedDeviceSwitchMetricsSnapshot().attempts[0]).toMatchObject({
      fromDeviceId: initialDeviceId,
      toDeviceId: "device-backup",
      routePath: "/config",
      outcome: "offline",
      verificationOk: false,
    });
  });

  it("captures thrown verification failures as error attempts", async () => {
    const store = await import("@/lib/savedDevices/store");
    const metrics = await import("@/lib/savedDevices/savedDeviceSwitchMetrics");
    metrics.clearSavedDeviceSwitchMetrics();
    const initialDeviceId = store.getSavedDevicesSnapshot().selectedDeviceId;
    store.updateSavedDevice(initialDeviceId, {
      name: "Office U64",
      host: "c64u",
      httpPort: 80,
      ftpPort: 21,
      telnetPort: 23,
      hasPassword: false,
    });
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

    const { useSavedDeviceSwitching } = await import("@/hooks/useSavedDeviceSwitching");
    mockVerifyCurrentConnectionTarget.mockRejectedValueOnce(new Error("Verification exploded"));

    const { result } = renderHook(() => useSavedDeviceSwitching(), {
      wrapper: createWrapper("/settings"),
    });

    await expect(
      act(async () => {
        await result.current("device-backup");
      }),
    ).rejects.toThrow("Verification exploded");

    expect(metrics.getSavedDeviceSwitchMetricsSnapshot().attempts[0]).toMatchObject({
      fromDeviceId: initialDeviceId,
      toDeviceId: "device-backup",
      routePath: "/settings",
      outcome: "error",
      verificationOk: false,
      errorMessage: "Verification exploded",
    });
  });
});
