/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Info } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { explainSkippedProbe, probeDisplayName } from "@/lib/diagnostics/skippedProbeExplanation";

type Props = {
  probe: string;
  reason: string | null | undefined;
  testId: string;
  /** Controlled open state, for a list that is re-rendered while the explanation is open. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

/** "Skipped" with an info button that says why, so the reason is not printed into a narrow row. */
export function SkippedProbeStatus({ probe, reason, testId, open, onOpenChange }: Props) {
  const explanation = explainSkippedProbe(reason);
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      <span className="whitespace-nowrap">Skipped</span>
      {explanation ? (
        <Popover open={open} onOpenChange={onOpenChange}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-11 w-11 shrink-0 text-muted-foreground hover:text-foreground"
              aria-label={`Why was ${probeDisplayName(probe)} skipped?`}
              data-testid={testId}
            >
              <Info className="h-4 w-4" aria-hidden="true" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-64 p-3 text-sm leading-snug"
            aria-label={`Why ${probeDisplayName(probe)} was skipped`}
            data-testid={`${testId}-explanation`}
          >
            <p>{explanation}</p>
          </PopoverContent>
        </Popover>
      ) : null}
    </span>
  );
}
