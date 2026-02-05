import { zipSync, strToU8 } from 'fflate';
import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';
import { addErrorLog } from '@/lib/logging';

export type DiagnosticsExportTab = 'error-logs' | 'logs' | 'traces' | 'actions';

const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const result = reader.result as string;
            const parts = typeof result === 'string' ? result.split(',') : [];
            if (parts.length < 2 || !parts[1]) {
                reject(new Error('Unexpected data URL format for diagnostics export.'));
                return;
            }
            resolve(parts[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
};

const buildDiagnosticsZipData = (tab: DiagnosticsExportTab, data: unknown) => {
    const fileName =
        tab === 'error-logs'
            ? 'error-logs.json'
            : tab === 'logs'
                ? 'logs.json'
                : tab === 'traces'
                    ? 'traces.json'
                    : 'actions.json';
    const json = JSON.stringify(data ?? [], null, 2);
    return zipSync({
        [fileName]: strToU8(json),
    });
};

export const buildDiagnosticsZipBlob = (tab: DiagnosticsExportTab, data: unknown) =>
    new Blob([buildDiagnosticsZipData(tab, data)], { type: 'application/zip' });

const downloadDiagnosticsZip = (filename: string, tab: DiagnosticsExportTab, data: unknown) => {
    const blob = buildDiagnosticsZipBlob(tab, data);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
};

export const shareDiagnosticsZip = async (tab: DiagnosticsExportTab, data: unknown) => {
    const filename = `c64commander-diagnostics-${tab}.zip`;
    if (Capacitor.isNativePlatform()) {
        try {
            const blob = buildDiagnosticsZipBlob(tab, data);
            const base64Data = await blobToBase64(blob);

            await Filesystem.writeFile({
                path: filename,
                data: base64Data,
                directory: Directory.Cache,
            });

            const uriResult = await Filesystem.getUri({
                path: filename,
                directory: Directory.Cache,
            });

            await Share.share({
                title: 'Diagnostics Export',
                files: [uriResult.uri],
            });
        } catch (error) {
            addErrorLog('Diagnostics share failed', { error: (error as Error).message });
            throw error;
        }
    } else {
        downloadDiagnosticsZip(filename, tab, data);
    }
};
