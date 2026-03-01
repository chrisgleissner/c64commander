import { describe, expect, it, vi } from 'vitest';
import { resolveAppLocale, t } from '@/lib/i18n';

describe('i18n', () => {
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
});
