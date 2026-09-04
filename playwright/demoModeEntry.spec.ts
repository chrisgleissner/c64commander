/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * How a user gets into Demo Mode, and what they can do once they are there.
 *
 * Three routes in, each with its own failure mode:
 *
 * - No network at all. The app skips discovery entirely (there is nothing to discover) and must
 *   still ask before standing a simulated device in for the one the user configured.
 * - A network, but no device answering on it. The app probes, fails, and offers Demo Mode naming
 *   the host it tried, so the user can correct a stale hostname instead.
 * - A deliberate choice, from Settings, with a real device connected and working.
 *
 * And once in: every control the app offers against a real device must still be there, because a
 * simulated device that quietly drops half the interface is not a demo of the app.
 */

import { test, expect } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";
import { createMockC64Server } from "../tests/mocks/mockC64Server";
import { markTourTaken } from "./uiMocks";
import {
  allowWarnings,
  assertNoUiIssues,
  attachStepScreenshotTolerant,
  finalizeEvidence,
  startStrictUiMonitoring,
} from "./testArtifacts";
import { saveCoverageFromPage } from "./withCoverage";

type MockServer = Awaited<ReturnType<typeof createMockC64Server>>;

type NetworkStatus = { online: boolean; supported: boolean };

type SeedOptions = {
  deviceHost: string;
  deviceBaseUrl: string;
  demoBaseUrl: string;
  networkStatus: NetworkStatus;
};

/** Every route reachable from the tab bar. `/docs` is excluded: it renders the manual, not CTAs. */
const MAIN_ROUTES = ["/", "/play", "/disks", "/config", "/settings"] as const;

const snap = attachStepScreenshotTolerant;

/**
 * Seed the page as a handset would look to the connection manager.
 *
 * The platform override and the injected network status are the two test seams that let a browser
 * reach the handset-only code path: `shouldStartDemoModeForOfflineDevice` requires a native
 * platform that positively reports no network, and a browser can report neither.
 */
const seedHandset = async (page: Page, options: SeedOptions) => {
  await markTourTaken(page);
  await page.addInitScript(({ deviceHost, deviceBaseUrl, demoBaseUrl, networkStatus }: SeedOptions) => {
    const win = window as Window & {
      __c64uTestProbeEnabled?: boolean;
      __c64uPlatformOverride?: string;
      __c64uMockNetworkStatus?: NetworkStatus;
      __c64uMockDeviceDiscovery?: { candidates: unknown[] };
      __c64uMockServerBaseUrl?: string;
      __c64uExpectedBaseUrl?: string;
      __c64uAllowedBaseUrls?: string[];
    };
    win.__c64uTestProbeEnabled = true;
    // The strict UI monitor rejects any request to a backend the test did not declare, so both
    // the configured device and the simulated one have to be named up front.
    win.__c64uExpectedBaseUrl = deviceBaseUrl;
    win.__c64uAllowedBaseUrls = [deviceBaseUrl, demoBaseUrl];
    win.__c64uPlatformOverride = "android";
    win.__c64uMockNetworkStatus = networkStatus;
    // An empty LAN scan, so the discovery fallback finds nothing and the run ends in the offer
    // rather than in a device picker. Without this the injected result is absent and the web
    // facade answers `unsupported`, which reads the same but says less about what was intended.
    win.__c64uMockDeviceDiscovery = { candidates: [] };
    win.__c64uMockServerBaseUrl = demoBaseUrl;

    localStorage.setItem("c64u_device_host", deviceHost);
    localStorage.setItem("c64u_startup_discovery_window_ms", "1200");
    localStorage.setItem("c64u_background_rediscovery_interval_ms", "60000");
    localStorage.setItem("c64u_automatic_demo_mode_enabled", "1");
    localStorage.setItem("c64u_feature_flag:demo_mode_enabled", "1");
    localStorage.removeItem("c64u_password");
    localStorage.removeItem("c64u_has_password");
    sessionStorage.removeItem("c64u_demo_interstitial_shown");
    sessionStorage.removeItem("c64u_demo_mode_pinned");
  }, options);
};

const setNetworkStatus = async (page: Page, status: NetworkStatus) => {
  await page.evaluate((value: NetworkStatus) => {
    (window as Window & { __c64uMockNetworkStatus?: NetworkStatus }).__c64uMockNetworkStatus = value;
  }, status);
};

const connectionBadge = (page: Page) => page.locator('[data-panel-position="1"]').getByTestId("unified-health-badge");

const expectConnectionState = async (page: Page, state: string, timeout = 15000) =>
  expect(connectionBadge(page)).toHaveAttribute("data-connection-state", state, { timeout });

