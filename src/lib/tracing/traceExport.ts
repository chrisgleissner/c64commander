import { zipSync, strToU8 } from 'fflate';
import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';
import { redactExportValue } from '@/lib/diagnostics/exportRedaction';
import { addErrorLog } from '@/lib/logging';
import { buildAppMetadata, exportTraceZip, getTraceEvents } from '@/lib/tracing/traceSession';

const buildTraceZipData = (options: { redacted?: boolean } = {}) => {
  if (!options.redacted) {
    return exportTraceZip();
  }
  const traceEvents = redactExportValue(getTraceEvents());
  const metadata = redactExportValue(buildAppMetadata());
  const traceJson = JSON.stringify(traceEvents, null, 2);
  const metadataJson = JSON.stringify(metadata, null, 2);
  return zipSync({
    'trace.json': strToU8(traceJson),
    'app-metadata.json': strToU8(metadataJson),
  });
};

export const buildTraceZipBlob = (options: { redacted?: boolean } = {}) =>
  new Blob([buildTraceZipData(options)], { type: 'application/zip' });

const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      // remove data:application/zip;base64, prefix
      const parts = typeof result === 'string' ? result.split(',') : [];
      if (parts.length < 2 || !parts[1]) {
        reject(new Error('Unexpected data URL format for trace export.'));
        return;
      }
      resolve(parts[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

export const downloadTraceZip = (filename = 'c64commander-traces.zip', options: { redacted?: boolean } = {}) => {
  const blob = buildTraceZipBlob(options);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
};

export const shareTraceZip = async (filename = 'c64commander-traces.zip', options: { redacted?: boolean } = {}) => {
  if (Capacitor.isNativePlatform()) {
    try {
      const blob = buildTraceZipBlob(options);
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
        title: 'Trace Export',
        files: [uriResult.uri],
      });
    } catch (error) {
      addErrorLog('Trace share failed', { error: (error as Error).message });
      throw error;
    }
  } else {
    downloadTraceZip(filename, options);
  }
};
