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
import { INTERSTITIAL_Z_INDEX } from "@/components/ui/interstitialStyles";

type Props = {
  title: ReactNode;
  subtitle?: ReactNode;
  leading?: ReactNode;
  children?: ReactNode;
};

export function AppBar({ title, subtitle: _subtitle, leading, children }: Props) {
  const headerRef = useRef<HTMLElement | null>(null);
  const { profile } = useDisplayProfile();
  const screenActive = useScreenActivity();
  const appChromeMode = useAppChromeMode();

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
        "app-chrome-rail app-chrome-rail-top top-0 border-b border-border bg-background",
        appChromeMode === "sticky" ? "relative w-full max-w-full shrink-0" : "fixed left-0 w-screen max-w-screen",
      )}
      style={{
        zIndex: INTERSTITIAL_Z_INDEX.header,
        top: 0,
        paddingTop: "var(--safe-area-inset-top)",
      }}
      data-app-chrome-mode={appChromeMode}
      data-display-profile={profile}
      data-app-chrome-family="primary"
    >
      <div
        className={cn("app-shell-container", children ? "space-y-3" : "space-y-0")}
        style={{
          paddingTop: "var(--app-chrome-rail-padding-y)",
          paddingBottom: "var(--app-chrome-rail-padding-y)",
        }}
      >
        <div className="flex min-h-11 items-center justify-between gap-2" data-testid="app-bar-row">
          <div className="flex min-h-11 min-w-0 items-center" data-testid="app-bar-title-zone">
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
