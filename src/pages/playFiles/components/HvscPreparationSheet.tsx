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
import { Progress } from "@/components/ui/progress";
import type { HvscPreparationPhase, HvscPreparationState } from "@/lib/hvsc";

type HvscPreparationSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: HvscPreparationState;
  statusLabel: string;
  failedPhase: HvscPreparationPhase;
  progressPercent: number | null;
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
  progressPercent,
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
  const normalizedProgress =
    typeof progressPercent === "number" ? Math.max(0, Math.min(100, progressPercent)) : isSuccess ? 100 : 0;

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
          <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">{statusLabel}</p>
                {isError ? (
                  <p className="text-xs text-muted-foreground">
                    Failure phase: {failedPhase === "ingest" ? "Indexing" : "Downloading"}
                  </p>
                ) : null}
              </div>
              <p className="text-sm font-medium text-foreground" data-testid="hvsc-preparation-progress-label">
                {isSuccess ? "100%" : `${Math.round(normalizedProgress)}%`}
              </p>
            </div>

            <Progress value={normalizedProgress} data-testid="hvsc-preparation-progress" />

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
