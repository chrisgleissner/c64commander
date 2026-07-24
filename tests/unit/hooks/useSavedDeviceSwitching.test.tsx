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
  mockResetMachineExecution,
  mockAddLog,
  mockClearToastsOnDeviceSwitch,
  mockSetSavedDeviceSwitchProbeWindow,
  mockIsBackgroundExecutionActive,
  mockStopBackgroundExecution,
  mockSetDueAtMs,
  mockToast,
} = vi.hoisted(() => ({
  mockVerifyCurrentConnectionTarget: vi.fn(),
  mockSetStoredFtpPort: vi.fn(),
  mockSetStoredTelnetPort: vi.fn(),
  mockInvalidateForSavedDeviceSwitch: vi.fn(),
  mockGetPasswordForDevice: vi.fn(),
  mockResetInteractionState: vi.fn(),
  mockResetMachineExecution: vi.fn(),
  mockAddLog: vi.fn(),
  mockClearToastsOnDeviceSwitch: vi.fn(),
  mockSetSavedDeviceSwitchProbeWindow: vi.fn(),
  mockIsBackgroundExecutionActive: vi.fn(() => false),
  mockStopBackgroundExecution: vi.fn().mockResolvedValue(undefined),
  mockSetDueAtMs: vi.fn().mockResolvedValue(undefined),
  mockToast: vi.fn(),
}));

