/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
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
  mockAddLog,
  mockIsMdnsAvailable,
  mockIsBareHostname,
  mockClearToastsOnDeviceSwitch,
} = vi.hoisted(() => ({
  mockVerifyCurrentConnectionTarget: vi.fn(),
  mockSetStoredFtpPort: vi.fn(),
  mockSetStoredTelnetPort: vi.fn(),
  mockInvalidateForSavedDeviceSwitch: vi.fn(),
  mockGetPasswordForDevice: vi.fn(),
  mockResetInteractionState: vi.fn(),
  mockAddLog: vi.fn(),
  mockIsMdnsAvailable: vi.fn(() => false),
  mockIsBareHostname: vi.fn((host: string) => !host.includes(".") && !host.includes(":")),
  mockClearToastsOnDeviceSwitch: vi.fn(),
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
  addLog: mockAddLog,
}));

vi.mock("@/lib/native/mdnsResolver", () => ({
  isMdnsAvailable: mockIsMdnsAvailable,
  isBareHostname: mockIsBareHostname,
  resolveMdnsHost: vi.fn(),
}));

vi.mock("@/lib/uiErrors", async () => {
  const actual = await vi.importActual<typeof import("@/lib/uiErrors")>("@/lib/uiErrors");
  return {
    ...actual,
    clearToastsOnDeviceSwitch: mockClearToastsOnDeviceSwitch,
  };
});

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

