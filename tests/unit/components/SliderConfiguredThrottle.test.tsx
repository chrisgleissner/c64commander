import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { saveVolumeSliderPreviewIntervalMs } from "@/lib/config/appSettings";

describe("Slider configured throttle", () => {
    afterEach(() => {
        vi.resetModules();
        vi.doUnmock("@/lib/ui/sliderBehavior");
        localStorage.clear();
    });

    it("uses the configured device slider preview interval when async throttle is omitted", async () => {
        localStorage.clear();
        saveVolumeSliderPreviewIntervalMs(350);

        const createSliderAsyncQueue = vi.fn(() => ({
            schedule: vi.fn(),
            commit: vi.fn(),
            cancel: vi.fn(),
        }));

        vi.doMock("@/lib/ui/sliderBehavior", async () => {
            const actual = await vi.importActual<typeof import("@/lib/ui/sliderBehavior")>("@/lib/ui/sliderBehavior");
            return {
                ...actual,
                createSliderAsyncQueue,
            };
        });

        const { Slider } = await import("@/components/ui/slider");

        render(<Slider value={[1]} min={0} max={4} step={1} onValueChangeAsync={vi.fn()} data-testid="test-slider" />);

        expect(createSliderAsyncQueue).toHaveBeenCalledWith(
            expect.objectContaining({
                throttleMs: 350,
            }),
        );
    });

    it("prefers an explicit async throttle over the configured default", async () => {
        localStorage.clear();
        saveVolumeSliderPreviewIntervalMs(350);

        const createSliderAsyncQueue = vi.fn(() => ({
            schedule: vi.fn(),
            commit: vi.fn(),
            cancel: vi.fn(),
        }));

        vi.doMock("@/lib/ui/sliderBehavior", async () => {
            const actual = await vi.importActual<typeof import("@/lib/ui/sliderBehavior")>("@/lib/ui/sliderBehavior");
            return {
                ...actual,
                createSliderAsyncQueue,
            };
        });

        const { Slider } = await import("@/components/ui/slider");

        render(<Slider value={[1]} min={0} max={4} step={1} asyncThrottleMs={125} onValueChangeAsync={vi.fn()} />);

        expect(createSliderAsyncQueue).toHaveBeenCalledWith(
            expect.objectContaining({
                throttleMs: 125,
            }),
        );
    });

    it("rebuilds the async queue only for matching slider preview interval updates", async () => {
        localStorage.clear();
        saveVolumeSliderPreviewIntervalMs(200);

        const createSliderAsyncQueue = vi.fn(() => ({
            schedule: vi.fn(),
            commit: vi.fn(),
            cancel: vi.fn(),
        }));

        vi.doMock("@/lib/ui/sliderBehavior", async () => {
            const actual = await vi.importActual<typeof import("@/lib/ui/sliderBehavior")>("@/lib/ui/sliderBehavior");
            return {
                ...actual,
                createSliderAsyncQueue,
            };
        });

        const { Slider } = await import("@/components/ui/slider");

        render(<Slider value={[1]} min={0} max={4} step={1} onValueChangeAsync={vi.fn()} />);

        expect(createSliderAsyncQueue).toHaveBeenCalledTimes(1);
        expect(createSliderAsyncQueue).toHaveBeenLastCalledWith(expect.objectContaining({ throttleMs: 200 }));

        await act(async () => {
            window.dispatchEvent(
                new CustomEvent("c64u-app-settings-updated", {
                    detail: { key: "c64u_config_write_min_interval_ms", value: 500 },
                }),
            );
            await Promise.resolve();
        });

        expect(createSliderAsyncQueue).toHaveBeenCalledTimes(1);

        await act(async () => {
            saveVolumeSliderPreviewIntervalMs(360);
            await Promise.resolve();
        });

        expect(createSliderAsyncQueue).toHaveBeenCalledTimes(2);
        expect(createSliderAsyncQueue).toHaveBeenLastCalledWith(expect.objectContaining({ throttleMs: 360 }));
    });
});
