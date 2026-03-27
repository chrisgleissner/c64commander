/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addErrorLog } from "@/lib/logging";
import { isNativePlatform } from "@/lib/native/platform";

const isVitestEnvironment = () => {
  try {
    return typeof process !== "undefined" && process.env.VITEST === "true";
  } catch {
    return false;
  }
};

const isTestProbeEnvironment = () => {
  try {
    if (import.meta.env.VITE_ENABLE_TEST_PROBES === "1") return true;
  } catch {
    // Ignore env access failures and fall through to process/window checks.
  }
  try {
    if (typeof process !== "undefined" && process.env?.VITE_ENABLE_TEST_PROBES === "1") return true;
  } catch {
    // Ignore process access failures.
  }
  return (
    typeof window !== "undefined" &&
    (window as Window & { __c64uTestProbeEnabled?: boolean }).__c64uTestProbeEnabled === true
  );
};

export const getServiceWorkerScriptUrl = () => {
  const buildId = typeof __SW_BUILD_ID__ !== "undefined" ? __SW_BUILD_ID__ : "";
  const fallbackBuildId =
    !buildId && typeof __APP_VERSION__ !== "undefined" && isVitestEnvironment() ? `${__APP_VERSION__}-test-build` : "";
  const resolvedBuildId = buildId || fallbackBuildId;
  if (!resolvedBuildId) return "/sw.js";
  return `/sw.js?v=${encodeURIComponent(resolvedBuildId)}`;
};

export const shouldRegisterServiceWorker = () => {
  return shouldRegisterServiceWorkerForEnvironment(import.meta.env.DEV);
};

export const shouldRegisterServiceWorkerForEnvironment = (isDev: boolean) => {
  if (typeof window === "undefined") return false;
  if (!("serviceWorker" in navigator)) return false;
  if (isDev) return false;
  if (isTestProbeEnvironment()) return false;
  if (isNativePlatform()) return false;
  return true;
};

export const registerServiceWorker = () => {
  return registerServiceWorkerForEnvironment(import.meta.env.DEV);
};

export const registerServiceWorkerForEnvironment = (isDev: boolean) => {
  if (!shouldRegisterServiceWorkerForEnvironment(isDev)) return false;
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register(getServiceWorkerScriptUrl()).catch((error) => {
      const err = error as Error;
      addErrorLog("Service worker registration failed", {
        error: {
          name: err.name,
          message: err.message,
          stack: err.stack,
        },
      });
    });
  });
  return true;
};
