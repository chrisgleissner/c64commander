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
} = vi.hoisted(() => ({
  mockVerifyCurrentConnectionTarget: vi.fn(),
  mockSetStoredFtpPort: vi.fn(),
  mockSetStoredTelnetPort: vi.fn(),
  mockInvalidateForSavedDeviceSwitch: vi.fn(),
  mockGetPasswordForDevice: vi.fn(),
  mockResetInteractionState: vi.fn(),
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

describe("useSavedDeviceSwitching import cancellation event", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("publishes the saved-device switch connection-change event before verification resolves", async () => {
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

    const { useSavedDeviceSwitching } = await import("@/hooks/useSavedDeviceSwitching");
    const verification = createDeferred<{
      ok: boolean;
      deviceInfo: { product: string; hostname: string; unique_id: string };
    }>();
    mockVerifyCurrentConnectionTarget.mockReturnValueOnce(verification.promise);

    const eventSpy = vi.fn();
    const handler = (event: Event) => eventSpy((event as CustomEvent).detail);
    window.addEventListener("c64u-connection-change", handler as EventListener);

    try {
      const { result } = renderHook(() => useSavedDeviceSwitching(), {
        wrapper: createWrapper("/play"),
      });

      let switchPromise!: Promise<unknown>;
      act(() => {
        switchPromise = result.current("device-backup");
      });

      expect(mockResetInteractionState).toHaveBeenCalledWith("saved-device-switch");
      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: "saved-device-switch",
          deviceHost: "backup-c64:8080",
        }),
      );

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
    } finally {
      window.removeEventListener("c64u-connection-change", handler as EventListener);
    }
  });
});
