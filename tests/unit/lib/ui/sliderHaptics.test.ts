/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { triggerSliderHaptic } from '@/lib/ui/sliderHaptics';
import { Capacitor } from '@capacitor/core';
import { addErrorLog } from '@/lib/logging';

vi.mock('@capacitor/core', () => ({
    Capacitor: {
        isNativePlatform: vi.fn(),
        isPluginAvailable: vi.fn(),
        Plugins: {} // Mock global Plugins property on Capacitor class
    }
}));

vi.mock('@/lib/logging', () => ({
    addErrorLog: vi.fn(),
}));

describe('sliderHaptics', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.unstubAllGlobals();
    });

    it('returns early if haptics not available (web)', async () => {
        vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
        await triggerSliderHaptic();
        // Nothing happens
    });

    it('returns early if native but Haptics plugin missing', async () => {
        vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
        vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(false);
        await triggerSliderHaptic();
    });
    
    it('catches and logs error in availability check', async () => {
        vi.mocked(Capacitor.isNativePlatform).mockImplementation(() => { throw new Error('Fail'); });
        await triggerSliderHaptic();
        expect(addErrorLog).toHaveBeenCalledWith('Haptics availability probe failed', expect.any(Object));
    });

    it('uses Capacitor Haptics plugin if available', async () => {
        vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
        vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
        
        const impactMock = vi.fn();
        const HapticsMock = { impact: impactMock, ImpactStyle: { Light: 'LIGHT' } };
        
        // Mocking the complex property access
        // const haptics = plugins?.Haptics ...
        (Capacitor as any).Plugins = { Haptics: HapticsMock };

        await triggerSliderHaptic();
        
        expect(impactMock).toHaveBeenCalledWith({ style: 'LIGHT' });
    });

    it('uses window.Capacitor fallback if global Capacitor missing plugins', async () => {
        vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
        vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
        (Capacitor as any).Plugins = undefined;

        const impactMock = vi.fn();
        const HapticsMock = { impact: impactMock, ImpactStyle: { Light: 'LIGHT' } };
        
        vi.stubGlobal('window', {
            Capacitor: { Plugins: { Haptics: HapticsMock } }
        });

        await triggerSliderHaptic();
        expect(impactMock).toHaveBeenCalled();
    });
    
    it('uses navigator.vibrate if haptics plugin is declared available but impact method missing', async () => {
        vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
        vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
        
        // Setup Haptics object without impact
        (Capacitor as any).Plugins = { Haptics: {} }; 
        
        const vibrateMock = vi.fn();
        vi.stubGlobal('navigator', { vibrate: vibrateMock });
        
        await triggerSliderHaptic();
        expect(vibrateMock).toHaveBeenCalledWith(8);
    });

    it('catches errors during impact execution', async () => {
        vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
        vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
        
        const impactMock = vi.fn().mockRejectedValue(new Error('Impact failed'));
        (Capacitor as any).Plugins = { Haptics: { impact: impactMock } };
        
        await triggerSliderHaptic();
        
        expect(addErrorLog).toHaveBeenCalledWith('Haptics impact failed', expect.any(Object));
    });
});
