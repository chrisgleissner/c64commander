/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useRef, useState } from "react";
import type { SwipeEvent } from "@radix-ui/react-toast";
import { useToast } from "@/hooks/use-toast";
import { Toast, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from "@/components/ui/toast";
import { requestDiagnosticsOpen } from "@/lib/diagnostics/diagnosticsOverlay";
import { APP_SETTINGS_KEYS, loadNotificationDurationMs } from "@/lib/config/appSettings";

export function Toaster() {
  const { toasts, dismiss } = useToast();
  const [duration, setDuration] = useState(loadNotificationDurationMs);

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
      {toasts.map(({ id, title, description, action, ...props }) => (
        <ToastItem
          key={id}
          id={id}
          title={title}
          description={description}
          action={action}
          dismiss={dismiss}
          {...props}
        />
      ))}
      <ToastViewport />
    </ToastProvider>
  );
}

type ToastItemProps = {
  id: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactElement;
  dismiss: (id?: string) => void;
  [key: string]: unknown;
};

// Separate component so each toast has its own swipe-tracking ref.
function ToastItem({ id, title, description, action, dismiss, ...props }: ToastItemProps) {
  // Track whether a swipe gesture started so click does not also fire after
  // a swipe on desktop (where mouseup + click both fire after a drag).
  const swipingRef = useRef(false);

  const handleSwipeStart = () => {
    swipingRef.current = true;
  };

  // Radix handles rightward swipe natively via swipeDirection="right" (provider default).
  // For leftward swipe we check the delta and call dismiss() manually.
  const handleSwipeEnd = (e: SwipeEvent) => {
    swipingRef.current = false;
    if (e.detail.delta.x < -50) {
      dismiss(id);
    }
  };

  const handleSwipeCancel = () => {
    swipingRef.current = false;
  };

  // Tap = dismiss + open Diagnostics. Guard prevents firing after a swipe gesture.
  const handleClick = () => {
    if (swipingRef.current) return;
    dismiss(id);
    requestDiagnosticsOpen("error-logs");
  };

  return (
    <Toast
      {...props}
      onSwipeStart={handleSwipeStart}
      onSwipeEnd={handleSwipeEnd}
      onSwipeCancel={handleSwipeCancel}
      onClick={handleClick}
    >
      <div className="grid gap-1">
        {title && <ToastTitle>{title}</ToastTitle>}
        {description && <ToastDescription>{description}</ToastDescription>}
      </div>
      {action}
    </Toast>
  );
}
