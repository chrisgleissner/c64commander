/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { expect, test, type Page } from '@playwright/test';
import { chromium, devices } from 'playwright';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { createMockC64Server } from '../../tests/mocks/mockC64Server';
import { seedUiMocks } from '../uiMocks';
import { createBackendFailureTracker, shouldIgnoreBackendFailure, type AppLogEntry } from './fuzzBackend';
import { diffProgress, hasMeaningfulProgress, readProgressSnapshot } from './fuzzProgress';

const FUZZ_ENABLED = process.env.FUZZ_RUN === '1';
const SHORT_FUZZ_DEFAULTS = !FUZZ_ENABLED;
test.use({ screenshot: 'off', video: 'off', trace: 'off' });

const ACTION_TIMEOUT_MS = 30_000; // Hard timeout for any single action
const SESSION_TIMEOUT_MS = 5 * 60 * 1000; // Maximum session duration (5 minutes)
const HEARTBEAT_INTERVAL_MS = 10_000; // Log heartbeat every 10 seconds during long operations
const VISUAL_SAMPLE_INTERVAL_MS = 1000;
const MAX_VISUAL_STAGNATION_MS = 5000;
const VISUAL_DELTA_THRESHOLD = 0.003;

type Severity = 'crash' | 'freeze' | 'errorLog' | 'warnLog';

type IssueSignature = {
  exception: string;
  message: string;
  topFrames: string[];
};

type IssueExample = {
  platform: string;
  runMode: string;
  seed: number;
  sessionId: string;
  interactionIndex: number;
  lastInteractions: string[];
  video?: string;
  screenshot?: string;
  route?: string;
  title?: string;
  severity: Severity;
};

type IssueGroup = {
  issue_group_id: string;
  signature: IssueSignature;
  severityCounts: Record<Severity, number>;
  platforms: string[];
  examples: IssueExample[];
};

type IssueRecord = {
  severity: Severity;
  message: string;
  stack?: string;
  source?: string;
  interactionIndex: number;
  route?: string;
  title?: string;
  lastInteractions: string[];
  consoleType?: string;
  appLog?: unknown;
};

type SessionTerminationReason =
  | 'issue'
  | 'session-timeout'
  | 'recovery-exhausted'
  | 'no-progress'
  | 'min-steps'
  | 'time-budget'
  | 'max-steps'
  | 'no-action'
  | 'visual-stagnation';

type RecoveryStepName =
  | 'close-modal'
  | 'navigate-back'
  | 'root-tab'
  | 'force-home'
  | 'reload'
  | 'terminate-session';

type VisualSample = {
  timestamp: number;
  deltaScore: number;
  stagnantMs: number;
  changed: boolean;
  hash: string;
};

type SessionManifest = {
  sessionId: string;
  seed: number;
  shardIndex: number;
  startTime: string;
  endTime: string;
  durationMs: number;
  steps: number;
  terminationReason: SessionTerminationReason;
  route?: string;
  title?: string;
  issueSeverity?: Severity;
  issueSource?: string;
  issueMessage?: string;
  maxVisualStagnationMs: number;
  visualSamples: number;
  recoverySteps: RecoveryStepName[];
  interactionLog: string;
  finalScreenshot: string;
  video: string;
};

