/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { resetActionTrace } from '@/lib/tracing/actionTrace';
import {
  clearTraceEvents,
  exportTraceZip,
  getTraceEvents,
  persistTracesToSession,
  replaceTraceEvents,
  resetTraceSession,
  restoreTracesFromSession,
} from '@/lib/tracing/traceSession';
import { resetTraceIds } from '@/lib/tracing/traceIds';

export type TraceBridge = {
  clearTraces: () => void;
  getTraces: () => ReturnType<typeof getTraceEvents>;
  exportTraces: () => Uint8Array;
  resetTraceIds: (eventStart?: number, correlationStart?: number) => void;
  resetTraceSession: (eventStart?: number, correlationStart?: number) => void;
  persistTracesToSession: () => void;
  restoreTracesFromSession: () => void;
  seedTraces?: (events: ReturnType<typeof getTraceEvents>) => void;
};

declare global {
  interface Window {
    __c64uTracing?: TraceBridge;
  }
}

export const registerTraceBridge = () => {
  if (typeof window === 'undefined') return;

  if (window.__c64uTracing) {
    if (import.meta.env.VITE_ENABLE_TEST_PROBES === '1' && !window.__c64uTracing.seedTraces) {
      window.__c64uTracing.seedTraces = (events) => {
        resetActionTrace();
        replaceTraceEvents(events);
      };
    }
    return;
  }

  // Restore any traces from previous navigation
  restoreTracesFromSession();

  // Persist traces before page unload
  window.addEventListener('beforeunload', () => {
    persistTracesToSession();
  });

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
    persistTracesToSession,
    restoreTracesFromSession,
  };

  if (import.meta.env.VITE_ENABLE_TEST_PROBES === '1') {
    window.__c64uTracing.seedTraces = (events) => {
      resetActionTrace();
      replaceTraceEvents(events);
    };
  }
};