const createWrapperWithQueryClient = (queryClient: QueryClient, initialPathname = "/play") => {
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

  it("rejects an unknown saved-device switch without mutating connection state", async () => {
    const { useSavedDeviceSwitching } = await import("@/hooks/useSavedDeviceSwitching");
    const { result } = renderHook(() => useSavedDeviceSwitching(), {
      wrapper: createWrapper("/settings"),
    });

    await expect(result.current("missing-device")).rejects.toThrow("Unknown saved device: missing-device");
    expect(mockSetStoredFtpPort).not.toHaveBeenCalled();
    expect(mockVerifyCurrentConnectionTarget).not.toHaveBeenCalled();
  });

  it("clears error toasts attributed to the previous device on switch (ERROR_POLICY §6)", async () => {
    const store = await import("@/lib/savedDevices/store");
    const initialDeviceId = store.getSavedDevicesSnapshot().selectedDeviceId;
    store.updateSavedDevice(initialDeviceId, {
      name: "Office C64U",
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
      hasPassword: false,
    });
    mockVerifyCurrentConnectionTarget.mockResolvedValueOnce({
      ok: true,
      deviceInfo: { product: "U64E", hostname: "backup-lab", unique_id: "UID-BACKUP" },
    });

    const { useSavedDeviceSwitching } = await import("@/hooks/useSavedDeviceSwitching");
    const { result } = renderHook(() => useSavedDeviceSwitching(), {
      wrapper: createWrapper("/play"),
    });

    await act(async () => {
      await result.current("device-backup");
    });

    expect(mockClearToastsOnDeviceSwitch).toHaveBeenCalledWith("c64u");
  });

  it("logs old-query cancellation failures while continuing the saved-device switch", async () => {
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
      hasPassword: false,
    });

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    vi.spyOn(queryClient, "cancelQueries").mockRejectedValueOnce(new Error("cancel rejected"));
    mockVerifyCurrentConnectionTarget.mockResolvedValueOnce({
      ok: true,
      deviceInfo: {
        product: "U64E",
        hostname: "backup-lab",
        unique_id: "UID-BACKUP",
      },
    });

    const { useSavedDeviceSwitching } = await import("@/hooks/useSavedDeviceSwitching");
    const { result } = renderHook(() => useSavedDeviceSwitching(), {
      wrapper: createWrapperWithQueryClient(queryClient, "/play"),
    });

    await act(async () => {
      await result.current("device-backup");
    });
    await waitFor(() => {
      expect(mockAddLog).toHaveBeenCalledWith(
        "warn",
        "Failed to cancel old-device C64 queries during saved-device switch",
        expect.objectContaining({
          deviceId: "device-backup",
          error: "cancel rejected",
        }),
      );
    });
  });

  it("uses route prefix membership when cancelling old-device queries during a switch", async () => {
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
      hasPassword: false,
    });

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    vi.spyOn(queryClient, "cancelQueries").mockImplementationOnce((filters) => {
      expect(filters.predicate?.({ queryKey: ["c64-info"] } as never)).toBe(true);
      expect(filters.predicate?.({ queryKey: ["playlist-items"] } as never)).toBe(false);
      return Promise.resolve();
    });
    mockVerifyCurrentConnectionTarget.mockResolvedValueOnce({ ok: false, deviceInfo: null, resolvedAddress: null });

    const { useSavedDeviceSwitching } = await import("@/hooks/useSavedDeviceSwitching");
    const { result } = renderHook(() => useSavedDeviceSwitching(), {
      wrapper: createWrapperWithQueryClient(queryClient, "/settings"),
    });

    await act(async () => {
      await result.current("device-backup");
    });

    expect(queryClient.cancelQueries).toHaveBeenCalled();
    expect(mockAddLog).not.toHaveBeenCalledWith(
      "warn",
      "Failed to cancel old-device C64 queries during saved-device switch",
      expect.anything(),
    );
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

  it("coalesces repeated switch requests for the same requested device while verification is in flight", async () => {
    const store = await import("@/lib/savedDevices/store");
    const metrics = await import("@/lib/savedDevices/savedDeviceSwitchMetrics");
    metrics.clearSavedDeviceSwitchMetrics();
    const initialDeviceId = store.getSavedDevicesSnapshot().selectedDeviceId;
    store.updateSavedDevice(initialDeviceId, {
      name: "Office U64",
      host: "u64",
      httpPort: 80,
      ftpPort: 21,
      telnetPort: 23,
      hasPassword: false,
    });
    store.addSavedDevice({
      id: "device-c64u",
      name: "C64U",
      host: "192.168.1.167",
      httpPort: 80,
      ftpPort: 21,
      telnetPort: 64,
      lastKnownProduct: null,
      lastKnownHostname: null,
      lastKnownUniqueId: null,
      hasPassword: false,
    });

    const verification = createDeferred<{
      ok: boolean;
      deviceInfo: { product: string; hostname: string; unique_id: string };
      resolvedAddress: string | null;
    }>();
    const { useSavedDeviceSwitching } = await import("@/hooks/useSavedDeviceSwitching");
    mockVerifyCurrentConnectionTarget.mockReturnValueOnce(verification.promise);

    const { result } = renderHook(() => useSavedDeviceSwitching(), {
      wrapper: createWrapper("/settings"),
    });

    let firstSwitch!: Promise<unknown>;
    let secondSwitch!: Promise<unknown>;
    act(() => {
      firstSwitch = result.current("device-c64u");
      secondSwitch = result.current("device-c64u");
    });

    verification.resolve({
      ok: true,
      deviceInfo: {
        product: "C64 Ultimate",
        hostname: "c64u",
        unique_id: "UID-C64U",
      },
      resolvedAddress: null,
    });

    await act(async () => {
      await Promise.all([firstSwitch, secondSwitch]);
    });

    expect(mockVerifyCurrentConnectionTarget).toHaveBeenCalledTimes(1);
    expect(store.getSavedDeviceSwitchStatus("device-c64u")).toBe("connected");
    expect(metrics.getSavedDeviceSwitchMetricsSnapshot().attempts).toHaveLength(1);
    expect(metrics.getSavedDeviceSwitchMetricsSnapshot().attempts[0]).toMatchObject({
      fromDeviceId: initialDeviceId,
      toDeviceId: "device-c64u",
      outcome: "success",
    });
  });

  it("queues a different in-flight saved-device switch request behind the active verification", async () => {
    const store = await import("@/lib/savedDevices/store");
    const metrics = await import("@/lib/savedDevices/savedDeviceSwitchMetrics");
    metrics.clearSavedDeviceSwitchMetrics();
    const initialDeviceId = store.getSavedDevicesSnapshot().selectedDeviceId;
    store.updateSavedDevice(initialDeviceId, {
      name: "Office U64",
      host: "u64",
      httpPort: 80,
      ftpPort: 21,
      telnetPort: 23,
      hasPassword: false,
    });
    store.addSavedDevice({
      id: "device-c64u",
      name: "C64U",
      host: "192.168.1.167",
      httpPort: 80,
      ftpPort: 21,
      telnetPort: 64,
      lastKnownProduct: null,
      lastKnownHostname: null,
      lastKnownUniqueId: null,
      hasPassword: false,
    });
    store.addSavedDevice({
      id: "device-c64u-backup",
      name: "Backup C64U",
      host: "10.0.0.12",
      httpPort: 80,
      ftpPort: 21,
      telnetPort: 64,
      lastKnownProduct: null,
      lastKnownHostname: null,
      lastKnownUniqueId: null,
      hasPassword: false,
    });

    const firstVerification = createDeferred<{
      ok: boolean;
      deviceInfo: { product: string; hostname: string; unique_id: string };
    }>();
    const secondVerification = createDeferred<{
      ok: boolean;
      deviceInfo: { product: string; hostname: string; unique_id: string };
    }>();

    const { useSavedDeviceSwitching } = await import("@/hooks/useSavedDeviceSwitching");
    mockVerifyCurrentConnectionTarget
      .mockReturnValueOnce(firstVerification.promise)
      .mockReturnValueOnce(secondVerification.promise);

    const { result } = renderHook(() => useSavedDeviceSwitching(), {
      wrapper: createWrapper("/settings"),
    });

    let primarySwitch!: Promise<unknown>;
    let queuedSwitch!: Promise<unknown>;
    act(() => {
      primarySwitch = result.current("device-c64u");
      queuedSwitch = result.current("device-c64u-backup");
    });

    expect(mockVerifyCurrentConnectionTarget).toHaveBeenCalledTimes(1);
    expect(primarySwitch).not.toBe(queuedSwitch);

    firstVerification.resolve({
      ok: true,
      deviceInfo: {
        product: "C64 Ultimate",
        hostname: "c64u",
        unique_id: "UID-C64U",
      },
    });

    await waitFor(() => {
      expect(mockVerifyCurrentConnectionTarget).toHaveBeenCalledTimes(2);
    });

    secondVerification.resolve({
      ok: true,
      deviceInfo: {
        product: "C64 Ultimate",
        hostname: "backup-c64u",
        unique_id: "UID-BACKUP",
      },
    });

    await act(async () => {
      await Promise.all([primarySwitch, queuedSwitch]);
    });

    expect(mockVerifyCurrentConnectionTarget).toHaveBeenNthCalledWith(1, {
      deviceHost: "192.168.1.167",
      password: null,
      preferResolvedAddress: null,
    });
    expect(mockVerifyCurrentConnectionTarget).toHaveBeenNthCalledWith(2, {
      deviceHost: "10.0.0.12",
      password: null,
      preferResolvedAddress: null,
    });
    expect(store.getSavedDevicesSnapshot().selectedDeviceId).toBe("device-c64u-backup");

    const attempts = metrics.getSavedDeviceSwitchMetricsSnapshot().attempts;
    expect(attempts).toHaveLength(2);
    expect(attempts.find((attempt) => attempt.toDeviceId === "device-c64u")).toMatchObject({
      fromDeviceId: initialDeviceId,
      toDeviceId: "device-c64u",
      outcome: "success",
    });
    expect(attempts.find((attempt) => attempt.toDeviceId === "device-c64u-backup")).toMatchObject({
      fromDeviceId: "device-c64u",
      toDeviceId: "device-c64u-backup",
      outcome: "success",
    });
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
