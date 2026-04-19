import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useArchiveClientSettings } from "@/pages/playFiles/hooks/useArchiveClientSettings";
import {
  APP_SETTINGS_KEYS,
  loadArchiveClientIdOverride,
  loadArchiveHostOverride,
  loadArchiveUserAgentOverride,
} from "@/lib/config/appSettings";

const featureFlagsRef = vi.hoisted(() => ({
  current: {
    commoserve_enabled: true,
  },
}));

vi.mock("@/hooks/useFeatureFlags", () => ({
  useFeatureFlag: (key: "commoserve_enabled") => ({
    value: featureFlagsRef.current[key],
  }),
}));

vi.mock("@/lib/config/appSettings", () => ({
  APP_SETTINGS_KEYS: {
    ARCHIVE_HOST_OVERRIDE_KEY: "c64u_archive_host_override",
    ARCHIVE_CLIENT_ID_OVERRIDE_KEY: "c64u_archive_client_id_override",
    ARCHIVE_USER_AGENT_OVERRIDE_KEY: "c64u_archive_user_agent_override",
  },
  loadArchiveClientIdOverride: vi.fn(() => ""),
  loadArchiveHostOverride: vi.fn(() => ""),
  loadArchiveUserAgentOverride: vi.fn(() => ""),
}));

describe("useArchiveClientSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    featureFlagsRef.current.commoserve_enabled = true;
    vi.mocked(loadArchiveHostOverride).mockReturnValue("");
    vi.mocked(loadArchiveClientIdOverride).mockReturnValue("");
    vi.mocked(loadArchiveUserAgentOverride).mockReturnValue("");
  });

  it("loads the persisted CommoServe archive settings on mount", () => {
    const { result } = renderHook(() => useArchiveClientSettings());

    expect(result.current.commoserveEnabled).toBe(true);
    expect(result.current.archiveConfig.baseUrl).toBe("http://commoserve.files.commodore.net");
    expect(result.current.archiveConfig.headers).toEqual({
      "Client-Id": "Commodore",
      "User-Agent": "Assembly Query",
    });
  });

  it("updates the live archive config when matching app settings change", async () => {
    const { result } = renderHook(() => useArchiveClientSettings());

    featureFlagsRef.current.commoserve_enabled = false;
    vi.mocked(loadArchiveHostOverride).mockReturnValue("archive.local");
    vi.mocked(loadArchiveClientIdOverride).mockReturnValue("Custom Client");
    vi.mocked(loadArchiveUserAgentOverride).mockReturnValue("Custom Agent");

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("c64u-app-settings-updated", {
          detail: { key: APP_SETTINGS_KEYS.ARCHIVE_HOST_OVERRIDE_KEY },
        }),
      );
    });

    expect(result.current.commoserveEnabled).toBe(false);
    expect(result.current.archiveConfig.enabled).toBe(false);
    expect(result.current.archiveConfig.baseUrl).toBe("http://archive.local");
    expect(result.current.archiveConfig.headers).toEqual({
      "Client-Id": "Custom Client",
      "User-Agent": "Custom Agent",
    });
  });

  it("ignores unrelated app setting updates", async () => {
    const { result } = renderHook(() => useArchiveClientSettings());
    vi.mocked(loadArchiveHostOverride).mockReturnValue("ignored.local");

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("c64u-app-settings-updated", {
          detail: { key: "c64u_other_setting" },
        }),
      );
    });

    expect(result.current.archiveConfig.baseUrl).toBe("http://commoserve.files.commodore.net");
  });
});
