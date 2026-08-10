/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import React from "react";
import { Button } from "@/components/ui/button";
import { useFocusItem } from "@/hooks/useFocusNavigation";
import { cn } from "@/lib/utils";

interface SectionHeaderProps {
  title: string;
  resetAction?: () => void;
  resetLabel?: string;
  resetDisabled?: boolean;
  isResetting?: boolean;
  className?: string;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  resetTestId?: string;
  /**
   * When set, registers the section's reset button into the keypad focus ring
   * (C64U Remote) so it is reachable by d-pad traversal and center-activation.
   * Inert in the default variant (no provider listener) and skipped while the
   * reset is disabled, so it never changes pointer behaviour.
   */
  focusId?: string;
  /** Lower sorts earlier in keypad d-pad traversal. Defaults to 0. */
  focusOrder?: number;
  /** Skips the title row (bullet + heading). For a section whose title is now owned by
   * an outer `CollapsibleSection` header, so this renders only the reset button/actions
   * row - kept reachable beside the toggle rather than duplicating the heading. */
  hideTitle?: boolean;
}

export function SectionHeader({
  title,
  resetAction,
  resetLabel = "Reset",
  resetDisabled = false,
  isResetting = false,
  className,
  children,
  actions,
  resetTestId,
  focusId,
  focusOrder = 0,
  hideTitle = false,
}: SectionHeaderProps) {
  const resetFocusRef = useFocusItem<HTMLButtonElement>({
    id: focusId ?? "",
    order: focusOrder,
    group: "home-sections",
    disabled: resetDisabled,
  });
  const actionsRow = (
    <div className="flex items-center gap-2">
      {actions}
      {resetAction && (
        <Button
          ref={resetFocusRef}
          variant="outline"
          size="sm"
          onClick={resetAction}
          disabled={resetDisabled}
          data-testid={resetTestId}
        >
          {isResetting ? "Resetting…" : resetLabel}
        </Button>
      )}
    </div>
  );

  if (hideTitle) return actionsRow;

  return (
    <div className={cn("flex items-center justify-between gap-2", className)}>
      <h3 className="category-header">
        <span className="w-1.5 h-1.5 rounded-full bg-primary" />
        {title}
        {children}
      </h3>
      {actionsRow}
    </div>
  );
}
