/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

const KNOWN_PRODUCT_TOKENS = new Set(['c64u', 'u64', 'u64e', 'u64e2'] as const);

const compact = (value: string): string => value.replace(/[^a-z0-9]+/g, '');

const normalizeKnownProduct = (value?: string | null): 'c64u' | 'u64' | 'u64e' | 'u64e2' | null => {
    const raw = (value ?? '').trim().toLowerCase();
    const normalized = compact(raw);
    if (!raw) return null;
    if (normalized === 'c64u' || normalized === 'c64ultimate') return 'c64u';
    if (
        normalized === 'u64e2'
        || normalized.includes('u64e2')
        || normalized.includes('u64emk2')
        || normalized.includes('ultimate64ii')
        || normalized.includes('ultimate64mk2')
    ) {
        return 'u64e2';
    }
    if (normalized === 'u64e' || normalized.includes('u64e') || normalized.includes('ultimate64elite')) return 'u64e';
    if (normalized === 'u64' || normalized.includes('ultimate64')) return 'u64';
    return null;
};

export const mapTargetDisplayLabel = (targetType?: string | null, product?: string | null): string => {
    const normalizedTargetType = (targetType ?? '').trim().toLowerCase();

    if (!normalizedTargetType) return 'unknown';
    if (normalizedTargetType === 'internal-mock' || normalizedTargetType === 'mock') return 'demo';
    if (normalizedTargetType === 'external-mock') return 'sandbox';
    if (normalizedTargetType === 'real-device') {
        return normalizeKnownProduct(product) ?? 'device';
    }

    if (KNOWN_PRODUCT_TOKENS.has(normalizedTargetType as 'c64u' | 'u64' | 'u64e' | 'u64e2')) {
        return normalizedTargetType;
    }

    return normalizedTargetType === 'c64' ? 'device' : normalizedTargetType;
};
