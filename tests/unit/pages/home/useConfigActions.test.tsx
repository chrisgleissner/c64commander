import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const setConfigValueMock = vi.fn();
const getDrivesMock = vi.fn();
const invalidateQueriesMock = vi.fn(async () => undefined);
const fetchQueryMock = vi.fn(async ({ queryFn }: { queryFn?: () => Promise<unknown> }) => queryFn?.());
const toastMock = vi.fn();
const reportUserErrorMock = vi.fn();
const buildConfigKeyMock = vi.fn((category: string, itemName: string) => `${category}:${itemName}`);
const readItemValueMock = vi.fn();
const updateHasChangesMock = vi.fn();
const getActiveBaseUrlMock = vi.fn(() => "http://c64u");
const routingEpochRef = vi.hoisted(() => ({ current: 0 }));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: invalidateQueriesMock,
    fetchQuery: fetchQueryMock,
  }),
}));

vi.mock("@/hooks/useActionTrace", () => ({
  useActionTrace: () => {
    const trace = <T extends (...args: never[]) => unknown>(fn: T) => fn;
    trace.scope = async (_name: string, fn: () => Promise<unknown>) => fn();
    return trace;
  },
}));

vi.mock("@/lib/c64api", () => ({
  getC64API: () => ({
    setConfigValue: setConfigValueMock,
    getDrives: getDrivesMock,
  }),
}));

vi.mock("@/pages/home/utils/HomeConfigUtils", () => ({
  buildConfigKey: (...args: [string, string]) => buildConfigKeyMock(...args),
  readItemValue: (...args: [unknown, string, string]) => readItemValueMock(...args),
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: (...args: unknown[]) => toastMock(...args),
}));

vi.mock("@/lib/uiErrors", () => ({
  reportUserError: (...args: unknown[]) => reportUserErrorMock(...args),
}));

vi.mock("@/lib/config/appConfigStore", () => ({
  getActiveBaseUrl: (...args: unknown[]) => getActiveBaseUrlMock(...args),
  updateHasChanges: (...args: unknown[]) => updateHasChangesMock(...args),
}));

vi.mock("@/hooks/useC64Connection", () => ({
  useConnectionRoutingEpoch: () => routingEpochRef.current,
}));

import { useConfigActions } from "@/pages/home/hooks/useConfigActions";

