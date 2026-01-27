import { chromium, devices, test } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createMockC64Server } from '../../tests/mocks/mockC64Server';
import { seedUiMocks } from '../uiMocks';

const FUZZ_ENABLED = process.env.FUZZ_RUN === '1';
const SHORT_FUZZ_DEFAULTS = !FUZZ_ENABLED;
test.use({ screenshot: 'off', video: 'off', trace: 'off' });

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

const sanitizeFileComponent = (value: string) =>
  value
    .replace(/[<>:"/\\|?*\r\n]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 128);

const parseActionTimeout = (error: unknown) => {
  const message = (error as Error)?.message || String(error);
  return /timeout/i.test(message);
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

const describeElement = async (element: import('@playwright/test').ElementHandle<HTMLElement>) =>
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
  page: import('@playwright/test').Page,
  selector: string,
  rng: SeededRng,
  filter?: (element: import('@playwright/test').ElementHandle<HTMLElement>) => Promise<boolean>,
) => {
  const elements = await page.$$(selector);
  const visible: Array<import('@playwright/test').ElementHandle<HTMLElement>> = [];
  for (const element of elements) {
    if (!(await element.isVisible())) continue;
    if (filter && !(await filter(element as import('@playwright/test').ElementHandle<HTMLElement>))) continue;
    visible.push(element as import('@playwright/test').ElementHandle<HTMLElement>);
    if (visible.length >= 30) break;
  }
  if (!visible.length) return null;
  const target = rng.pick(visible);
  const description = await describeElement(target);
  return { target, description };
};

const hasVisibleElement = async (page: import('@playwright/test').Page, selector: string) => {
  const elements = await page.$$(selector);
  for (const element of elements) {
    if (await element.isVisible()) return true;
  }
  return false;
};

const pickVisibleElementByText = async (
  page: import('@playwright/test').Page,
  selector: string,
  matcher: RegExp,
  rng: SeededRng,
) => {
  const elements = await page.$$(selector);
  const visible: Array<import('@playwright/test').ElementHandle<HTMLElement>> = [];
  for (const element of elements) {
    if (!(await element.isVisible())) continue;
    const text = ((await element.textContent()) || '').trim();
    if (!matcher.test(text)) continue;
    visible.push(element as import('@playwright/test').ElementHandle<HTMLElement>);
    if (visible.length >= 20) break;
  }
  if (!visible.length) return null;
  const target = rng.pick(visible);
  const description = await describeElement(target);
  return { target, description };
};

const hasVisibleElementByText = async (
  page: import('@playwright/test').Page,
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

const getActiveDialog = async (page: import('@playwright/test').Page) =>
  page.$('[role="dialog"], [data-radix-dialog-content], [data-state="open"][role="dialog"]');

const isExternalOrBlankTarget = async (element: import('@playwright/test').ElementHandle<HTMLElement>) =>
  element.evaluate((node) => {
    if (!(node instanceof HTMLAnchorElement)) return false;
    const target = node.getAttribute('target');
    const href = node.getAttribute('href') || '';
    if (target === '_blank') return true;
    if (/^https?:\/\//i.test(href)) return true;
    if (/^[a-z]+:/i.test(href) && !href.startsWith('/') && !href.startsWith('#')) return true;
    return false;
  });

const resolveBlockingDialog = async (page: import('@playwright/test').Page) => {
  const dialog = await page.$('[role="dialog"], [data-radix-dialog-content], [data-state="open"][role="dialog"]');
  if (!dialog) return false;

  const input = await dialog.$('input[type="text"], input[type="search"], textarea');
  if (input) {
    const labelText = await dialog.evaluate((node) => node.textContent?.toLowerCase() || '');
    const value = labelText.includes('delete') ? 'delete' : 'confirm';
    await input.fill(value).catch(() => {});
  }

  const buttons = await dialog.$$('button, [role="button"]');
  for (const button of buttons) {
    const text = (await button.textContent())?.trim().toLowerCase() || '';
    if (!text) continue;
    if (/(confirm|continue|ok|yes|save|delete|submit|proceed)/.test(text)) {
      await button.click().catch(() => {});
      return true;
    }
  }

  await page.keyboard.press('Escape').catch(() => {});
  return true;
};

const showInteractionPulse = async (
  page: import('@playwright/test').Page,
  target?: import('@playwright/test').ElementHandle<HTMLElement>,
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
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(50);
  return true;
};

const jitterClick = async (
  page: import('@playwright/test').Page,
  target: import('@playwright/test').ElementHandle<HTMLElement>,
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
  page: import('@playwright/test').Page,
  pick: { target: import('@playwright/test').ElementHandle<HTMLElement>; description: string },
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
  return page.evaluate(() => ({
    x: Math.max(4, Math.floor(Math.random() * (window.innerWidth - 8)) + 4),
    y: Math.max(4, Math.floor(Math.random() * (window.innerHeight - 8)) + 4),
  }));
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

test.describe('Chaos fuzz', () => {
  test('run', async ({ page }, testInfo) => {
    void page;
    const seed = toNumber(process.env.FUZZ_SEED) ?? Date.now();
    const maxStepsInput = toNumber(process.env.FUZZ_MAX_STEPS);
    const timeBudgetMs = toNumber(process.env.FUZZ_TIME_BUDGET_MS);
    const maxSteps = maxStepsInput ?? (timeBudgetMs ? undefined : (SHORT_FUZZ_DEFAULTS ? 35 : 500));
    const baseTimeout = timeBudgetMs ?? (SHORT_FUZZ_DEFAULTS ? 90_000 : 10 * 60 * 1000);
    const timeoutMs = baseTimeout + 60_000;
    test.setTimeout(timeoutMs);
    testInfo.setTimeout(timeoutMs);
    const platform = process.env.FUZZ_PLATFORM || 'android-phone';
    const runMode = process.env.FUZZ_RUN_MODE || 'local';
    const runId = process.env.FUZZ_RUN_ID || `${seed}`;
    const shardIndex = toNumber(process.env.FUZZ_SHARD_INDEX) ?? 0;
    const shardTotal = toNumber(process.env.FUZZ_SHARD_TOTAL) ?? 1;
    const lastInteractionCount = toNumber(process.env.FUZZ_LAST_INTERACTIONS) ?? 50;
    const retainSuccessSessions = Math.max(0, toNumber(process.env.FUZZ_RETAIN_SUCCESS) ?? (SHORT_FUZZ_DEFAULTS ? 2 : 10));
    const minSessionSteps = Math.max(1, toNumber(process.env.FUZZ_MIN_SESSION_STEPS) ?? (SHORT_FUZZ_DEFAULTS ? 35 : 200));
    const noProgressLimit = Math.max(1, toNumber(process.env.FUZZ_NO_PROGRESS_STEPS) ?? (SHORT_FUZZ_DEFAULTS ? 10 : 20));
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
    let externalClickUsed = false;
    const clickActionsDisabled = false;
    const retainedSuccess: Array<{ logPath: string; videoPath?: string }> = [];

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
      const interactions: string[] = [];
      const logInteraction = (entry: string) => {
        interactions.push(entry);
      };

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

      const readUiSignature = async () => {
        try {
          const signature = await page.evaluate(() => {
            const text = document.body?.innerText?.slice(0, 200) ?? '';
            const active = document.activeElement?.tagName ?? '';
            return `${location.pathname}|${document.title}|${window.scrollX},${window.scrollY}|${active}|${text}`;
          });
          return signature;
        } catch {
          try {
            return `error:${page.url()}`;
          } catch {
            return 'error:unknown';
          }
        }
      };

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
      let lastFaultAt = 0;
      let currentFaultMode: 'none' | 'slow' | 'timeout' | 'refused' = 'none';
      let serverReachable = true;
      let lastOutageAt = 0;

      const recordIssueOnce = (payload: IssueRecord) => {
        if (issue) return;
        issue = payload;
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
        const outageExpected = !serverReachable || currentFaultMode !== 'none' || networkOffline;
        if (
          outageExpected &&
          text.includes('Failed to load resource') &&
          (text.includes('Service Unavailable') || text.includes('net::ERR_'))
        ) {
          return;
        }
        if (
          msg.type() === 'error' &&
          (text.includes('Failed to load resource') && text.includes('net::ERR_'))
        ) {
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

      const readAppLogs = async () => {
        try {
          const raw = await page.evaluate(() => localStorage.getItem('c64u_app_logs'));
          if (!raw) return [] as Array<{ id: string; level: string; message: string; details?: unknown }>; 
          const parsed = JSON.parse(raw) as Array<{ id: string; level: string; message: string; details?: unknown }>;
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [] as Array<{ id: string; level: string; message: string; details?: unknown }>;
        }
      };

      const checkAppLogsForIssues = async () => {
        const logs = await readAppLogs();
        if (!logs.length) return;
        if (!lastLogId) {
          lastLogId = logs[0]?.id ?? null;
          return;
        }
        const fresh = [] as Array<{ id: string; level: string; message: string; details?: unknown }>;
        for (const entry of logs) {
          if (entry.id === lastLogId) break;
          fresh.push(entry);
        }
        if (logs[0]?.id) lastLogId = logs[0].id;
        const errorEntry = fresh.find((entry) => entry.level === 'error');
        const warnEntry = fresh.find((entry) => entry.level === 'warn');
        if (errorEntry) {
          if (
            errorEntry.message === 'C64 API request failed' &&
            (!serverReachable || networkOffline || currentFaultMode !== 'none' || (lastOutageAt > 0 && Date.now() - lastOutageAt < 60000))
          ) {
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

      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

      let sessionSteps = 0;
      let noProgressCount = 0;
      let lastSignature = await readUiSignature();

      const ensureAppOrigin = async () => {
        const url = page.url();
        if (!url || url.startsWith('about:') || !url.startsWith(baseOrigin)) {
          await page.goto(baseUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
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
            await pick.target.click().catch(() => {});
            await page.keyboard.press('Control+A').catch(() => {});
            await page.keyboard.press('Backspace').catch(() => {});
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
              await showInteractionPulse(page, option as import('@playwright/test').ElementHandle<HTMLElement>);
              await option.click().catch(() => {});
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
                await page.keyboard.press(key).catch(() => {});
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
            lastFaultAt = Date.now();
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
            await context.setOffline(true).catch(() => {});
            const duration = rng.int(500, 2500);
            await page.waitForTimeout(duration);
            await context.setOffline(false).catch(() => {});
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
              await page.keyboard.press(key).catch(() => {});
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
            hasVisibleElement(page, 'input[type="text"], input[type="search"], textarea, [contenteditable="true"]'),
          run: async () => {
            const pick = await pickVisibleElement(page, 'input[type="text"], input[type="search"], textarea, [contenteditable="true"]', rng);
            if (!pick) return { log: 'type skip' };
            const supportsFill = await pick.target.evaluate((node) =>
              node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement,
            );
            const modeRoll = rng.next();
            const text = modeRoll < 0.35 ? randomLargeText(rng) : randomText(rng);
            await showInteractionPulse(page, pick.target);
            if (modeRoll < 0.35) {
              await pick.target.click().catch(() => {});
              await page.keyboard.press('Control+A').catch(() => {});
              await page.keyboard.press('Backspace').catch(() => {});
              await page.keyboard.insertText(text);
              return { log: `paste ${pick.description} (${text.length} chars)` };
            }
            if (rng.next() > 0.45 || !supportsFill) {
              await pick.target.click().catch(() => {});
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
                await showInteractionPulse(page, target);
                await target.click().catch(() => {});
                return { log: 'modal button' };
              }
              await page.keyboard.press('Escape').catch(() => {});
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
              await page.goto(baseUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
              return { log: 'nav recover' };
            }
            if (rng.next() > 0.5) {
              await page.goBack({ timeout: 5000 }).catch(() => {});
              return { log: 'nav back' };
            }
            await page.goForward({ timeout: 5000 }).catch(() => {});
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
            lastFaultAt = mode === 'none' ? 0 : Date.now();
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

      while (Date.now() < deadline && (maxSteps ? totalSteps < maxSteps : true)) {
        if (issue) break;
        totalSteps += 1;
        sessionSteps += 1;
        if (await ensureAppOrigin()) {
          logInteraction(`s=${totalSteps}\ta=recover\treturn-to-app`);
          continue;
        }
        if (await closeBlockingOverlay(page)) {
          logInteraction(`s=${totalSteps}\ta=modal\tauto-close`);
          continue;
        }
        if (await resolveBlockingDialog(page)) {
          logInteraction(`s=${totalSteps}\ta=modal\tauto-resolve`);
          continue;
        }
        const action = await pickAction();
        if (!action) break;
        try {
          const result = await action.run();
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
        await checkAppLogsForIssues();
        if (issue) break;
        const signature = await readUiSignature();
        if (signature === lastSignature) {
          noProgressCount += 1;
        } else {
          noProgressCount = 0;
          lastSignature = signature;
        }
        if (noProgressCount >= noProgressLimit) {
          logInteraction(`s=${totalSteps}\ta=session\tno-progress`);
          break;
        }
        if (sessionSteps >= minSessionSteps) {
          logInteraction(`s=${totalSteps}\ta=session\tmin-steps`);
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

      let screenshotPath: string | undefined;
      if (issue) {
        const screenshotName = `${sessionId}.png`;
        screenshotPath = path.join(outputRoot, screenshotName);
        await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
      }

      const video = page.video();
      await context.close();
      let savedVideo: string | undefined;
      if (video) {
        try {
          const recorded = await video.path();
          if (issue) {
            const safeName = sanitizeFileComponent(buildGroupId(buildSignature(issue)) || 'issue');
            const target = path.join(videosDir, `${safeName}-${sessionId}.webm`);
            await fs.rename(recorded, target).catch(async () => {
              await fs.copyFile(recorded, target);
              await fs.unlink(recorded).catch(() => {});
            });
            savedVideo = path.relative(outputRoot, target);
          } else if (retainSuccessSessions > 0) {
            const target = path.join(videosDir, `success-${sessionId}.webm`);
            await fs.rename(recorded, target).catch(async () => {
              await fs.copyFile(recorded, target);
              await fs.unlink(recorded).catch(() => {});
            });
            savedVideo = path.relative(outputRoot, target);
          } else {
            await fs.unlink(recorded).catch(() => {});
          }
        } catch {
          // ignore video errors
        }
      }

      if (issue || retainSuccessSessions > 0) {
        await fs.writeFile(sessionLogPath, interactions.join('\n'), 'utf8');
      }

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
          screenshot: screenshotPath ? path.relative(outputRoot, screenshotPath) : undefined,
          route,
          title,
          severity: issue.severity,
        };
        recordIssue(issue, example);
      } else if (retainSuccessSessions > 0) {
        retainedSuccess.push({ logPath: sessionLogPath, videoPath: savedVideo ? path.join(outputRoot, savedVideo) : undefined });
        while (retainedSuccess.length > retainSuccessSessions) {
          const removed = retainedSuccess.shift();
          if (removed?.logPath) await fs.unlink(removed.logPath).catch(() => {});
          if (removed?.videoPath) await fs.unlink(removed.videoPath).catch(() => {});
        }
      }

      server.resetState();
      server.setFaultMode('none');
      server.setLatencyMs(null);
    };

    while (Date.now() < deadline && (maxSteps ? totalSteps < maxSteps : true)) {
      await runSession();
      if (maxSteps && totalSteps >= maxSteps) break;
    }

    await browser.close();
    await server.close();

    try {
      const videoEntries = await fs.readdir(videosDir, { withFileTypes: true });
      await Promise.all(
        videoEntries
          .filter((entry) => entry.isFile())
          .map(async (entry) => {
            if (entry.name.includes('-session-')) return;
            if (!entry.name.endsWith('.webm')) return;
            await fs.unlink(path.join(videosDir, entry.name)).catch(() => {});
          }),
      );
    } catch {
      // ignore cleanup errors
    }

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

    const summaryLines: string[] = ['# Chaos Fuzz Summary', ''];
    if (!issueGroups.size) {
      summaryLines.push('No issues detected.');
    } else {
      for (const group of issueGroups.values()) {
        const totalCount = Object.values(group.severityCounts).reduce((sum, value) => sum + value, 0);
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
  });
});
