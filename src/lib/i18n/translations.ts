export type SupportedLocale = "en";

export const defaultLocale: SupportedLocale = "en";

export const translations: Record<SupportedLocale, Record<string, string>> = {
  en: {
    "app.loadingScreen": "Loading screen...",
    "app.error.title": "Something went wrong",
    "app.error.description": "The app hit an unexpected error. Please reopen the page or try again.",
    "app.error.reload": "Reload",
  },
};
