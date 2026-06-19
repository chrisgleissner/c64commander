/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { LucideIcon } from "lucide-react";
import { useDisplayProfile } from "@/hooks/useDisplayProfile";
import { useProfileActionGridDensity } from "@/components/layout/PageContainer";
import { useFocusItem } from "@/hooks/useFocusNavigation";
import { cn } from "@/lib/utils";
import { handlePointerButtonClick } from "@/lib/ui/buttonInteraction";

interface QuickActionCardProps {
  icon: LucideIcon;
  label: string;
  description?: string;
  onClick: () => void;
  variant?: "default" | "danger" | "success";
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  dataTestId?: string;
  /**
   * When set, registers this card into the keypad focus ring (C64U Remote) so it
   * is reachable by d-pad traversal and center-activation. Inert in the default
   * variant (no provider listener), so it never changes pointer behaviour.
   */
  focusId?: string;
  /** Lower sorts earlier in keypad d-pad traversal. Defaults to 0. */
  focusOrder?: number;
}

export function QuickActionCard({
  icon: Icon,
  label,
  description,
  onClick,
  variant = "default",
  disabled = false,
  loading = false,
  className,
  dataTestId,
  focusId,
  focusOrder = 0,
}: QuickActionCardProps) {
  const { profile } = useDisplayProfile();
  const density = useProfileActionGridDensity();
  // A disabled/loading card is registered as disabled so the keypad ring skips
  // it (a never-reachable CTA can't be activated by accident while inactive).
  const focusRef = useFocusItem<HTMLButtonElement>({
    id: focusId ?? "",
    order: focusOrder,
    group: "home-actions",
    disabled: disabled || loading,
  });
  const compact = density === "compact" || (density === "adaptive" && profile === "compact");
  const variantClasses = {
    default: "hover:border-primary hover:bg-primary/5",
    danger: "hover:border-destructive hover:bg-destructive/5",
    success: "hover:border-success hover:bg-success/5",
  };

  return (
    <button
      ref={focusRef}
      onClick={(event) => {
        onClick();
        handlePointerButtonClick(event);
      }}
      disabled={disabled || loading}
      data-testid={dataTestId}
      className={cn(
        "quick-action",
        compact ? "gap-1.5 p-2.5 min-h-[86px]" : null,
        variantClasses[variant],
        disabled ? "opacity-50 cursor-not-allowed" : null,
        className,
      )}
    >
      <div
        className={cn(
          compact ? "p-1.5" : "p-2",
          "rounded-lg",
          variant === "danger"
            ? "bg-destructive/10 text-destructive"
            : variant === "success"
              ? "bg-success/10 text-success"
              : "bg-primary/10 text-primary",
        )}
      >
        <Icon className={cn(compact ? "h-5 w-5" : "h-6 w-6", loading ? "animate-pulse" : null)} />
      </div>
      <span
        className={cn(
          "font-medium max-w-full",
          compact ? "text-[11px] leading-tight text-center whitespace-normal break-normal" : "text-sm",
        )}
      >
        {label}
      </span>
      {description && (
        <span
          className={cn(
            "text-muted-foreground max-w-full",
            compact ? "text-[11px] leading-tight text-center whitespace-normal break-words" : "text-xs",
          )}
        >
          {description}
        </span>
      )}
    </button>
  );
}
