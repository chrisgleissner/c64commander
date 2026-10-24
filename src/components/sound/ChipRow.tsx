/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
  disabled?: boolean;
  className?: string;
}

const FADE_MASK = "[mask-image:linear-gradient(to_right,transparent,black_14px,black_calc(100%-14px),transparent)]";

/** A horizontally scrolling row of single-choice chips whose active chip is kept in view. */
export const ChipRow = ({ chips, activeId, onSelect, ariaLabel, testIdPrefix, disabled, className }: ChipRowProps) => {
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
      className={cn("flex min-w-0 gap-2 overflow-x-auto px-3 py-0.5", FADE_MASK, className)}
      data-testid={`${testIdPrefix}-row`}
    >
      {chips.map((chip) => (
        <Button
          key={chip.id}
          type="button"
          size="sm"
          variant={activeId === chip.id ? "default" : "outline"}
          className="min-h-11 shrink-0 whitespace-nowrap px-3 text-sm"
          aria-pressed={activeId === chip.id}
          disabled={disabled}
          data-chip-id={chip.id}
          data-testid={`${testIdPrefix}-${chip.id}`}
          onClick={() => onSelect(chip.id)}
        >
          {chip.label}
        </Button>
      ))}
    </div>
  );
};
