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
      // Mirrored onto the DOM `id` as well as `data-testid`, the way the tab bar and the Add-items
      // button already do it. A WebView exposes the DOM id as the Android accessibility
      // resource-id, and `data-testid` not at all, so a UI-automation `id:` selector can only
      // reach a tile that carries both. Without it the showcase walk had to match these tiles by
      // their visible label, which is one word shared with other controls on the same page.
      id={dataTestId}
      data-testid={dataTestId}
      className={cn(
        "quick-action",
        // `px-0.5`, not the `p-2.5` this used to be on both axes. Horizontal padding is width the
        // label could have had, and these tiles carry one word that cannot wrap, so a word wider
        // than the box is cut rather than wrapped. The medium profile at 393px draws four 69.6px
        // tracks, which left 58.6px for the label: "Resume" needed 61.4px and "Manage" 61.7px, and
        // both shipped cut. Two pixels a side is enough to keep the text off the rounded border.
        //
        // The vertical sizes are what they are because every label here is now one word on one
        // line. A grid row stretches to its tallest tile, so a single wrapped label used to add
        // 21.6px to all four tiles beside it: the medium 393px row measured 112.3px against the
        // 86px floor.
        //
        // With nothing wrapping, CONTENT decides the height, not the floor — the icon, the gap and
        // one line of label came to 71.6px on compact against a 64px floor the tile never reached.
        // `py-1.5` and `gap-0.5` take 6px of that back. The floor stays as the 44px touch minimum
        // written in pixels, which is what it is for; it is inert while the content is taller.
        compact ? "gap-0.5 px-0.5 py-1.5 min-h-11" : null,
        variantClasses[variant],
        disabled ? "opacity-50 cursor-not-allowed" : null,
        className,
      )}
    >
      <div
        className={cn(
          // `p-0.5`: the tinted chip reads as a chip at 2px around the glyph, and the 8px it used
          // to carry was the single largest piece of dead height in the tile.
          compact ? "p-0.5" : "p-2",
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
          compact ? "text-xs leading-tight text-center whitespace-normal break-normal" : "text-sm",
        )}
      >
        {label}
      </span>
      {description && (
        <span
          className={cn(
            "text-muted-foreground max-w-full",
            // Deliberately NOT clamped. A grid row is as tall as its tallest tile, so a long caption
            // here sets the height of every tile beside it — one 41-character sentence under a
            // greyed tile took Home's top row from 91 px to 204 px on a cartridge. Clipping it to a
            // fixed number of lines would hide that rather than fix it, and would put this span in
            // breach of `actionTileLabels.spec.ts`, which measures every tile span at every profile
            // and width and fails on any text the tile does not draw whole. Callers pass a caption
            // short enough to read in a ~68 px tile, and that spec is what holds them to it.
            //
            // A word wider than the tile still has to split, but at a syllable with a hyphen, not as "connecte d".
            compact ? "text-xs leading-tight text-center whitespace-normal break-words hyphens-auto" : "text-xs",
          )}
        >
          {description}
        </span>
      )}
    </button>
  );
}