describe("useConfigActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setConfigValueMock.mockResolvedValue(undefined);
    getDrivesMock.mockResolvedValue({});
    readItemValueMock.mockReturnValue(undefined);
    routingEpochRef.current = 0;
  });

  it("clears every optimistic pin when the connection routing epoch changes (HARD9-052)", async () => {
    // Regression: a device switch or reconnect bumps routingEpoch and
    // re-keys every config query against the new device. A pin from the
    // previous device can never echo back from a different device -
    // ConfigBrowserPage already clears all pins on this signal (BUG-033);
    // Home's store had no equivalent, so the row would stay latched (and
    // disabled) on the new device forever.
    const { result, rerender } = renderHook(() => useConfigActions());

    await act(async () => {
      await result.current.updateConfigValue("Video", "Mode", "NTSC", "HOME_CONFIG_UPDATE", "Updated");
    });
    expect(result.current.configWritePending).toEqual({ "Video:Mode": true });

    routingEpochRef.current = 1;
    rerender();

    expect(result.current.configWritePending).toEqual({});
    expect(result.current.configOverrides).toEqual({});
  });

  it("marks the app config as changed on a successful write so Revert Changes becomes enabled (HARD9-051)", async () => {
    // Regression: this hook called api.setConfigValue directly, bypassing
    // useC64SetConfig/useC64UpdateConfigBatch (which both call
    // updateHasChanges on success). Video Mode, Turbo Control, SID address,
    // UltiSID filter, and lighting selects on Home never enabled "Revert
    // Changes" as a result.
    const { result } = renderHook(() => useConfigActions());

    await act(async () => {
      await result.current.updateConfigValue("Video", "Mode", "NTSC", "HOME_CONFIG_UPDATE", "Updated");
    });

    expect(updateHasChangesMock).toHaveBeenCalledWith("http://c64u", true);
  });

  it("updates config, invalidates matching queries, and refreshes drives when requested", async () => {
    const { result } = renderHook(() => useConfigActions());

    await act(async () => {
      await result.current.updateConfigValue("Audio", "Volume", 7, "HOME_CONFIG_UPDATE", "Updated", {
        refreshDrives: true,
      });
    });

    expect(setConfigValueMock).toHaveBeenCalledWith("Audio", "Volume", 7);
    expect(toastMock).toHaveBeenCalledWith({ title: "Updated" });
    expect(invalidateQueriesMock).toHaveBeenCalledTimes(1);
    const predicate = invalidateQueriesMock.mock.calls[0][0].predicate as (query: { queryKey: unknown }) => boolean;
    expect(predicate({ queryKey: ["c64-config-items", "Audio"] })).toBe(true);
    expect(predicate({ queryKey: ["c64-config-items", "Video"] })).toBe(false);
    expect(fetchQueryMock).toHaveBeenCalledTimes(1);
    expect(getDrivesMock).toHaveBeenCalledTimes(1);
    expect(result.current.configWritePending).toEqual({ "Audio:Volume": true });
  });

  it("resolves true on a successful write and false on a failed write", async () => {
    const { result } = renderHook(() => useConfigActions());

    let okResult: boolean | undefined;
    await act(async () => {
      okResult = await result.current.updateConfigValue("Audio", "Volume", 7, "HOME_CONFIG_UPDATE", "Updated");
    });
    expect(okResult).toBe(true);

    setConfigValueMock.mockRejectedValueOnce(new Error("write failed"));
    let failResult: boolean | undefined;
    await act(async () => {
      failResult = await result.current.updateConfigValue("Audio", "Volume", 9, "HOME_CONFIG_UPDATE", "Updated");
    });
    expect(failResult).toBe(false);
  });

  it("suppresses success toast when requested", async () => {
    const { result } = renderHook(() => useConfigActions());

    await act(async () => {
      await result.current.updateConfigValue("Audio", "Volume", "0 dB", "HOME_CONFIG_UPDATE", "Updated", {
        suppressToast: true,
      });
    });

    expect(toastMock).not.toHaveBeenCalled();
  });

  it("rolls back to previous override when update fails", async () => {
    const { result } = renderHook(() => useConfigActions());

    await act(async () => {
      await result.current.updateConfigValue("Audio", "Volume", 3, "HOME_CONFIG_UPDATE", "Updated");
    });

    setConfigValueMock.mockRejectedValueOnce(new Error("write failed"));

    await act(async () => {
      await result.current.updateConfigValue("Audio", "Volume", 9, "HOME_CONFIG_UPDATE", "Updated");
    });

    expect(reportUserErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "HOME_CONFIG_UPDATE",
        title: "Update failed",
        description: "write failed",
      }),
    );
    expect(result.current.resolveConfigValue({}, "Audio", "Volume", 0)).toBe(3);
    expect(result.current.configWritePending).toEqual({ "Audio:Volume": true });
  });

  it("setConfigOverride sets the override synchronously without a REST call", () => {
    const { result } = renderHook(() => useConfigActions());

    act(() => {
      result.current.setConfigOverride("Audio Mixer", "Volume", 42);
    });

    expect(result.current.resolveConfigValue({}, "Audio Mixer", "Volume", 0)).toBe(42);
    expect(setConfigValueMock).not.toHaveBeenCalled();
  });

  it("setConfigOverride prevents slider snap-back: displayed value remains committed while REST is in-flight", async () => {
    let resolveApi!: () => void;
    setConfigValueMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveApi = resolve;
        }),
    );
    const { result } = renderHook(() => useConfigActions());

    // Simulate what AudioMixer.handleVolumeLocalCommit does:
    // 1. Set override synchronously (before activeSliders is cleared)
    act(() => {
      result.current.setConfigOverride("Audio Mixer", "Volume", 75);
    });

    // 2. Start the async REST call (will be in-flight until resolveApi is called)
    const updatePromise = act(async () => {
      await result.current.updateConfigValue("Audio Mixer", "Volume", 75, "HOME_SID_VOLUME", "Volume updated");
    });

    // Override is still visible while REST is pending
    expect(result.current.resolveConfigValue({}, "Audio Mixer", "Volume", 0)).toBe(75);

    // Clean up: resolve the pending REST call
    resolveApi();
    await updatePromise;

    // Once the device payload catches up, local authority clears and device state
    // becomes authoritative again without a hidden override lingering.
    expect(result.current.resolveConfigValue({}, "Audio Mixer", "Volume", 75)).toBe(75);
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.configOverrides).toEqual({});
    expect(result.current.configWritePending).toEqual({});
  });

  it("removes temporary override after failed first write and falls back to payload value", async () => {
    setConfigValueMock.mockRejectedValueOnce(new Error("boom"));
    readItemValueMock.mockReturnValueOnce("from-payload");
    const { result } = renderHook(() => useConfigActions());

    await act(async () => {
      await result.current.updateConfigValue("Video", "Mode", "NTSC", "HOME_CONFIG_UPDATE", "Updated");
    });

    expect(result.current.configOverrides).toEqual({});
    expect(result.current.resolveConfigValue({}, "Video", "Mode", "fallback")).toBe("from-payload");
  });

  it("keeps user intent authoritative until the device payload matches, then clears the pending state", async () => {
    const { result } = renderHook(() => useConfigActions());

    await act(async () => {
      await result.current.updateConfigValue("Audio Mixer", "Volume", "6 dB", "HOME_CONFIG_UPDATE", "Updated");
    });

    expect(result.current.resolveConfigValue({}, "Audio Mixer", "Volume", "0 dB")).toBe("6 dB");
    expect(result.current.configWritePending).toEqual({ "Audio Mixer:Volume": true });

    expect(result.current.resolveConfigValue({}, "Audio Mixer", "Volume", "6 dB")).toBe("6 dB");
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.configWritePending).toEqual({});
    expect(result.current.configOverrides).toEqual({});
  });

  it("can clear pending state immediately after a successful write for controls without resolved values", async () => {
    const { result } = renderHook(() => useConfigActions());

    await act(async () => {
      await result.current.updateConfigValue(
        "Data Streams",
        "Stream Audio to",
        "239.0.1.65:11001",
        "HOME_STREAM_UPDATE",
        "Updated",
        {
          clearPendingOnSuccess: true,
        },
      );
    });

    expect(setConfigValueMock).toHaveBeenCalledWith("Data Streams", "Stream Audio to", "239.0.1.65:11001");
    expect(result.current.configWritePending).toEqual({});
    expect(result.current.configOverrides).toEqual({});
  });
});
