import { clearTraceEvents, exportTraceZip, getTraceEvents, resetTraceSession } from '@/lib/tracing/traceSession';
import { resetTraceIds } from '@/lib/tracing/traceIds';

export type TraceBridge = {
  clearTraces: () => void;
  getTraces: () => ReturnType<typeof getTraceEvents>;
  exportTraces: () => Uint8Array;
  resetTraceIds: (eventStart?: number, correlationStart?: number) => void;
  resetTraceSession: (eventStart?: number, correlationStart?: number) => void;
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
    resetTraceIds: (eventStart = 1, correlationStart = 1) => resetTraceIds(eventStart, correlationStart),
    resetTraceSession: (eventStart = 1, correlationStart = 1) => resetTraceSession(eventStart, correlationStart),
  };
};
