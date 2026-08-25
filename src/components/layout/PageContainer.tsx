/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { useAppChromeMode } from "@/components/layout/AppChromeContext";
import { useDisplayProfile } from "@/hooks/useDisplayProfile";
import { cn } from "@/lib/utils";

type PageContainerProps = {
  children: ReactNode;
  className?: string;
  size?: "default" | "reading" | "full";
  as?: "main" | "div" | "section";
};

export type ProfileActionGridDensity = "adaptive" | "compact";

const ProfileActionGridDensityContext = createContext<ProfileActionGridDensity>("adaptive");

export const useProfileActionGridDensity = () => useContext(ProfileActionGridDensityContext);

/**
 * The widest track a tile needs before its label starts running past it.
 *
 * A tile's label is one word — "Manage", "Pause", "Game" — and a one-word label cannot wrap out
 * of a track too narrow for it, so it is clipped instead. 3.75rem sits just under the ~64px a
 * four-column medium row already gives, so that layout is untouched, and because it is a rem it
 * grows with the reader's Text size setting.
 */
const MIN_TILE_REM = 3.75;

/**
 * The largest column count, up to the one the design asked for, whose tracks are still wide
 * enough for a tile's label.
 *
 * Measured from the grid rather than derived from the profile. The two things that make a track
 * too narrow are independent: the reader's Text size, and a profile being wider than the screen
 * actually showing it — the medium profile forced onto a 320px screen gave 45px tiles against
 * labels needing 47-56px. Measuring covers both, and covers a window resize for free.
 *
 * `auto-fit` with a rem floor was tried first. It decides the count itself, and when the floor
 * and the available width are close it rounds a column away: a floor chosen to leave the medium
 * profile's four columns alone at the default text size still took it to three.
 */
const useFittingColumns = (requested: number, gap: string, enabled: boolean) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [columns, setColumns] = useState(requested);

  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element || typeof ResizeObserver === "undefined") {
      setColumns(requested);
      return undefined;
    }
    const measure = () => {
      const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const gapPx = Number.parseFloat(getComputedStyle(element).columnGap) || 0;
      const width = element.getBoundingClientRect().width;
      if (!width) return;
      const minTile = MIN_TILE_REM * rootFontSize;
      let fitting = requested;
      while (fitting > 1 && (width - (fitting - 1) * gapPx) / fitting < minTile) fitting -= 1;
      setColumns(fitting);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    // The root font size changes with the Text size setting without the grid resizing at all.
    window.addEventListener("c64u-ui-preferences-changed", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("c64u-ui-preferences-changed", measure);
    };
  }, [requested, gap, enabled]);

  return { ref, columns };
};

export function PageContainer({ children, className, size = "default", as = "main" }: PageContainerProps) {
  const { tokens } = useDisplayProfile();
  const appChromeMode = useAppChromeMode();
  const Component = as;
  const style: CSSProperties = {
    height: appChromeMode === "sticky" ? "calc(100% - var(--app-bar-height))" : undefined,
    minHeight: 0,
    width: size === "full" ? "100%" : undefined,
    maxWidth: size === "full" ? "100%" : size === "reading" ? tokens.readingMaxWidth : tokens.pageMaxWidth,
  };

  return (
    <Component className={cn("page-shell", className)} data-page-scroll-container="true" style={style}>
      {children}
    </Component>
  );
}

export function PageStack({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("page-stack", className)}>{children}</div>;
}

type ProfileActionGridProps = {
  children: ReactNode;
  className?: string;
  compactColumns?: number;
  mediumColumns?: number;
  expandedColumns?: number;
  minItemWidth?: string;
  cardDensity?: ProfileActionGridDensity;
  testId?: string;
};

export function ProfileActionGrid({
  children,
  className,
  compactColumns = 2,
  mediumColumns = 4,
  expandedColumns = 4,
  minItemWidth,
  cardDensity = "adaptive",
  testId,
}: ProfileActionGridProps) {
  const { profile, tokens } = useDisplayProfile();
  const columns = profile === "compact" ? compactColumns : profile === "expanded" ? expandedColumns : mediumColumns;
  // An explicit `minItemWidth` is a caller naming exactly how wide a track must be, so it keeps
  // both the count and the width it was given; nothing is measured for it.
  const gap = tokens.actionGridGap;
  const { ref, columns: fitting } = useFittingColumns(columns, gap, !minItemWidth);
  const style: CSSProperties = {
    gridTemplateColumns: `repeat(${fitting}, minmax(${minItemWidth ?? tokens.actionGridMinWidth}, 1fr))`,
  };
  return (
    <ProfileActionGridDensityContext.Provider value={cardDensity}>
      <div
        ref={ref}
        className={cn("profile-action-grid", className)}
        style={style}
        data-testid={testId}
        data-profile={profile}
      >
        {children}
      </div>
    </ProfileActionGridDensityContext.Provider>
  );
}

type ProfileSplitSectionProps = {
  children: ReactNode;
  className?: string;
  minColumnWidth?: string;
  testId?: string;
};

export function ProfileSplitSection({
  children,
  className,
  minColumnWidth = "18rem",
  testId,
}: ProfileSplitSectionProps) {
  const { profile } = useDisplayProfile();
  const style: CSSProperties | undefined =
    profile === "expanded"
      ? {
          gridTemplateColumns: `repeat(auto-fit, minmax(min(${minColumnWidth}, 100%), 1fr))`,
        }
      : undefined;

  return (
    <div
      className={cn("profile-split-section", profile === "expanded" && "profile-split-section-expanded", className)}
      style={style}
      data-testid={testId}
      data-profile={profile}
    >
      {children}
    </div>
  );
}
