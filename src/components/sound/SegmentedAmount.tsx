/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { nearestPreset } from "@/lib/config/audioProcessingSettings";
import { cn } from "@/lib/utils";

export interface AmountChoice {
  id: string;
  label: string;
  value: number;
}

interface SegmentedAmountProps {
  testIdPrefix: string;
  label: string;
  description: string;
  choices: readonly AmountChoice[];
  value: number;
  onSelect: (value: number) => void;
  /** Adds a "Fine tune" fold holding a slider for the exact amount. */
  fineTune?: { max: number };
  disabled?: boolean;
}

/** One effect as a segmented control, optionally with a slider behind a "Fine tune" fold. */
export const SegmentedAmount = ({
  testIdPrefix,
  label,
  description,
  choices,
  value,
  onSelect,
  fineTune,
  disabled,
}: SegmentedAmountProps) => {
  const [folded, setFolded] = useState(true);
  const selected = nearestPreset(choices, value);
  return (
    <div className="min-w-0 space-y-2 rounded-lg border border-border/70 p-3" data-testid={testIdPrefix}>
      <Label className="text-sm font-medium">{label}</Label>
      <p className="text-sm text-muted-foreground">{description}</p>
      <div
        role="group"
        aria-label={label}
        className={cn("grid gap-2", choices.length === 2 ? "grid-cols-2" : "grid-cols-3")}
      >
        {choices.map((choice) => (
          <Button
            key={choice.id}
            type="button"
            size="sm"
            className="min-h-11 w-full text-sm"
            variant={selected.id === choice.id ? "default" : "outline"}
            aria-pressed={selected.id === choice.id}
            disabled={disabled}
            data-testid={`${testIdPrefix}-${choice.id}`}
            onClick={() => onSelect(choice.value)}
          >
            {choice.label}
          </Button>
        ))}
      </div>
      {fineTune ? (
        <div className="space-y-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="min-h-11 text-sm"
            aria-expanded={!folded}
            disabled={disabled}
            onClick={() => setFolded((current) => !current)}
            data-testid={`${testIdPrefix}-fine`}
          >
            Fine tune
          </Button>
          {folded ? null : (
            <Slider
              className="h-11"
              min={0}
              max={fineTune.max}
              step={1}
              value={[value]}
              disabled={disabled}
              onValueChange={(values) => onSelect(values[0] ?? 0)}
              aria-label={`${label} amount`}
              data-testid={`${testIdPrefix}-amount`}
              keypadFocusId={`${testIdPrefix}-amount`}
              keypadFocusGroup={`${testIdPrefix}-group`}
            />
          )}
        </div>
      ) : null}
    </div>
  );
};
