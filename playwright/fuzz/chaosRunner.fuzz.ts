import { chromium, devices, test } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createMockC64Server } from '../../tests/mocks/mockC64Server';
import { seedUiMocks } from '../uiMocks';

const FUZZ_ENABLED = process.env.FUZZ_RUN === '1';

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

const buildGroupId = (signature: IssueSignature) => {
  const frame = signature.topFrames[0] || 'unknown';
  const base = `${signature.exception}@${frame}`;
  return base.replace(/[^a-z0-9@._:-]+/gi, '-').slice(0, 120);
};

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

const safeClick = async (
  page: import('@playwright/test').Page,
  pick: { target: import('@playwright/test').ElementHandle<HTMLElement>; description: string },
  rng: SeededRng,
  selector: string,
) => {
  try {
    await pick.target.click();
    return { ok: true, log: `click ${pick.description}` };
  } catch (error) {
    const message = (error as Error)?.message || '';
    if (message.includes('not attached') || message.includes('Element is not attached')) {
      const refreshed = await pickVisibleElement(
        page,
        selector,
        rng,
        async (element) => !(await isExternalOrBlankTarget(element)),
      );
      if (refreshed) {
        await refreshed.target.click();
        return { ok: true, log: `click ${refreshed.description}` };
      }
    }
    throw error;
  }
};

const closeBlockingOverlay = async (page: import('@playwright/test').Page) => {
  const overlay = await page.$('[data-state="open"][data-aria-hidden="true"], [data-state="open"][aria-hidden="true"]');
  if (!overlay) return false;
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(50);
  return true;
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
  test.skip(!FUZZ_ENABLED, 'Chaos fuzz runs only when FUZZ_RUN=1 is set.');

  test('run', async ({}, testInfo) => {
    const seed = toNumber(process.env.FUZZ_SEED) ?? 1337;
    const maxStepsInput = toNumber(process.env.FUZZ_MAX_STEPS);
    const timeBudgetMs = toNumber(process.env.FUZZ_TIME_BUDGET_MS);
    const maxSteps = maxStepsInput ?? (timeBudgetMs ? undefined : 500);
    const baseTimeout = timeBudgetMs ?? 10 * 60 * 1000;
    test.setTimeout(baseTimeout + 60_000);
    const platform = process.env.FUZZ_PLATFORM || 'android-phone';
    const runMode = process.env.FUZZ_RUN_MODE || 'local';
    const lastInteractionCount = toNumber(process.env.FUZZ_LAST_INTERACTIONS) ?? 50;
    const baseUrl = process.env.FUZZ_BASE_URL || String(testInfo.project.use.baseURL || 'http://127.0.0.1:4173');

    const outputRoot = path.resolve(
      process.cwd(),
      'test-results',
      'fuzz',
      `run-${runMode}-${platform}-${seed}`,
    );
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
    let clickActionsDisabled = false;

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
      }, { baseUrl: server.baseUrl });

      await seedUiMocks(page, server.baseUrl);

      let issue: IssueRecord | null = null;
      let lastLogId: string | null = null;

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
        recordIssueOnce({
          severity: msg.type() === 'error' ? 'errorLog' : 'warnLog',
          message: msg.text(),
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

      const actions = [
        {
          name: 'click',
          weight: 28,
          canRun: async () => {
            if (clickActionsDisabled) return false;
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
            const result = await safeClick(page, pick, rng, selector);
            if (isExternal) {
              externalClickUsed = true;
              clickActionsDisabled = true;
              return { log: `click external ${pick.description} (clicks disabled)` };
            }
            return { log: result.log };
          },
        },
        {
          name: 'tab',
          weight: 10,
          canRun: async () => {
            if (clickActionsDisabled) return false;
            return hasVisibleElement(page, '.tab-bar button');
          },
          run: async () => {
            const pick = await pickVisibleElement(page, '.tab-bar button', rng);
            if (!pick) return { log: 'tab skip' };
            await pick.target.click();
            return { log: `tab ${pick.description}` };
          },
        },
        {
          name: 'scroll',
          weight: 12,
          canRun: async () => true,
          run: async () => {
            const delta = rng.int(-600, 600);
            await page.mouse.wheel(0, delta);
            return { log: `scroll ${delta}` };
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
            await pick.target.click();
            return { log: `select ${pick.description}` };
          },
        },
        {
          name: 'type',
          weight: 8,
          canRun: async () =>
            hasVisibleElement(page, 'input[type="text"], input[type="search"], textarea, [contenteditable="true"]'),
          run: async () => {
            const pick = await pickVisibleElement(page, 'input[type="text"], input[type="search"], textarea, [contenteditable="true"]', rng);
            if (!pick) return { log: 'type skip' };
            const text = randomText(rng);
            await pick.target.fill(text);
            return { log: `type ${pick.description} "${text}"` };
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
            await pick.target.click();
            return { log: `toggle ${pick.description}` };
          },
        },
        {
          name: 'modal',
          weight: 6,
          canRun: async () => !clickActionsDisabled,
          run: async () => {
            const dialog = await page.$('[role="dialog"], [data-radix-dialog-content], [data-state="open"][role="dialog"]');
            if (dialog) {
              await page.keyboard.press('Escape');
              return { log: 'modal close' };
            }
            const pick = await pickVisibleElement(page, 'button[aria-haspopup="dialog"], [data-state="closed"][data-radix-collection-item]', rng);
            if (!pick) return { log: 'modal open skip' };
            await pick.target.click();
            return { log: `modal open ${pick.description}` };
          },
        },
        {
          name: 'navigate',
          weight: 4,
          canRun: async () => true,
          run: async () => {
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
        await page.waitForTimeout(rng.int(40, 200));
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
            const safeName = issue
              ? buildGroupId(buildSignature(issue))
              : sessionId;
            const target = path.join(videosDir, `${safeName}-${sessionId}.webm`);
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

      await fs.writeFile(sessionLogPath, interactions.join('\n'), 'utf8');

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

    const report = {
      meta: {
        seed,
        platform,
        runMode,
        maxSteps: maxSteps ?? null,
        timeBudgetMs: timeBudgetMs ?? null,
        totalSteps,
        sessions: sessionIndex,
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
