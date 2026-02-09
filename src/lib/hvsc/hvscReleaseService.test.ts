import { beforeEach, describe, expect, it } from 'vitest';
import {
    buildHvscBaselineUrl,
    getHvscBaseUrl,
    getHvscBaseUrlOverride,
    setHvscBaseUrlOverride,
} from './hvscReleaseService';

describe('hvscReleaseService base URL overrides', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('normalizes and persists base URL overrides', () => {
        setHvscBaseUrlOverride('http://example.com/hvsc');
        expect(getHvscBaseUrlOverride()).toBe('http://example.com/hvsc/');
        expect(buildHvscBaselineUrl(80)).toBe('http://example.com/hvsc/HVSC_80-all-of-them.7z');
    });

    it('clears overrides when blank', () => {
        setHvscBaseUrlOverride('http://example.com/hvsc');
        setHvscBaseUrlOverride('');
        expect(getHvscBaseUrlOverride()).toBeNull();
        expect(getHvscBaseUrl()).toMatch(/hvsc\.brona\.dk\/HVSC\/$/);
    });
});
