import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HOME_CONFIG_REFRESH_ACTION_SETTLE_MS,
  HOME_CONFIG_REFRESH_INTERVAL_MS,
  HOME_CONFIG_REFRESH_RETRY_MS,
  HOME_CONFIG_REFRESH_TIMEOUT_MS,
  useHomeConfigRefresh,
} from "@/pages/home/hooks/useHomeConfigRefresh";
import { createNumericSliderDomain, useDeviceBoundSlider } from "@/hooks/useDeviceBoundSlider";
import { pollingPauseRegistry } from "@/lib/query/c64PollingGovernance";
import { beginMachineTransition, resetDeviceActivityGate } from "@/lib/deviceInteraction/deviceActivityGate";
import { markDeviceRequestEnd, markDeviceRequestStart } from "@/lib/deviceInteraction/deviceStateStore";
import { publishDeviceWrite, TELNET_DEVICE_ACTION } from "@/lib/deviceInteraction/deviceWriteEvents";

const addLogMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/logging", () => ({ addLog: addLogMock, addErrorLog: vi.fn() }));
vi.mock("@/hooks/useSavedDevices", () => ({ useSavedDevices: () => ({ selectedDeviceId: "device-a" }) }));
vi.mock("@/lib/config/deviceSafetySettings", () => ({
  loadDeviceSafetyConfig: () => ({ configsCacheMs: 1000, configsCooldownMs: 500, backoffBaseMs: 200 }),
}));

const device = { volMaster: 0, ledMode: "Fixed Color" };
const fetchCounts = { volMaster: 0, ledMode: 0, drives: 0, hidden: 0 };
let volMasterFetch: () => Promise<number> = async () => device.volMaster;

const volDomain = createNumericSliderDomain({ min: -42, max: 6, round: Math.round });

/**
 * Stands in for Home: two config reads it shows, a drives read the refresh must not touch, a
 * config read that is disabled (a section Home is not showing), a real device-bound slider and a
 * text field.
 */
function HomeHarness({
  connected = true,
  configWritePending = {},
}: {
  connected?: boolean;
  configWritePending?: Record<string, boolean>;
}) {
  useHomeConfigRefresh({ connected, configWritePending });
  const volMaster = useQuery({
    queryKey: ["c64-config-items", "Audio Mixer", "Vol Master", 0],
    queryFn: () => {
      fetchCounts.volMaster += 1;
      return volMasterFetch();
    },
    staleTime: 30_000,
  });
  useQuery({
    queryKey: ["c64-config-items", "LED Strip Settings", "LedStrip Mode", 0],
    queryFn: async () => {
      fetchCounts.ledMode += 1;
      return device.ledMode;
    },
    staleTime: 30_000,
  });
  useQuery({
    queryKey: ["c64-drives", 0],
    queryFn: async () => {
      fetchCounts.drives += 1;
      return {};
    },
    staleTime: 30_000,
  });
  useQuery({
    queryKey: ["c64-config-items", "Printer Settings", "IEC printer", 0],
    queryFn: async () => {
      fetchCounts.hidden += 1;
      return "Off";
    },
    enabled: false,
  });
  const slider = useDeviceBoundSlider({
    debugName: "vol-master",
    deviceValue: volMaster.data ?? 0,
    domain: volDomain,
    previewMode: "commitOnly",
    commit: () => undefined,
  });
  return (
    <div>
      <span data-testid="vol-master">{String(slider.displayValue)}</span>
      <button type="button" data-testid="drag-to-minus-ten" onClick={() => slider.onValueChange([-10])}>
        drag
      </button>
      <input data-testid="stream-endpoint" type="text" defaultValue="" />
    </div>
  );
}

let visibility: DocumentVisibilityState = "visible";
const setVisibility = (next: DocumentVisibilityState) => {
  visibility = next;
  document.dispatchEvent(new Event("visibilitychange"));
};

const renderHome = (props: Parameters<typeof HomeHarness>[0] = {}) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const refetchSpy = vi.spyOn(queryClient, "refetchQueries");
  const view = render(
    <QueryClientProvider client={queryClient}>
      <HomeHarness {...props} />
    </QueryClientProvider>,
  );
  const rerenderHome = (next: Parameters<typeof HomeHarness>[0]) =>
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <HomeHarness {...next} />
      </QueryClientProvider>,
    );
  return { ...view, queryClient, refetchSpy, rerenderHome };
};

