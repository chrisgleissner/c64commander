import { exportTraceZip } from '@/lib/tracing/traceSession';

export const buildTraceZipBlob = () => new Blob([exportTraceZip()], { type: 'application/zip' });

export const downloadTraceZip = (filename = 'c64commander-traces.zip') => {
  const blob = buildTraceZipBlob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
};
