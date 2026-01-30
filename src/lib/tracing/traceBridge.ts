import { clearTraceEvents, exportTraceZip, getTraceEvents } from '@/lib/tracing/traceSession';

export type TraceBridge = {
  clearTraces: () => void;
  getTraces: () => ReturnType<typeof getTraceEvents>;
  exportTraces: () => Uint8Array;
};

declare global {
  interface Window {
    __c64uTracing?: TraceBridge;
  }
}

export const registerTraceBridge = () => {
  if (typeof window === 'undefined') return;
  window.__c64uTracing = {
    clearTraces: () => clearTraceEvents(),
    getTraces: () => getTraceEvents(),
    exportTraces: () => exportTraceZip(),
  };
};
