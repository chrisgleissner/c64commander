/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { createContext, useContext, type CSSProperties, type ReactNode } from "react";

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
  /*
   * The column count is what the design asks for, not a promise the grid can always keep.
   *
   * This used to be `repeat(<columns>, minmax(<floor>, 1fr))`, and on the compact profile the
   * floor is `0px`, so the tracks had no lower bound at all: as the app's own Text size setting
   * scaled every label with the root, the tiles stayed exactly as wide and their labels ran past
   * them. "Manage" needed 93px in an 89px tile, and three of Home's machine controls needed 47-54px
   * in 45px. A one-word label cannot wrap out of that, so it was simply clipped.
   *
   * `auto-fit` with a floor lets the row drop to fewer, wider columns instead. The floor is the
   * larger of a rem value — which grows with the text scale, and is what forces the drop — and the
   * width the requested column count would give, which keeps the intended layout at the default
   * text size rather than reflowing every grid in the app.
   */
  const gap = tokens.actionGridGap;
  const requested = `calc((100% - ${columns - 1} * ${gap}) / ${columns})`;
  const floor = minItemWidth ?? (tokens.actionGridMinWidth === "0px" ? "7rem" : tokens.actionGridMinWidth);
  const style: CSSProperties = {
    gridTemplateColumns: `repeat(auto-fit, minmax(min(max(${floor}, ${requested}), 100%), 1fr))`,
  };
  return (
    <ProfileActionGridDensityContext.Provider value={cardDensity}>
      <div className={cn("profile-action-grid", className)} style={style} data-testid={testId} data-profile={profile}>
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
