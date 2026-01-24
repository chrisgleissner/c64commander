import type { TestInfo } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';

type EvidenceMetadata = {
  testId: string;
  deviceId: string;
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  isMobile: boolean;
  playwrightProject: string;
  timestamp: string;
  testTitle: string;
  testFile: string;
  status: string;
};

/**
 * Generate stable test ID from test info.
 * Format: <file>--<describe>--<test>
 */
const generateTestId = (testInfo: TestInfo): string => {
  const fileName = path.basename(testInfo.file, '.ts').replace(/\.spec$/, '');
  const titlePath = typeof (testInfo as any).titlePath === 'function'
    ? (testInfo as any).titlePath()
    : (testInfo as any).titlePath ?? [testInfo.title];
  
  const parts = [fileName, ...titlePath].map((part) =>
    part
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]+/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
  ).filter(Boolean);
  
  return parts.join('--');
};

/**
 * Get canonical evidence path: test-results/evidence/<testId>/<deviceId>/
 */
export const getCanonicalEvidencePath = (testInfo: TestInfo): string => {
  const testId = generateTestId(testInfo);
  const deviceId = testInfo.project.name;
  return path.resolve(process.cwd(), 'test-results', 'evidence', testId, deviceId);
};

/**
 * Create meta.json for the test evidence.
 */
export const createEvidenceMetadata = async (testInfo: TestInfo, viewport: { width: number; height: number } | null): Promise<void> => {
  const evidencePath = getCanonicalEvidencePath(testInfo);
  await fs.mkdir(evidencePath, { recursive: true });

  const metadata: EvidenceMetadata = {
    testId: generateTestId(testInfo),
    deviceId: testInfo.project.name,
    viewport: viewport ?? { width: 0, height: 0 },
    deviceScaleFactor: await getDeviceScaleFactor(testInfo),
    isMobile: testInfo.project.use?.isMobile ?? false,
    playwrightProject: testInfo.project.name,
    timestamp: new Date().toISOString(),
    testTitle: testInfo.title,
    testFile: testInfo.file,
    status: testInfo.status ?? 'unknown',
  };

  const metaPath = path.join(evidencePath, 'meta.json');
  await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2), 'utf8');
};

/**
 * Get device scale factor from test configuration.
 */
const getDeviceScaleFactor = async (testInfo: TestInfo): Promise<number> => {
  const use = testInfo.project.use;
  return use?.deviceScaleFactor ?? 1;
};

/**
 * Consolidate evidence into canonical structure.
 * Moves screenshots from flat structure to test-first, device-second.
 */
export const consolidateEvidence = async (testInfo: TestInfo, flatEvidenceDir: string): Promise<void> => {
  const canonicalPath = getCanonicalEvidencePath(testInfo);
  await fs.mkdir(path.join(canonicalPath, 'screenshots'), { recursive: true });

  // Move all PNG files to screenshots subdirectory
  try {
    const files = await fs.readdir(flatEvidenceDir);
    for (const file of files) {
      if (file.endsWith('.png')) {
        const source = path.join(flatEvidenceDir, file);
        const dest = path.join(canonicalPath, 'screenshots', file);
        await fs.copyFile(source, dest);
      } else if (file === 'video.webm') {
        const source = path.join(flatEvidenceDir, file);
        const dest = path.join(canonicalPath, file);
        await fs.copyFile(source, dest);
      } else if (file === 'trace.zip') {
        const source = path.join(flatEvidenceDir, file);
        const dest = path.join(canonicalPath, file);
        await fs.copyFile(source, dest);
      }
    }
  } catch (error) {
    // Flat evidence dir may not exist yet - that's OK
  }
};

/**
 * Validate that evidence structure is correct.
 * Returns list of validation errors.
 */
export const validateEvidenceStructure = async (testInfo: TestInfo): Promise<string[]> => {
  const errors: string[] = [];
  const canonicalPath = getCanonicalEvidencePath(testInfo);

  // Check meta.json exists
  const metaPath = path.join(canonicalPath, 'meta.json');
  try {
    const metaContent = await fs.readFile(metaPath, 'utf8');
    const meta = JSON.parse(metaContent) as EvidenceMetadata;

    // Validate required fields
    if (!meta.testId) errors.push('meta.json missing testId');
    if (!meta.deviceId) errors.push('meta.json missing deviceId');
    if (!meta.viewport) errors.push('meta.json missing viewport');
    if (!meta.deviceScaleFactor) errors.push('meta.json missing deviceScaleFactor');
    if (meta.isMobile === undefined) errors.push('meta.json missing isMobile');
    if (!meta.playwrightProject) errors.push('meta.json missing playwrightProject');
    if (!meta.timestamp) errors.push('meta.json missing timestamp');
  } catch (error) {
    errors.push(`meta.json missing or invalid: ${error}`);
  }

  return errors;
};
