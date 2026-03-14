import type { CSSProperties, ReactNode } from "react";

import { useDisplayProfile } from "@/hooks/useDisplayProfile";
import { cn } from "@/lib/utils";

type PageContainerProps = {
  children: ReactNode;
  className?: string;
  size?: "default" | "reading" | "full";
  as?: "main" | "div" | "section";
};

export function PageContainer({ children, className, size = "default", as = "main" }: PageContainerProps) {
  const { tokens } = useDisplayProfile();
  const Component = as;
  const style: CSSProperties = {
    maxWidth: size === "full" ? "100%" : size === "reading" ? tokens.readingMaxWidth : tokens.pageMaxWidth,
  };

  return (
    <Component className={cn("page-shell", className)} style={style}>
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
  testId?: string;
};

export function ProfileActionGrid({
  children,
  className,
  compactColumns = 2,
  mediumColumns = 4,
  expandedColumns = 4,
  minItemWidth,
  testId,
}: ProfileActionGridProps) {
  const { profile, tokens } = useDisplayProfile();
  const columns = profile === "compact" ? compactColumns : profile === "expanded" ? expandedColumns : mediumColumns;
  const style: CSSProperties = {
    gridTemplateColumns: `repeat(${columns}, minmax(${minItemWidth ?? tokens.actionGridMinWidth}, 1fr))`,
  };
  return (
    <div className={cn("profile-action-grid", className)} style={style} data-testid={testId} data-profile={profile}>
      {children}
    </div>
  );
}

type ProfileSplitSectionProps = {
  children: ReactNode;
  className?: string;
  minColumnWidth?: string;
  expandedColumns?: 2 | 3;
  testId?: string;
};

export function ProfileSplitSection({
  children,
  className,
  minColumnWidth = "18rem",
  expandedColumns = 2,
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