vi.mock("@/lib/connection/connectionManager", () => ({
  verifyCurrentConnectionTarget: mockVerifyCurrentConnectionTarget,
  setSavedDeviceSwitchProbeWindow: mockSetSavedDeviceSwitchProbeWindow,
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

vi.mock("@/lib/deviceInteraction/machineExecutionStore", () => ({
  resetMachineExecution: mockResetMachineExecution,
}));

vi.mock("@/lib/logging", () => ({
  addLog: mockAddLog,
}));

const { mockAvMirror } = vi.hoisted(() => ({
  mockAvMirror: {
    videoLive: false,
    audioLive: false,
    stopAll: vi.fn().mockResolvedValue(undefined),
    startVideo: vi.fn().mockResolvedValue(undefined),
    startAudio: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/lib/streams/avMirrorSession", () => ({ avMirrorSession: mockAvMirror }));

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

vi.mock("@/lib/native/backgroundExecutionManager", () => ({
  isBackgroundExecutionActive: mockIsBackgroundExecutionActive,
  stopBackgroundExecution: mockStopBackgroundExecution,
}));

vi.mock("@/lib/native/backgroundExecution", () => ({
  BackgroundExecution: { setDueAtMs: mockSetDueAtMs },
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: mockToast,
}));

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
    mockAvMirror.videoLive = false;
    mockAvMirror.audioLive = false;
  });

  it("updates local selection immediately, then persists verified identity and route invalidation on success", async () => {
    const store = await import("@/lib/savedDevices/store");
    const metrics = await import("@/lib/savedDevices/savedDeviceSwitchMetrics");
    const traceContext = await import("@/lib/tracing/traceContext");
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
    traceContext.setTraceDeviceAttributionContext({
      savedDeviceId: initialDeviceId,
      savedDeviceNameSnapshot: "Office C64U",
      savedDeviceHostSnapshot: "c64u",
      verifiedUniqueId: "UID-C64U",
      verifiedHostname: "c64u",
      verifiedProduct: "C64U",
    });

    const { result } = renderHook(() => useSavedDeviceSwitching(), {
      wrapper: createWrapper("/play"),
    });

    let switchPromise!: Promise<unknown>;
    await act(async () => {
      switchPromise = result.current("device-backup");
      // HARD12-003: selection now follows the password read (the only fallible
      // step before any mutation), so let that microtask settle before the
      // deferred verification blocks, making the post-selection state observable.
      await Promise.resolve();
    });

    expect(store.getSavedDevicesSnapshot().selectedDeviceId).toBe("device-backup");
    expect(traceContext.getTraceContextSnapshot().device).toMatchObject({
      savedDeviceId: "device-backup",
      savedDeviceNameSnapshot: "Backup Lab",
      savedDeviceHostSnapshot: "backup-c64",
      verifiedUniqueId: null,
      verifiedHostname: null,
      verifiedProduct: null,
    });
    expect(store.getSavedDeviceSwitchStatus("device-backup")).toBe("verifying");
    expect(mockSetStoredFtpPort).toHaveBeenCalledWith(2021);
    expect(mockSetStoredTelnetPort).toHaveBeenCalledWith(2323);
    expect(mockResetInteractionState).toHaveBeenCalledWith("saved-device-switch");
    // HARD12-020: the shared machine pause/resume state must not carry device
    // A's pause state onto device B — reset it on every switch regardless of
    // which page (Play or Home) happens to be mounted.
    expect(mockResetMachineExecution).toHaveBeenCalled();
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
    expect(mockInvalidateForSavedDeviceSwitch).toHaveBeenCalledWith(expect.any(QueryClient));

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

  it("aborts before mutating selection or API config when the password read rejects (HARD12-003)", async () => {
    const store = await import("@/lib/savedDevices/store");
    const c64api = await import("@/lib/c64api");
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
      id: "device-protected",
      name: "Protected Lab",
      host: "protected-c64",
      httpPort: 8080,
      ftpPort: 2021,
      telnetPort: 2323,
      hasPassword: true,
    });

    mockGetPasswordForDevice.mockRejectedValueOnce(new Error("SecureStorage unavailable"));
    const before = c64api.getC64APIConfigSnapshot();

    const { useSavedDeviceSwitching } = await import("@/hooks/useSavedDeviceSwitching");
    const { result } = renderHook(() => useSavedDeviceSwitching(), {
      wrapper: createWrapper("/play"),
    });

    await expect(result.current("device-protected")).rejects.toThrow("SecureStorage unavailable");

    // Nothing half-applied: selection, ports, verification, and the runtime API
    // config all still describe the previous device — never "selected=new /
    // API=old".
    expect(store.getSavedDevicesSnapshot().selectedDeviceId).toBe(initialDeviceId);
    expect(store.getSavedDeviceSwitchStatus("device-protected")).not.toBe("verifying");
    expect(mockSetStoredFtpPort).not.toHaveBeenCalledWith(2021);
    expect(mockSetStoredTelnetPort).not.toHaveBeenCalledWith(2323);
    expect(mockVerifyCurrentConnectionTarget).not.toHaveBeenCalled();
    expect(c64api.getC64APIConfigSnapshot()).toMatchObject({
      baseUrl: before.baseUrl,
      deviceHost: before.deviceHost,
    });
    expect(mockClearToastsOnDeviceSwitch).not.toHaveBeenCalled();
    // The switch aborted before an attempt metric was opened.
    expect(metrics.getSavedDeviceSwitchMetricsSnapshot().attempts).toHaveLength(0);
  });

  it("awaits a registered active-input release before retargeting the API config (HARD13-001 residual E1)", async () => {
    const store = await import("@/lib/savedDevices/store");
    const c64api = await import("@/lib/c64api");
    const activeInputRelease = await import("@/lib/remoteInput/activeInputRelease");
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
    mockVerifyCurrentConnectionTarget.mockResolvedValueOnce({
      ok: true,
      deviceInfo: { product: "U64E", hostname: "backup-lab", unique_id: "UID-BACKUP" },
    });

    const before = c64api.getC64APIConfigSnapshot();
    const releaseDeferred = createDeferred<void>();
    const releaseSpy = vi.fn(() => releaseDeferred.promise);
    activeInputRelease.registerActiveInputRelease(releaseSpy);

    try {
      const { useSavedDeviceSwitching } = await import("@/hooks/useSavedDeviceSwitching");
      const { result } = renderHook(() => useSavedDeviceSwitching(), {
        wrapper: createWrapper("/play"),
      });

      let switchPromise!: Promise<unknown>;
      act(() => {
        switchPromise = result.current("device-backup");
      });

      expect(releaseSpy).toHaveBeenCalledTimes(1);
      // The API config must still target the OLD device while the release
      // to the old device is still in flight - the switch must not retarget
      // ahead of it.
      expect(c64api.getC64APIConfigSnapshot()).toMatchObject({ deviceHost: before.deviceHost });

      releaseDeferred.resolve();
      await act(async () => {
        await switchPromise;
      });

      expect(c64api.getC64APIConfigSnapshot()).toMatchObject({ deviceHost: "backup-c64:8080" });
    } finally {
      activeInputRelease.unregisterActiveInputRelease(releaseSpy);
    }
  });

  it("does not await anything when no Remote Input session is mounted (no unnecessary suspension)", async () => {
    const store = await import("@/lib/savedDevices/store");
    const activeInputRelease = await import("@/lib/remoteInput/activeInputRelease");
    expect(activeInputRelease.hasActiveInputRelease()).toBe(false);

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
    mockVerifyCurrentConnectionTarget.mockResolvedValueOnce({
      ok: true,
      deviceInfo: { product: "U64E", hostname: "backup-lab", unique_id: "UID-BACKUP" },
    });

    const { useSavedDeviceSwitching } = await import("@/hooks/useSavedDeviceSwitching");
    const { result } = renderHook(() => useSavedDeviceSwitching(), {
      wrapper: createWrapper("/play"),
    });

    // With nothing registered, verifyCurrentConnectionTarget is reached
    // synchronously within this act() - proves no unconditional suspension
    // was introduced for the common (no session mounted) case.
    act(() => {
      void result.current("device-backup");
    });
    expect(mockVerifyCurrentConnectionTarget).toHaveBeenCalledTimes(1);
  });

  it("invalidates C64 queries when saved-device verification reports offline", async () => {
    const store = await import("@/lib/savedDevices/store");
    store.addSavedDevice({
      id: "device-offline",
      name: "Offline Lab",
      host: "offline-c64",
      httpPort: 8080,
      ftpPort: 2021,
      telnetPort: 2323,
      hasPassword: false,
    });
    mockVerifyCurrentConnectionTarget.mockResolvedValueOnce({
      ok: false,
      deviceInfo: null,
      error: "Host unreachable",
    });

    const { useSavedDeviceSwitching } = await import("@/hooks/useSavedDeviceSwitching");
    const { result } = renderHook(() => useSavedDeviceSwitching(), {
      wrapper: createWrapper("/play"),
    });

    await act(async () => {
      await result.current("device-offline");
    });

    expect(mockInvalidateForSavedDeviceSwitch).toHaveBeenCalledWith(expect.any(QueryClient));
    expect(store.getSavedDeviceSwitchStatus("device-offline")).toBe("offline");
  });

  it("invalidates C64 queries when saved-device verification throws", async () => {
    const store = await import("@/lib/savedDevices/store");
    store.addSavedDevice({
      id: "device-error",
      name: "Error Lab",
      host: "error-c64",
      httpPort: 8080,
      ftpPort: 2021,
      telnetPort: 2323,
      hasPassword: false,
    });
    mockVerifyCurrentConnectionTarget.mockRejectedValueOnce(new Error("verification exploded"));

    const { useSavedDeviceSwitching } = await import("@/hooks/useSavedDeviceSwitching");
    const { result } = renderHook(() => useSavedDeviceSwitching(), {
      wrapper: createWrapper("/play"),
    });

    await expect(result.current("device-error")).rejects.toThrow("verification exploded");

    expect(mockInvalidateForSavedDeviceSwitch).toHaveBeenCalledWith(expect.any(QueryClient));
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

  // HARD18-011: a saved-device switch while Play is unmounted (idle
  // placeholder) previously left no code path allowed to stop the
  // foreground-service wake lock or clear the native auto-advance watchdog
  // — orphaning both until process death. Fixed in the switch flow itself
  // (not in PlayFilesPage's hasObservedActivePlaybackRef guard), so this is
  // covered here rather than in the BUG-040/025 suites.
  it("HARD18-011: stops orphaned background execution and clears the native due-time on a genuine device switch", async () => {
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
    mockIsBackgroundExecutionActive.mockReturnValue(true);
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

    expect(mockStopBackgroundExecution).toHaveBeenCalledWith(
      expect.objectContaining({ source: "saved-device-switch", reason: "saved-device-switch" }),
    );
    expect(mockSetDueAtMs).toHaveBeenCalledWith({ dueAtMs: null });
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Playback controls detached" }));
  });

  it("HARD18-011: does not touch background execution when none is active", async () => {
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
    mockIsBackgroundExecutionActive.mockReturnValue(false);
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

    expect(mockStopBackgroundExecution).not.toHaveBeenCalled();
    expect(mockSetDueAtMs).not.toHaveBeenCalled();
  });

  it("HARD18-011: logs (not throws) when stopping orphaned background execution fails, and still clears the due-time and shows the toast", async () => {
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
    mockIsBackgroundExecutionActive.mockReturnValueOnce(true);
    mockStopBackgroundExecution.mockRejectedValueOnce(new Error("stop failed"));
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

    expect(mockAddLog).toHaveBeenCalledWith(
      "warn",
      "Failed to stop orphaned background execution during saved-device switch",
      expect.objectContaining({ deviceId: "device-backup", error: "stop failed" }),
    );
    expect(mockSetDueAtMs).toHaveBeenCalledWith({ dueAtMs: null });
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Playback controls detached" }));
  });

  it("HARD18-011: logs (not throws) when clearing the native auto-skip due-time fails, and still shows the toast", async () => {
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
    mockIsBackgroundExecutionActive.mockReturnValueOnce(true);
    mockSetDueAtMs.mockRejectedValueOnce(new Error("clear due-time failed"));
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

    expect(mockAddLog).toHaveBeenCalledWith(
      "warn",
      "Failed to clear native auto-skip due-time during saved-device switch",
      expect.objectContaining({ deviceId: "device-backup", error: "clear due-time failed" }),
    );
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Playback controls detached" }));
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

  it("verifies the raw bare hostname even when an earlier resolved address exists", async () => {
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
    });
    expect(c64api.getC64APIConfigSnapshot()).toMatchObject({
      baseUrl: "http://u64",
      deviceHost: "u64",
    });
  });

  it("falls back to the raw bare hostname when no resolved address has been verified yet", async () => {
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
    });
    expect(mockVerifyCurrentConnectionTarget).toHaveBeenNthCalledWith(2, {
      deviceHost: "10.0.0.12",
      password: null,
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
    expect(mockInvalidateForSavedDeviceSwitch).toHaveBeenCalledWith(expect.any(QueryClient));

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

    expect(mockInvalidateForSavedDeviceSwitch).toHaveBeenCalledWith(expect.any(QueryClient));

    expect(metrics.getSavedDeviceSwitchMetricsSnapshot().attempts[0]).toMatchObject({
      fromDeviceId: initialDeviceId,
      toDeviceId: "device-backup",
      routePath: "/settings",
      outcome: "error",
      verificationOk: false,
      errorMessage: "Verification exploded",
    });
  });

  it("stops the live A/V mirror on the old device and restarts it on the verified new device", async () => {
    const store = await import("@/lib/savedDevices/store");
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
    // Live View is running when the user switches devices.
    mockAvMirror.videoLive = true;
    mockAvMirror.audioLive = true;

    const { useSavedDeviceSwitching } = await import("@/hooks/useSavedDeviceSwitching");
    const { result } = renderHook(() => useSavedDeviceSwitching(), { wrapper: createWrapper("/play") });

    await act(async () => {
      await result.current("device-backup");
    });

    // Stopped on the OLD device (before the API retarget), restarted on the NEW verified device —
    // so both devices never stream to the shared multicast group at once (clean transition).
    expect(mockAvMirror.stopAll).toHaveBeenCalledTimes(1);
    expect(mockAvMirror.startVideo).toHaveBeenCalledTimes(1);
    expect(mockAvMirror.startAudio).toHaveBeenCalledTimes(1);
  });

  it("does not restart the mirror when the new device fails to verify", async () => {
    const store = await import("@/lib/savedDevices/store");
    store.addSavedDevice({
      id: "device-offline",
      name: "Offline Lab",
      host: "offline-c64",
      httpPort: 80,
      ftpPort: 21,
      telnetPort: 23,
      hasPassword: false,
    });
    mockVerifyCurrentConnectionTarget.mockResolvedValueOnce({ ok: false, error: "Host unreachable" });
    mockAvMirror.videoLive = true;
    mockAvMirror.audioLive = false;

    const { useSavedDeviceSwitching } = await import("@/hooks/useSavedDeviceSwitching");
    const { result } = renderHook(() => useSavedDeviceSwitching(), { wrapper: createWrapper("/play") });

    await act(async () => {
      await result.current("device-offline");
    });

    // Old device's stream is stopped, but we do NOT start streaming on an unreachable device.
    expect(mockAvMirror.stopAll).toHaveBeenCalledTimes(1);
    expect(mockAvMirror.startVideo).not.toHaveBeenCalled();
    expect(mockAvMirror.startAudio).not.toHaveBeenCalled();
  });

  it("leaves the mirror untouched when Live View is not active", async () => {
    const store = await import("@/lib/savedDevices/store");
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
    // Live View off — nothing to stop or restart.
    mockAvMirror.videoLive = false;
    mockAvMirror.audioLive = false;

    const { useSavedDeviceSwitching } = await import("@/hooks/useSavedDeviceSwitching");
    const { result } = renderHook(() => useSavedDeviceSwitching(), { wrapper: createWrapper("/play") });

    await act(async () => {
      await result.current("device-backup");
    });

    expect(mockAvMirror.stopAll).not.toHaveBeenCalled();
    expect(mockAvMirror.startVideo).not.toHaveBeenCalled();
  });
});
