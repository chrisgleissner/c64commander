import type { ReactNode } from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ConnectivityIndicator } from '@/components/ConnectivityIndicator';
import { DiagnosticsActivityIndicator } from '@/components/DiagnosticsActivityIndicator';
import { requestDiagnosticsOpen } from '@/lib/diagnostics/diagnosticsOverlay';
import { isDiagnosticsOverlayActive, subscribeDiagnosticsOverlay } from '@/lib/diagnostics/diagnosticsOverlayState';
import { useDiagnosticsActivity } from '@/hooks/useDiagnosticsActivity';
import { toast, useToast } from '@/hooks/use-toast';

type Props = {
  title: ReactNode;
  subtitle?: ReactNode;
  leading?: ReactNode;
  children?: ReactNode;
};

export function AppBar({ title, subtitle, leading, children }: Props) {
  const headerRef = useRef<HTMLElement | null>(null);
  const restToastRef = useRef<ReturnType<typeof toast> | null>(null);
  const { restInFlight } = useDiagnosticsActivity();
  const { toasts } = useToast();
  const [diagnosticsOverlayActive, setDiagnosticsOverlayActive] = useState(isDiagnosticsOverlayActive());

  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;
    const element = headerRef.current;
    if (!element) return;

    const updateHeight = () => {
      const nextHeight = element.offsetHeight;
      if (!Number.isFinite(nextHeight) || nextHeight <= 0) return;
      document.documentElement.style.setProperty('--app-bar-height', `${nextHeight}px`);
    };

    updateHeight();

    let observer: ResizeObserver | null = null;
    if ('ResizeObserver' in window) {
      observer = new ResizeObserver(() => updateHeight());
      observer.observe(element);
    } else {
      window.addEventListener('resize', updateHeight);
    }

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateHeight);
    };
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeDiagnosticsOverlay((active) => {
      setDiagnosticsOverlayActive(active);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const restToastId = restToastRef.current?.id;
    const hasOtherToast = toasts.some((entry) => entry.id !== restToastId);
    if (diagnosticsOverlayActive || restInFlight === 0 || hasOtherToast) {
      if (restToastRef.current) {
        restToastRef.current.dismiss();
        restToastRef.current = null;
      }
      return;
    }

    const description = restInFlight === 1
      ? '1 request in flight.'
      : `${restInFlight} requests in flight.`;

    if (!restToastRef.current) {
      restToastRef.current = toast({
        title: 'REST activity',
        description,
      });
      return;
    }

    restToastRef.current.update({
      title: 'REST activity',
      description,
    });
  }, [diagnosticsOverlayActive, restInFlight, toasts]);

  const handleDiagnosticsOpen = () => {
    requestDiagnosticsOpen('actions');
  };

  return (
    <header
      ref={headerRef}
      className="fixed top-0 left-0 right-0 z-40 bg-background/80 backdrop-blur-lg border-b border-border pt-safe"
    >
      <div className="container py-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            {leading ? (
              leading
            ) : (
              <>
                <h1 className="c64-header text-xl truncate">{title}</h1>
                {subtitle ? (
                  <p className="text-xs text-muted-foreground mt-1 truncate">{subtitle}</p>
                ) : null}
              </>
            )}
          </div>
          <div className="flex items-center gap-3">
            <DiagnosticsActivityIndicator onClick={handleDiagnosticsOpen} />
            <ConnectivityIndicator />
          </div>
        </div>
        {children ? <div className="min-w-0">{children}</div> : null}
      </div>
    </header>
  );
}
