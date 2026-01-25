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
  errorCategory?: HvscFailureCategory | null;
  errorMessage?: string | null;
};

export type HvscExtractionStatus = {
  status: HvscStepStatus;
  startedAt?: string | null;
  finishedAt?: string | null;
  durationMs?: number | null;
  filesExtracted?: number | null;
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
