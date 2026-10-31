import { useHvscArchiveSize } from "@/lib/hvsc/hvscArchiveSize";
import {
  AppSheet,
  AppSheetBody,
  AppSheetContent,
  AppSheetDescription,
  AppSheetFooter,
  AppSheetHeader,
  AppSheetTitle,
} from "@/components/ui/app-surface";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import type { HvscPreparationPhase, HvscPreparationState } from "@/lib/hvsc";
import type { HvscStageId } from "@/lib/hvsc/hvscStageModel";
import { HvscStageSteps } from "./HvscStageSteps";
import { COLLECTION_CONSENT_COPY } from "@/lib/appMode/copy";
import { describeHvscInstallRequirement } from "@/lib/hvsc/hvscStorageBudget";

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
  /** Ready to browse, with the pass that reads every tune again still running. */
  analyzing?: boolean;
  readySongCount: number;
  errorReason: string | null;
  onBrowse: () => void;
  /** What the ready button does, said on its face: browsing, or going back to what asked for HVSC. */
  browseLabel?: string;
  onCancel: () => void;
  onRetry: () => void;
  /** SID Player: the download waits for the person to press Download. */
  awaitingConsent?: boolean;
  onConsent?: () => void;
};

/** After a download the person asked for, the ready sheet shows its result for a moment and closes itself. */
export const READY_CLOSE_DELAY_MS = 2500;

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
  analyzing: analyzingWhileReady = false,
  readySongCount,
  errorReason,
  onBrowse,
  browseLabel = "Browse HVSC",
  onCancel,
  onRetry,
  awaitingConsent = false,
  onConsent,
}: HvscPreparationSheetProps) => {
  const archiveBytes = useHvscArchiveSize(open && awaitingConsent);
  const requirement = describeHvscInstallRequirement(archiveBytes);
  const isInProgress = state === "DOWNLOADING" || state === "INGESTING" || state === "DOWNLOADED";
  const isSuccess = state === "READY";
  const isError = state === "ERROR";
  const analyzing = isSuccess && analyzingWhileReady;
  const consentedRef = useRef(false);
  if (awaitingConsent) consentedRef.current = true;
  if (!open) consentedRef.current = false;
  const closeWhenReady = isSuccess && consentedRef.current && !awaitingConsent;
  useEffect(() => {
    if (!closeWhenReady) return undefined;
    const timer = window.setTimeout(() => onOpenChange(false), READY_CLOSE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [closeWhenReady, onOpenChange]);

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
          <AppSheetTitle>{awaitingConsent ? COLLECTION_CONSENT_COPY.title : "Preparing HVSC library"}</AppSheetTitle>
          <AppSheetDescription>
            {awaitingConsent
              ? "Download the free C64 music collection to this phone."
              : isSuccess
                ? analyzing
                  ? "The HVSC library is ready to browse. Reading every tune again continues in the background."
                  : "The HVSC library is indexed and ready."
                : isError
                  ? "Preparation stopped before the HVSC library was ready."
                  : "Downloading the free HVSC music collection once, then indexing it on this device."}
          </AppSheetDescription>
        </AppSheetHeader>

        <AppSheetBody className="space-y-4 px-4 py-4 sm:px-6" data-testid="hvsc-preparation-body">
          {awaitingConsent ? (
            <div className="space-y-2 text-sm" data-testid="hvsc-consent">
              <p>{COLLECTION_CONSENT_COPY.intro}</p>
              <ul className="list-disc space-y-1 pl-5" data-testid="hvsc-consent-benefits">
                {COLLECTION_CONSENT_COPY.whatYouGet.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <p data-testid="hvsc-consent-size">
                It is {requirement.sizeLabel} and needs {requirement.spaceLabel}. {COLLECTION_CONSENT_COPY.wifi}
              </p>
              <p className="text-muted-foreground">{COLLECTION_CONSENT_COPY.afterwards}</p>
            </div>
          ) : null}
          <div hidden={awaitingConsent} className="rounded-panel border border-border bg-muted/30 p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">{analyzing ? "Analyzing songs" : statusLabel}</p>
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
              state={analyzing ? "INGESTING" : state}
              stage={stage}
              step={analyzing ? "analyze" : step}
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
          {awaitingConsent ? (
            <>
              <Button
                variant="outline"
                className="min-h-11"
                onClick={() => onOpenChange(false)}
                data-testid="hvsc-consent-not-now"
              >
                {COLLECTION_CONSENT_COPY.notNow}
              </Button>
              <Button className="min-h-11" onClick={onConsent} data-testid="hvsc-consent-download">
                {COLLECTION_CONSENT_COPY.download}
              </Button>
            </>
          ) : null}
          {isSuccess ? (
            <Button onClick={onBrowse} data-testid="hvsc-preparation-browse">
              {browseLabel}
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
