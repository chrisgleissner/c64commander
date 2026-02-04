import type { TestInfo } from '@playwright/test';
import path from 'node:path';

export const getTitlePath = (testInfo: TestInfo) => {
  if (typeof (testInfo as TestInfo & { titlePath?: () => string[] }).titlePath === 'function') {
    return (testInfo as TestInfo & { titlePath: () => string[] }).titlePath();
  }
  return (testInfo as TestInfo & { titlePath?: string[] }).titlePath ?? [testInfo.title];
};

export const generateTestId = (testInfo: TestInfo): string => {
  const fileName = path.basename(testInfo.file, '.ts').replace(/\.spec$/, '');
  const titlePath = getTitlePath(testInfo);

  const parts = [fileName, ...titlePath]
    .map((part) =>
      part
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]+/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
    )
    .filter(Boolean);

  return parts.join('--');
};
