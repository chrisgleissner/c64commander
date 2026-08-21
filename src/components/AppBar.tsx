/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { ReactNode } from "react";
import { MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requestQuickMenuOpen } from "@/lib/input/keypadCommands";
import { useLayoutEffect, useRef } from "react";
import { UnifiedHealthBadge } from "@/components/UnifiedHealthBadge";
import { AvMirrorLivePip } from "@/components/streams/AvMirrorLivePip";
import { useDisplayProfile } from "@/hooks/useDisplayProfile";
import { useScreenActivity } from "@/hooks/useScreenActivity";
import { cn } from "@/lib/utils";
import { useAppChromeMode } from "@/components/layout/AppChromeContext";
import { INTERSTITIAL_Z_INDEX } from "@/components/ui/interstitialStyles";

type Props = {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Replaces the whole title zone. Prefer {@link Props.leadingVisual} — see its note. */
  leading?: ReactNode;
  /**
   * A mark rendered before the title, inside this component's own title markup.
   *
   * `leading` replaces the title zone entirely, so a page that only wanted a logo beside the title
   * had to copy the title's own markup to keep it looking the same — and Home's copy then drifted
   * from this one. A page that just needs a mark uses this instead and keeps one title.
   */
  leadingVisual?: ReactNode;
  /** testid on the rendered title, for a page whose title is addressed by name in a spec. */
  titleTestId?: string;
  children?: ReactNode;
};

export function AppBar({ title, subtitle: _subtitle, leading, leadingVisual, titleTestId, children }: Props) {
  const headerRef = useRef<HTMLElement | null>(null);
  const { profile } = useDisplayProfile();
  // The smallest screen gets a slim status strip instead of a 44 px row: 24 CSS px of the 427 the
  // panel has, which is half a collapsed card, spent on a bar that holds one title and one dot.
  const isCompact = profile === "compact";
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
        <div
          className={cn("flex items-center justify-between gap-2", isCompact ? "min-h-0" : "min-h-11")}
          data-testid="app-bar-row"
        >
          <div
            className={cn("flex min-w-0 items-center", isCompact ? "min-h-0" : "min-h-11")}
            data-testid="app-bar-title-zone"
          >
            {leading ?? (
              <div className={cn("flex min-w-0 items-center gap-2", isCompact ? "min-h-0" : "min-h-11")}>
                {leadingVisual}
                <h1 className="c64-header truncate text-xl leading-none" data-testid={titleTestId}>
                  {title}
                </h1>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1">
            {/*
              The Quick menu, in the same place on every page.
              It already existed for the keypad's Menu key — jump to a page, Game Mode,
              Diagnostics, Switch device — but nothing on screen could open it, so a reader
              without a keypad could not reach any of it. This is the same dialog, not a second
              menu, and it is where the page-level actions (expand/collapse every section, show
              card descriptions) live rather than spending app-bar width on a button each.
              Left of the health badge, and separated from it, because the badge opens the device
              switcher and the two should not be neighbours a thumb can confuse.
            */}

            <Button
              variant="ghost"
              size="icon"
              className="size-11 shrink-0"
              aria-label="Quick menu"
              data-testid="app-bar-quick-menu"
              onClick={() => requestQuickMenuOpen()}
            >
              <MoreVertical className="h-5 w-5 text-muted-foreground" aria-hidden />
            </Button>
            {/* Live A/V mirror indicator — renders only while a stream is active. */}
            <AvMirrorLivePip />
            {/* §8.1 — Unified badge: sole diagnostic/connectivity element in AppBar */}
            <UnifiedHealthBadge className="self-center" />
          </div>
        </div>
        {children ? <div className="min-w-0">{children}</div> : null}
      </div>
    </header>
  );
}
