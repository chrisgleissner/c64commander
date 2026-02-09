import { Capacitor } from '@capacitor/core';
import { addErrorLog } from '@/lib/logging';

const isHapticsAvailable = () => {
    try {
        return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('Haptics');
    } catch (error) {
        const err = error as Error;
        addErrorLog('Haptics availability probe failed', {
            error: err.message,
        });
        return false;
    }
};

export const triggerSliderHaptic = async () => {
    if (!isHapticsAvailable()) return;
    try {
        const plugins = (Capacitor as unknown as { Plugins?: Record<string, any> }).Plugins;
        const haptics = plugins?.Haptics ?? (window as unknown as { Capacitor?: { Plugins?: Record<string, any> } }).Capacitor?.Plugins?.Haptics;
        if (haptics?.impact) {
            const style = haptics.ImpactStyle?.Light ?? 'LIGHT';
            await haptics.impact({ style });
            return;
        }
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
            navigator.vibrate(8);
        }
    } catch (error) {
        const err = error as Error;
        addErrorLog('Haptics impact failed', {
            error: err.message,
        });
    }
};
