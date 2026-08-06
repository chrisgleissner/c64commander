/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { activeStepPercent, hvscStageSteps, stageCountLabel, type HvscStageInput } from "@/lib/hvsc/hvscStageModel";

export type HvscStageStepsProps = HvscStageInput & {
  /** The running step's own percentage, when it reports one. */
  stagePercent?: number | null;
  /** Items finished in the running step, e.g. songs read. Preferred over the percentage. */
  stageDone?: number | null;
  /** Items in the running step, once known. */
  stageTotal?: number | null;
  /** Rate or counter text for the running step, e.g. "13 MB/s". */
  detailLabel?: string | null;
  testId?: string;
};

/**
 * The four install steps as a row of circles.
 *
 * This replaces a single percentage bar that failed on hardware twice. The problem was never the
 * arithmetic — it is that the counters behind the stages are in different units and disappear when
 * their stage ends, so any single number has to be guessed at across the handovers. See
 * `hvscStageModel` for the reasoning. Circles state only what is actually known: which stage is
 * running, and which are done.
 */
export const HvscStageSteps = ({
  stagePercent,
  stageDone,
  stageTotal,
  detailLabel,
  testId = "hvsc-stage-steps",
  ...stageInput
}: HvscStageStepsProps) => {
  const steps = hvscStageSteps(stageInput);
  // Counts first: they move from the first item, where a percentage of 61,157 songs reads 0% for the
  // first six hundred of them and looks stuck.
  const counts = stageCountLabel(stageDone, stageTotal);
  const percent = counts === null ? activeStepPercent(stagePercent) : null;
  const activeStep = steps.find((step) => step.status === "active") ?? null;

  return (
    <div className="space-y-2" data-testid={testId}>
      <ol className="flex items-start justify-between gap-1">
        {steps.map((step, index) => (
          <li
            key={step.id}
            className="flex min-w-0 flex-1 flex-col items-center gap-1.5"
            data-testid={`${testId}-${step.id}`}
            data-status={step.status}
          >
            <div className="flex w-full items-center gap-1">
              {/* Connectors sit between circles, so the first has none on its left and the last none
                  on its right — kept as spacers so every step stays the same width. */}
              <span
                aria-hidden
                className={cn(
                  "h-0.5 flex-1 rounded-full",
                  index === 0 ? "bg-transparent" : step.status === "pending" ? "bg-border" : "bg-primary/60",
                )}
              />
              <span
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-semibold transition-colors",
                  step.status === "done" && "border-primary bg-primary text-primary-foreground",
                  step.status === "active" && "border-primary bg-background text-primary",
                  step.status === "pending" && "border-border bg-background text-muted-foreground",
                  step.status === "failed" && "border-destructive bg-destructive text-destructive-foreground",
                )}
              >
                {step.status === "done" ? (
                  <Check className="h-3.5 w-3.5" aria-hidden />
                ) : step.status === "failed" ? (
                  <X className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  index + 1
                )}
              </span>
              <span
                aria-hidden
                className={cn(
                  "h-0.5 flex-1 rounded-full",
                  index === steps.length - 1
                    ? "bg-transparent"
                    : step.status === "done"
                      ? "bg-primary/60"
                      : "bg-border",
                )}
              />
            </div>
            <span
              className={cn(
                "text-center text-[11px] leading-tight",
                step.status === "pending" ? "text-muted-foreground" : "text-foreground",
                step.status === "active" && "font-medium",
              )}
            >
              {step.label}
            </span>
          </li>
        ))}
      </ol>

      {/* What the running step is doing, in a sentence. The labels under the circles are two words
          because that is all that fits beneath them, which leaves "Song details" to account for
          most of the wait on a first install without saying what it is doing. Only the running
          step's sentence appears: the other three describe work that is done or has not begun. */}
      {activeStep ? (
        <p className="text-center text-[11px] leading-snug text-muted-foreground" data-testid={`${testId}-explains`}>
          {activeStep.description}
        </p>
      ) : null}

      {/* The running step's own counter. Scoped to one step, where a percentage is honest. */}
      {counts !== null || percent !== null || detailLabel ? (
        <p className="text-center text-[11px] text-muted-foreground" data-testid={`${testId}-detail`}>
          {[counts, percent !== null ? `${percent}%` : null, detailLabel].filter(Boolean).join(" · ")}
        </p>
      ) : null}
    </div>
  );
};