class SeededRng {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  next() {
    let t = (this.state += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(min: number, max: number) {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
  pick<T>(items: T[]) {
    return items[this.int(0, items.length - 1)];
  }
}

const toNumber = (value: string | undefined) => {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const normalizeMessage = (value: string) =>
  value
    .replace(/[\s\t]+/g, ' ')
    .replace(/0x[0-9a-f]+/gi, '0x#')
    .replace(/\b\d{3,}\b/g, '#')
    .trim();

const extractFrames = (stack?: string) => {
  if (!stack) return [] as string[];
  return stack
    .split('\n')
    .map((line) => line.trim().replace(/^at\s+/, ''))
    .filter(Boolean)
    .slice(0, 5);
};

const buildSignature = (issue: IssueRecord): IssueSignature => {
  const exception = issue.source || issue.consoleType || issue.severity;
  const message = normalizeMessage(issue.message);
  const topFrames = extractFrames(issue.stack);
  return { exception, message, topFrames };
};

const hashString = (value: string) => {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const buildGroupId = (signature: IssueSignature) => {
  const frame = signature.topFrames[0] || 'unknown';
  const base = `${signature.exception}@${frame}`;
  const signatureKey = `${signature.exception}|${signature.message}|${signature.topFrames.join('|')}`;
  const hash = hashString(signatureKey).slice(0, 8);
  return `${base}-${hash}`.replace(/[^a-z0-9@._-]+/gi, '-').slice(0, 128);
};

const parseActionTimeout = (error: unknown) => {
  const message = (error as Error)?.message || String(error);
  return /timeout/i.test(message);
};

/**
 * Wraps an async operation with a hard timeout.
 * Throws a timeout error if the operation doesn't complete within the specified time.
 */
const withTimeout = async <T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  description: string,
): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Timeout after ${timeoutMs}ms: ${description}`));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([operation(), timeoutPromise]);
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
    return result;
  } catch (error) {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
    throw error;
  }
};

const getDeviceProfile = (platform: string) => {
  if (platform === 'android-tablet') {
    return {
      viewport: { width: 800, height: 1280 },
      deviceScaleFactor: 2,
      isMobile: true,
    };
  }
  if (platform === 'web-desktop') {
    return devices['Desktop Chrome'];
  }
  return devices['Pixel 5'];
};

type ElementHandle = import('playwright').ElementHandle<HTMLElement>;

const describeElement = async (element: ElementHandle) =>
  element.evaluate((node) => {
    const tag = node.tagName.toLowerCase();
    const role = node.getAttribute('role');
    const id = node.id ? `#${node.id}` : '';
    const name = node.getAttribute('aria-label') || node.getAttribute('name') || '';
    const text = (node.textContent || '').trim().slice(0, 40);
    const label = name ? `[${name}]` : text ? `"${text}"` : '';
    const rolePart = role ? `{${role}}` : '';
    return `${tag}${id}${rolePart}${label}`.trim();
  });

const pickVisibleElement = async (
  page: Page,
  selector: string,
  rng: SeededRng,
  filter?: (element: ElementHandle) => Promise<boolean>,
) => {
  const elements = await page.$$(selector);
  const visible: ElementHandle[] = [];
  for (const element of elements) {
    if (!(await element.isVisible())) continue;
    if (filter && !(await filter(element as ElementHandle))) continue;
    visible.push(element as ElementHandle);
    if (visible.length >= 30) break;
  }
  if (!visible.length) return null;
  const target = rng.pick(visible);
  const description = await describeElement(target);
  return { target, description };
};

const hasVisibleElement = async (page: Page, selector: string) => {
  const elements = await page.$$(selector);
  for (const element of elements) {
    if (await element.isVisible()) return true;
  }
  return false;
};

const pickVisibleElementByText = async (
  page: Page,
  selector: string,
  matcher: RegExp,
  rng: SeededRng,
) => {
  const elements = await page.$$(selector);
  const visible: ElementHandle[] = [];
  for (const element of elements) {
    if (!(await element.isVisible())) continue;
    const text = ((await element.textContent()) || '').trim();
    if (!matcher.test(text)) continue;
    visible.push(element as ElementHandle);
    if (visible.length >= 20) break;
  }
  if (!visible.length) return null;
  const target = rng.pick(visible);
  const description = await describeElement(target);
  return { target, description };
};

const hasVisibleElementByText = async (
  page: Page,
  selector: string,
  matcher: RegExp,
) => {
  const elements = await page.$$(selector);
  for (const element of elements) {
    if (!(await element.isVisible())) continue;
    const text = ((await element.textContent()) || '').trim();
    if (matcher.test(text)) return true;
  }
  return false;
};

const getActiveDialog = async (page: Page) =>
  page.$('[role="dialog"], [data-radix-dialog-content], [data-state="open"][role="dialog"]');

const isExternalOrBlankTarget = async (element: ElementHandle) =>
  element.evaluate((node) => {
    if (!(node instanceof HTMLAnchorElement)) return false;
    const target = node.getAttribute('target');
    const href = node.getAttribute('href') || '';
    if (target === '_blank') return true;
    if (/^https?:\/\//i.test(href)) return true;
    if (/^[a-z]+:/i.test(href) && !href.startsWith('/') && !href.startsWith('#')) return true;
    return false;
  });

const showInteractionPulse = async (
  page: Page,
  target?: ElementHandle,
) => {
  try {
    const box = target ? await target.boundingBox() : null;
    if (!box) return;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.evaluate(({ x, y }) => {
      (window as Window & { __c64uFuzzPulse?: (x: number, y: number) => void }).__c64uFuzzPulse?.(x, y);
    }, { x, y });
    await page.waitForTimeout(40);
  } catch {
    // ignore
  }
};

const closeBlockingOverlay = async (page: import('@playwright/test').Page) => {
  const toastViewport = await page.$('[data-radix-toast-viewport], [role="region"][aria-label*="Notifications"]');
  if (toastViewport) {
    await toastViewport.evaluate((node) => {
      const el = node as HTMLElement;
      el.style.pointerEvents = 'none';
      el.style.opacity = '0';
    });
    return false;
  }
  const overlay = await page.$('[data-state="open"][data-aria-hidden="true"], [data-state="open"][aria-hidden="true"]');
  if (!overlay) return false;
  await page.keyboard.press('Escape').catch(() => { });
  await page.waitForTimeout(50);
  return true;
};

const jitterClick = async (
  page: Page,
  target: ElementHandle,
  rng: SeededRng,
  clickCount = 1,
  delay = 0,
) => {
  let box: { x: number; y: number; width: number; height: number } | null = null;
  try {
    box = await target.boundingBox();
  } catch (error) {
    const message = (error as Error)?.message || '';
    if (message.includes('not attached') || message.includes('Element is not attached')) {
      throw new Error('Element is not attached');
    }
    throw error;
  }
  if (!box) {
    await showInteractionPulse(page, target);
    try {
      await target.click({ clickCount, delay });
    } catch (error) {
      const message = (error as Error)?.message || '';
      if (message.includes('not attached') || message.includes('Element is not attached')) {
        throw new Error('Element is not attached');
      }
      throw error;
    }
    return;
  }
  for (let i = 0; i < clickCount; i += 1) {
    const jitterX = rng.int(-Math.max(1, Math.floor(box.width * 0.25)), Math.max(1, Math.floor(box.width * 0.25)));
    const jitterY = rng.int(-Math.max(1, Math.floor(box.height * 0.25)), Math.max(1, Math.floor(box.height * 0.25)));
    const x = box.x + box.width / 2 + jitterX;
    const y = box.y + box.height / 2 + jitterY;
    await page.evaluate(({ x: xPos, y: yPos }) => {
      (window as Window & { __c64uFuzzPulse?: (x: number, y: number) => void }).__c64uFuzzPulse?.(xPos, yPos);
    }, { x, y });
    await page.mouse.click(x, y, { delay, clickCount: 1 });
    if (delay) await page.waitForTimeout(delay);
  }
};

const safeClick = async (
  page: Page,
  pick: { target: ElementHandle; description: string },
  rng: SeededRng,
  selector: string,
  options?: { clickCount?: number; delay?: number },
) => {
  try {
    await jitterClick(page, pick.target, rng, options?.clickCount ?? 1, options?.delay ?? 0);
    return { ok: true, log: `click ${pick.description}` };
  } catch (error) {
    const message = (error as Error)?.message || '';
    if (message.includes('intercepts pointer events')) {
      await closeBlockingOverlay(page);
      await jitterClick(page, pick.target, rng, options?.clickCount ?? 1, options?.delay ?? 0);
      return { ok: true, log: `click ${pick.description}` };
    }
    if (message.includes('not attached') || message.includes('Element is not attached')) {
      const refreshed = await pickVisibleElement(
        page,
        selector,
        rng,
        async (element) => !(await isExternalOrBlankTarget(element)),
      );
      if (refreshed) {
        await jitterClick(page, refreshed.target, rng, options?.clickCount ?? 1, options?.delay ?? 0);
        return { ok: true, log: `click ${refreshed.description}` };
      }
    }
    throw error;
  }
};

const safeClickByText = async (
  page: import('@playwright/test').Page,
  selector: string,
  matcher: RegExp,
  rng: SeededRng,
  options?: { clickCount?: number; delay?: number },
) => {
  const pick = await pickVisibleElementByText(page, selector, matcher, rng);
  if (!pick) return null;
  try {
    await jitterClick(page, pick.target, rng, options?.clickCount ?? 1, options?.delay ?? 0);
    return { ok: true, log: `click ${pick.description}` };
  } catch (error) {
    const message = (error as Error)?.message || '';
    if (message.includes('not attached') || message.includes('Element is not attached')) {
      const refreshed = await pickVisibleElementByText(page, selector, matcher, rng);
      if (refreshed) {
        await jitterClick(page, refreshed.target, rng, options?.clickCount ?? 1, options?.delay ?? 0);
        return { ok: true, log: `click ${refreshed.description}` };
      }
    }
    throw error;
  }
};

const randomText = (rng: SeededRng) => {
  const length = rng.int(1, 12);
  const chars = [] as string[];
  for (let i = 0; i < length; i += 1) {
    const code = rng.int(97, 122);
    chars.push(String.fromCharCode(code));
  }
  return chars.join('');
};

const randomLargeText = (rng: SeededRng) => {
  const wordCount = rng.int(80, 320);
  const parts: string[] = [];
  for (let i = 0; i < wordCount; i += 1) {
    const wordLength = rng.int(2, 12);
    const chars = [] as string[];
    for (let j = 0; j < wordLength; j += 1) {
      const code = rng.int(97, 122);
      chars.push(String.fromCharCode(code));
    }
    parts.push(chars.join(''));
    if (rng.next() > 0.92) {
      parts.push('\n');
    }
  }
  return parts.join(' ').replace(/\s+\n\s+/g, '\n');
};

const randomKey = (rng: SeededRng) => {
  const keys = ['Enter', 'Escape', 'Tab', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'] as const;
  return rng.pick([...keys]);
};

const randomViewportPoint = async (page: import('@playwright/test').Page, rng: SeededRng) => {
  const viewport = page.viewportSize();
  if (viewport?.width && viewport?.height) {
    return {
      x: rng.int(4, Math.max(5, viewport.width - 4)),
      y: rng.int(4, Math.max(5, viewport.height - 4)),
    };
  }
  const innerSize = await page.evaluate(() => ({
    width: Math.max(8, window.innerWidth),
    height: Math.max(8, window.innerHeight),
  }));
  return {
    x: rng.int(4, Math.max(5, innerSize.width - 4)),
    y: rng.int(4, Math.max(5, innerSize.height - 4)),
  };
};

const hashBuffer = (buffer: Buffer) => createHash('sha1').update(buffer).digest('hex');

const computeVisualDelta = (previous: Buffer | null, current: Buffer): number => {
  if (!previous) return 1;
  const sampleLength = Math.min(previous.length, current.length);
  if (sampleLength === 0) return 0;
  const stride = 32;
  let compared = 0;
  let changed = 0;
  for (let index = 0; index < sampleLength; index += stride) {
    compared += 1;
    if (previous[index] !== current[index]) changed += 1;
  }
  const lengthPenalty = Math.abs(previous.length - current.length) / Math.max(previous.length, current.length);
  const byteDelta = compared ? changed / compared : 0;
  return Math.min(1, byteDelta + lengthPenalty);
};

const writeJson = async (filePath: string, payload: unknown) => {
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
};

const summarizeFixHint = (signature: IssueSignature, severity: Severity) => {
  if (severity === 'freeze') return `Investigate timeout/freeze around ${signature.topFrames[0] || 'recent action'}.`;
  if (signature.exception.toLowerCase().includes('typeerror')) {
    return `Guard null/undefined access near ${signature.topFrames[0] || 'the failing frame'}.`;
  }
  return `Inspect ${signature.exception} at ${signature.topFrames[0] || 'top frame'} and add safe handling.`;
};

test.describe('Fuzz Test', () => {
  test('run', async ({ page }, testInfo) => {
    void page;
    const infraMode = !FUZZ_ENABLED;
    const seed = infraMode ? 4242 : toNumber(process.env.FUZZ_SEED) ?? Date.now();
    const maxStepsInput = toNumber(process.env.FUZZ_MAX_STEPS);
    // Default time budget for fuzz mode: 10 minutes if not specified
    const defaultTimeBudgetMs = SHORT_FUZZ_DEFAULTS ? 120_000 : 10 * 60 * 1000;
    const timeBudgetMs = infraMode ? undefined : (toNumber(process.env.FUZZ_TIME_BUDGET_MS) ?? defaultTimeBudgetMs);
    const maxSteps = infraMode ? 10 : maxStepsInput ?? (timeBudgetMs ? undefined : (SHORT_FUZZ_DEFAULTS ? 35 : 500));
    const progressTimeoutMs = infraMode
      ? Math.max(500, toNumber(process.env.FUZZ_PROGRESS_TIMEOUT_MS) ?? 2000)
      : Math.max(500, toNumber(process.env.FUZZ_PROGRESS_TIMEOUT_MS) ?? 5000);
    const actionTimeoutMs = Math.max(5000, toNumber(process.env.FUZZ_ACTION_TIMEOUT_MS) ?? ACTION_TIMEOUT_MS);
    const sessionTimeoutMs = Math.max(30_000, toNumber(process.env.FUZZ_SESSION_TIMEOUT_MS) ?? SESSION_TIMEOUT_MS);
    // Grace period is now much shorter to prevent long hangs
    const timeoutGraceMs = infraMode ? 30_000 : 60_000; // 1 minute max grace
    const baseTimeout = infraMode ? 20_000 : (timeBudgetMs ?? defaultTimeBudgetMs);
    const timeoutMs = baseTimeout + timeoutGraceMs;
    test.setTimeout(timeoutMs);
    testInfo.setTimeout(timeoutMs);
    const platform = process.env.FUZZ_PLATFORM || 'android-phone';
    const runMode = infraMode ? 'infra' : (process.env.FUZZ_RUN_MODE || 'local');
    const runId = process.env.FUZZ_RUN_ID || `${seed}`;
    const shardIndex = toNumber(process.env.FUZZ_SHARD_INDEX) ?? 0;
    const shardTotal = toNumber(process.env.FUZZ_SHARD_TOTAL) ?? 1;
    const lastInteractionCount = toNumber(process.env.FUZZ_LAST_INTERACTIONS) ?? 50;
    const minSessionSteps = infraMode
      ? 1
      : Math.max(1, toNumber(process.env.FUZZ_MIN_SESSION_STEPS) ?? (SHORT_FUZZ_DEFAULTS ? 35 : 200));
    const noProgressLimit = infraMode
      ? maxSteps
      : Math.max(1, toNumber(process.env.FUZZ_NO_PROGRESS_STEPS) ?? (SHORT_FUZZ_DEFAULTS ? 10 : 20));
    const baseUrl = process.env.FUZZ_BASE_URL || String(testInfo.project.use.baseURL || 'http://127.0.0.1:4173');
    const baseOrigin = new URL(baseUrl).origin;

    const outputRootBase = process.env.FUZZ_OUTPUT_ROOT
      ? path.resolve(process.cwd(), process.env.FUZZ_OUTPUT_ROOT)
      : path.resolve(
        process.cwd(),
        'test-results',
        'fuzz',
        `run-${runMode}-${platform}-${seed}-${runId}`,
      );
    const outputRoot = shardTotal > 1 ? path.join(outputRootBase, `shard-${shardIndex}`) : outputRootBase;
    const videosDir = path.join(outputRoot, 'videos');
    const sessionsDir = path.join(outputRoot, 'sessions');
    await fs.rm(outputRoot, { recursive: true, force: true });
    await fs.mkdir(videosDir, { recursive: true });
    await fs.mkdir(sessionsDir, { recursive: true });

    const rng = new SeededRng(seed);
    const server = await createMockC64Server();
    const browser = await chromium.launch({ headless: true });
    const deviceProfile = getDeviceProfile(platform);

    const issueGroups = new Map<string, IssueGroup>();
    let totalSteps = 0;
    let sessionIndex = 0;
    const startTime = Date.now();
    const deadline = timeBudgetMs ? startTime + timeBudgetMs : Number.POSITIVE_INFINITY;
    const requestedShutdownBufferMs = infraMode ? 1_000 : Math.max(30_000, Math.min(180_000, progressTimeoutMs * 6));
    const shutdownBufferMs = timeBudgetMs
      ? Math.min(requestedShutdownBufferMs, Math.max(1_000, Math.floor(timeBudgetMs / 4)))
      : requestedShutdownBufferMs;
    const runDeadline = Number.isFinite(deadline)
      ? Math.max(startTime + 1_000, deadline - shutdownBufferMs)
      : Number.POSITIVE_INFINITY;
    let externalClickUsed = false;
    const clickActionsDisabled = false;
    let infraActionsExecuted = 0;
    let infraSessionClean = false;
    const sessionManifests: SessionManifest[] = [];
    const terminationCounts: Record<SessionTerminationReason, number> = {
      issue: 0,
      'session-timeout': 0,
      'recovery-exhausted': 0,
      'no-progress': 0,
      'min-steps': 0,
      'time-budget': 0,
      'max-steps': 0,
      'no-action': 0,
      'visual-stagnation': 0,
    };

    const recordIssue = (issue: IssueRecord, example: IssueExample) => {
      const signature = buildSignature(issue);
      const groupId = buildGroupId(signature);
      const existing = issueGroups.get(groupId);
      if (existing) {
        existing.severityCounts[issue.severity] += 1;
        if (!existing.platforms.includes(example.platform)) {
          existing.platforms.push(example.platform);
        }
        if (existing.examples.length < 3) {
          existing.examples.push(example);
        }
        return;
      }
      issueGroups.set(groupId, {
        issue_group_id: groupId,
        signature,
        severityCounts: {
          crash: issue.severity === 'crash' ? 1 : 0,
          freeze: issue.severity === 'freeze' ? 1 : 0,
          errorLog: issue.severity === 'errorLog' ? 1 : 0,
          warnLog: issue.severity === 'warnLog' ? 1 : 0,
        },
        platforms: [example.platform],
        examples: [example],
      });
    };

    const runSession = async () => {
      sessionIndex += 1;
      const sessionId = `session-${String(sessionIndex).padStart(4, '0')}`;
      const sessionLogPath = path.join(sessionsDir, `${sessionId}.log`);
      const sessionJsonPath = path.join(sessionsDir, `${sessionId}.json`);
      const sessionScreenshotPath = path.join(sessionsDir, `${sessionId}.png`);
      const sessionStartedAtMs = Date.now();
      const interactions: string[] = [];
      const logInteraction = (entry: string) => {
        interactions.push(entry);
      };
      let terminationReason: SessionTerminationReason | null = null;
      const recoverySteps: RecoveryStepName[] = [];
      const visualSamples: VisualSample[] = [];
      let previousVisualBuffer: Buffer | null = null;
      let lastVisualSampleAt = 0;
      let lastVisualChangeAt = Date.now();
      let maxVisualStagnationMs = 0;

      const context = await browser.newContext({
        ...deviceProfile,
        baseURL: baseUrl,
        recordVideo: {
          dir: videosDir,
          size: deviceProfile.viewport ?? { width: 360, height: 740 },
        },
      });
      const page = await context.newPage();
      page.setDefaultTimeout(8000);
      page.setDefaultNavigationTimeout(12000);
      let networkOffline = false;

      await page.addInitScript(({ baseUrl: baseUrlArg }) => {
        try {
          localStorage.clear();
          sessionStorage.clear();
          localStorage.setItem('c64u_fuzz_mode_enabled', '1');
          localStorage.setItem('c64u_fuzz_mock_base_url', baseUrlArg);
          localStorage.setItem('c64u_fuzz_storage_seeded', '1');
          localStorage.setItem('c64u_debug_logging_enabled', '1');
          localStorage.setItem('c64u_automatic_demo_mode_enabled', '1');
          (window as Window & { __c64uFuzzMode?: boolean }).__c64uFuzzMode = true;
        } catch {
          // ignore
        }
        try {
          const style = document.createElement('style');
          style.textContent = `
            .c64u-fuzz-pulse {
              position: absolute;
              width: 48px;
              height: 48px;
              margin: -24px 0 0 -24px;
              border-radius: 999px;
              background: rgba(59, 130, 246, 0.35);
              border: 2px solid rgba(59, 130, 246, 0.8);
              box-shadow: 0 0 12px rgba(59, 130, 246, 0.5);
              pointer-events: none;
              transform: scale(0.6);
              opacity: 0.9;
              transition: transform 0.35s ease, opacity 0.35s ease;
              z-index: 2147483647;
            }
          `;
          document.head?.appendChild(style);

          const ensureRoot = () => {
            let root = document.getElementById('c64u-fuzz-overlay');
            if (!root) {
              root = document.createElement('div');
              root.id = 'c64u-fuzz-overlay';
              root.style.position = 'fixed';
              root.style.left = '0';
              root.style.top = '0';
              root.style.width = '100%';
              root.style.height = '100%';
              root.style.pointerEvents = 'none';
              root.style.zIndex = '2147483647';
              (document.body || document.documentElement).appendChild(root);
            }
            return root;
          };

          const pulse = (x: number, y: number) => {
            const root = ensureRoot();
            const dot = document.createElement('div');
            dot.className = 'c64u-fuzz-pulse';
            dot.style.left = `${x}px`;
            dot.style.top = `${y}px`;
            root.appendChild(dot);
            requestAnimationFrame(() => {
              dot.style.transform = 'scale(1)';
              dot.style.opacity = '0';
            });
            setTimeout(() => dot.remove(), 450);
          };

          (window as Window & { __c64uFuzzPulse?: (x: number, y: number) => void }).__c64uFuzzPulse = pulse;

          document.addEventListener('pointerdown', (event) => {
            pulse(event.clientX, event.clientY);
          }, true);

          document.addEventListener('keydown', () => {
            const active = document.activeElement as HTMLElement | null;
            if (!active || typeof active.getBoundingClientRect !== 'function') return;
            const rect = active.getBoundingClientRect();
            if (!rect.width && !rect.height) return;
            pulse(rect.left + rect.width / 2, rect.top + rect.height / 2);
          }, true);
        } catch {
          // ignore
        }
      }, { baseUrl: server.baseUrl });

      await seedUiMocks(page, server.baseUrl);

      let issue: IssueRecord | null = null;
      let lastLogId: string | null = null;
      let currentFaultMode: 'none' | 'slow' | 'timeout' | 'refused' | 'auth' = 'none';
      let serverReachable = true;
      let lastOutageAt = 0;
      const backendTracker = createBackendFailureTracker({
        baseDelayMs: infraMode ? 50 : 250,
        maxDelayMs: infraMode ? 300 : 2500,
        factor: 1.8,
      });

      const recordIssueOnce = (payload: IssueRecord) => {
        if (issue) return;
        issue = payload;
      };
      const recordStuckSessionIssue = (reason: string, detail: string) => {
        recordIssueOnce({
          severity: 'freeze',
          message: `Session stalled (${reason}): ${detail}`,
          source: 'session.stalled',
          interactionIndex: totalSteps,
          lastInteractions: interactions.slice(-lastInteractionCount),
        });
      };

      page.on('pageerror', (error) => {
        recordIssueOnce({
          severity: 'crash',
          message: error.message || 'Page error',
          stack: error.stack,
          source: error.name,
          interactionIndex: totalSteps,
          lastInteractions: interactions.slice(-lastInteractionCount),
        });
      });

      page.on('crash', () => {
        recordIssueOnce({
          severity: 'crash',
          message: 'Page crashed',
          source: 'PageCrash',
          interactionIndex: totalSteps,
          lastInteractions: interactions.slice(-lastInteractionCount),
        });
      });

      page.on('console', (msg) => {
        if (issue) return;
        if (msg.type() !== 'error' && msg.type() !== 'warning') return;
        const text = msg.text();
        if (msg.type() === 'error') {
          const shouldIgnore = shouldIgnoreBackendFailure(
            { id: 'console', level: msg.type(), message: text } as AppLogEntry,
            {
              now: Date.now(),
              serverReachable,
              networkOffline,
              faultMode: currentFaultMode,
              lastOutageAt,
            },
          );
          if (shouldIgnore) {
            lastOutageAt = Date.now();
            backendTracker.recordFailure();
            return;
          }
        }
        if (msg.type() === 'error' && text.includes('Failed to load resource') && text.includes('net::ERR_')) {
          return;
        }
        recordIssueOnce({
          severity: msg.type() === 'error' ? 'errorLog' : 'warnLog',
          message: text,
          source: `console.${msg.type()}`,
          interactionIndex: totalSteps,
          lastInteractions: interactions.slice(-lastInteractionCount),
          consoleType: msg.type(),
        });
      });

      const readAppLogs = async (): Promise<AppLogEntry[]> => {
        try {
          const raw = await page.evaluate(() => localStorage.getItem('c64u_app_logs'));
          if (!raw) return [] as AppLogEntry[];
          const parsed = JSON.parse(raw) as AppLogEntry[];
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [] as AppLogEntry[];
        }
      };

      const checkAppLogsForIssues = async () => {
        const logs = await readAppLogs();
        if (!logs.length) return;
        if (!lastLogId) {
          lastLogId = logs[0]?.id ?? null;
          return;
        }
        const fresh = [] as AppLogEntry[];
        for (const entry of logs) {
          if (entry.id === lastLogId) break;
          fresh.push(entry);
        }
        if (logs[0]?.id) lastLogId = logs[0].id;
        const errorEntry = fresh.find((entry) => entry.level === 'error');
        const warnEntry = fresh.find((entry) => entry.level === 'warn');
        if (errorEntry) {
          if (errorEntry.message.toLowerCase().includes('fuzz mode blocked')) return;
          const shouldIgnore = shouldIgnoreBackendFailure(errorEntry, {
            now: Date.now(),
            serverReachable,
            networkOffline,
            faultMode: currentFaultMode,
            lastOutageAt,
          });
          if (shouldIgnore) {
            lastOutageAt = Date.now();
            backendTracker.recordFailure();
            return;
          }
          recordIssueOnce({
            severity: 'errorLog',
            message: errorEntry.message,
            source: 'app.log.error',
            interactionIndex: totalSteps,
            lastInteractions: interactions.slice(-lastInteractionCount),
            appLog: errorEntry,
          });
        } else if (warnEntry) {
          recordIssueOnce({
            severity: 'warnLog',
            message: warnEntry.message,
            source: 'app.log.warn',
            interactionIndex: totalSteps,
            lastInteractions: interactions.slice(-lastInteractionCount),
            appLog: warnEntry,
          });
        }
      };

      const sampleVisualProgress = async (force = false) => {
        const now = Date.now();
        if (!force && now - lastVisualSampleAt < VISUAL_SAMPLE_INTERVAL_MS) {
          return;
        }
        lastVisualSampleAt = now;
        let screenshotBuffer: Buffer;
        try {
          screenshotBuffer = await withTimeout(
            () => page.screenshot({ type: 'png', animations: 'disabled', timeout: actionTimeoutMs }),
            actionTimeoutMs,
            'visual sample screenshot',
          );
        } catch (error) {
          logInteraction(`s=${totalSteps}\ta=visual\terror=${(error as Error)?.message || 'screenshot-failed'}`);
          return;
        }
        const deltaScore = computeVisualDelta(previousVisualBuffer, screenshotBuffer);
        const changed = deltaScore >= VISUAL_DELTA_THRESHOLD;
        if (changed) {
          lastVisualChangeAt = now;
        }
        const stagnantMs = Math.max(0, now - lastVisualChangeAt);
        if (stagnantMs > maxVisualStagnationMs) {
          maxVisualStagnationMs = stagnantMs;
        }
        const sample: VisualSample = {
          timestamp: now,
          deltaScore,
          stagnantMs,
          changed,
          hash: hashBuffer(screenshotBuffer),
        };
        visualSamples.push(sample);
        previousVisualBuffer = screenshotBuffer;
      };

      const runRecoveryStep = async (stepNumber: number): Promise<{ log: string; terminal: boolean }> => {
        const step = stepNumber === 1
          ? 'close-modal'
          : stepNumber === 2
            ? 'navigate-back'
            : stepNumber === 3
              ? 'root-tab'
              : stepNumber === 4
                ? 'force-home'
                : stepNumber === 5
                  ? 'reload'
                  : 'terminate-session';
        recoverySteps.push(step);
        if (step === 'close-modal') {
          if (await closeBlockingOverlay(page)) {
            return { log: 'ladder close-modal:overlay-closed', terminal: false };
          }
          await page.keyboard.press('Escape').catch(() => { });
          return { log: 'ladder close-modal:escape', terminal: false };
        }
        if (step === 'navigate-back') {
          await page.goBack({ timeout: actionTimeoutMs }).catch(() => { });
          return { log: 'ladder navigate-back', terminal: false };
        }
        if (step === 'root-tab') {
          const rootTab = await page.$('.tab-bar button:first-of-type');
          if (rootTab && (await rootTab.isVisible())) {
            await showInteractionPulse(page, rootTab as ElementHandle);
            await rootTab.click().catch(() => { });
            return { log: 'ladder root-tab:clicked', terminal: false };
          }
          return { log: 'ladder root-tab:missing', terminal: false };
        }
        if (step === 'force-home') {
          await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: actionTimeoutMs }).catch(() => { });
          return { log: 'ladder force-home', terminal: false };
        }
        if (step === 'reload') {
          await page.reload({ waitUntil: 'domcontentloaded', timeout: actionTimeoutMs }).catch(() => { });
          return { log: 'ladder reload', terminal: false };
        }
        return { log: 'ladder terminate-session', terminal: true };
      };

      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

      let sessionSteps = 0;
      let noProgressCount = 0;
      let progressSnapshot = await readProgressSnapshot(page);
      let lastProgressAt = Date.now();
      const sessionStartTime = Date.now();
      let lastHeartbeatAt = sessionStartTime;
      let mode: 'chaos' | 'recovery' = 'chaos';
      let recoveryAttempts = 0;
      const recoveryStepLimit = 6;

      await sampleVisualProgress(true);

      if (infraMode) {
        totalSteps += 1;
        sessionSteps += 1;
        logInteraction(`s=${totalSteps}\ta=infra\tpage-load`);
        await page.waitForSelector('[data-testid="connectivity-indicator"]', { timeout: 5000 }).catch(() => { });
        await checkAppLogsForIssues();
        infraActionsExecuted += 1;
        if (!issue) {
          infraSessionClean = true;
        }
      }

      const ensureAppOrigin = async () => {
        const url = page.url();
        if (!url || url.startsWith('about:') || !url.startsWith(baseOrigin)) {
          await withTimeout(
            () => page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: actionTimeoutMs }),
            actionTimeoutMs,
            'navigate to app origin'
          ).catch(() => { });
          return true;
        }
        return false;
      };

      const chaosTapAt = async (point: { x: number; y: number }) => {
        const meta = await page.evaluate(({ x, y }) => {
          const el = document.elementFromPoint(x, y) as HTMLElement | null;
          if (!el) return { isExternal: false };
          const anchor = el.closest('a') as HTMLAnchorElement | null;
          if (!anchor) return { isExternal: false };
          const href = anchor.getAttribute('href') || '';
          const target = anchor.getAttribute('target');
          const external = target === '_blank' || /^https?:\/\//i.test(href) || (/^[a-z]+:/i.test(href) && !href.startsWith('/') && !href.startsWith('#'));
          return { isExternal: external };
        }, point);
        if (meta.isExternal && externalClickUsed) {
          return { ok: false, log: 'chaos-tap external blocked' };
        }
        if (meta.isExternal) {
          externalClickUsed = true;
        }
        await page.evaluate(({ x, y }) => {
          (window as Window & { __c64uFuzzPulse?: (x: number, y: number) => void }).__c64uFuzzPulse?.(x, y);
        }, point);
        const clickCount = rng.int(1, 5);
        for (let i = 0; i < clickCount; i += 1) {
          await page.mouse.click(point.x, point.y, { delay: rng.int(0, 10) });
        }
        return { ok: true, log: `chaos-tap ${Math.round(point.x)},${Math.round(point.y)} x${clickCount}` };
      };

      const actions = [
        {
          name: 'click',
          weight: 16,
          canRun: async () => {
            return hasVisibleElement(page, 'button, [role="button"], a[href], [data-clickable="true"]');
          },
          run: async () => {
            const selector = 'button, [role="button"], a[href], [data-clickable="true"]';
            const pick = await pickVisibleElement(
              page,
              selector,
              rng,
              async (element) => {
                if (await isExternalOrBlankTarget(element)) {
                  return !externalClickUsed;
                }
                return element.isEnabled();
              },
            );
            if (!pick) return { log: 'click skip' };
            const isExternal = await isExternalOrBlankTarget(pick.target);
            const clickCount = rng.int(1, 4);
            const delay = rng.int(0, 10);
            const result = await safeClick(page, pick, rng, selector, { clickCount, delay });
            if (isExternal) {
              externalClickUsed = true;
              return { log: `click external ${pick.description} (clicks disabled)` };
            }
            return { log: result.log };
          },
        },
        {
          name: 'rage-click',
          weight: 20,
          canRun: async () => {
            return hasVisibleElement(page, 'button, [role="button"], [role="tab"], [role="option"], a[href], [data-clickable="true"]');
          },
          run: async () => {
            const selector = 'button, [role="button"], [role="tab"], [role="option"], a[href], [data-clickable="true"]';
            const pick = await pickVisibleElement(
              page,
              selector,
              rng,
              async (element) => {
                if (await isExternalOrBlankTarget(element)) {
                  return !externalClickUsed;
                }
                return true;
              },
            );
            if (!pick) return { log: 'rage-click skip' };
            const isExternal = await isExternalOrBlankTarget(pick.target);
            const clickCount = rng.int(5, 10);
            await safeClick(page, pick, rng, selector, { clickCount, delay: rng.int(0, 8) });
            if (isExternal) {
              externalClickUsed = true;
            }
            return { log: `rage-click ${pick.description} x${clickCount}` };
          },
        },
        {
          name: 'chaos-tap',
          weight: 20,
          canRun: async () => true,
          run: async () => {
            const point = await randomViewportPoint(page, rng);
            const result = await chaosTapAt(point);
            return { log: result.log };
          },
        },
        {
          name: 'add-items-open',
          weight: 10,
          canRun: async () => {
            if (clickActionsDisabled) return false;
            if (await getActiveDialog(page)) return false;
            return hasVisibleElementByText(page, 'button', /Add (items|more items|disks|more disks)/i);
          },
          run: async () => {
            const result = await safeClickByText(page, 'button', /Add (items|more items|disks|more disks)/i, rng, {
              clickCount: 1,
              delay: rng.int(0, 15),
            });
            return { log: result?.log ?? 'add-items open skip' };
          },
        },
        {
          name: 'add-items-source-ultimate',
          weight: 10,
          canRun: async () => {
            if (clickActionsDisabled) return false;
            if (!(await getActiveDialog(page))) return false;
            return hasVisibleElementByText(page, '[role="dialog"] button', /C64 Ultimate/i);
          },
          run: async () => {
            const result = await safeClickByText(page, '[role="dialog"] button', /C64 Ultimate/i, rng, {
              clickCount: 1,
              delay: rng.int(0, 10),
            });
            return { log: result?.log ?? 'add-items source skip' };
          },
        },
        {
          name: 'add-items-open-folder',
          weight: 12,
          canRun: async () => {
            if (clickActionsDisabled) return false;
            if (!(await getActiveDialog(page))) return false;
            return hasVisibleElementByText(page, '[role="dialog"] button', /^Open$/i);
          },
          run: async () => {
            const result = await safeClickByText(page, '[role="dialog"] button', /^Open$/i, rng, {
              clickCount: 1,
              delay: rng.int(0, 10),
            });
            return { log: result?.log ?? 'open folder skip' };
          },
        },
        {
          name: 'add-items-select',
          weight: 16,
          canRun: async () => {
            if (clickActionsDisabled) return false;
            if (!(await getActiveDialog(page))) return false;
            return hasVisibleElement(page, '[data-testid="source-entry-row"] [role="checkbox"], [data-testid="source-entry-row"] input[type="checkbox"]');
          },
          run: async () => {
            const selector = '[data-testid="source-entry-row"] [role="checkbox"], [data-testid="source-entry-row"] input[type="checkbox"]';
            const toggles = rng.int(2, 6);
            const logs: string[] = [];
            for (let i = 0; i < toggles; i += 1) {
              const pick = await pickVisibleElement(page, selector, rng);
              if (!pick) break;
              await safeClick(page, pick, rng, selector, { clickCount: 1, delay: rng.int(0, 10) });
              logs.push(pick.description);
            }
            return { log: `add-items select ${logs.length}` };
          },
        },
        {
          name: 'add-items-filter',
          weight: 8,
          canRun: async () => {
            if (!(await getActiveDialog(page))) return false;
            return hasVisibleElement(page, '[data-testid="add-items-filter"]');
          },
          run: async () => {
            const pick = await pickVisibleElement(page, '[data-testid="add-items-filter"]', rng);
            if (!pick) return { log: 'add-items filter skip' };
            const text = rng.next() > 0.5 ? randomLargeText(rng) : randomText(rng);
            await showInteractionPulse(page, pick.target);
            await pick.target.click().catch(() => { });
            await page.keyboard.press('Control+A').catch(() => { });
            await page.keyboard.press('Backspace').catch(() => { });
            await page.keyboard.insertText(text);
            return { log: `add-items filter ${text.length} chars` };
          },
        },
        {
          name: 'add-items-confirm',
          weight: 10,
          canRun: async () => {
            if (clickActionsDisabled) return false;
            if (!(await getActiveDialog(page))) return false;
            const button = await page.$('[data-testid="add-items-confirm"]');
            if (!button || !(await button.isVisible())) return false;
            const disabled = await button.evaluate((node) => {
              const el = node as HTMLButtonElement;
              return el.disabled || el.getAttribute('aria-disabled') === 'true';
            });
            return !disabled;
          },
          run: async () => {
            const pick = await pickVisibleElement(page, '[data-testid="add-items-confirm"]', rng);
            if (!pick) return { log: 'add-items confirm skip' };
            await safeClick(page, pick, rng, '[data-testid="add-items-confirm"]', { clickCount: 1, delay: rng.int(0, 10) });
            return { log: `add-items confirm ${pick.description}` };
          },
        },
        {
          name: 'config-toggle',
          weight: 18,
          canRun: async () =>
            hasVisibleElement(
              page,
              '[data-testid="config-item-layout"] [role="checkbox"], [data-testid="config-item-layout"] [role="switch"], [data-testid^="audio-mixer-solo-"]',
            ),
          run: async () => {
            const selector =
              '[data-testid="config-item-layout"] [role="checkbox"], [data-testid="config-item-layout"] [role="switch"], [data-testid^="audio-mixer-solo-"]';
            const pick = await pickVisibleElement(page, selector, rng);
            if (!pick) return { log: 'config-toggle skip' };
            const toggles = rng.int(3, 8);
            for (let i = 0; i < toggles; i += 1) {
              await safeClick(page, pick, rng, selector, { clickCount: 1, delay: rng.int(0, 10) });
            }
            return { log: `config-toggle ${pick.description} x${toggles}` };
          },
        },
        {
          name: 'config-toggle-burst',
          weight: 14,
          canRun: async () =>
            hasVisibleElement(
              page,
              '[data-testid="config-item-layout"] [role="checkbox"], [data-testid="config-item-layout"] [role="switch"], [data-testid^="audio-mixer-solo-"]',
            ),
          run: async () => {
            const selector =
              '[data-testid="config-item-layout"] [role="checkbox"], [data-testid="config-item-layout"] [role="switch"], [data-testid^="audio-mixer-solo-"]';
            const burst = rng.int(2, 5);
            const logs: string[] = [];
            for (let i = 0; i < burst; i += 1) {
              const pick = await pickVisibleElement(page, selector, rng);
              if (!pick) break;
              const toggles = rng.int(2, 5);
              for (let j = 0; j < toggles; j += 1) {
                await safeClick(page, pick, rng, selector, { clickCount: 1, delay: rng.int(0, 8) });
              }
              logs.push(`${pick.description} x${toggles}`);
            }
            return { log: `config-burst ${logs.join(' | ') || 'skip'}` };
          },
        },
        {
          name: 'config-slider-scrub',
          weight: 12,
          canRun: async () => hasVisibleElement(page, '[data-testid="config-item-layout"] [role="slider"]'),
          run: async () => {
            const selector = '[data-testid="config-item-layout"] [role="slider"]';
            const pick = await pickVisibleElement(page, selector, rng);
            if (!pick) return { log: 'config-slider skip' };
            const box = await pick.target.boundingBox();
            if (!box) return { log: 'config-slider no-box' };
            const steps = rng.int(4, 10);
            for (let i = 0; i < steps; i += 1) {
              const x = box.x + rng.int(2, Math.max(3, Math.floor(box.width) - 2));
              const y = box.y + box.height / 2;
              await page.evaluate(({ x: xPos, y: yPos }) => {
                (window as Window & { __c64uFuzzPulse?: (x: number, y: number) => void }).__c64uFuzzPulse?.(xPos, yPos);
              }, { x, y });
              await page.mouse.click(x, y, { delay: rng.int(0, 10) });
            }
            return { log: `config-slider ${pick.description} x${steps}` };
          },
        },
        {
          name: 'config-select-burst',
          weight: 12,
          canRun: async () =>
            hasVisibleElement(page, '[data-testid="config-item-layout"] [aria-label$=" select"], [data-testid="config-item-layout"] [role="combobox"]'),
          run: async () => {
            const triggerSelector = '[data-testid="config-item-layout"] [aria-label$=" select"], [data-testid="config-item-layout"] [role="combobox"]';
            const pick = await pickVisibleElement(page, triggerSelector, rng);
            if (!pick) return { log: 'config-select skip' };
            const selections = rng.int(2, 5);
            for (let i = 0; i < selections; i += 1) {
              await safeClick(page, pick, rng, triggerSelector, { clickCount: 1, delay: rng.int(0, 10) });
              await page.waitForTimeout(rng.int(10, 40));
              const options = await page.$$('role=option');
              if (!options.length) continue;
              const option = rng.pick(options);
              await showInteractionPulse(page, option as ElementHandle);
              await option.click().catch(() => { });
            }
            return { log: `config-select ${pick.description} x${selections}` };
          },
        },
        {
          name: 'drag',
          weight: 8,
          canRun: async () => true,
          run: async () => {
            const start = await randomViewportPoint(page, rng);
            const end = await randomViewportPoint(page, rng);
            await page.evaluate(({ x, y }) => {
              (window as Window & { __c64uFuzzPulse?: (x: number, y: number) => void }).__c64uFuzzPulse?.(x, y);
            }, start);
            await page.mouse.move(start.x, start.y);
            await page.mouse.down();
            await page.mouse.move(end.x, end.y, { steps: rng.int(4, 10) });
            await page.mouse.up();
            return { log: `drag ${Math.round(start.x)},${Math.round(start.y)}->${Math.round(end.x)},${Math.round(end.y)}` };
          },
        },
        {
          name: 'panic',
          weight: 14,
          canRun: async () => true,
          run: async () => {
            const burst = rng.int(6, 16);
            const logs: string[] = [];
            for (let i = 0; i < burst; i += 1) {
              const roll = rng.next();
              if (roll < 0.45 && !clickActionsDisabled) {
                const point = await randomViewportPoint(page, rng);
                const result = await chaosTapAt(point);
                logs.push(result.log);
              } else if (roll < 0.7) {
                const delta = rng.int(-1200, 1200);
                await page.mouse.wheel(0, delta);
                logs.push(`wheel ${delta}`);
              } else {
                const key = randomKey(rng);
                await page.keyboard.press(key).catch(() => { });
                logs.push(`key ${key}`);
              }
              await page.waitForTimeout(rng.int(0, 15));
            }
            return { log: `panic ${logs.slice(0, 6).join('|')}${logs.length > 6 ? '…' : ''}` };
          },
        },
        {
          name: 'connection-flap',
          weight: 6,
          canRun: async () => true,
          run: async () => {
            const nextReachable = rng.next() > 0.5;
            server.setReachable(nextReachable);
            serverReachable = nextReachable;
            if (!nextReachable) lastOutageAt = Date.now();
            return { log: `connection ${nextReachable ? 'online' : 'offline'}` };
          },
        },
        {
          name: 'latency-spike',
          weight: 6,
          canRun: async () => true,
          run: async () => {
            const previousMode = server.getFaultMode();
            const spikeMs = rng.int(1500, 7000);
            server.setFaultMode('slow');
            server.setLatencyMs(spikeMs);
            currentFaultMode = 'slow';
            const recoveryDelay = rng.int(2000, 6000);
            setTimeout(() => {
              server.setFaultMode(previousMode);
              server.setLatencyMs(null);
              currentFaultMode = previousMode;
            }, recoveryDelay);
            return { log: `latency spike ${spikeMs}ms` };
          },
        },
        {
          name: 'network-offline',
          weight: 4,
          canRun: async () => !networkOffline,
          run: async () => {
            networkOffline = true;
            lastOutageAt = Date.now();
            await context.setOffline(true).catch(() => { });
            const duration = rng.int(500, 2500);
            await page.waitForTimeout(duration);
            await context.setOffline(false).catch(() => { });
            networkOffline = false;
            return { log: `network offline ${duration}ms` };
          },
        },
        {
          name: 'random-key',
          weight: 12,
          canRun: async () => true,
          run: async () => {
            const bursts = rng.int(2, 5);
            const keys = [] as string[];
            for (let i = 0; i < bursts; i += 1) {
              const key = randomKey(rng);
              keys.push(key);
              await page.keyboard.press(key).catch(() => { });
            }
            return { log: `key ${keys.join(',')}` };
          },
        },
        {
          name: 'tab',
          weight: 6,
          canRun: async () => {
            if (clickActionsDisabled) return false;
            return hasVisibleElement(page, '.tab-bar button');
          },
          run: async () => {
            const pick = await pickVisibleElement(page, '.tab-bar button', rng);
            if (!pick) return { log: 'tab skip' };
            await safeClick(page, pick, rng, '.tab-bar button', { clickCount: 1, delay: rng.int(0, 20) });
            return { log: `tab ${pick.description}` };
          },
        },
        {
          name: 'scroll',
          weight: 16,
          canRun: async () => true,
          run: async () => {
            const bursts = rng.int(1, 4);
            const deltas = [] as number[];
            for (let i = 0; i < bursts; i += 1) {
              const delta = rng.int(-1200, 1200);
              deltas.push(delta);
              await page.mouse.wheel(0, delta);
              await page.waitForTimeout(rng.int(0, 30));
            }
            return { log: `scroll ${deltas.join(',')}` };
          },
        },
        {
          name: 'select',
          weight: 6,
          canRun: async () => {
            if (clickActionsDisabled) return false;
            return hasVisibleElement(page, '[role="option"], [role="menuitem"], li[role="option"]');
          },
          run: async () => {
            const pick = await pickVisibleElement(page, '[role="option"], [role="menuitem"], li[role="option"]', rng);
            if (!pick) return { log: 'select skip' };
            await safeClick(page, pick, rng, '[role="option"], [role="menuitem"], li[role="option"]', { clickCount: 1, delay: rng.int(0, 20) });
            return { log: `select ${pick.description}` };
          },
        },
        {
          name: 'type',
          weight: 12,
          canRun: async () =>
            hasVisibleElement(page, 'input:not([type]), input[type="text"], input[type="search"], textarea, [contenteditable="true"]'),
          run: async () => {
            const pick = await pickVisibleElement(page, 'input:not([type]), input[type="text"], input[type="search"], textarea, [contenteditable="true"]', rng);
            if (!pick) return { log: 'type skip' };
            const supportsFill = await pick.target.evaluate((node) =>
              node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement,
            );
            const modeRoll = rng.next();
            const text = modeRoll < 0.35 ? randomLargeText(rng) : randomText(rng);
            await showInteractionPulse(page, pick.target);
            if (modeRoll < 0.35) {
              await pick.target.click().catch(() => { });
              await page.keyboard.press('Control+A').catch(() => { });
              await page.keyboard.press('Backspace').catch(() => { });
              await page.keyboard.insertText(text);
              return { log: `paste ${pick.description} (${text.length} chars)` };
            }
            if (rng.next() > 0.45 || !supportsFill) {
              await pick.target.click().catch(() => { });
              await page.keyboard.type(text, { delay: rng.int(0, 15) });
              return { log: `type ${pick.description} "${text}"` };
            }
            await pick.target.fill(text);
            return { log: `fill ${pick.description} "${text}"` };
          },
        },
        {
          name: 'toggle',
          weight: 6,
          canRun: async () => {
            if (clickActionsDisabled) return false;
            return hasVisibleElement(page, 'input[type="checkbox"], [role="switch"]');
          },
          run: async () => {
            const pick = await pickVisibleElement(page, 'input[type="checkbox"], [role="switch"]', rng);
            if (!pick) return { log: 'toggle skip' };
            await safeClick(page, pick, rng, 'input[type="checkbox"], [role="switch"]', { clickCount: 1, delay: rng.int(0, 20) });
            return { log: `toggle ${pick.description}` };
          },
        },
        {
          name: 'modal',
          weight: 4,
          canRun: async () => !clickActionsDisabled,
          run: async () => {
            const dialog = await page.$('[role="dialog"], [data-radix-dialog-content], [data-state="open"][role="dialog"]');
            if (dialog) {
              const buttons = await dialog.$$('button, [role="button"]');
              if (buttons.length) {
                const target = rng.pick(buttons);
                await showInteractionPulse(page, target as ElementHandle);
                await target.click().catch(() => { });
                return { log: 'modal button' };
              }
              await page.keyboard.press('Escape').catch(() => { });
              return { log: 'modal escape' };
            }
            const pick = await pickVisibleElement(page, 'button[aria-haspopup="dialog"], [data-state="closed"][data-radix-collection-item]', rng);
            if (!pick) return { log: 'modal open skip' };
            await safeClick(page, pick, rng, 'button[aria-haspopup="dialog"], [data-state="closed"][data-radix-collection-item]', { clickCount: rng.int(1, 3), delay: rng.int(0, 15) });
            return { log: `modal open ${pick.description}` };
          },
        },
        {
          name: 'navigate',
          weight: 4,
          canRun: async () => true,
          run: async () => {
            const url = page.url();
            if (!url.startsWith(baseOrigin) || url.startsWith('about:')) {
              await page.goto(baseUrl, { waitUntil: 'domcontentloaded' }).catch(() => { });
              return { log: 'nav recover' };
            }
            if (rng.next() > 0.5) {
              await page.goBack({ timeout: 5000 }).catch(() => { });
              return { log: 'nav back' };
            }
            await page.goForward({ timeout: 5000 }).catch(() => { });
            return { log: 'nav forward' };
          },
        },
        {
          name: 'background',
          weight: 4,
          canRun: async () => true,
          run: async () => {
            await page.evaluate(() => {
              window.dispatchEvent(new Event('blur'));
              document.dispatchEvent(new Event('visibilitychange'));
            });
            await page.waitForTimeout(50);
            await page.evaluate(() => {
              window.dispatchEvent(new Event('focus'));
              document.dispatchEvent(new Event('visibilitychange'));
            });
            return { log: 'background-resume' };
          },
        },
        {
          name: 'fault',
          weight: 3,
          canRun: async () => true,
          run: async () => {
            const modes = ['none', 'slow', 'timeout', 'refused'] as const;
            const mode = rng.pick([...modes]);
            server.setFaultMode(mode);
            if (mode === 'slow') {
              server.setLatencyMs(rng.int(100, 600));
            } else {
              server.setLatencyMs(null);
            }
            currentFaultMode = mode;
            return { log: `fault ${mode}` };
          },
        },
      ];

      const pickAction = async () => {
        const eligible: typeof actions = [];
        for (const action of actions) {
          if (await action.canRun()) eligible.push(action);
        }
        if (!eligible.length) return null;
        const totalWeight = eligible.reduce((sum, action) => sum + action.weight, 0);
        let roll = rng.next() * totalWeight;
        for (const action of eligible) {
          roll -= action.weight;
          if (roll <= 0) return action;
        }
        return eligible[eligible.length - 1];
      };

      while (!infraMode && Date.now() < runDeadline && (maxSteps ? totalSteps < maxSteps : true)) {
        if (issue) break;

        await sampleVisualProgress();

        // Session-level timeout check - prevent sessions from running forever
        const sessionElapsed = Date.now() - sessionStartTime;
        if (sessionElapsed >= sessionTimeoutMs) {
          logInteraction(`s=${totalSteps}\ta=session\ttimeout ${Math.round(sessionElapsed / 1000)}s`);
          recordStuckSessionIssue(
            'session-timeout',
            `Session exceeded maximum duration of ${sessionTimeoutMs / 1000}s after ${sessionSteps} steps.`,
          );
          terminationReason = 'session-timeout';
          break;
        }

        totalSteps += 1;
        sessionSteps += 1;

        const now = Date.now();
        if (now - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
          lastHeartbeatAt = now;
          logInteraction(`s=${totalSteps}\ta=heartbeat\tmode=${mode} noProgress=${noProgressCount} visualStagnantMs=${Math.max(0, now - lastVisualChangeAt)}`);
        }

        const visualStagnantMs = Math.max(0, now - lastVisualChangeAt);
        if (mode === 'chaos' && visualStagnantMs > MAX_VISUAL_STAGNATION_MS) {
          mode = 'recovery';
          recoveryAttempts = 0;
          logInteraction(`s=${totalSteps}\ta=visual\tstagnation ${visualStagnantMs}ms`);
        }
        if (mode === 'chaos' && now - lastProgressAt >= progressTimeoutMs) {
          mode = 'recovery';
          recoveryAttempts = 0;
          logInteraction(`s=${totalSteps}\ta=progress\twatchdog ${now - lastProgressAt}ms`);
        }

        const backoffUntil = backendTracker.getBackoffUntilMs();
        if (backoffUntil > now) {
          const waitMs = Math.min(backoffUntil - now, 5000); // Cap backoff wait to 5s max
          logInteraction(`s=${totalSteps}\ta=backend\tbackoff ${waitMs}ms`);
          await page.waitForTimeout(waitMs);
          await sampleVisualProgress();
        }

        let progressed = false;
        let actionLogged = false;
        let recoveryAttempted = false;

        if (await ensureAppOrigin()) {
          logInteraction(`s=${totalSteps}\ta=recover\treturn-to-app`);
          actionLogged = true;
        } else if (await closeBlockingOverlay(page)) {
          logInteraction(`s=${totalSteps}\ta=modal\tauto-close`);
          actionLogged = true;
        } else if (mode === 'recovery') {
          recoveryAttempts += 1;
          recoveryAttempted = true;
          const recoveryResult = await runRecoveryStep(recoveryAttempts);
          logInteraction(`s=${totalSteps}\ta=recovery\t${recoveryResult.log}`);
          if (recoveryResult.terminal) {
            logInteraction(`s=${totalSteps}\ta=session\trecovery-terminate`);
            recordStuckSessionIssue(
              'recovery-exhausted',
              'Deterministic recovery ladder exhausted all steps.',
            );
            terminationReason = 'recovery-exhausted';
            break;
          }
          actionLogged = true;
        } else {
          const action = await pickAction();
          if (!action) {
            logInteraction(`s=${totalSteps}\ta=session\tno-action`);
            recordStuckSessionIssue('no-action', 'No eligible action was available.');
            break;
          }
          try {
            // Wrap action execution with a hard timeout to prevent hangs
            const result = await withTimeout(
              () => action.run(),
              actionTimeoutMs,
              `action ${action.name}`,
            );
            logInteraction(`s=${totalSteps}\ta=${action.name}\t${result.log}`);
          } catch (error) {
            logInteraction(`s=${totalSteps}\ta=${action.name}\terror=${(error as Error)?.message || 'unknown'}`);
            if (parseActionTimeout(error)) {
              recordIssueOnce({
                severity: 'freeze',
                message: (error as Error).message || 'Action timeout',
                source: 'action.timeout',
                interactionIndex: totalSteps,
                lastInteractions: interactions.slice(-lastInteractionCount),
              });
            } else {
              recordIssueOnce({
                severity: 'errorLog',
                message: (error as Error)?.message || 'Action failed',
                source: (error as Error)?.name || 'action.error',
                stack: (error as Error)?.stack,
                interactionIndex: totalSteps,
                lastInteractions: interactions.slice(-lastInteractionCount),
              });
            }
          }
          actionLogged = true;
        }

        if (actionLogged) {
          await checkAppLogsForIssues();
          if (issue) break;
          await sampleVisualProgress();
          const nextSnapshot = await readProgressSnapshot(page);
          const delta = diffProgress(progressSnapshot, nextSnapshot);
          const anyProgress = hasMeaningfulProgress(delta);
          const interactionProgress = delta.screenChanged || delta.navigationChanged || delta.stateChanged;
          progressed = interactionProgress;
          if (anyProgress) {
            progressSnapshot = nextSnapshot;
          }
          if (progressed) {
            lastProgressAt = Date.now();
            noProgressCount = 0;
            if (mode === 'recovery') {
              logInteraction(
                `s=${totalSteps}\ta=recovery\tprogress screen=${Number(delta.screenChanged)} nav=${Number(delta.navigationChanged)} trace=${Number(delta.traceChanged)} state=${Number(delta.stateChanged)}`,
              );
              mode = 'chaos';
              recoveryAttempts = 0;
            }
          } else if (mode === 'chaos') {
            noProgressCount += 1;
          }
        }

        if (mode === 'recovery' && recoveryAttempted && recoveryAttempts >= recoveryStepLimit && !progressed) {
          logInteraction(`s=${totalSteps}\ta=session\trecovery-exhausted`);
          recordStuckSessionIssue(
            'recovery-exhausted',
            `No structured recovery progress after ${recoveryAttempts} attempts.`,
          );
          terminationReason = 'recovery-exhausted';
          break;
        }
        if (noProgressCount >= noProgressLimit) {
          logInteraction(`s=${totalSteps}\ta=session\tno-progress`);
          recordStuckSessionIssue(
            'no-progress',
            `No interaction progress after ${noProgressCount} steps in chaos mode.`,
          );
          terminationReason = 'no-progress';
          break;
        }
        if (Math.max(0, Date.now() - lastVisualChangeAt) > MAX_VISUAL_STAGNATION_MS && mode === 'recovery' && recoveryAttempts >= recoveryStepLimit) {
          logInteraction(`s=${totalSteps}\ta=session\tvisual-stagnation`);
          recordStuckSessionIssue(
            'visual-stagnation',
            `Visual delta remained below threshold for more than ${MAX_VISUAL_STAGNATION_MS}ms.`,
          );
          terminationReason = 'visual-stagnation';
          break;
        }
        if (sessionSteps >= minSessionSteps) {
          logInteraction(`s=${totalSteps}\ta=session\tmin-steps`);
          terminationReason = 'min-steps';
          break;
        }
        await page.waitForTimeout(rng.int(0, 25));
      }

      let route: string | undefined;
      try {
        route = new URL(page.url()).pathname;
      } catch {
        route = undefined;
      }
      const title = await page.title().catch(() => undefined);

      await sampleVisualProgress(true);

      const screenshotPath = sessionScreenshotPath;
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch((error) => {
        logInteraction(`s=${totalSteps}\ta=screenshot\terror=${(error as Error)?.message || 'failed'}`);
      });

      await fs.writeFile(sessionLogPath, interactions.join('\n'), 'utf8');

      const video = page.video();
      await context.close();
      let savedVideo: string | undefined;
      if (video) {
        try {
          const recorded = await video.path();
          const target = path.join(videosDir, `${sessionId}.webm`);
          await fs.rename(recorded, target).catch(async () => {
            await fs.copyFile(recorded, target);
            await fs.unlink(recorded).catch((error) => {
              logInteraction(`s=${totalSteps}\ta=video\tcleanup-error=${(error as Error)?.message || 'unlink-failed'}`);
            });
          });
          savedVideo = path.relative(outputRoot, target);
        } catch (error) {
          logInteraction(`s=${totalSteps}\ta=video\terror=${(error as Error)?.message || 'video-finalize-failed'}`);
        }
      }

      if (!savedVideo) {
        recordIssueOnce({
          severity: 'freeze',
          message: 'Session video missing or failed to finalize.',
          source: 'session.video',
          interactionIndex: totalSteps,
          lastInteractions: interactions.slice(-lastInteractionCount),
        });
      }

      if (infraMode && issue) {
        infraSessionClean = false;
      }

      if (!terminationReason) {
        if (issue) {
          terminationReason = 'issue';
        } else if (Date.now() >= runDeadline) {
          terminationReason = 'time-budget';
        } else if (maxSteps && totalSteps >= maxSteps) {
          terminationReason = 'max-steps';
        } else {
          terminationReason = 'min-steps';
        }
      }

      terminationCounts[terminationReason] += 1;

      if (issue) {
        issue.route = route;
        issue.title = title;
        const example: IssueExample = {
          platform,
          runMode,
          seed,
          sessionId,
          interactionIndex: issue.interactionIndex,
          lastInteractions: issue.lastInteractions,
          video: savedVideo,
          screenshot: path.relative(outputRoot, screenshotPath),
          route,
          title,
          severity: issue.severity,
        };
        recordIssue(issue, example);
      }

      const sessionManifest: SessionManifest = {
        sessionId,
        seed,
        shardIndex,
        startTime: new Date(sessionStartedAtMs).toISOString(),
        endTime: new Date().toISOString(),
        durationMs: Date.now() - sessionStartedAtMs,
        steps: sessionSteps,
        terminationReason,
        route,
        title,
        issueSeverity: issue?.severity,
        issueSource: issue?.source,
        issueMessage: issue?.message,
        maxVisualStagnationMs,
        visualSamples: visualSamples.length,
        recoverySteps,
        interactionLog: path.relative(outputRoot, sessionLogPath),
        finalScreenshot: path.relative(outputRoot, screenshotPath),
        video: savedVideo || '',
      };
      sessionManifests.push(sessionManifest);
      await writeJson(sessionJsonPath, sessionManifest);

      server.resetState();
      server.setFaultMode('none');
      server.setLatencyMs(null);
    };

    while (Date.now() < runDeadline && (maxSteps ? totalSteps < maxSteps : true)) {
      await runSession();
      if (maxSteps && totalSteps >= maxSteps) break;
    }

    if (infraMode) {
      expect(infraActionsExecuted).toBeGreaterThan(0);
      expect(infraSessionClean).toBe(true);
    }

    await browser.close();
    await server.close();

    const sessionsStarted = sessionManifests.length;
    const averageSessionDurationMs = sessionsStarted
      ? Math.round(sessionManifests.reduce((sum, item) => sum + item.durationMs, 0) / sessionsStarted)
      : 0;
    const averageStepsPerSession = sessionsStarted
      ? Number((sessionManifests.reduce((sum, item) => sum + item.steps, 0) / sessionsStarted).toFixed(2))
      : 0;
    const maxVisualStagnationMs = sessionManifests.reduce(
      (max, item) => Math.max(max, item.maxVisualStagnationMs),
      0,
    );

    const visualStagnationReport = {
      meta: {
        seed,
        shardIndex,
        shardTotal,
        thresholdMs: MAX_VISUAL_STAGNATION_MS,
      },
      maxVisualStagnationMs,
      violations: sessionManifests
        .filter((item) => item.maxVisualStagnationMs > MAX_VISUAL_STAGNATION_MS)
        .map((item) => ({
          sessionId: item.sessionId,
          maxVisualStagnationMs: item.maxVisualStagnationMs,
          terminationReason: item.terminationReason,
        })),
      sessions: sessionManifests.map((item) => ({
        sessionId: item.sessionId,
        maxVisualStagnationMs: item.maxVisualStagnationMs,
        terminationReason: item.terminationReason,
      })),
    };

    const runMetrics = {
      meta: {
        seed,
        platform,
        runMode,
        shardIndex,
        shardTotal,
        runId,
      },
      sessionsStarted,
      sessionsTerminatedByReason: terminationCounts,
      maxVisualStagnationMs,
      averageSessionDurationMs,
      averageStepsPerSession,
      totalSteps,
      stepsPerSession: sessionManifests.map((item) => ({ sessionId: item.sessionId, steps: item.steps })),
    };

    await writeJson(path.join(outputRoot, 'visual-stagnation-report.json'), visualStagnationReport);
    await writeJson(path.join(outputRoot, 'fuzz-run-metrics.json'), runMetrics);

    const report = {
      meta: {
        seed,
        platform,
        runMode,
        maxSteps: maxSteps ?? null,
        timeBudgetMs: timeBudgetMs ?? null,
        totalSteps,
        sessions: sessionIndex,
        shardIndex,
        shardTotal,
        runId,
      },
      issueGroups: Array.from(issueGroups.values()),
    };

    await writeJson(path.join(outputRoot, 'fuzz-issue-report.json'), report);

    const summaryLines: string[] = ['# Fuzz Test Summary', ''];
    if (!issueGroups.size) {
      summaryLines.push('No issues detected.');
    } else {
      const groupsArray = Array.from(issueGroups.values());
      for (const group of groupsArray) {
        const totalCount = Object.values(group.severityCounts).reduce((sum: number, value: number) => sum + value, 0);
        const exampleVideos = group.examples
          .map((example) => example.video)
          .filter(Boolean)
          .slice(0, 3);
        summaryLines.push(`## ${group.issue_group_id}`);
        summaryLines.push('');
        summaryLines.push(`- Exception: ${group.signature.exception}`);
        summaryLines.push(`- Message: ${group.signature.message || 'n/a'}`);
        summaryLines.push(`- Top frames: ${group.signature.topFrames.join(' | ') || 'n/a'}`);
        summaryLines.push(`- Total: ${totalCount}`);
        summaryLines.push(
          `- Severity: crash=${group.severityCounts.crash} freeze=${group.severityCounts.freeze} error=${group.severityCounts.errorLog} warn=${group.severityCounts.warnLog}`,
        );
        summaryLines.push(`- Platforms: ${group.platforms.join(', ')}`);
        if (exampleVideos.length) {
          summaryLines.push(`- Videos: ${exampleVideos.join(', ')}`);
        }
        summaryLines.push(`- Likely fix: ${summarizeFixHint(group.signature, group.examples[0].severity)}`);
        summaryLines.push('');
      }
    }

    await fs.writeFile(path.join(outputRoot, 'fuzz-issue-summary.md'), summaryLines.join('\n'), 'utf8');
    await fs.writeFile(path.join(outputRoot, 'README.md'), summaryLines.join('\n'), 'utf8');

    const requiredArtifactChecks = await Promise.all(
      sessionManifests.map(async (item) => {
        const missing: string[] = [];
        try {
          await fs.stat(path.join(outputRoot, item.interactionLog));
        } catch {
          missing.push('interactionLog');
        }
        try {
          await fs.stat(path.join(outputRoot, item.finalScreenshot));
        } catch {
          missing.push('finalScreenshot');
        }
        try {
          await fs.stat(path.join(outputRoot, item.video));
        } catch {
          missing.push('video');
        }
        return { sessionId: item.sessionId, missing };
      }),
    );

    const missingArtifactSessions = requiredArtifactChecks.filter((item) => item.missing.length > 0);
    expect(missingArtifactSessions, `Missing required session artifacts: ${JSON.stringify(missingArtifactSessions)}`).toEqual([]);
    expect(visualStagnationReport.violations, 'Visual stagnation exceeded 5s threshold.').toEqual([]);
  });
});
