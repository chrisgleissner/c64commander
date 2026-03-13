import { useVolumePreviewInterval } from "@/pages/playFiles/hooks/useVolumePreviewInterval";
import { useVolumeOverride } from "@/pages/playFiles/hooks/useVolumeOverride";

type UsePlayFilesVolumeBindingsArgs = {
    isPlaying: boolean;
    isPaused: boolean;
};

export function usePlayFilesVolumeBindings({ isPlaying, isPaused }: UsePlayFilesVolumeBindingsArgs) {
    const volumeSliderPreviewIntervalMs = useVolumePreviewInterval();
    const volumeOverride = useVolumeOverride({
        isPlaying,
        isPaused,
        previewIntervalMs: volumeSliderPreviewIntervalMs,
    });

    return {
        volumeSliderPreviewIntervalMs,
        ...volumeOverride,
    };
}
