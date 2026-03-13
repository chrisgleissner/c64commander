import { addErrorLog } from "@/lib/logging";
import { isNativePlatform } from "@/lib/native/platform";

export const getServiceWorkerScriptUrl = () => {
  const buildId = typeof __SW_BUILD_ID__ !== "undefined" ? __SW_BUILD_ID__ : "";
  if (!buildId) return "/sw.js";
  return `/sw.js?v=${encodeURIComponent(buildId)}`;
};

export const shouldRegisterServiceWorker = () => {
  return shouldRegisterServiceWorkerForEnvironment(import.meta.env.DEV);
};

export const shouldRegisterServiceWorkerForEnvironment = (isDev: boolean) => {
  if (typeof window === "undefined") return false;
  if (!("serviceWorker" in navigator)) return false;
  if (isDev) return false;
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
