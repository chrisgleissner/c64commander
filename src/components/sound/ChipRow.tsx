/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */
import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";
import { inkOn, pairVars, type ThemePair } from "@/lib/audio/tone/soundPalette";

export interface Chip {
  id: string;
  label: string;
}

interface ChipRowProps {
  chips: readonly Chip[];
  activeId: string | undefined;
  onSelect: (id: string) => void;
  ariaLabel: string;
  testIdPrefix: string;
  /** Each chip's color: its dot, and its fill when active. Null draws a neutral chip. */
  accentFor: (id: string) => ThemePair | null;
  disabled?: boolean;
  className?: string;
}

const FADE_MASK = "[mask-image:linear-gradient(to_right,transparent,black_28px,black_calc(100%-28px),transparent)]";
const NEUTRAL: ThemePair = { light: "#3b3f52", dark: "#d9dcea" };

/** A horizontally scrolling row of single-choice chips whose active chip is kept in view. */
export const ChipRow = ({
  chips,
  activeId,
  onSelect,
  ariaLabel,
  testIdPrefix,
  accentFor,
  disabled,
  className,
}: ChipRowProps) => {
  const rowRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const row = rowRef.current;
    const active = activeId ? row?.querySelector<HTMLElement>(`[data-chip-id="${activeId}"]`) : null;
    if (!row || !active || typeof row.scrollTo !== "function") return;
    row.scrollTo({ left: active.offsetLeft - (row.clientWidth - active.offsetWidth) / 2, behavior: "smooth" });
  }, [activeId]);

  return (
    <div
      ref={rowRef}
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "flex min-w-0 snap-x snap-proximity scroll-px-4 gap-2 overflow-x-auto px-4 py-1.5 [scrollbar-width:none]",
        FADE_MASK,
        className,
      )}
      data-testid={`${testIdPrefix}-row`}
    >
      {chips.map((chip) => {
        const active = activeId === chip.id;
        const accent = accentFor(chip.id);
        const color = accent ?? NEUTRAL;
        return (
          <button
            key={chip.id}
            type="button"
            className={cn(
              "snd-hue flex h-11 shrink-0 snap-start items-center gap-2 whitespace-nowrap rounded-full px-4 text-sm font-medium",
              "outline-none transition-[background-color,box-shadow,color] duration-150",
              "focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-card",
              "disabled:cursor-not-allowed",
              active
                ? "bg-[var(--hue)] text-[var(--hue-ink)] shadow-[0_1px_2px_rgb(0_0_0/0.18),0_4px_12px_-2px_rgb(0_0_0/0.25)]"
                : "bg-foreground/[0.05] text-foreground shadow-[inset_0_0_0_1px_hsl(var(--foreground)/0.09)] hover:bg-foreground/[0.08]",
            )}
            style={{
              ...pairVars("hue", color),
              ...pairVars("hue-ink", { light: inkOn(color.light), dark: inkOn(color.dark) }),
            }}
            aria-pressed={active}
            disabled={disabled}
            data-chip-id={chip.id}
            data-testid={`${testIdPrefix}-${chip.id}`}
            onClick={() => onSelect(chip.id)}
          >
            {accent && !active ? (
              <span aria-hidden="true" className="size-2 rounded-full bg-[var(--hue)]" data-chip-dot="" />
            ) : null}
            {chip.label}
          </button>
        );
      })}
    </div>
  );
};
