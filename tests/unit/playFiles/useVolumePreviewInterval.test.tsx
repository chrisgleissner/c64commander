import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useVolumePreviewInterval } from "@/pages/playFiles/hooks/useVolumePreviewInterval";
import { APP_SETTINGS_KEYS, loadVolumeSliderPreviewIntervalMs } from "@/lib/config/appSettings";

vi.mock("@/lib/config/appSettings", () => ({
    APP_SETTINGS_KEYS: {
        VOLUME_SLIDER_PREVIEW_INTERVAL_MS_KEY: "c64u_volume_slider_preview_interval_ms",
    },
    loadVolumeSliderPreviewIntervalMs: vi.fn(() => 200),
}));

describe("useVolumePreviewInterval", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(loadVolumeSliderPreviewIntervalMs).mockReturnValue(200);
    });

    it("loads the persisted preview interval on mount", () => {
        const { result } = renderHook(() => useVolumePreviewInterval());

        expect(result.current).toBe(200);
    });

    it("updates when the matching app setting changes", async () => {
        const { result } = renderHook(() => useVolumePreviewInterval());
        vi.mocked(loadVolumeSliderPreviewIntervalMs).mockReturnValue(350);

        await act(async () => {
            window.dispatchEvent(
                new CustomEvent("c64u-app-settings-updated", {
                    detail: { key: APP_SETTINGS_KEYS.VOLUME_SLIDER_PREVIEW_INTERVAL_MS_KEY },
                }),
            );
        });

        expect(result.current).toBe(350);
    });

    it("ignores unrelated app setting updates", async () => {
        const { result } = renderHook(() => useVolumePreviewInterval());
        vi.mocked(loadVolumeSliderPreviewIntervalMs).mockReturnValue(420);

        await act(async () => {
            window.dispatchEvent(
                new CustomEvent("c64u-app-settings-updated", {
                    detail: { key: "c64u_other_setting" },
                }),
            );
        });

        expect(result.current).toBe(200);
    });
});
