import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { ConnectionController } from "@/components/ConnectionController";

const connectionState = {
  value: "UNKNOWN" as
    | "UNKNOWN"
    | "DISCOVERING"
    | "REAL_CONNECTED"
    | "DEMO_ACTIVE"
    | "OFFLINE_NO_DEMO",
};

const discoverConnectionMock = vi.fn();
const initializeConnectionManagerMock = vi.fn(async () => {});
const hasStoredPasswordFlagMock = vi.fn(() => false);
const getPasswordMock = vi.fn(async () => "");

vi.mock("@/hooks/useConnectionState", () => ({
  useConnectionState: () => ({
    state: connectionState.value,
    lastDiscoveryTrigger: null,
    lastTransitionAtMs: 0,
    lastProbeAtMs: null,
    lastProbeSucceededAtMs: null,
    lastProbeFailedAtMs: null,
    lastProbeError: null,
    demoInterstitialVisible: false,
  }),
}));

vi.mock("@/lib/connection/connectionManager", () => ({
  discoverConnection: (...args: unknown[]) => discoverConnectionMock(...args),
  initializeConnectionManager: () => initializeConnectionManagerMock(),
  getConnectionSnapshot: () => ({
    state: connectionState.value,
    lastDiscoveryTrigger: null,
    lastTransitionAtMs: 0,
    lastProbeAtMs: null,
    lastProbeSucceededAtMs: null,
    lastProbeFailedAtMs: null,
    lastProbeError: null,
    demoInterstitialVisible: false,
  }),
}));

vi.mock("@/lib/c64api", () => ({
  buildBaseUrlFromDeviceHost: (host?: string) => `http://${host ?? "c64u"}`,
  resolveDeviceHostFromStorage: () => "c64u",
}));

vi.mock("@/lib/config/appSettings", () => ({
  loadBackgroundRediscoveryIntervalMs: () => 60_000,
}));

vi.mock("@/lib/secureStorage", () => ({
  getPassword: () => getPasswordMock(),
  hasStoredPasswordFlag: () => hasStoredPasswordFlagMock(),
}));

