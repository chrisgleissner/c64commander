import { addErrorLog } from "@/lib/logging";
import { isNativePlatform } from "@/lib/native/platform";

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
    void navigator.serviceWorker.register("/sw.js").catch((error) => {
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