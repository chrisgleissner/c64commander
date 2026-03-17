/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { ReactNode } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ConnectivityIndicator } from "@/components/ConnectivityIndicator";
import { DiagnosticsActivityIndicator } from "@/components/DiagnosticsActivityIndicator";
import { useDisplayProfile } from "@/hooks/useDisplayProfile";
import { requestDiagnosticsOpen } from "@/lib/diagnostics/diagnosticsOverlay";
import { isDiagnosticsOverlayActive, subscribeDiagnosticsOverlay } from "@/lib/diagnostics/diagnosticsOverlayState";
import { cn } from "@/lib/utils";

type Props = {
  title: ReactNode;
  subtitle?: ReactNode;
  leading?: ReactNode;
  children?: ReactNode;
};

export function AppBar({ title, subtitle, leading, children }: Props) {
  const headerRef = useRef<HTMLElement | null>(null);
  const { profile, tokens } = useDisplayProfile();
  const [diagnosticsOverlayActive, setDiagnosticsOverlayActive] = useState(isDiagnosticsOverlayActive());
  const compact = profile === "compact";

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    const element = headerRef.current;
    if (!element) return;

    const updateHeight = () => {
      const nextHeight = element.offsetHeight;
      if (!Number.isFinite(nextHeight) || nextHeight <= 0) return;
      document.documentElement.style.setProperty("--app-bar-height", `${nextHeight}px`);
    };

    updateHeight();

    let observer: ResizeObserver | null = null;
    if ("ResizeObserver" in window) {
      observer = new ResizeObserver(() => updateHeight());
      observer.observe(element);
    } else {
      window.addEventListener("resize", updateHeight);
    }

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateHeight);
    };
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeDiagnosticsOverlay((active) => {
      setDiagnosticsOverlayActive(active);
    });
    return () => unsubscribe();
  }, []);

  const handleDiagnosticsOpen = () => {
    requestDiagnosticsOpen("actions");
  };

  return (
    <header
      ref={headerRef}
      className={cn(
        "fixed left-0 top-0 z-40 w-screen max-w-screen bg-background/80 border-b border-border backdrop-blur-lg",
        !compact && "pt-safe",
      )}
    >
      <div
        className={cn("app-shell-container", compact ? "space-y-2" : "py-4 space-y-3")}
        style={compact ? { paddingTop: tokens.pagePaddingX, paddingBottom: tokens.pagePaddingY } : undefined}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            {leading ? (
              leading
            ) : (
              <>
                <h1 className="c64-header text-xl truncate">{title}</h1>
                {subtitle ? <p className="text-xs text-muted-foreground mt-1 truncate">{subtitle}</p> : null}
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
