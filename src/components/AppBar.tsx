/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { ReactNode } from "react";
import { useLayoutEffect, useRef } from "react";
import { UnifiedHealthBadge } from "@/components/UnifiedHealthBadge";
import { useDisplayProfile } from "@/hooks/useDisplayProfile";
import { useScreenActivity } from "@/hooks/useScreenActivity";
import { cn } from "@/lib/utils";
import { useAppChromeMode } from "@/components/layout/AppChromeContext";

type Props = {
  title: ReactNode;
  subtitle?: ReactNode;
  leading?: ReactNode;
  children?: ReactNode;
};

export function AppBar({ title, subtitle: _subtitle, leading, children }: Props) {
  const headerRef = useRef<HTMLElement | null>(null);
  const { profile, tokens } = useDisplayProfile();
  const screenActive = useScreenActivity();
  const appChromeMode = useAppChromeMode();
  const compact = profile === "compact";

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    if (!screenActive) return;
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
      globalThis.addEventListener("resize", updateHeight);
    }

    return () => {
      observer?.disconnect();
      globalThis.removeEventListener("resize", updateHeight);
    };
  }, [screenActive]);

  return (
    <header
      ref={headerRef}
      className={cn(
        // z-[51] keeps the app bar (and health badge) above overlay backdrops (z-50) so the badge
        // remains visually readable at all times — even when a bottom sheet or dialog is open.
        "top-0 z-[51] bg-background/80 border-b border-border backdrop-blur-lg",
        appChromeMode === "sticky" ? "sticky w-full max-w-full" : "fixed left-0 w-screen max-w-screen",
        !compact && "pt-safe",
      )}
      data-app-chrome-mode={appChromeMode}
    >
      <div
        className={cn("app-shell-container", children ? "space-y-3" : "space-y-0")}
        style={{
          paddingTop: compact ? tokens.pagePaddingX : tokens.pagePaddingY,
          paddingBottom: compact ? tokens.pagePaddingX : tokens.pagePaddingY,
        }}
      >
        <div className="flex min-h-[52px] items-center justify-between gap-4" data-testid="app-bar-row">
          <div className="flex min-h-[52px] min-w-0 items-center">
            {leading ? leading : <h1 className="c64-header text-xl leading-none truncate">{title}</h1>}
          </div>
          {/* §8.1 — Unified badge: sole diagnostic/connectivity element in AppBar */}
          <UnifiedHealthBadge className="self-center" />
        </div>
        {children ? <div className="min-w-0">{children}</div> : null}
      </div>
    </header>
  );
}
