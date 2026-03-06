/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { installAsyncContextPropagation } from './lib/tracing/traceActionContextStore';
import { registerFetchTrace } from './lib/tracing/fetchTrace';
import { registerUserInteractionCapture } from './lib/tracing/userInteractionCapture';
import { registerTraceBridge } from './lib/tracing/traceBridge';
import { markStartupBootstrapComplete } from './lib/startup/startupMilestones';
import { initializeRuntimeMotionMode } from './lib/startup/runtimeMotionBudget';
import { addErrorLog } from './lib/logging';
import { initializeSentry } from './lib/observability/sentry';
import './index.css';

const loadFonts = () => {
  if (import.meta.env.VITE_ENABLE_TEST_PROBES === '1') return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href =
    'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap';
  document.head.appendChild(link);
};

const scheduleAfterFirstPaint = (work: () => void) => {
  if (import.meta.env.VITE_ENABLE_TEST_PROBES === '1') {
    work();
    return;
  }
  if (typeof window === 'undefined') {
    work();
    return;
  }
  const runWhenIdle = () => {
    const win = window as Window & {
      requestIdleCallback?: (
        callback: () => void,
        options?: { timeout: number },
      ) => number;
    };
    if (typeof win.requestIdleCallback === 'function') {
      win.requestIdleCallback(() => work(), { timeout: 1200 });
      return;
    }
    window.setTimeout(work, 0);
  };
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      runWhenIdle();
    });
  });
};

const startDeferredStartupBootstrap = () => {
  loadFonts();
  // Async context propagation must be installed before trace hooks.
  installAsyncContextPropagation();
  registerTraceBridge();
  registerFetchTrace();
  registerUserInteractionCapture();
  markStartupBootstrapComplete();
  void import('./lib/secureStorage')
    .then(({ primeStoredPassword }) => primeStoredPassword())
    .catch((error) => {
      const err = error as Error;
      addErrorLog('Deferred secure storage bootstrap failed', {
        error: {
          name: err.name,
          message: err.message,
          stack: err.stack,
        },
      });
    });
};

const registerServiceWorker = () => {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;
  if (import.meta.env.DEV) return;
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch((error) => {
      const err = error as Error;
      addErrorLog('Service worker registration failed', {
        error: {
          name: err.name,
          message: err.message,
          stack: err.stack,
        },
      });
    });
  });
};

initializeRuntimeMotionMode();
initializeSentry();
registerServiceWorker();
createRoot(document.getElementById('root')!).render(<App />);
scheduleAfterFirstPaint(startDeferredStartupBootstrap);