const demoDialog = (page: Page) => page.getByRole("dialog", { name: "Demo Mode" });

/**
 * Click a control that a concurrent re-render may detach mid-click.
 *
 * The Demo Mode dialog re-renders as the connection state moves underneath it, so a plain click
 * loses the element between resolving it and acting on it. The fallback dispatches the click on
 * the handle that was resolved, which is the element the user would have hit.
 */
const clickCta = async (page: Page, testId: string) => {
  const locator = page.getByTestId(testId);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await locator.click({ timeout: 5000, noWaitAfter: true });
      return;
    } catch (error) {
      const handle = await locator.elementHandle().catch(() => null);
      if (handle) {
        await page.evaluate((node) => (node as HTMLElement).click(), handle);
        return;
      }
      if (attempt === 2) throw error;
      await page.waitForTimeout(200);
    }
  }
};

/**
 * The testids of every visible, enabled control on the current page.
 *
 * Read twice with a settle in between and only accepted when the two agree, so a list still
 * hydrating cannot decide the comparison. Testids, not text, because text is localised and
 * position is not stable across a re-render.
 */
const interactiveTestIds = async (page: Page): Promise<string[]> => {
  const read = () =>
    page.evaluate(() => {
      const selector = [
        "button",
        "a[href]",
        "input",
        "select",
        "textarea",
        '[role="button"]',
        '[role="checkbox"]',
        '[role="switch"]',
        '[role="tab"]',
        '[role="slider"]',
        '[role="menuitem"]',
      ].join(",");
      const ids = new Set<string>();
      for (const node of Array.from(document.querySelectorAll(selector))) {
        const element = node as HTMLElement;
        const testId = element.dataset.testid;
        if (!testId) continue;
        if (element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true") continue;
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        if (getComputedStyle(element).visibility === "hidden") continue;
        ids.add(testId);
      }
      return Array.from(ids).sort();
    });

  let previous = await read();
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await page.waitForTimeout(400);
    const next = await read();
    if (next.length > 0 && next.join(" ") === previous.join(" ")) return next;
    previous = next;
  }
  return previous;
};

/**
 * Walk every main route and record its controls.
 *
 * `expected` makes the second pass wait for the first pass's controls rather than sampling
 * whenever the DOM happens to go quiet: several sections mount only once a config read has
 * answered (streaming, for instance, is derived from the Data Streams category, not from a
 * literal), and those reads finish well after the page stops changing for a moment.
 */
/**
 * Controls that only render once a config read has answered, so a route is not finished settling
 * until they are there. Sampling before them makes the comparison report a difference between two
 * moments rather than between two modes.
 */
const ROUTE_LANDMARKS: Record<string, string[]> = {
  "/": ["home-drive-toggle-a", "home-video-mode"],
  "/play": ["volume-mute"],
  "/disks": ["drive-bus-select-a"],
  "/settings": ["settings-discover-devices"],
};

const collectCtasPerRoute = async (page: Page, options: { state: string; expected?: Record<string, string[]> }) => {
  const byRoute: Record<string, string[]> = {};
  for (const route of MAIN_ROUTES) {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => undefined);
    // Each route is sampled only once the app is in the mode under test on that route. A page that
    // has navigated but not yet re-rendered against the connection state answers for the previous
    // mode, and the comparison then reports a difference between two moments, not two modes.
    await expectConnectionState(page, options.state);

    const wanted = [...(ROUTE_LANDMARKS[route] ?? []), ...(options.expected?.[route] ?? [])];
    let found = await interactiveTestIds(page);
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline && wanted.some((testId) => !found.includes(testId))) {
      await page.waitForTimeout(500);
      found = await interactiveTestIds(page);
    }
    byRoute[route] = found;
  }
  return byRoute;
};

