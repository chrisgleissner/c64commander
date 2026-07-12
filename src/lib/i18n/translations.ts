/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export type SupportedLocale = "en";

export const defaultLocale: SupportedLocale = "en";

export const translations: Record<SupportedLocale, Record<string, string>> = {
  en: {
    "app.loadingScreen": "Loading screen...",
    "app.error.title": "Something went wrong",
    "app.error.description": "The app hit an unexpected error. Please reopen the page or try again.",
    "app.error.reload": "Reload",
    // Button label on the page-level error boundary. Kept distinct from
    // app.error.reload (full app reload) and app.error.description (body copy)
    // so a future translation of one does not bleed into the others (HARD19-033).
    "app.error.tryAgain": "Try again",
  },
};