const settle = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
};

const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

describe("useHomeConfigRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-02T12:00:00Z"));
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
    visibility = "visible";
    device.volMaster = 0;
    device.ledMode = "Fixed Color";
    fetchCounts.volMaster = 0;
    fetchCounts.ledMode = 0;
    fetchCounts.drives = 0;
    fetchCounts.hidden = 0;
    volMasterFetch = async () => device.volMaster;
    pollingPauseRegistry.__resetForTest();
    resetDeviceActivityGate();
    addLogMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("one refresh re-reads exactly the config queries the page load read: 2 reads, drives and disabled reads untouched", async () => {
    renderHome();
    await settle();
    const pageLoad = { ...fetchCounts };
    expect(pageLoad).toEqual({ volMaster: 1, ledMode: 1, drives: 1, hidden: 0 });

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await settle();

    expect(fetchCounts.volMaster - pageLoad.volMaster + fetchCounts.ledMode - pageLoad.ledMode).toBe(
      pageLoad.volMaster + pageLoad.ledMode,
    );
    expect(fetchCounts.drives).toBe(1);
    expect(fetchCounts.hidden).toBe(0);
  });

  it("refreshes on window focus and when the page becomes visible again", async () => {
    const { refetchSpy } = renderHome();
    await settle();

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await settle();
    expect(fetchCounts.volMaster).toBe(2);

    setVisibility("hidden");
    await advance(5_000);
    await act(async () => {
      setVisibility("visible");
    });
    await settle();
    expect(fetchCounts.volMaster).toBe(3);
    expect(refetchSpy).toHaveBeenCalledTimes(2);
  });

  it("refreshes on every interval while Home stays visible", async () => {
    renderHome();
    await settle();

    await advance(HOME_CONFIG_REFRESH_INTERVAL_MS);
    expect(fetchCounts.volMaster).toBe(2);
    await advance(HOME_CONFIG_REFRESH_INTERVAL_MS);
    expect(fetchCounts.volMaster).toBe(3);
    expect(fetchCounts.ledMode).toBe(3);
  });

  it("issues no request while the page is hidden, and resumes when it is shown", async () => {
    const { refetchSpy } = renderHome();
    await settle();

    setVisibility("hidden");
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await advance(HOME_CONFIG_REFRESH_INTERVAL_MS * 6);
    expect(refetchSpy).not.toHaveBeenCalled();
    expect(fetchCounts.volMaster).toBe(1);

    await act(async () => {
      setVisibility("visible");
    });
    await settle();
    expect(fetchCounts.volMaster).toBe(2);
  });

  it("issues no request while the device is offline or in demo, and starts once it is connected", async () => {
    const { refetchSpy, rerenderHome } = renderHome({ connected: false });
    await settle();
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await advance(HOME_CONFIG_REFRESH_INTERVAL_MS * 3);
    expect(refetchSpy).not.toHaveBeenCalled();

    rerenderHome({ connected: true });
    await advance(HOME_CONFIG_REFRESH_INTERVAL_MS);
    expect(refetchSpy).toHaveBeenCalledTimes(1);
  });

  it("shows a value changed on the device within one interval", async () => {
    renderHome();
    await settle();
    expect(screen.getByTestId("vol-master").textContent).toBe("0");

    device.volMaster = -6;
    await advance(HOME_CONFIG_REFRESH_INTERVAL_MS);
    await advance(50);

    expect(screen.getByTestId("vol-master").textContent).toBe("-6");
  });

  it("does not overwrite a slider while it is being dragged, and catches up after the drag", async () => {
    renderHome();
    await settle();
    fireEvent.click(screen.getByTestId("drag-to-minus-ten"));
    expect(screen.getByTestId("vol-master").textContent).toBe("-10");

    device.volMaster = 3;
    await advance(HOME_CONFIG_REFRESH_INTERVAL_MS * 2);

    expect(fetchCounts.volMaster).toBe(1);
    expect(screen.getByTestId("vol-master").textContent).toBe("-10");

    await act(async () => {
      pollingPauseRegistry.__resetForTest();
    });
    await advance(HOME_CONFIG_REFRESH_RETRY_MS);
    expect(fetchCounts.volMaster).toBe(2);
  });

  it("defers while a text field is being edited and refreshes once editing ends", async () => {
    renderHome();
    await settle();
    const input = screen.getByTestId("stream-endpoint") as HTMLInputElement;
    input.focus();

    await advance(HOME_CONFIG_REFRESH_INTERVAL_MS);
    expect(fetchCounts.volMaster).toBe(1);

    input.blur();
    await advance(HOME_CONFIG_REFRESH_RETRY_MS);
    expect(fetchCounts.volMaster).toBe(2);
  });

  it("defers while a Home config write is pending and refreshes once it settles", async () => {
    const { rerenderHome } = renderHome({ configWritePending: { "Audio Mixer::Vol Master": true } });
    await settle();
    await advance(HOME_CONFIG_REFRESH_INTERVAL_MS * 2);
    expect(fetchCounts.volMaster).toBe(1);

    rerenderHome({ configWritePending: { "Audio Mixer::Vol Master": false } });
    await advance(HOME_CONFIG_REFRESH_RETRY_MS);
    expect(fetchCounts.volMaster).toBe(2);
  });

  it("defers while a machine transition or its cooldown is active, and while any device request is in flight", async () => {
    renderHome();
    await settle();

    const endTransition = beginMachineTransition(3_000);
    await advance(HOME_CONFIG_REFRESH_INTERVAL_MS);
    expect(fetchCounts.volMaster).toBe(1);
    endTransition();
    await advance(2_000);
    expect(fetchCounts.volMaster).toBe(1);
    await advance(2_000);
    expect(fetchCounts.volMaster).toBe(2);

    markDeviceRequestStart();
    await advance(HOME_CONFIG_REFRESH_INTERVAL_MS);
    expect(fetchCounts.volMaster).toBe(2);
    markDeviceRequestEnd({ success: true });
    await advance(HOME_CONFIG_REFRESH_RETRY_MS);
    expect(fetchCounts.volMaster).toBe(3);
  });

  it("refreshes after a non-config device action settles, not after a config write", async () => {
    renderHome();
    await settle();

    publishDeviceWrite("/v1/configs/Audio Mixer");
    await advance(HOME_CONFIG_REFRESH_ACTION_SETTLE_MS);
    expect(fetchCounts.volMaster).toBe(1);

    publishDeviceWrite("/v1/machine:menu_button");
    await advance(HOME_CONFIG_REFRESH_ACTION_SETTLE_MS);
    expect(fetchCounts.volMaster).toBe(2);

    publishDeviceWrite(TELNET_DEVICE_ACTION);
    await advance(HOME_CONFIG_REFRESH_ACTION_SETTLE_MS);
    expect(fetchCounts.volMaster).toBe(3);
  });

  it("keeps one refresh in flight: later triggers queue a single trailing refresh", async () => {
    let release!: () => void;
    const { refetchSpy } = renderHome();
    await settle();
    volMasterFetch = () =>
      new Promise<number>((resolve) => {
        release = () => resolve(device.volMaster);
      });

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await advance(3_000);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      setVisibility("visible");
    });
    publishDeviceWrite("/v1/machine:reset");
    await advance(HOME_CONFIG_REFRESH_ACTION_SETTLE_MS);

    expect(refetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchCounts.volMaster).toBe(2);

    volMasterFetch = async () => device.volMaster;
    await act(async () => {
      release();
    });
    await settle();
    expect(refetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchCounts.volMaster).toBe(3);
  });

  it("releases the single-flight slot after the timeout without re-sending the read still on the wire", async () => {
    const { refetchSpy } = renderHome();
    await settle();
    volMasterFetch = () => new Promise<number>(() => undefined);

    await advance(HOME_CONFIG_REFRESH_INTERVAL_MS);
    expect(refetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchCounts.volMaster).toBe(2);

    await advance(HOME_CONFIG_REFRESH_TIMEOUT_MS);
    expect(addLogMock).toHaveBeenCalledWith(
      "warn",
      "Home config refresh timed out; releasing the single-flight slot",
      expect.objectContaining({ timeoutMs: HOME_CONFIG_REFRESH_TIMEOUT_MS }),
    );

    await advance(HOME_CONFIG_REFRESH_INTERVAL_MS - HOME_CONFIG_REFRESH_TIMEOUT_MS);
    expect(refetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchCounts.volMaster).toBe(2);
  });
});
