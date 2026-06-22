/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { installAsyncContextPropagation } from "./lib/tracing/traceActionContextStore";
import { registerFetchTrace } from "./lib/tracing/fetchTrace";
import { registerUserInteractionCapture } from "./lib/tracing/userInteractionCapture";
import { registerTraceBridge } from "./lib/tracing/traceBridge";
import { registerDiagnosticsTestBridge } from "./lib/diagnostics/diagnosticsTestBridge";
import { markStartupBootstrapComplete } from "./lib/startup/startupMilestones";
import { initializeRuntimeMotionMode } from "./lib/startup/runtimeMotionBudget";
import { registerServiceWorker } from "./lib/startup/serviceWorkerRegistration";
import { addErrorLog } from "./lib/logging";
import { installNativeSafeAreaSync } from "./lib/native/safeArea";
import { applyFullScreenFromSettings } from "./lib/native/fullScreen";
import { applyScreenOrientationFromSettings } from "./lib/native/screenOrientation";
import { loadRemoteFonts } from "./lib/startup/fontLoading";
import "./index.css";

const scheduleAfterFirstPaint = (work: () => void) => {
  if (import.meta.env.VITE_ENABLE_TEST_PROBES === "1") {
    work();
    return;
  }
  if (typeof window === "undefined") {
    work();
    return;
  }
  const runWhenIdle = () => {
    const win = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    };
    if (typeof win.requestIdleCallback === "function") {
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
  loadRemoteFonts();
  // Async context propagation must be installed before trace hooks.
  installAsyncContextPropagation();
  registerTraceBridge();
  registerDiagnosticsTestBridge();
  registerFetchTrace();
  registerUserInteractionCapture();
  markStartupBootstrapComplete();
  void import("./lib/startup/secureStorageBootstrap")
    .then(({ primeSecureStorageAfterStartup }) => primeSecureStorageAfterStartup())
    .catch((error) => {
      const err = error as Error;
      addErrorLog("Deferred secure storage bootstrap failed", {
        error: {
          name: err.name,
          message: err.message,
          stack: err.stack,
        },
      });
    });
};

initializeRuntimeMotionMode();
registerServiceWorker();
installNativeSafeAreaSync();
applyFullScreenFromSettings();
applyScreenOrientationFromSettings();
createRoot(document.getElementById("root")!).render(<App />);
scheduleAfterFirstPaint(startDeferredStartupBootstrap);
