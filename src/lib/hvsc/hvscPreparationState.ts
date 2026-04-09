import type { HvscFailureCategory, HvscStepStatus } from "./hvscStatusStore";
import type { HvscIngestionState } from "./hvscTypes";

export type HvscPreparationState = "NOT_PRESENT" | "DOWNLOADING" | "DOWNLOADED" | "INGESTING" | "READY" | "ERROR";

export type HvscPreparationPhase = "download" | "ingest" | null;

export type HvscPreparationStateInput = {
  available: boolean;
  installedVersion: number;
  ingestionState: HvscIngestionState | null;
  activeStage: string | null;
  downloadStatus: HvscStepStatus;
  extractionStatus: HvscStepStatus;
  metadataStatus: HvscStepStatus;
  hasCachedArchive: boolean;
  inlineError: string | null;
  downloadErrorMessage?: string | null;
  extractionErrorMessage?: string | null;
  metadataErrorMessage?: string | null;
  ingestionError?: string | null;
  downloadFailureCategory?: HvscFailureCategory | null;
  extractionFailureCategory?: HvscFailureCategory | null;
};

export type HvscPreparationSnapshot = {
  state: HvscPreparationState;
  phase: HvscPreparationPhase;
  failedPhase: HvscPreparationPhase;
  statusLabel: string;
  errorReason: string | null;
};

const INGESTION_STAGES = new Set([
  "archive_extraction",
  "archive_validation",
  "sid_enumeration",
  "songlengths",
  "sid_metadata_parsing",
  "sid_metadata_hydration",
  "database_insertion",
]);

const DOWNLOAD_FAILURE_CATEGORIES = new Set<HvscFailureCategory>(["network", "download"]);

const resolveFailedPhase = (input: HvscPreparationStateInput): HvscPreparationPhase => {
  if (input.downloadStatus === "failure") {
    return "download";
  }
  if (input.extractionStatus === "failure" || input.metadataStatus === "failure") {
    return "ingest";
  }
  if (input.downloadFailureCategory && DOWNLOAD_FAILURE_CATEGORIES.has(input.downloadFailureCategory)) {
    return "download";
  }
  if (input.extractionFailureCategory) {
    return "ingest";
  }
  if (input.activeStage === "download") {
    return "download";
  }
  if (input.activeStage && INGESTION_STAGES.has(input.activeStage)) {
    return "ingest";
  }
  if (input.hasCachedArchive) {
    return "ingest";
  }
  return "download";
};

export const resolveHvscPreparationSnapshot = (input: HvscPreparationStateInput): HvscPreparationSnapshot => {
  const errorReason =
    input.inlineError ??
    input.metadataErrorMessage ??
    input.extractionErrorMessage ??
    input.downloadErrorMessage ??
    input.ingestionError ??
    null;

  if (!input.available) {
    return {
      state: "NOT_PRESENT",
      phase: null,
      failedPhase: null,
      statusLabel: "Unavailable",
      errorReason: null,
    };
  }

  if (input.installedVersion > 0 && input.ingestionState === "ready") {
    return {
      state: "READY",
      phase: null,
      failedPhase: null,
      statusLabel: "Ready",
      errorReason: null,
    };
  }

  if (errorReason || input.ingestionState === "error") {
    const failedPhase = resolveFailedPhase(input);
    return {
      state: "ERROR",
      phase: failedPhase,
      failedPhase,
      statusLabel: failedPhase === "ingest" ? "Indexing failed" : "Download failed",
      errorReason: errorReason ?? "HVSC preparation failed",
    };
  }

  if (input.downloadStatus === "in-progress" || input.activeStage === "download") {
    return {
      state: "DOWNLOADING",
      phase: "download",
      failedPhase: null,
      statusLabel: "Downloading",
      errorReason: null,
    };
  }

  if (
    input.extractionStatus === "in-progress" ||
    input.metadataStatus === "in-progress" ||
    input.ingestionState === "installing" ||
    input.ingestionState === "updating" ||
    (input.activeStage && INGESTION_STAGES.has(input.activeStage))
  ) {
    return {
      state: "INGESTING",
      phase: "ingest",
      failedPhase: null,
      statusLabel: "Indexing",
      errorReason: null,
    };
  }

  if (input.hasCachedArchive || input.downloadStatus === "success") {
    return {
      state: "DOWNLOADED",
      phase: null,
      failedPhase: null,
      statusLabel: "Downloaded",
      errorReason: null,
    };
  }

  return {
    state: "NOT_PRESENT",
    phase: null,
    failedPhase: null,
    statusLabel: "Not installed",
    errorReason: null,
  };
};

export const describeHvscPreparationTransition = (
  previous: HvscPreparationSnapshot | null,
  next: HvscPreparationSnapshot,
) => {
  if (!previous) {
    return `unknown -> ${next.state}`;
  }
  return `${previous.state} -> ${next.state}`;
};
