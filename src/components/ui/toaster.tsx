/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ComponentProps } from "react";
import { X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Toast, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from "@/components/ui/toast";
import { requestDiagnosticsOpen } from "@/lib/diagnostics/diagnosticsOverlay";
import { APP_SETTINGS_KEYS, loadNotificationDurationMs } from "@/lib/config/appSettings";

const TOAST_RESERVED_HEIGHT_VAR = "--app-toast-reserved-height";

const reserveToastStripHeight = (heightPx: number) => {
  const root = document.documentElement;
  const next = `${Math.max(0, Math.round(heightPx))}px`;
  if (root.style.getPropertyValue(TOAST_RESERVED_HEIGHT_VAR) === next) return;
  root.style.setProperty(TOAST_RESERVED_HEIGHT_VAR, next);
};

/** Keeps the page area ending above the toast strip, so no page control can sit under a toast. */
const useToastStripReservation = () => {
  const viewportRef = useRef<HTMLOListElement | null>(null);
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;
    const measure = () => reserveToastStripHeight(viewport.offsetHeight);
    measure();
    if (typeof ResizeObserver === "undefined") return () => reserveToastStripHeight(0);
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => {
      observer.disconnect();
      reserveToastStripHeight(0);
    };
  }, []);
  return viewportRef;
};

export function Toaster() {
  const { toasts, dismiss } = useToast();
  const [duration, setDuration] = useState(loadNotificationDurationMs);
  const viewportRef = useToastStripReservation();

  // React to duration setting changes without requiring a page reload.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ key: string; value: unknown }>).detail;
      if (detail.key === APP_SETTINGS_KEYS.NOTIFICATION_DURATION_MS_KEY) {
        setDuration(typeof detail.value === "number" ? detail.value : loadNotificationDurationMs());
      }
    };
    window.addEventListener("c64u-app-settings-updated", handler);
    return () => window.removeEventListener("c64u-app-settings-updated", handler);
  }, []);

  return (
    <ToastProvider duration={duration}>
      {toasts.map(
        ({
          id,
          title,
          description,
          action,
          onToastDismiss: _onToastDismiss,
          alwaysVisible: _alwaysVisible,
          ...props
        }) => (
          <ToastItem
            key={id}
            id={id}
            title={title}
            description={description}
            action={action}
            dismiss={dismiss}
            {...props}
          />
        ),
      )}
      <ToastViewport ref={viewportRef} />
    </ToastProvider>
  );
}

type ToastItemProps = {
  id: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactElement;
  dismiss: (id?: string) => void;
  variant?: "default" | "destructive" | null;
  [key: string]: unknown;
};

const TOAST_BUTTON_CLASS =
  "inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md text-base font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function ToastItem({ id, title, description, action, dismiss, variant, ...props }: ToastItemProps) {
  // Radix dismisses on a rightward swipe itself; a leftward one is dismissed here.
  const handleSwipeEnd: NonNullable<ComponentProps<typeof Toast>["onSwipeEnd"]> = (e) => {
    if (e.detail.delta.x < -50) {
      dismiss(id);
    }
  };

  const openDetails = () => {
    dismiss(id);
    requestDiagnosticsOpen("error-logs");
  };

  return (
    <Toast
      data-testid="app-toast"
      data-toast-id={id}
      variant={variant}
      // ERROR_POLICY §4: an error toast stays until the user closes it (or it is stale-cleared).
      // The provider duration is the notice duration, so destructive roots override it (HARD19-037).
      duration={variant === "destructive" ? Infinity : undefined}
      {...props}
      onSwipeEnd={handleSwipeEnd}
    >
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1 self-center">
          {title && (
            <ToastTitle className="line-clamp-2" data-testid="app-toast-title">
              {title}
            </ToastTitle>
          )}
        </div>
        <button
          type="button"
          className={`${TOAST_BUTTON_CLASS} border border-current px-3`}
          data-testid="app-toast-details"
          onClick={openDetails}
        >
          Details
        </button>
        <button
          type="button"
          className={`${TOAST_BUTTON_CLASS} -mr-2 opacity-80 hover:opacity-100`}
          aria-label="Close notification"
          data-testid="app-toast-close"
          onClick={() => dismiss(id)}
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      {description && (
        <ToastDescription className="line-clamp-3" data-testid="app-toast-description">
          {description}
        </ToastDescription>
      )}
      {action ? (
        <div className="flex justify-end" data-testid="app-toast-action">
          {action}
        </div>
      ) : null}
    </Toast>
  );
}