test.describe("Entering Demo Mode", () => {
  let device: MockServer;
  let demo: MockServer;

  test.beforeEach(async () => {
    device = await createMockC64Server({});
    demo = await createMockC64Server({});
  });

  test.afterEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    try {
      await saveCoverageFromPage(page, testInfo.title);
      await assertNoUiIssues(page, testInfo);
    } finally {
      if (!page.isClosed()) await finalizeEvidence(page, testInfo);
      await demo?.close?.().catch(() => undefined);
      await device?.close?.().catch(() => undefined);
    }
  });

  test("with no network, the app asks before using the simulated device", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    allowWarnings(testInfo, "Reads in flight when Demo Mode re-routes the API are aborted by design.");

    // The device server is reachable throughout. Nothing may reach it: with no network there is
    // nothing to discover, and a probe that went out anyway would mean the app was about to
    // report a working device as offline.
    await seedHandset(page, {
      deviceHost: new URL(device.baseUrl).host,
      deviceBaseUrl: device.baseUrl,
      demoBaseUrl: demo.baseUrl,
      networkStatus: { online: false, supported: true },
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });

    const dialog = demoDialog(page);
    await expect(dialog).toBeVisible({ timeout: 15000 });
    // Visible copy, not the sr-only description: a confirmation dialog that shows the user a
    // title and two buttons and nothing else is not asking them anything.
    await expect(page.getByTestId("demo-interstitial-message")).toBeVisible();
    await expect(page.getByTestId("demo-interstitial-message")).toContainText(/no network connection/i);

    // A hostname is not the question when there is no network to reach one over.
    await expect(page.getByTestId("demo-interstitial-host-input")).toHaveCount(0);
    await expect(page.getByTestId("demo-interstitial-save-retry")).toHaveCount(0);
    await expect(page.getByTestId("demo-interstitial-hostname")).toHaveCount(0);
    expect(device.requests.filter((request) => request.url.startsWith("/v1/info"))).toHaveLength(0);

    await snap(page, testInfo, "no-network-offer");

    await clickCta(page, "demo-interstitial-continue");
    await expect(dialog).toBeHidden({ timeout: 10000 });
    await expectConnectionState(page, "DEMO_ACTIVE");

    await snap(page, testInfo, "no-network-confirmed");
  });

  test("with no network, trying again reaches the device once the network is back", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    allowWarnings(testInfo, "Discovery is expected to report no network before the radios come back.");

    await seedHandset(page, {
      deviceHost: new URL(device.baseUrl).host,
      deviceBaseUrl: device.baseUrl,
      demoBaseUrl: demo.baseUrl,
      networkStatus: { online: false, supported: true },
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(demoDialog(page)).toBeVisible({ timeout: 15000 });

    await setNetworkStatus(page, { online: true, supported: true });

    // Declining the offer must not leave the user stranded. Whether the user's own retry gets
    // there first or the app's rediscovery does, the requirement is the same: once there is a
    // network again, the configured device wins over the simulated one. The click is attempted
    // only while the dialog is still up, because the app reaching the device first also closes it.
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if ((await connectionBadge(page).getAttribute("data-connection-state")) === "REAL_CONNECTED") break;
      if (
        await demoDialog(page)
          .isVisible()
          .catch(() => false)
      ) {
        await clickCta(page, "demo-interstitial-retry").catch(() => undefined);
      }
      await page.waitForTimeout(500);
    }

    await expectConnectionState(page, "REAL_CONNECTED");
    await expect(demoDialog(page)).toBeHidden();
    expect(device.requests.filter((request) => request.url.startsWith("/v1/info")).length).toBeGreaterThan(0);

    await snap(page, testInfo, "no-network-retry-connected");
  });

  test("with a network but no device answering, the offer names the host it tried", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    allowWarnings(testInfo, "The configured device is deliberately unreachable in this test.");

    device.setReachable(false);
    const deviceHost = new URL(device.baseUrl).host;
    await seedHandset(page, {
      deviceHost,
      deviceBaseUrl: device.baseUrl,
      demoBaseUrl: demo.baseUrl,
      networkStatus: { online: true, supported: true },
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });

    const dialog = demoDialog(page);
    await expect(dialog).toBeVisible({ timeout: 20000 });

    // This case differs from the no-network one in exactly the way that matters to the user: a
    // hostname worth correcting, and the controls to correct it.
    await expect(page.getByTestId("demo-interstitial-message")).toBeVisible();
    await expect(page.getByTestId("demo-interstitial-hostname")).toHaveText(deviceHost);
    await expect(page.getByTestId("demo-interstitial-host-input")).toBeVisible();
    await expect(page.getByTestId("demo-interstitial-save-retry")).toBeVisible();

    // The probe really went out over the app's own request path — this is the network-enabled
    // route, not the shortcut the no-network case takes.
    expect(device.requests.filter((request) => request.url.startsWith("/v1/info")).length).toBeGreaterThan(0);

    await snap(page, testInfo, "unreachable-offer");

    await clickCta(page, "demo-interstitial-continue");
    await expect(dialog).toBeHidden({ timeout: 10000 });
    await expectConnectionState(page, "DEMO_ACTIVE");

    await snap(page, testInfo, "unreachable-confirmed");
  });

  test("Preview Demo Mode switches to the simulated device with a real one connected", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    allowWarnings(testInfo, "Reads in flight when Demo Mode re-routes the API are aborted by design.");

    await seedHandset(page, {
      deviceHost: new URL(device.baseUrl).host,
      deviceBaseUrl: device.baseUrl,
      demoBaseUrl: demo.baseUrl,
      networkStatus: { online: true, supported: true },
    });

    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await expectConnectionState(page, "REAL_CONNECTED");
    await expect(demoDialog(page)).toHaveCount(0);

    // Reaching a real device sets the sticky lock, which exists to stop a transient probe failure
    // moving the user off hardware they are using. A deliberate choice is not a probe failure, and
    // before this entry point existed the lock made Demo Mode unreachable while a device answered.
    const preview = page.getByTestId("settings-preview-demo-mode");
    await preview.scrollIntoViewIfNeeded();
    await expect(preview).toBeVisible();
    await snap(page, testInfo, "preview-demo-button");

    await clickCta(page, "settings-preview-demo-mode");
    await expectConnectionState(page, "DEMO_ACTIVE");
    await expect(preview).toHaveCount(0);

    await snap(page, testInfo, "preview-demo-active");
  });
});

