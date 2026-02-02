import { zipSync, strToU8 } from 'fflate';
import { redactExportValue } from '@/lib/diagnostics/exportRedaction';
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

export const downloadTraceZip = (filename = 'c64commander-traces.zip', options: { redacted?: boolean } = {}) => {
  const blob = buildTraceZipBlob(options);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
};
