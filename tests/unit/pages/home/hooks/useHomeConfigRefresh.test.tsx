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
const fakeApi = vi.hoisted(() => ({
  baseUrl: "http://device-0",
  requests: [] as string[],
  wildcard: null as null | (() => Promise<Record<string, unknown>>),
  getBaseUrl() {
    return this.baseUrl;
  },
  getAllConfigCategories: vi.fn(),
  selectConfigItems: vi.fn(),
}));

vi.mock("@/lib/logging", () => ({ addLog: addLogMock, addErrorLog: vi.fn() }));
vi.mock("@/lib/c64api", () => ({ getC64API: () => fakeApi }));
vi.mock("@/hooks/useSavedDevices", () => ({ useSavedDevices: () => ({ selectedDeviceId: "device-a" }) }));
vi.mock("@/lib/config/deviceSafetySettings", () => ({
  loadDeviceSafetyConfig: () => ({ configsCacheMs: 1000, configsCooldownMs: 500, backoffBaseMs: 200 }),
}));

type ItemsPayload = Record<string, { items: Record<string, unknown> }>;

const device: Record<string, Record<string, unknown>> = {};
const resetDevice = () => {
  device["Audio Mixer"] = { "Vol Master": 0 };
  device["LED Strip Settings"] = { "LedStrip Mode": "Fixed Color" };
  device["Printer Settings"] = { "IEC printer": "Off" };
};

const readCategory = (category: string, items: string[]): ItemsPayload => ({
  [category]: { items: Object.fromEntries(items.map((item) => [item, device[category][item]])) },
});

const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { c64uHttpStatus: status });

const volDomain = createNumericSliderDomain({ min: -42, max: 6, round: Math.round });

const useConfigItems = (category: string, items: string[], enabled = true) =>
  useQuery({
    queryKey: ["c64-config-items", category, items.join("|"), 0],
    queryFn: async () => {
      fakeApi.requests.push(`/v1/configs/${category}`);
      return readCategory(category, items);
    },
    enabled,
    staleTime: 30_000,
  });

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
  const audio = useConfigItems("Audio Mixer", ["Vol Master"]);
  const led = useConfigItems("LED Strip Settings", ["LedStrip Mode"]);
  useConfigItems("Printer Settings", ["IEC printer"], false);
  useQuery({
    queryKey: ["c64-drives", 0],
    queryFn: async () => {
      fakeApi.requests.push("/v1/drives");
      return {};
    },
    staleTime: 30_000,
  });
  const slider = useDeviceBoundSlider({
    debugName: "vol-master",
    deviceValue: Number(audio.data?.["Audio Mixer"].items["Vol Master"] ?? 0),
    domain: volDomain,
    previewMode: "commitOnly",
    commit: () => undefined,
  });
  return (
    <div>
      <span data-testid="vol-master">{String(slider.displayValue)}</span>
      <span data-testid="led-mode">{String(led.data?.["LED Strip Settings"].items["LedStrip Mode"] ?? "")}</span>
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
    await vi.advanceTimersByTimeAsync(50);
  });
};

const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

const focusWindow = async () => {
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  await settle();
};

const wildcardRequests = () => fakeApi.requests.filter((path) => path === "/v1/configs/*").length;

let baseUrlCounter = 0;

