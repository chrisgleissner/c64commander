import { useEffect, useState } from "react";
import { APP_SETTINGS_KEYS, loadVolumeSliderPreviewIntervalMs } from "@/lib/config/appSettings";

export function useVolumePreviewInterval() {
    const [previewIntervalMs, setPreviewIntervalMs] = useState(loadVolumeSliderPreviewIntervalMs());

    useEffect(() => {
        const handler = (event: Event) => {
            const detail = (event as CustomEvent).detail as { key?: string } | undefined;
            if (detail?.key !== APP_SETTINGS_KEYS.VOLUME_SLIDER_PREVIEW_INTERVAL_MS_KEY) return;
            setPreviewIntervalMs(loadVolumeSliderPreviewIntervalMs());
        };

        window.addEventListener("c64u-app-settings-updated", handler as EventListener);
        return () => window.removeEventListener("c64u-app-settings-updated", handler as EventListener);
    }, []);

    return previewIntervalMs;
}
