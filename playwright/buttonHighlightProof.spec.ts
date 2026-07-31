import { expect, test, type Locator, type Page } from "@playwright/test";
import { CTA_HIGHLIGHT_MIN_EXPECTED_MS } from "../src/lib/ui/buttonInteraction";
import { createMockC64Server } from "../tests/mocks/mockC64Server";
import { seedUiMocks } from "./uiMocks";
import { saveCoverageFromPage } from "./withCoverage";

const FLASH_ATTR = "data-c64-tap-flash";
const PERSISTENT_ATTR = "data-c64-persistent-active";
const dismissDemoInterstitial = async (page: Page) => {
  const continueDemo = page.getByRole("button", {
    name: "Continue in Demo Mode",
  });
  if (await continueDemo.isVisible().catch(() => false)) {
    await continueDemo.click();
  }
};

const seedPlaylistStorage = async (
  page: Page,
  items: Array<{
    source: "ultimate" | "local" | "hvsc";
    path: string;
    name: string;
    durationMs?: number;
    sourceId?: string | null;
  }>,
) => {
  await page.addInitScript(
    ({ seedItems }) => {
      const payload = {
        items: seedItems,
        currentIndex: -1,
      };
      localStorage.setItem("c64u_playlist:v1:TEST-123", JSON.stringify(payload));
      localStorage.setItem("c64u_playlist:v1:default", JSON.stringify(payload));
      localStorage.setItem("c64u_last_device_id", "TEST-123");
    },
    { seedItems: items },
  );
};

const measureFlashDuration = async (target: Locator, trigger: () => Promise<void>) => {
  const durationPromise = target.evaluate((element, attr) => {
    return new Promise<number | null>((resolve) => {
      const setAtAttr = `${attr}-set-at`;
      let startedAt: number | null = null;
      let deadlineTimer: number | null = null;

      const finish = (value: number | null) => {
        if (deadlineTimer !== null) {
          window.clearTimeout(deadlineTimer);
        }
        resolve(value);
      };

      const poll = () => {
        const active = element.getAttribute(attr) === "true";
        if (active) {
          if (startedAt === null) {
            startedAt = Number(element.getAttribute(setAtAttr) ?? "0") || Date.now();
          }
          window.requestAnimationFrame(poll);
          return;
        }
        if (startedAt !== null) {
          finish(Date.now() - startedAt);
          return;
        }
        window.requestAnimationFrame(poll);
      };

      deadlineTimer = window.setTimeout(() => {
        finish(startedAt === null ? null : Date.now() - startedAt);
      }, 2000);

      poll();
    });
  }, FLASH_ATTR);

  await trigger();
  return durationPromise;
};