test.describe("Reaching Demo Mode after declining the offer", () => {
  let device: MockServer;
  let demo: MockServer;

  test.beforeEach(async () => {
    device = await createMockC64Server({});
    demo = await createMockC64Server({});
  });

  test.afterEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    try {
      await saveCoverageFromPage(page, testInfo.title);
      await assertNoUiIssues(page, testInfo);
    } finally {
      if (!page.isClosed()) await finalizeEvidence(page, testInfo);
      await demo?.close?.().catch(() => undefined);
      await device?.close?.().catch(() => undefined);
    }
  });

  test("the connection indicator offers the simulated device once discovery has failed", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    allowWarnings(
      testInfo,
      "The configured device is deliberately unreachable, and reads in flight when Demo Mode re-routes the API are aborted by design.",
    );

    device.setReachable(false);
    await seedHandset(page, {
      deviceHost: new URL(device.baseUrl).host,
      deviceBaseUrl: device.baseUrl,
      demoBaseUrl: demo.baseUrl,
      networkStatus: { online: true, supported: true },
    });
    // Automatic Demo Mode turned off, which is the case this control exists for: the app reports
    // itself offline, no dialog is coming, and until now the only way in was to know Demo Mode
    // exists and to go looking for it in Settings.
    await page.addInitScript(() => localStorage.setItem("c64u_demo_mode_enabled", "0"));

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(demoDialog(page)).toHaveCount(0);
    await expectConnectionState(page, "OFFLINE_NO_DEMO", 25000);

    // Where a user actually goes when they notice nothing is connected: the connection indicator,
    // and then the connection actions inside the Diagnostics dialog it opens.
    await clickCta(page, "unified-health-badge");
    await expect(page.getByRole("dialog", { name: "Diagnostics" })).toBeVisible({ timeout: 10000 });
    const offer = page.getByTestId("use-simulated-device-action");
    await expect(offer).toBeVisible({ timeout: 10000 });
    await snap(page, testInfo, "connection-actions-offer");

    await clickCta(page, "use-simulated-device-action");
    await expectConnectionState(page, "DEMO_ACTIVE");

    await snap(page, testInfo, "connection-actions-demo-active");
  });
});

