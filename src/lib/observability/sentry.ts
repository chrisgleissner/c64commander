import * as Sentry from '@sentry/react';

const parseSampleRate = (
  value: string | undefined,
  fallback: number,
): number => {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < 0 || parsed > 1) return fallback;
  return parsed;
};

export const initializeSentry = () => {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: parseSampleRate(
      import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE,
      0.0,
    ),
    replaysSessionSampleRate: parseSampleRate(
      import.meta.env.VITE_SENTRY_REPLAY_SESSION_SAMPLE_RATE,
      0.0,
    ),
    replaysOnErrorSampleRate: parseSampleRate(
      import.meta.env.VITE_SENTRY_REPLAY_ERROR_SAMPLE_RATE,
      1.0,
    ),
  });
};
