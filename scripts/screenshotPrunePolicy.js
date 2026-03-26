const IMPORT_SCREENSHOT_PATH_PREFIXES = [
  'play/import/',
  'doc/img/app/play/import/',
];

export const shouldSkipFuzzyScreenshotPrune = (filePath) => {
  const normalizedPath = String(filePath).replace(/\\/g, '/');
  return IMPORT_SCREENSHOT_PATH_PREFIXES.some((prefix) => normalizedPath.startsWith(prefix));
};
