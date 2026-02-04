import type { HvscProgressEvent } from './hvscTypes';

export type HvscFailureCategory =
  | 'network'
  | 'remote'
  | 'download'
  | 'extraction'
  | 'storage'
  | 'corrupt-archive'
  | 'unsupported-format'
  | 'unknown';

export type HvscStepStatus = 'idle' | 'in-progress' | 'success' | 'failure';

export type HvscDownloadStatus = {
  status: HvscStepStatus;
  startedAt?: string | null;
  finishedAt?: string | null;
  durationMs?: number | null;
  sizeBytes?: number | null;
  downloadedBytes?: number | null;
  totalBytes?: number | null;
  errorCategory?: HvscFailureCategory | null;
  errorMessage?: string | null;
};

export type HvscExtractionStatus = {
  status: HvscStepStatus;
  startedAt?: string | null;
  finishedAt?: string | null;
  durationMs?: number | null;
  filesExtracted?: number | null;
  totalFiles?: number | null;
  errorCategory?: HvscFailureCategory | null;
  errorMessage?: string | null;
};

export type HvscStatusSummary = {
  download: HvscDownloadStatus;
  extraction: HvscExtractionStatus;
  lastUpdatedAt?: string | null;
};

const STORAGE_KEY = 'c64u_hvsc_status:v1';

export const getDefaultHvscStatusSummary = (): HvscStatusSummary => ({
  download: { status: 'idle' },
  extraction: { status: 'idle' },
  lastUpdatedAt: null,
});

export const loadHvscStatusSummary = (): HvscStatusSummary => {
  if (typeof localStorage === 'undefined') return getDefaultHvscStatusSummary();
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return getDefaultHvscStatusSummary();
  try {
    const parsed = JSON.parse(raw) as HvscStatusSummary;
    if (!parsed?.download || !parsed?.extraction) return getDefaultHvscStatusSummary();
    return parsed;
  } catch {
    return getDefaultHvscStatusSummary();
  }
};

export const saveHvscStatusSummary = (summary: HvscStatusSummary) => {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(summary));
};

export const clearHvscStatusSummary = () => {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
};

const extractionStages = new Set([
  'archive_extraction',
  'archive_validation',
  'sid_enumeration',
  'songlengths',
  'sid_metadata_parsing',
]);

const resolveFailureCategory = (event: HvscProgressEvent, lastStage?: string | null): HvscFailureCategory => {
  const details = `${event.errorType ?? ''} ${event.errorCause ?? ''}`.toLowerCase();
  if (/timeout|network|socket|host|dns|connection|ssl|refused|reset/.test(details)) return 'network';
  if (/disk|space|permission|storage|file|io|not found|readonly|denied|enospc|eacces/.test(details)) return 'storage';
  if (lastStage === 'download') return 'download';
  if (lastStage && extractionStages.has(lastStage)) return 'extraction';
  return 'unknown';
};

export const applyHvscProgressEventToSummary = (
  summary: HvscStatusSummary,
  event: HvscProgressEvent,
  lastStage?: string | null,
) => {
  const now = new Date().toISOString();
  const isDownloadComplete =
    event.stage === 'download'
    && (
      (typeof event.percent === 'number' && event.percent >= 100)
      || (typeof event.downloadedBytes === 'number'
        && typeof event.totalBytes === 'number'
        && event.totalBytes > 0
        && event.downloadedBytes >= event.totalBytes)
    );
  if (event.stage === 'download') {
    const finishedAt = isDownloadComplete ? (summary.download.finishedAt ?? now) : summary.download.finishedAt ?? null;
    return {
      ...summary,
      download: {
        ...summary.download,
        status: isDownloadComplete ? 'success' : 'in-progress',
        startedAt: summary.download.startedAt ?? now,
        finishedAt,
        durationMs: event.elapsedTimeMs ?? summary.download.durationMs ?? null,
        sizeBytes: event.totalBytes
          ?? (isDownloadComplete ? event.downloadedBytes : summary.download.sizeBytes)
          ?? null,
        downloadedBytes: event.downloadedBytes ?? summary.download.downloadedBytes ?? null,
        totalBytes: event.totalBytes ?? summary.download.totalBytes ?? null,
        errorCategory: null,
        errorMessage: null,
      },
      lastUpdatedAt: now,
    };
  }

  if (extractionStages.has(event.stage)) {
    return {
      ...summary,
      download: summary.download.status === 'in-progress'
        ? {
          ...summary.download,
          status: 'success',
          finishedAt: summary.download.finishedAt ?? now,
        }
        : summary.download,
      extraction: {
        ...summary.extraction,
        status: 'in-progress',
        startedAt: summary.extraction.startedAt ?? now,
        durationMs: event.elapsedTimeMs ?? summary.extraction.durationMs ?? null,
        filesExtracted: event.processedCount ?? summary.extraction.filesExtracted ?? null,
        totalFiles: event.totalCount ?? summary.extraction.totalFiles ?? null,
        errorCategory: null,
        errorMessage: null,
      },
    };
  }

  if (event.stage === 'complete') {
    return {
      ...summary,
      download: {
        ...summary.download,
        status: summary.download.status === 'success' ? summary.download.status : 'success',
        finishedAt: summary.download.finishedAt ?? now,
      },
      extraction: {
        ...summary.extraction,
        status: summary.extraction.status === 'success' ? summary.extraction.status : 'success',
        finishedAt: summary.extraction.finishedAt ?? now,
      },
      lastUpdatedAt: now,
    };
  }

  if (event.stage === 'error') {
    const category = resolveFailureCategory(event, lastStage ?? null);
    const errorMessage = event.errorCause ?? event.message ?? null;
    if (lastStage === 'download') {
      return {
        ...summary,
        download: {
          ...summary.download,
          status: 'failure',
          finishedAt: now,
          errorCategory: category,
          errorMessage,
        },
        lastUpdatedAt: now,
      };
    }
    return {
      ...summary,
      extraction: {
        ...summary.extraction,
        status: 'failure',
        finishedAt: now,
        errorCategory: category,
        errorMessage,
      },
      lastUpdatedAt: now,
    };
  }

  return summary;
};

export const updateHvscStatusSummaryFromEvent = (
  event: HvscProgressEvent,
  lastStage?: string | null,
) => {
  const current = loadHvscStatusSummary();
  const next = applyHvscProgressEventToSummary(current, event, lastStage);
  saveHvscStatusSummary(next);
  return next;
};
