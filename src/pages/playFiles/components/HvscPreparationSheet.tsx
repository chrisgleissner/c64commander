import {
  AppSheet,
  AppSheetBody,
  AppSheetContent,
  AppSheetDescription,
  AppSheetFooter,
  AppSheetHeader,
  AppSheetTitle,
} from "@/components/ui/app-surface";
import { Button } from "@/components/ui/button";
import type { HvscPreparationPhase, HvscPreparationState } from "@/lib/hvsc";
import type { HvscStageId } from "@/lib/hvsc/hvscStageModel";
import { HvscStageSteps } from "./HvscStageSteps";

type HvscPreparationSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: HvscPreparationState;
  statusLabel: string;
  failedPhase: HvscPreparationPhase;
  /** The most recent raw progress stage, which says which step is running. */
  stage: string | null;
  /** The resolved running step, preferred over the raw stage. */
  step?: HvscStageId | null;
  /** The running step's own percentage. */
  stagePercent: number | null;
  /** Items finished in the running step, and how many there are. */
  stageDone?: number | null;
  stageTotal?: number | null;
  throughputLabel: string | null;
  readySongCount: number;
  errorReason: string | null;
  onBrowse: () => void;
  onCancel: () => void;
  onRetry: () => void;
};

const formatReadyCount = (count: number) => `${count.toLocaleString()} songs ready`;

export const HvscPreparationSheet = ({
  open,
  onOpenChange,
  state,
  statusLabel,
  failedPhase,
  stage,
  step = null,
  stagePercent,
  stageDone = null,
  stageTotal = null,
  throughputLabel,
  readySongCount,
  errorReason,
  onBrowse,
  onCancel,
  onRetry,
}: HvscPreparationSheetProps) => {
  const isInProgress = state === "DOWNLOADING" || state === "INGESTING" || state === "DOWNLOADED";
  const isSuccess = state === "READY";
  const isError = state === "ERROR";

  return (
    <AppSheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && isInProgress) {
          return;
        }
        onOpenChange(nextOpen);
      }}
    >
      <AppSheetContent data-testid="hvsc-preparation-sheet">
        <AppSheetHeader hideClose={isInProgress}>
          <AppSheetTitle>Preparing HVSC library</AppSheetTitle>
          <AppSheetDescription>
            {isSuccess
              ? "The HVSC library is indexed and ready to browse."
              : isError
                ? "Preparation stopped before the HVSC browser could open."
                : "Download and indexing start automatically when you choose HVSC from Add items."}
          </AppSheetDescription>
        </AppSheetHeader>

        <AppSheetBody className="space-y-4 px-4 py-4 sm:px-6" data-testid="hvsc-preparation-body">
          <div className="rounded-panel border border-border bg-muted/30 p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">{statusLabel}</p>
                {isError ? (
                  <p className="text-xs text-muted-foreground">
                    Failure phase: {failedPhase === "ingest" ? "Indexing" : "Downloading"}
                  </p>
                ) : null}
              </div>
            </div>

            {/* Four named steps rather than one percentage — the counters behind the stages are in
                different units and vanish at each handover, so a single figure could only ever be a
                guess. It showed 73%, fell to 58%, then disappeared without reaching 100%. */}
            <HvscStageSteps
              state={state}
              stage={stage}
              step={step}
              failedPhase={failedPhase}
              stagePercent={stagePercent}
              stageDone={stageDone}
              stageTotal={stageTotal}
              detailLabel={throughputLabel}
              testId="hvsc-preparation-progress"
            />

            {isSuccess ? (
              <p className="text-sm font-medium text-foreground" data-testid="hvsc-preparation-success-count">
                {formatReadyCount(readySongCount)}
              </p>
            ) : null}

            {!isSuccess ? (
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span data-testid="hvsc-preparation-phase">{statusLabel}</span>
                {throughputLabel ? <span data-testid="hvsc-preparation-throughput">{throughputLabel}</span> : null}
              </div>
            ) : null}

            {isError && errorReason ? (
              <p className="text-sm text-destructive" data-testid="hvsc-preparation-error">
                {errorReason}
              </p>
            ) : null}
          </div>
        </AppSheetBody>

        <AppSheetFooter className="flex flex-wrap items-center justify-end gap-2">
          {isSuccess ? (
            <Button onClick={onBrowse} data-testid="hvsc-preparation-browse">
              Browse HVSC
            </Button>
          ) : null}
          {isError ? (
            <>
              <Button variant="outline" onClick={onCancel} data-testid="hvsc-preparation-cancel">
                Cancel
              </Button>
              <Button onClick={onRetry} data-testid="hvsc-preparation-retry">
                Retry
              </Button>
            </>
          ) : null}
          {isInProgress ? (
            <Button variant="outline" onClick={onCancel} data-testid="hvsc-preparation-cancel">
              Cancel
            </Button>
          ) : null}
        </AppSheetFooter>
      </AppSheetContent>
    </AppSheet>
  );
};
