/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { defaultLocale, translations, type SupportedLocale } from "./translations";

const normalizeLocale = (locale: string | null | undefined): SupportedLocale => {
  if (!locale) return defaultLocale;
  const lower = locale.toLowerCase();
  if (lower.startsWith("en")) return "en";
  return defaultLocale;
};

export const resolveAppLocale = (): SupportedLocale => {
  if (typeof navigator === "undefined") return defaultLocale;
  return normalizeLocale(navigator.language);
};

export const t = (key: string, fallback: string, locale = resolveAppLocale()): string => {
  return translations[locale]?.[key] ?? fallback;
};
