import {
  defaultLocale,
  translations,
  type SupportedLocale,
} from './translations';

const normalizeLocale = (
  locale: string | null | undefined,
): SupportedLocale => {
  if (!locale) return defaultLocale;
  const lower = locale.toLowerCase();
  if (lower.startsWith('en')) return 'en';
  return defaultLocale;
};

export const resolveAppLocale = (): SupportedLocale => {
  if (typeof navigator === 'undefined') return defaultLocale;
  return normalizeLocale(navigator.language);
};

export const t = (
  key: string,
  fallback: string,
  locale = resolveAppLocale(),
): string => {
  return translations[locale]?.[key] ?? fallback;
};