test.describe("CTA highlight proof", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }) => {
    server = await createMockC64Server({});
    await seedUiMocks(page, server.baseUrl);
  });

  test.afterEach(async ({ page }, testInfo) => {
    try {
      await saveCoverageFromPage(page, testInfo.title);
    } finally {
      await server.close();
    }
  });

  test("standard button flash lasts about 150 ms", async ({ page }) => {
    await page.goto("/");
    await dismissDemoInterstitial(page);

    const target = page.locator('[data-panel-position="1"]').getByTestId("unified-health-badge");
    await expect(target).toBeVisible();

    const duration = await measureFlashDuration(target, () => target.click({ timeout: 60000 }));

    // Two claims, and deliberately no wall-clock ceiling.
    //
    // The lower bound is safe to assert from the outside: a starved machine can
    // only make the flash last *longer*, so a measurement below the floor means
    // the flash was genuinely too brief to see.
    //
    // An upper bound cannot be asserted this way. `measureFlashDuration` returns
    // the time from when the app set the attribute to when a `requestAnimationFrame`
    // poll observed it cleared, so it accumulates both the app's own timer and the
    // browser's scheduling delay. On a loaded CI runner this read 1834 ms for a
    // 150 ms flash while `locator.click` was itself timing out at 60 s — the number
    // was measuring the runner, not the app, and it turned a dependency-bump PR red
    // for a day (PR #330).
    //
    // Nothing is lost by dropping it. That the flash ends after exactly
    // CTA_HIGHLIGHT_DURATION_MS is proven deterministically with fake timers in
    // `tests/unit/lib/ui/buttonInteraction.test.ts` ("removes tap-flash attribute
    // after the highlight duration"), and that it does not stick is asserted on the
    // next line and again in the "rapid repeated taps" test below.
    expect(duration).not.toBeNull();
    expect(duration ?? 0).toBeGreaterThanOrEqual(CTA_HIGHLIGHT_MIN_EXPECTED_MS);
    await expect(target).not.toHaveAttribute(FLASH_ATTR, "true");
  });

  test("rapid repeated taps do not leave highlight stuck", async ({ page }) => {
    await page.goto("/");
    await dismissDemoInterstitial(page);

    const target = page.getByTestId("tab-home");
    await expect(target).toBeVisible();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await target.click();
    }

    await expect.poll(() => target.getAttribute(FLASH_ATTR)).not.toBe("true");
  });

  test("navigation buttons still navigate without leaving highlight stuck", async ({ page }) => {
    await page.goto("/");
    await dismissDemoInterstitial(page);

    const disksTab = page.getByTestId("tab-disks");
    await expect(disksTab).toBeVisible();

    await disksTab.tap({ timeout: 60000 });
    await expect(page.locator("header").getByRole("heading", { name: "Disks" })).toBeVisible();
    await expect.poll(() => page.getByTestId("tab-disks").getAttribute(FLASH_ATTR)).not.toBe("true");
  });

  test("play-page change button clears retained pointer focus when the app regains focus", async ({ page }) => {
    await page.goto("/play");

    const changeButton = page.getByTestId("play-section-playback").getByRole("button", { name: "Change", exact: true });
    await expect(changeButton).toBeVisible();

    const state = await changeButton.evaluate((element, flashAttr) => {
      element.focus();

      const event = new Event("pointerup", { bubbles: true }) as PointerEvent;
      Object.defineProperty(event, "button", { value: -1 });
      Object.defineProperty(event, "pointerType", { value: "touch" });
      element.dispatchEvent(event);

      const focusedAfterPointer = document.activeElement === element;
      const flashAfterPointer = element.getAttribute(flashAttr);

      window.dispatchEvent(new Event("focus"));

      return {
        flashAfterPointer,
        focusedAfterPointer,
        focusedAfterResume: document.activeElement === element,
      };
    }, FLASH_ATTR);

    expect(state.focusedAfterPointer).toBe(true);
    expect(state.flashAfterPointer).toBe("true");
    expect(state.focusedAfterResume).toBe(false);

    await page.waitForTimeout(250);
    await expect(changeButton).not.toHaveAttribute(FLASH_ATTR, "true");
    await expect.poll(() => changeButton.evaluate((element) => document.activeElement === element)).toBe(false);
  });

  test("disabled controls do not trigger highlight", async ({ page }) => {
    await page.goto("/play");

    const previousButton = page.getByTestId("playlist-prev");
    await expect(previousButton).toBeDisabled();

    await previousButton.dispatchEvent("pointerup", { button: 0, pointerType: "touch" });
    await expect(previousButton).not.toHaveAttribute(FLASH_ATTR, "true");
  });

  test("play button stays highlighted for active playback and clears on stop", async ({ page }) => {
    await seedPlaylistStorage(page, [
      {
        source: "ultimate",
        path: "/Usb0/Demos/demo.sid",
        name: "demo.sid",
        durationMs: 8000,
      },
    ]);
    await page.goto("/play");

    const playButton = page.getByTestId("playlist-play");
    await expect(page.getByTestId("playlist-list")).toContainText("demo.sid");
    await expect(playButton).toHaveAttribute("aria-label", "Play");

    await playButton.click();
    await expect(playButton).toHaveAttribute("aria-label", "Stop");
    await expect(playButton).toHaveAttribute(PERSISTENT_ATTR, "true");
    await expect.poll(() => server.sidplayRequests.length).toBeGreaterThan(0);

    await page.waitForFunction(
      ([selector, attr]) => {
        const button = document.querySelector(selector);
        if (!(button instanceof HTMLElement)) return false;
        const active = button.getAttribute(attr) === "true";
        const statefulWindow = window as Window & { __c64uPersistentHighlightStart?: number };
        if (!active) {
          statefulWindow.__c64uPersistentHighlightStart = undefined;
          return false;
        }
        if (typeof statefulWindow.__c64uPersistentHighlightStart !== "number") {
          statefulWindow.__c64uPersistentHighlightStart = performance.now();
          return false;
        }
        return performance.now() - statefulWindow.__c64uPersistentHighlightStart >= 5000;
      },
      ['[data-testid="playlist-play"]', PERSISTENT_ATTR],
      { timeout: 7000 },
    );

    await playButton.click();
    await expect(playButton).toHaveAttribute("aria-label", "Play");
    await expect(playButton).not.toHaveAttribute(PERSISTENT_ATTR, "true");
    await expect(playButton).not.toHaveAttribute(FLASH_ATTR, "true");
  });
});
