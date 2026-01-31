import { resetActionTrace } from '@/lib/tracing/actionTrace';
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
    clearTraces: () => {
      resetActionTrace();
      clearTraceEvents();
    },
    getTraces: () => getTraceEvents(),
    exportTraces: () => exportTraceZip(),
    resetTraceIds: (eventStart = 0, correlationStart = 0) => resetTraceIds(eventStart, correlationStart),
    resetTraceSession: (eventStart = 0, correlationStart = 0) => {
      resetActionTrace();
      resetTraceSession(eventStart, correlationStart);
    },
  };
};