describe("ConnectionController", () => {
  beforeEach(() => {
    connectionState.value = "UNKNOWN";
    discoverConnectionMock.mockReset();
    discoverConnectionMock.mockResolvedValue(undefined);
    initializeConnectionManagerMock.mockReset();
    initializeConnectionManagerMock.mockResolvedValue(undefined);
    hasStoredPasswordFlagMock.mockReset();
    hasStoredPasswordFlagMock.mockReturnValue(false);
    getPasswordMock.mockReset();
    getPasswordMock.mockResolvedValue("");
  });

  it("invalidates only on meaningful connection transitions", async () => {
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const view = render(
      <QueryClientProvider client={queryClient}>
        <ConnectionController />
      </QueryClientProvider>,
    );

    expect(invalidateSpy).not.toHaveBeenCalled();

    connectionState.value = "REAL_CONNECTED";
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <ConnectionController />
      </QueryClientProvider>,
    );

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["c64-info"] });

    const callCountAfterConnect = invalidateSpy.mock.calls.length;

    connectionState.value = "REAL_CONNECTED";
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <ConnectionController />
      </QueryClientProvider>,
    );
    expect(invalidateSpy.mock.calls.length).toBe(callCountAfterConnect);

    connectionState.value = "DISCOVERING";
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <ConnectionController />
      </QueryClientProvider>,
    );

    expect(invalidateSpy.mock.calls.length).toBe(callCountAfterConnect + 1);
    expect(invalidateSpy).toHaveBeenLastCalledWith({ queryKey: ["c64-info"] });
  });

  it("stops background rediscovery scheduling after leaving demo state", async () => {
    vi.useFakeTimers();
    try {
      connectionState.value = "DEMO_ACTIVE";
      const queryClient = new QueryClient();

      const view = render(
        <QueryClientProvider client={queryClient}>
          <ConnectionController />
        </QueryClientProvider>,
      );

      await vi.advanceTimersByTimeAsync(60_000);

      connectionState.value = "REAL_CONNECTED";
      view.rerender(
        <QueryClientProvider client={queryClient}>
          <ConnectionController />
        </QueryClientProvider>,
      );

      discoverConnectionMock.mockClear();

      await vi.advanceTimersByTimeAsync(180_000);

      expect(discoverConnectionMock).not.toHaveBeenCalledWith("background");
    } finally {
      vi.useRealTimers();
    }
  });

  it("triggers settings rediscovery only when connection settings actually change", async () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <ConnectionController />
      </QueryClientProvider>,
    );

    discoverConnectionMock.mockClear();

    window.dispatchEvent(
      new CustomEvent("c64u-connection-change", {
        detail: { baseUrl: "http://c64u", password: "", deviceHost: "c64u" },
      }),
    );
    expect(discoverConnectionMock).not.toHaveBeenCalledWith("settings");

    window.dispatchEvent(
      new CustomEvent("c64u-connection-change", {
        detail: {
          baseUrl: "http://new-host",
          password: "pw",
          deviceHost: "new-host",
        },
      }),
    );

    expect(discoverConnectionMock).toHaveBeenCalledWith("settings");
  });

  it("reschedules background probes when app setting update event is emitted", async () => {
    vi.useFakeTimers();
    try {
      connectionState.value = "DEMO_ACTIVE";
      const queryClient = new QueryClient();

      render(
        <QueryClientProvider client={queryClient}>
          <ConnectionController />
        </QueryClientProvider>,
      );

      discoverConnectionMock.mockClear();
      window.dispatchEvent(
        new CustomEvent("c64u-app-settings-updated", {
          detail: { key: "c64u_background_rediscovery_interval_ms" },
        }),
      );

      await vi.advanceTimersByTimeAsync(60_000);
      expect(discoverConnectionMock).toHaveBeenCalledWith("background");
    } finally {
      vi.useRealTimers();
    }
  });

  it("primes settings baseline with stored password and avoids false-positive rediscovery", async () => {
    hasStoredPasswordFlagMock.mockReturnValue(true);
    getPasswordMock.mockResolvedValue("pw");
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <ConnectionController />
      </QueryClientProvider>,
    );

    await Promise.resolve();
    await Promise.resolve();
    discoverConnectionMock.mockClear();

    window.dispatchEvent(
      new CustomEvent("c64u-connection-change", {
        detail: { baseUrl: "http://c64u", password: "pw", deviceHost: "c64u" },
      }),
    );

    expect(discoverConnectionMock).not.toHaveBeenCalledWith("settings");
  });

  it("skips background scheduling when test probes disable rediscovery", async () => {
    vi.useFakeTimers();
    const windowWithProbeGate = window as Window & {
      __c64uAllowBackgroundRediscovery?: boolean;
    };
    const previousAllow = windowWithProbeGate.__c64uAllowBackgroundRediscovery;
    vi.stubEnv("VITE_ENABLE_TEST_PROBES", "1");

    try {
      windowWithProbeGate.__c64uAllowBackgroundRediscovery = false;
      connectionState.value = "DEMO_ACTIVE";

      const queryClient = new QueryClient();
      render(
        <QueryClientProvider client={queryClient}>
          <ConnectionController />
        </QueryClientProvider>,
      );

      discoverConnectionMock.mockClear();
      await vi.advanceTimersByTimeAsync(120_000);

      const triggers = discoverConnectionMock.mock.calls.map((call) => call[0]);
      expect(triggers).not.toContain("background");
    } finally {
      vi.unstubAllEnvs();
      windowWithProbeGate.__c64uAllowBackgroundRediscovery = previousAllow;
      vi.useRealTimers();
    }
  });

  it("aborts scheduled timer callback when rediscovery gate closes before callback executes", async () => {
    vi.useFakeTimers();
    const windowWithProbeGate = window as Window & {
      __c64uAllowBackgroundRediscovery?: boolean;
    };
    const previousAllow = windowWithProbeGate.__c64uAllowBackgroundRediscovery;
    vi.stubEnv("VITE_ENABLE_TEST_PROBES", "1");

    const callbacks: Array<() => void> = [];
    const setTimeoutSpy = vi.spyOn(window, "setTimeout").mockImplementation(((
      cb: TimerHandler,
    ) => {
      callbacks.push(cb as () => void);
      return callbacks.length as unknown as number;
    }) as typeof window.setTimeout);
    const clearTimeoutSpy = vi
      .spyOn(window, "clearTimeout")
      .mockImplementation(() => undefined);

    try {
      windowWithProbeGate.__c64uAllowBackgroundRediscovery = true;
      connectionState.value = "DEMO_ACTIVE";
      const queryClient = new QueryClient();

      render(
        <QueryClientProvider client={queryClient}>
          <ConnectionController />
        </QueryClientProvider>,
      );

      discoverConnectionMock.mockClear();
      expect(callbacks.length).toBeGreaterThan(0);

      windowWithProbeGate.__c64uAllowBackgroundRediscovery = false;
      callbacks[0]();

      expect(discoverConnectionMock).not.toHaveBeenCalledWith("background");
      expect(clearTimeoutSpy).toHaveBeenCalled();
    } finally {
      setTimeoutSpy.mockRestore();
      clearTimeoutSpy.mockRestore();
      vi.unstubAllEnvs();
      windowWithProbeGate.__c64uAllowBackgroundRediscovery = previousAllow;
      vi.useRealTimers();
    }
  });
});
