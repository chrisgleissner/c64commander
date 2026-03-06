/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const addErrorLog = vi.fn();
const share = vi.fn();
const writeFile = vi.fn();
const getUri = vi.fn();

vi.mock('@/lib/logging', () => ({
    addErrorLog,
}));

vi.mock('@capacitor/share', () => ({
    Share: {
        share,
    },
}));

vi.mock('@capacitor/filesystem', () => ({
    Directory: {
        Cache: 'CACHE',
    },
    Filesystem: {
        writeFile,
        getUri,
    },
}));

const isNativePlatform = vi.fn(() => false);
vi.mock('@capacitor/core', () => ({
    Capacitor: {
        isNativePlatform,
    },
}));

describe('diagnosticsExport', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        isNativePlatform.mockReturnValue(false);
        (window as unknown as { __c64uDiagnosticsShareOverride?: unknown }).__c64uDiagnosticsShareOverride = undefined;
    });

    it('uses diagnostics share override when present', async () => {
        const override = vi.fn(async () => undefined);
        (window as unknown as { __c64uDiagnosticsShareOverride?: unknown }).__c64uDiagnosticsShareOverride = override;

        const { shareDiagnosticsZip } = await import('@/lib/diagnostics/diagnosticsExport');
        await shareDiagnosticsZip('logs', [{ id: 1 }]);

        expect(override).toHaveBeenCalledTimes(1);
        expect(share).not.toHaveBeenCalled();
    });

    it('downloads zip in web mode', async () => {
        if (!(URL as unknown as { createObjectURL?: unknown }).createObjectURL) {
            Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:test'), configurable: true });
        }
        if (!(URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL) {
            Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(() => undefined), configurable: true });
        }
        const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
        const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
        const click = vi.fn();
        const createElement = vi.spyOn(document, 'createElement').mockReturnValue({
            href: '',
            download: '',
            click,
        } as unknown as HTMLAnchorElement);

        const { shareDiagnosticsZip } = await import('@/lib/diagnostics/diagnosticsExport');
        await shareDiagnosticsZip('traces', [{ trace: true }]);

        expect(createObjectURL).toHaveBeenCalledTimes(1);
        expect(click).toHaveBeenCalledTimes(1);
        expect(revokeObjectURL).toHaveBeenCalledTimes(0);

        createObjectURL.mockRestore();
        revokeObjectURL.mockRestore();
        createElement.mockRestore();
    });

    it('uses native share flow when running on native platform', async () => {
        isNativePlatform.mockReturnValue(true);
        writeFile.mockResolvedValue(undefined);
        getUri.mockResolvedValue({ uri: 'file://cache/export.zip' });
        share.mockResolvedValue(undefined);

        const { shareDiagnosticsZip } = await import('@/lib/diagnostics/diagnosticsExport');
        await shareDiagnosticsZip('actions', [{ action: 'A' }]);

        expect(writeFile).toHaveBeenCalledTimes(1);
        expect(getUri).toHaveBeenCalledTimes(1);
        expect(share).toHaveBeenCalledTimes(1);
    });

    it('logs and rethrows when override fails', async () => {
        const override = vi.fn(async () => {
            throw new Error('override failed');
        });
        (window as unknown as { __c64uDiagnosticsShareOverride?: unknown }).__c64uDiagnosticsShareOverride = override;

        const { shareDiagnosticsZip } = await import('@/lib/diagnostics/diagnosticsExport');

        await expect(shareDiagnosticsZip('error-logs', [{ id: 1 }])).rejects.toThrow('override failed');
        expect(addErrorLog).toHaveBeenCalledWith('Diagnostics share override failed', expect.objectContaining({ error: 'override failed' }));
    });
});
