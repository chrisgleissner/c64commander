/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

const parseNumeric = (value: string) => {
    const match = value.trim().match(/[+-]?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
};

export const formatDbValue = (value: string) => {
    const trimmed = value.trim();
    const numeric = parseNumeric(trimmed);
    if (numeric === null) return trimmed;
    const sign = numeric > 0 ? '+' : '';
    return `${sign}${numeric} dB`;
};

export const formatPanValue = (value: string) => {
    const trimmed = value.trim();
    const normalized = trimmed.toLowerCase();
    if (normalized === 'center' || normalized === 'centre') return 'C';
    const numeric = parseNumeric(trimmed) ?? 0;
    if (normalized.startsWith('left')) {
        return numeric ? `L ${Math.abs(numeric)}` : 'L';
    }
    if (normalized.startsWith('right')) {
        return numeric ? `R ${Math.abs(numeric)}` : 'R';
    }
    if (numeric === 0) return 'C';
    return numeric < 0 ? `L ${Math.abs(numeric)}` : `R ${numeric}`;
};
