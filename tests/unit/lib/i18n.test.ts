import { describe, expect, it, vi, afterEach } from 'vitest';
import { resolveAppLocale, t } from '@/lib/i18n';

describe('i18n', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('resolves english locale as default supported locale', () => {
        vi.stubGlobal('navigator', { language: 'en-US' });
        expect(resolveAppLocale()).toBe('en');
    });

    it('falls back to default locale for unsupported locale', () => {
        vi.stubGlobal('navigator', { language: 'de-DE' });
        expect(resolveAppLocale()).toBe('en');
    });

    it('returns translated value with fallback behavior', () => {
        expect(t('app.error.reload', 'Fallback reload', 'en')).toBe('Reload');
        expect(t('missing.key', 'Fallback text', 'en')).toBe('Fallback text');
    });

    it('falls back to default locale when navigator is undefined', () => {
        vi.stubGlobal('navigator', undefined);
        expect(resolveAppLocale()).toBe('en');
    });

    it('falls back to default locale when navigator.language is null', () => {
        vi.stubGlobal('navigator', { language: null });
        expect(resolveAppLocale()).toBe('en');
    });
});
