import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getPlatform, isNativePlatform } from '@/lib/native/platform';
import { Capacitor } from '@capacitor/core';

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: vi.fn().mockReturnValue('web'),
    isNativePlatform: vi.fn().mockReturnValue(false),
  },
}));

describe('platform', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.unstubAllEnvs();
        
        // Restore defaults
        if (Capacitor.getPlatform) vi.mocked(Capacitor.getPlatform).mockReturnValue('web');
        if (Capacitor.isNativePlatform) vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    });

    afterEach(() => {
        // vi.unstubAllGlobals(); // causing issues?
    });

    describe('getPlatform', () => {
        it('returns web by default', () => {
             expect(getPlatform()).toBe('web');
        });

        it('returns capacitor platform if available', () => {
            vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');
            expect(getPlatform()).toBe('ios');
        });

        it('supports override when enabled', () => {
            vi.stubEnv('VITE_ENABLE_TEST_PROBES', '1');
            const win = window as any;
            win.__c64uPlatformOverride = 'android';
            
            // Should read override
            expect(getPlatform()).toBe('android');
            
            delete win.__c64uPlatformOverride;
        });

        it('defaults to web when enabled but no override set', () => {
            vi.stubEnv('VITE_ENABLE_TEST_PROBES', '1');
            expect(getPlatform()).toBe('web');
        });

        it('ignores override when disabled', () => {
            vi.stubEnv('VITE_ENABLE_TEST_PROBES', '0');
            const win = window as any;
            win.__c64uPlatformOverride = 'android';
            
            expect(getPlatform()).toBe('web'); // Default mock
            delete win.__c64uPlatformOverride;
        });
    });
    
    describe('isNativePlatform', () => {
        it('returns false by default', () => {
            vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
            expect(isNativePlatform()).toBe(false);
        });

        it('returns true if capacitor says so', () => {
            vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
            expect(isNativePlatform()).toBe(true);
        });

        it('supports override', () => {
            vi.stubEnv('VITE_ENABLE_TEST_PROBES', '1');
            const win = window as any;
            win.__c64uPlatformOverride = 'android';
            expect(isNativePlatform()).toBe(true);
            
            win.__c64uPlatformOverride = 'web';
            expect(isNativePlatform()).toBe(false);
            
            delete win.__c64uPlatformOverride;
        });

        it('defaults to false when enabled but no override set', () => {
            vi.stubEnv('VITE_ENABLE_TEST_PROBES', '1');
            expect(isNativePlatform()).toBe(false);
        });
    });

    describe('SSR environment', () => {
        it('returns web/false when window is undefined', () => {
            const originalWindow = global.window;
            // @ts-ignore
            delete global.window;
            
            try {
                expect(getPlatform()).toBe('web');
                expect(isNativePlatform()).toBe(false);
            } finally {
                global.window = originalWindow;
            }
        });
    });

    describe('Runtime safety', () => {
        it('handles missing Capacitor methods', () => {
            // Remove methods from mock temporarily
            const originalGet = Capacitor.getPlatform;
            const originalIs = Capacitor.isNativePlatform;
            
            // @ts-ignore
            Capacitor.getPlatform = undefined;
            // @ts-ignore
            Capacitor.isNativePlatform = undefined;
            
            try {
                expect(getPlatform()).toBe('web'); 
                expect(isNativePlatform()).toBe(false); 
            } finally {
                Capacitor.getPlatform = originalGet;
                Capacitor.isNativePlatform = originalIs;
            }
        });
        
        it('uses window.Capacitor fallback', () => {
            const originalIs = Capacitor.isNativePlatform;
            // @ts-ignore
            Capacitor.isNativePlatform = undefined;
            
            const win = window as any;
            win.Capacitor = {
                isNativePlatform: vi.fn().mockReturnValue(true)
            };
            
            const result = isNativePlatform();

            delete win.Capacitor;
            Capacitor.isNativePlatform = originalIs;
            
            expect(result).toBe(true);
        });

        it('handles exceptions in isNativePlatform', () => {
             vi.mocked(Capacitor.isNativePlatform).mockImplementation(() => {
                 throw new Error('fail');
             });
             expect(isNativePlatform()).toBe(false);
        });
    });
});
