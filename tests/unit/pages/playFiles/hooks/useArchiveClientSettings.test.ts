import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { appSettingsKeys, buildDefaultArchiveClientConfigSpy, settingsState } = vi.hoisted(() => ({
  appSettingsKeys: {
    ARCHIVE_HOST_OVERRIDE_KEY: "c64u_archive_host_override",
    ARCHIVE_CLIENT_ID_OVERRIDE_KEY: "c64u_archive_client_id_override",
    ARCHIVE_USER_AGENT_OVERRIDE_KEY: "c64u_archive_user_agent_override",
  },
  buildDefaultArchiveClientConfigSpy: vi.fn(
    (input: { enabled: boolean; hostOverride: string; clientIdOverride: string; userAgentOverride: string }) => ({
      id: "commoserve",
      name: "CommoServe",
      baseUrl: "https://archive.test",
      headers: {},
      ...input,
    }),
  ),
  settingsState: {
    commoserveEnabled: true,
    archiveHostOverride: "",
    archiveClientIdOverride: "",
    archiveUserAgentOverride: "",
  },
}));

vi.mock("@/lib/archive/config", () => ({
  buildDefaultArchiveClientConfig: buildDefaultArchiveClientConfigSpy,
}));

vi.mock("@/hooks/useFeatureFlags", () => ({
  useFeatureFlag: () => ({
    value: settingsState.commoserveEnabled,
  }),
}));

vi.mock("@/lib/config/appSettings", () => ({
  APP_SETTINGS_KEYS: appSettingsKeys,
  loadArchiveHostOverride: () => settingsState.archiveHostOverride,
  loadArchiveClientIdOverride: () => settingsState.archiveClientIdOverride,
  loadArchiveUserAgentOverride: () => settingsState.archiveUserAgentOverride,
}));

import { useArchiveClientSettings } from "@/pages/playFiles/hooks/useArchiveClientSettings";

describe("useArchiveClientSettings", () => {
  beforeEach(() => {
    settingsState.commoserveEnabled = true;
    settingsState.archiveHostOverride = "";
    settingsState.archiveClientIdOverride = "";
    settingsState.archiveUserAgentOverride = "";
    buildDefaultArchiveClientConfigSpy.mockClear();
  });

  it("updates CommoServe settings when a relevant app-settings event fires", async () => {
    const { result } = renderHook(() => useArchiveClientSettings());

    expect(result.current.commoserveEnabled).toBe(true);
    expect(result.current.archiveHostOverride).toBe("");

    settingsState.commoserveEnabled = false;
    settingsState.archiveHostOverride = "archive.override";
    settingsState.archiveClientIdOverride = "client-42";
    settingsState.archiveUserAgentOverride = "ua-42";

    act(() => {
      window.dispatchEvent(
        new CustomEvent("c64u-app-settings-updated", {
          detail: { key: appSettingsKeys.ARCHIVE_HOST_OVERRIDE_KEY },
        }),
      );
    });

    await waitFor(() => {
      expect(result.current.commoserveEnabled).toBe(false);
      expect(result.current.archiveHostOverride).toBe("archive.override");
      expect(result.current.archiveClientIdOverride).toBe("client-42");
      expect(result.current.archiveUserAgentOverride).toBe("ua-42");
    });

    expect(buildDefaultArchiveClientConfigSpy).toHaveBeenLastCalledWith({
      enabled: false,
      hostOverride: "archive.override",
      clientIdOverride: "client-42",
      userAgentOverride: "ua-42",
    });
  });

  it("ignores app-settings events without a key", () => {
    const { result } = renderHook(() => useArchiveClientSettings());

    settingsState.commoserveEnabled = false;
    settingsState.archiveHostOverride = "ignored.example";

    act(() => {
      window.dispatchEvent(new CustomEvent("c64u-app-settings-updated", { detail: {} }));
    });

    expect(result.current.commoserveEnabled).toBe(true);
    expect(result.current.archiveHostOverride).toBe("");
  });

  it("ignores unrelated app-settings events", () => {
    const { result } = renderHook(() => useArchiveClientSettings());

    settingsState.commoserveEnabled = false;
    settingsState.archiveHostOverride = "ignored.example";

    act(() => {
      window.dispatchEvent(
        new CustomEvent("c64u-app-settings-updated", {
          detail: { key: "c64u_unrelated_setting" },
        }),
      );
    });

    expect(result.current.commoserveEnabled).toBe(true);
    expect(result.current.archiveHostOverride).toBe("");
  });
});