describe("useHomeConfigRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-02T12:00:00Z"));
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
    visibility = "visible";
    resetDevice();
    baseUrlCounter += 1;
    fakeApi.baseUrl = `http://device-${baseUrlCounter}`;
    fakeApi.requests = [];
    fakeApi.wildcard = null;
    fakeApi.getAllConfigCategories.mockReset().mockImplementation(async () => {
      fakeApi.requests.push("/v1/configs/*");
      if (fakeApi.wildcard) return fakeApi.wildcard();
      return { ...structuredClone(device), errors: [] };
    });
    fakeApi.selectConfigItems
      .mockReset()
      .mockImplementation((all: Record<string, Record<string, unknown>>, category: string, items: string[]) =>
        Object.hasOwn(all, category)
          ? { [category]: { items: Object.fromEntries(items.map((item) => [item, all[category][item]])) } }
          : null,
      );
    pollingPauseRegistry.__resetForTest();
    resetDeviceActivityGate();
    addLogMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("one refresh issues exactly one GET /v1/configs/* and updates every mounted category", async () => {
    renderHome();
    await settle();
    expect(fakeApi.requests.sort()).toEqual([
      "/v1/configs/Audio Mixer",
      "/v1/configs/LED Strip Settings",
      "/v1/drives",
    ]);
    fakeApi.requests = [];

    device["Audio Mixer"]["Vol Master"] = -6;
    device["LED Strip Settings"]["LedStrip Mode"] = "Rainbow";
    await focusWindow();

    expect(fakeApi.requests).toEqual(["/v1/configs/*"]);
    expect(fakeApi.getAllConfigCategories).toHaveBeenCalledWith(
      expect.objectContaining({ __c64uIntent: "background", timeoutMs: 3_000 }),
    );
    expect(screen.getByTestId("vol-master").textContent).toBe("-6");
    expect(screen.getByTestId("led-mode").textContent).toBe("Rainbow");
    expect(fakeApi.selectConfigItems).not.toHaveBeenCalledWith(
      expect.anything(),
      "Printer Settings",
      expect.anything(),
    );
  });

  it("falls back to one read per mounted category when the firmware rejects the wildcard, and remembers it", async () => {
    const { refetchSpy } = renderHome();
    await settle();
    fakeApi.requests = [];
    fakeApi.wildcard = async () => {
      throw httpError(404);
    };

    device["Audio Mixer"]["Vol Master"] = -3;
    await focusWindow();
    expect(fakeApi.requests.sort()).toEqual([
      "/v1/configs/*",
      "/v1/configs/Audio Mixer",
      "/v1/configs/LED Strip Settings",
    ]);
    expect(screen.getByTestId("vol-master").textContent).toBe("-3");

    fakeApi.requests = [];
    await advance(HOME_CONFIG_REFRESH_INTERVAL_MS);
    await settle();
    expect(fakeApi.requests.sort()).toEqual(["/v1/configs/Audio Mixer", "/v1/configs/LED Strip Settings"]);
    expect(refetchSpy).toHaveBeenCalledTimes(2);
    const fallbackLogs = addLogMock.mock.calls.filter(
      ([level, message]) =>
        level === "info" && message === "Device does not answer the config wildcard read; Home refreshes per category",
    );
    expect(fallbackLogs).toHaveLength(1);
  });

  it("does not fall back on a server error or a password challenge; it logs and retries the wildcard", async () => {
    const { refetchSpy } = renderHome();
    await settle();
    fakeApi.wildcard = async () => {
      throw httpError(503);
    };
    await focusWindow();
    fakeApi.wildcard = async () => {
      throw httpError(401);
    };
    await advance(HOME_CONFIG_REFRESH_INTERVAL_MS);
    await settle();

    expect(refetchSpy).not.toHaveBeenCalled();
    expect(wildcardRequests()).toBe(2);
    expect(addLogMock).toHaveBeenCalledWith("warn", "Home config refresh failed", expect.anything());
  });

  it("refreshes on window focus and when the page becomes visible again", async () => {
    renderHome();
    await settle();

    await focusWindow();
    expect(wildcardRequests()).toBe(1);

    setVisibility("hidden");
    await advance(5_000);
    await act(async () => {
      setVisibility("visible");
    });
    await settle();
    expect(wildcardRequests()).toBe(2);
  });

  it("refreshes on every interval while Home stays visible", async () => {
    renderHome();
    await settle();

    await advance(HOME_CONFIG_REFRESH_INTERVAL_MS);
    expect(wildcardRequests()).toBe(1);
    await advance(HOME_CONFIG_REFRESH_INTERVAL_MS);
    expect(wildcardRequests()).toBe(2);
  });

  it("issues no request while the page is hidden, and resumes when it is shown", async () => {
    renderHome();
    await settle();
    const before = fakeApi.requests.length;

    setVisibility("hidden");
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await advance(HOME_CONFIG_REFRESH_INTERVAL_MS * 6);
    expect(fakeApi.requests.length).toBe(before);

    await act(async () => {
      setVisibility("visible");
    });
    await settle();
    expect(wildcardRequests()).toBe(1);
  });

  it("issues no request while the device is offline or in demo, and starts once it is connected", async () => {
    const { rerenderHome } = renderHome({ connected: false });
    await settle();
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await advance(HOME_CONFIG_REFRESH_INTERVAL_MS * 3);
    expect(wildcardRequests()).toBe(0);

    rerenderHome({ connected: true });
    await advance(HOME_CONFIG_REFRESH_INTERVAL_MS);
    expect(wildcardRequests()).toBe(1);
  });

  it("shows a value changed on the device within one interval", async () => {
    renderHome();
    await settle();
    expect(screen.getByTestId("vol-master").textContent).toBe("0");

    device["Audio Mixer"]["Vol Master"] = -6;
    await advance(HOME_CONFIG_REFRESH_INTERVAL_MS);
    await settle();

    expect(screen.getByTestId("vol-master").textContent).toBe("-6");
  });

  it("does not read or overwrite a slider while it is being dragged, and catches up after the drag", async () => {
    renderHome();
    await settle();
    fireEvent.click(screen.getByTestId("drag-to-minus-ten"));
    expect(screen.getByTestId("vol-master").textContent).toBe("-10");

    device["Audio Mixer"]["Vol Master"] = 3;
    await advance(HOME_CONFIG_REFRESH_INTERVAL_MS * 2);

    expect(wildcardRequests()).toBe(0);
    expect(screen.getByTestId("vol-master").textContent).toBe("-10");

    await act(async () => {
      pollingPauseRegistry.__resetForTest();
    });
    await advance(HOME_CONFIG_REFRESH_RETRY_MS);
    expect(wildcardRequests()).toBe(1);
  });

  it("discards a response that arrives after a drag started, leaving the dragged control's cache alone", async () => {
    const { queryClient } = renderHome();
    await settle();
    let release!: () => void;
    fakeApi.wildcard = () =>
      new Promise((resolve) => {
        release = () => resolve({ ...structuredClone(device), errors: [] });
      });
    device["Audio Mixer"]["Vol Master"] = 3;

    await focusWindow();
    fireEvent.click(screen.getByTestId("drag-to-minus-ten"));
    await act(async () => {
      release();
    });
    await settle();

    expect(queryClient.getQueryData(["c64-config-items", "Audio Mixer", "Vol Master", 0])).toEqual({
      "Audio Mixer": { items: { "Vol Master": 0 } },
    });
    expect(screen.getByTestId("vol-master").textContent).toBe("-10");
  });

  it("leaves a control with a pending write alone and updates the other categories from the same response", async () => {
    const { queryClient, rerenderHome } = renderHome();
    await settle();
    let release!: () => void;
    fakeApi.wildcard = () =>
      new Promise((resolve) => {
        release = () => resolve({ ...structuredClone(device), errors: [] });
      });
    device["Audio Mixer"]["Vol Master"] = 3;
    device["LED Strip Settings"]["LedStrip Mode"] = "Rainbow";

    await focusWindow();
    rerenderHome({ configWritePending: { "Audio Mixer::Vol Master": true } });
    await act(async () => {
      release();
    });
    await settle();

    expect(queryClient.getQueryData(["c64-config-items", "Audio Mixer", "Vol Master", 0])).toEqual({
      "Audio Mixer": { items: { "Vol Master": 0 } },
    });
    expect(screen.getByTestId("led-mode").textContent).toBe("Rainbow");
  });

  it("defers while a text field is being edited and refreshes once editing ends", async () => {
    renderHome();
    await settle();
    const input = screen.getByTestId("stream-endpoint") as HTMLInputElement;
    input.focus();

    await advance(HOME_CONFIG_REFRESH_INTERVAL_MS);
    expect(wildcardRequests()).toBe(0);

    input.blur();
    await advance(HOME_CONFIG_REFRESH_RETRY_MS);
    expect(wildcardRequests()).toBe(1);
  });

  it("defers while a Home config write is pending and refreshes once it settles", async () => {
    const { rerenderHome } = renderHome({ configWritePending: { "Audio Mixer::Vol Master": true } });
    await settle();
    await advance(HOME_CONFIG_REFRESH_INTERVAL_MS * 2);
    expect(wildcardRequests()).toBe(0);

    rerenderHome({ configWritePending: { "Audio Mixer::Vol Master": false } });
    await advance(HOME_CONFIG_REFRESH_RETRY_MS);
    expect(wildcardRequests()).toBe(1);
  });

  it("defers while a machine transition or its cooldown is active, and while any device request is in flight", async () => {
    renderHome();
    await settle();

    const endTransition = beginMachineTransition(3_000);
    await advance(HOME_CONFIG_REFRESH_INTERVAL_MS);
    expect(wildcardRequests()).toBe(0);
    endTransition();
    await advance(2_000);
    expect(wildcardRequests()).toBe(0);
    await advance(2_000);
    expect(wildcardRequests()).toBe(1);

    markDeviceRequestStart();
    await advance(HOME_CONFIG_REFRESH_INTERVAL_MS);
    expect(wildcardRequests()).toBe(1);
    markDeviceRequestEnd({ success: true });
    await advance(HOME_CONFIG_REFRESH_RETRY_MS);
    expect(wildcardRequests()).toBe(2);
  });

  it("refreshes after a non-config device action settles, not after a config write", async () => {
    renderHome();
    await settle();

    publishDeviceWrite("/v1/configs/Audio Mixer");
    await advance(HOME_CONFIG_REFRESH_ACTION_SETTLE_MS);
    expect(wildcardRequests()).toBe(0);

    publishDeviceWrite("/v1/machine:menu_button");
    await advance(HOME_CONFIG_REFRESH_ACTION_SETTLE_MS);
    expect(wildcardRequests()).toBe(1);

    publishDeviceWrite(TELNET_DEVICE_ACTION);
    await advance(HOME_CONFIG_REFRESH_ACTION_SETTLE_MS);
    expect(wildcardRequests()).toBe(2);
  });

  it("does not re-read config after Remote Input keystrokes, stream toggles, memory access or pause", async () => {
    renderHome();
    await settle();

    for (const path of [
      "/v1/machine:input",
      "/v1/streams/video:start",
      "/v1/streams/audio:stop",
      "/v1/machine:writemem",
      "/v1/machine:pause",
      "/v1/machine:resume",
      "/v1/runners:sidplay",
    ]) {
      publishDeviceWrite(path);
      await advance(HOME_CONFIG_REFRESH_ACTION_SETTLE_MS);
    }
    expect(wildcardRequests()).toBe(0);

    for (const path of ["/v1/machine:reset", "/v1/drives/a:mount", "/v1/runners:run_prg"]) {
      publishDeviceWrite(path);
      await advance(HOME_CONFIG_REFRESH_ACTION_SETTLE_MS);
    }
    expect(wildcardRequests()).toBe(3);
  });

  it("keeps one refresh in flight: later triggers queue a single trailing refresh", async () => {
    renderHome();
    await settle();
    let release!: () => void;
    fakeApi.wildcard = () =>
      new Promise((resolve) => {
        release = () => resolve({ ...structuredClone(device), errors: [] });
      });

    await focusWindow();
    await advance(3_000);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      setVisibility("visible");
    });
    publishDeviceWrite("/v1/machine:reset");
    await advance(HOME_CONFIG_REFRESH_ACTION_SETTLE_MS);
    expect(wildcardRequests()).toBe(1);

    fakeApi.wildcard = null;
    await act(async () => {
      release();
    });
    await settle();
    expect(wildcardRequests()).toBe(2);
  });

  it("releases the single-flight slot after the timeout", async () => {
    renderHome();
    await settle();
    fakeApi.wildcard = () => new Promise(() => undefined);

    await advance(HOME_CONFIG_REFRESH_INTERVAL_MS);
    expect(wildcardRequests()).toBe(1);
    await advance(HOME_CONFIG_REFRESH_INTERVAL_MS / 2);
    expect(wildcardRequests()).toBe(1);

    await advance(HOME_CONFIG_REFRESH_TIMEOUT_MS - HOME_CONFIG_REFRESH_INTERVAL_MS / 2);
    expect(addLogMock).toHaveBeenCalledWith(
      "warn",
      "Home config refresh timed out; releasing the single-flight slot",
      expect.objectContaining({ timeoutMs: HOME_CONFIG_REFRESH_TIMEOUT_MS }),
    );

    await advance(HOME_CONFIG_REFRESH_INTERVAL_MS - HOME_CONFIG_REFRESH_TIMEOUT_MS);
    expect(wildcardRequests()).toBe(2);
  });
});