test.describe("The Demo Mode offer on a small screen", () => {
  let device: MockServer;
  let demo: MockServer;

  test.beforeEach(async () => {
    device = await createMockC64Server({});
    demo = await createMockC64Server({});
  });

  test.afterEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    try {
      await saveCoverageFromPage(page, testInfo.title);
      await assertNoUiIssues(page, testInfo);
    } finally {
      if (!page.isClosed()) await finalizeEvidence(page, testInfo);
      await demo?.close?.().catch(() => undefined);
      await device?.close?.().catch(() => undefined);
    }
  });

  // The Callback 8020's 480x640 panel is 320x426.7 CSS pixels, the narrowest screen this app
  // ships on. The offer is a dialog carrying a paragraph of prose, so it is exactly the shape of
  // thing that overflows there while looking fine on a phone.
  for (const viewport of [
    { name: "callback-480x640", width: 320, height: 427 },
    { name: "narrow-320x480", width: 320, height: 480 },
  ]) {
    test(`fits ${viewport.name} without horizontal overflow`, async ({ page }: { page: Page }, testInfo: TestInfo) => {
      await startStrictUiMonitoring(page, testInfo);
      allowWarnings(testInfo, "Reads in flight when Demo Mode re-routes the API are aborted by design.");
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      await seedHandset(page, {
        deviceHost: new URL(device.baseUrl).host,
        deviceBaseUrl: device.baseUrl,
        demoBaseUrl: demo.baseUrl,
        networkStatus: { online: false, supported: true },
      });
      await page.goto("/", { waitUntil: "domcontentloaded" });

      const dialog = demoDialog(page);
      await expect(dialog).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId("demo-interstitial-message")).toBeVisible();
      await expect(page.getByTestId("demo-interstitial-continue")).toBeVisible();

      const overflow = await page.evaluate(() => ({
        doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        body: document.body.scrollWidth - document.body.clientWidth,
      }));
      expect(overflow.doc, `${viewport.name}: document overflows horizontally`).toBeLessThanOrEqual(1);
      expect(overflow.body, `${viewport.name}: body overflows horizontally`).toBeLessThanOrEqual(1);

      const dialogBox = await dialog.boundingBox();
      expect(dialogBox, "the dialog has no box").not.toBeNull();
      expect(dialogBox!.x, `${viewport.name}: the dialog starts off the left edge`).toBeGreaterThanOrEqual(-1);
      expect(
        dialogBox!.x + dialogBox!.width,
        `${viewport.name}: the dialog runs past the right edge`,
      ).toBeLessThanOrEqual(viewport.width + 1);

      await snap(page, testInfo, `offer-${viewport.name}`);
    });
  }
});

test.describe("Demo Mode CTA parity", () => {
  let device: MockServer;
  let demo: MockServer;

  test.beforeEach(async () => {
    device = await createMockC64Server({});
    demo = await createMockC64Server({});
  });

  test.afterEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    try {
      await saveCoverageFromPage(page, testInfo.title);
      await assertNoUiIssues(page, testInfo);
    } finally {
      if (!page.isClosed()) await finalizeEvidence(page, testInfo);
      await demo?.close?.().catch(() => undefined);
      await device?.close?.().catch(() => undefined);
    }
  });

  test("every control offered against a real device is offered in Demo Mode", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    test.slow();
    await startStrictUiMonitoring(page, testInfo);
    allowWarnings(
      testInfo,
      "The configured device is deliberately unreachable in the Demo Mode half, and reads in flight when Demo Mode re-routes the API are aborted by design.",
    );

    // Both halves talk to an identical mock C64U, so any control that appears in one and not the
    // other is the app treating Demo Mode differently — not the two devices differing. A hard-coded
    // list of expected controls would go stale on the next feature; this comparison cannot.
    await seedHandset(page, {
      deviceHost: new URL(device.baseUrl).host,
      deviceBaseUrl: device.baseUrl,
      demoBaseUrl: demo.baseUrl,
      networkStatus: { online: true, supported: true },
    });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expectConnectionState(page, "REAL_CONNECTED");
    const connected = await collectCtasPerRoute(page, { state: "REAL_CONNECTED" });

    device.setReachable(false);
    await page.evaluate(() => {
      sessionStorage.removeItem("c64u_demo_interstitial_shown");
    });
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const dialog = demoDialog(page);
    await expect(dialog).toBeVisible({ timeout: 20000 });
    await clickCta(page, "demo-interstitial-continue");
    await expect(dialog).toBeHidden({ timeout: 10000 });
    await expectConnectionState(page, "DEMO_ACTIVE");
    const inDemo = await collectCtasPerRoute(page, { state: "DEMO_ACTIVE", expected: connected });

    // The one control that is meant to disappear: it is the way IN to Demo Mode, so it hides once
    // you are there. Asserted below rather than only excluded, so the exception stays a checked
    // property instead of a hole in the comparison.
    expect(connected["/settings"], "the entry point should be offered against a real device").toContain(
      "settings-preview-demo-mode",
    );
    expect(inDemo["/settings"], "the entry point should be gone once Demo Mode is active").not.toContain(
      "settings-preview-demo-mode",
    );

    const missing: Record<string, string[]> = {};
    for (const route of MAIN_ROUTES) {
      const absent = connected[route].filter(
        (testId) => testId !== "settings-preview-demo-mode" && !inDemo[route].includes(testId),
      );
      if (absent.length > 0) missing[route] = absent;
    }

    expect(
      missing,
      `Controls present against a real device but missing in Demo Mode: ${JSON.stringify(missing, null, 2)}`,
    ).toEqual({});

    for (const route of MAIN_ROUTES) {
      expect(inDemo[route].length, `${route} rendered no controls in Demo Mode`).toBeGreaterThan(0);
    }

    await snap(page, testInfo, "demo-cta-parity");
  });
});
