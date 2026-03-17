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

import { useConfigActions } from "@/pages/home/hooks/useConfigActions";

describe("useConfigActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setConfigValueMock.mockResolvedValue(undefined);
    getDrivesMock.mockResolvedValue({});
    readItemValueMock.mockReturnValue(undefined);
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
    expect(result.current.configWritePending).toEqual({});
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
    expect(result.current.configWritePending).toEqual({});
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
});
