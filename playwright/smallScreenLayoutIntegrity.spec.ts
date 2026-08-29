/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { test, expect, type Locator, type Page } from "@playwright/test";
import { createMockC64Server } from "../tests/mocks/mockC64Server";
import { seedUiMocks } from "./uiMocks";
import { disableTraceAssertions } from "./traceUtils";
import { DISPLAY_PROFILE_VIEWPORTS } from "./displayProfileViewports";
import { applyDisplayProfileViewport } from "./displayProfileViewportUtils";
import { TAB_ROUTES } from "../src/lib/navigation/tabRoutes";
import { LARGEST_TEXT_SCALE_ID } from "../src/lib/textScale";
import { auditSmallScreenLayout, formatDefects, type LayoutDefect } from "./smallScreenLayoutAudit";

/**
 * Does the text still fit at 320 CSS pixels?
 *
 * `smallScreenErgonomics.spec.ts` measures the *cause*: how large the type is and how
 * large the controls are. It cannot see the *consequence* of enlarging the type, which
 * is that the same words in the same box stop fitting it. That is why it stayed green
 * through a set of layout defects that were plainly visible on the device: a label
 * clipped at the screen edge, two labels drawn on top of each other, and words cut in
 * half across a line break.
 *
 * The two specs are complements. The ergonomics spec stops type being shrunk to make
 * something fit. This one stops type being enlarged without being given room. Between
 * them the only remaining answer to "it does not fit" is to reflow, shorten or scroll.
 *
 * Everything measured here comes from the rendered page - element boxes, text run
 * rectangles and line boxes - rather than from the stylesheet, so a defect reported
 * here is one a user would see.
 *
 * Runs on the default appearance style only; see appearanceGeometryInvariance.spec.ts, which proves
 * switching style changes zero geometry so this coverage holds for all twelve generated palettes.
 */

const compactViewport = DISPLAY_PROFILE_VIEWPORTS.compact.viewport;

/**
 * Surfaces that are deliberately larger than the viewport.
 *
 * The emulator picture is a fixed 384x272 raster that the user pans and zooms, so
 * "wider than 320px" is what it is for. Nothing else is excluded.
 */
const IGNORED_SURFACES = ["[data-testid=av-mirror-immersive]", "[data-testid=av-mirror-canvas]"];

const settle = async (page: Page) => {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForFunction(() => document.documentElement.dataset.displayProfile === "compact");
  // The tab bar only exists once the launch sequence has handed over to a real page.
  // Without this the measurement can land on the startup screen and report that
  // everything is fine because almost nothing is on screen yet.
  await page.locator("nav.tab-bar").first().waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(600);
};

/**
 * Opens every collapsed section on the current surface.
 *
 * Most of this app's content starts folded away, so measuring the pages as they load
 * measures perhaps a third of the text in them. Disclosure buttons are found by
 * `aria-expanded="false"`; select triggers and menu buttons carry the same attribute
 * and are excluded by their `role` and `aria-haspopup`, because opening those is a
 * different interaction with a different surface.
 */
const expandAllSections = async (root: Locator, page: Page) => {
  const collapsed = root.locator('button[aria-expanded="false"]:not([role="combobox"]):not([aria-haspopup])');
  for (let step = 0; step < 40; step += 1) {
    const next = collapsed.first();
    if ((await collapsed.count()) === 0) break;
    if (!(await next.isVisible().catch(() => false))) break;
    await next.click({ timeout: 5000 }).catch(() => undefined);
    await page.waitForTimeout(150);
  }
  // Let the disclosure animations finish before anything is measured.
  await page.waitForTimeout(700);
};

const auditAndAssert = async (page: Page, where: string) => {
  const defects: LayoutDefect[] = await auditSmallScreenLayout(page, { ignore: IGNORED_SURFACES });
  expect(defects, formatDefects(where, defects)).toEqual([]);
};

/**
 * Puts content on the list pages.
 *
 * An empty Play or Disks page is one empty-state sentence, which measures almost
 * nothing. The seeded names are long on purpose: a file name that has to be shortened
 * is where this kind of defect shows up first.
 */
const seedListContent = async (page: Page) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "c64u_playlist:v1:TEST-123",
      JSON.stringify({
        items: [
          {
            source: "ultimate",
            path: "/Usb0/Demos/Commodore_Sixty_Four_Anniversary_Megademo_Part_One.sid",
            name: "Commodore_Sixty_Four_Anniversary_Megademo_Part_One.sid",
            durationMs: 214_000,
            songNr: 1,
            sourceId: null,
          },
          {
            source: "ultimate",
            path: "/Usb0/Music/Short.sid",
            name: "Short.sid",
            durationMs: 61_000,
            songNr: 1,
            sourceId: null,
          },
        ],
        currentIndex: 0,
      }),
    );
    localStorage.setItem(
      "c64u_disk_library:TEST-123",
      JSON.stringify({
        disks: [
          {
            id: "local:/Games/Another-Very-Long-Disk-Name-For-Layout-Measurement.d64",
            name: "Another-Very-Long-Disk-Name-For-Layout-Measurement.d64",
            path: "/Games/Another-Very-Long-Disk-Name-For-Layout-Measurement.d64",
            location: "local",
            group: "Group-With-An-Extra-Long-Name",
            importOrder: 1,
            importedAt: new Date().toISOString(),
            sizeBytes: 174_848,
            modifiedAt: new Date().toISOString(),
          },
          {
            id: "ultimate:/Usb0/Disks/Short.d64",
            name: "Short.d64",
            path: "/Usb0/Disks/Short.d64",
            location: "ultimate",
            group: null,
            importOrder: 2,
            importedAt: new Date().toISOString(),
            sizeBytes: 174_848,
            modifiedAt: new Date().toISOString(),
          },
        ],
      }),
    );
  });
};

const setup = async (page: Page, baseUrl: string, options: { developerMode?: boolean; textScale?: string } = {}) => {
  await seedUiMocks(page, baseUrl);
  await page.addInitScript(
    ({ developerMode, textScale }) => {
      localStorage.setItem("c64u_display_profile_override", "compact");
      localStorage.setItem("c64u_text_scale", textScale);
      if (developerMode) localStorage.setItem("c64u_dev_mode_enabled", "1");
    },
    { developerMode: options.developerMode ?? false, textScale: options.textScale ?? "default" },
  );
  await seedListContent(page);
  await page.setViewportSize(compactViewport);
};

test.describe("Small screen layout integrity", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }, testInfo) => {
    disableTraceAssertions(testInfo, "Layout-only coverage; trace assertions disabled.");
    server = await createMockC64Server();
    void page;
  });

  test.afterEach(async () => {
    await server.close();
  });

  for (const route of TAB_ROUTES) {
    test(`${route.label} text fits the smallest supported screen @layout`, async ({ page }) => {
      await setup(page, server.baseUrl);
      await page.goto(route.path, { waitUntil: "domcontentloaded" });
      await settle(page);
      await auditAndAssert(page, `${route.label} (as it loads)`);

      await expandAllSections(page.locator('[data-slot-active="true"]'), page);
      await auditAndAssert(page, `${route.label} (every section open)`);
    });

    /**
     * The same 320px screen with the app's own Text size turned up as far as it goes. That
     * combination is a real one — the setting exists precisely for a small screen — and it is
     * where this kind of defect appears first: a label that fits at the default size stops
     * fitting, and `overflow-wrap: anywhere` in `index.css` then splits it mid-word rather than
     * letting it run over. The size comes from LARGEST_TEXT_SCALE_ID rather than being written
     * out, so this measures whatever the app currently offers as its maximum.
     */
    test(`${route.label} text fits the smallest supported screen at the largest text size @layout`, async ({
      page,
    }) => {
      await setup(page, server.baseUrl, { textScale: LARGEST_TEXT_SCALE_ID });
      await page.goto(route.path, { waitUntil: "domcontentloaded" });
      await settle(page);
      await auditAndAssert(page, `${route.label} at the largest text size (as it loads)`);

      await expandAllSections(page.locator('[data-slot-active="true"]'), page);
      await auditAndAssert(page, `${route.label} at the largest text size (every section open)`);
    });

    test(`${route.label} text fits the smallest supported screen in developer mode @layout`, async ({ page }) => {
      await setup(page, server.baseUrl, { developerMode: true });
      await page.goto(route.path, { waitUntil: "domcontentloaded" });
      await settle(page);
      await expandAllSections(page.locator('[data-slot-active="true"]'), page);
      await auditAndAssert(page, `${route.label} in developer mode (every section open)`);
    });
  }

  /**
   * The page title's descenders.
   *
   * The compact profile pins the header's line-height, and the title is line-clamped, so its box
   * is a whole number of line boxes and anything outside them is cut. At a 1.1 ratio the line box
   * was 26px against the 28px the font draws, which took the tail off the "y" in "Play files" at
   * every text size. Two pixels is below what the page audit reports, so it is measured here
   * against the text's own rectangle.
   */
  for (const scaleId of ["default", LARGEST_TEXT_SCALE_ID]) {
    test(`the page title is drawn whole at the ${scaleId} text size @layout`, async ({ page }) => {
      await setup(page, server.baseUrl, { textScale: scaleId });

      for (const route of TAB_ROUTES) {
        await page.goto(route.path, { waitUntil: "domcontentloaded" });
        await settle(page);
        const title = page.locator("header .c64-header").first();
        await expect(title).toBeVisible();
        const fits = await title.evaluate((el) => {
          const range = document.createRange();
          range.selectNodeContents(el);
          return { text: range.getBoundingClientRect().height, box: el.clientHeight };
        });
        expect(
          fits.box,
          `${route.label}: the title box is ${fits.box}px and its text draws ${fits.text}px`,
        ).toBeGreaterThanOrEqual(Math.ceil(fits.text));
      }
    });
  }

  /**
   * The tab labels are `rem`-sized, so the app's own Text size setting (a pure CSS variable,
   * unlike device font scale this harness can't simulate) grows them too. A fixed-width bar once
   * pushed Settings and Docs off-screen with no way back (HARD25-002).
   *
   * The bar is not required to overflow. The offered sizes are capped at what the layout can draw
   * whole, so at 320px all six may well fit; what is required is that every tab can be reached,
   * which means the bar must scroll if and only if it overflows.
   */
  test("every tab stays reachable at the largest text size @layout", async ({ page }) => {
    await seedUiMocks(page, server.baseUrl);
    await page.addInitScript((scaleId: string) => {
      localStorage.setItem("c64u_display_profile_override", "compact");
      localStorage.setItem("c64u_text_scale", scaleId);
    }, LARGEST_TEXT_SCALE_ID);
    await page.setViewportSize(compactViewport);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await settle(page);

    const nav = page.locator("nav.tab-bar");
    const scrollWidth = await nav.evaluate((el) => el.scrollWidth);
    const clientWidth = await nav.evaluate((el) => el.clientWidth);
    if (scrollWidth > clientWidth) {
      const overflowX = await nav.evaluate((el) => getComputedStyle(el).overflowX);
      expect(["auto", "scroll"]).toContain(overflowX);
    }

    for (const route of TAB_ROUTES) {
      const tabId = `tab-${route.label.toLowerCase().replace(/\s+/g, "-")}`;
      const tab = page.getByTestId(tabId);
      await tab.scrollIntoViewIfNeeded();
      const reachable = await tab.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const cx = r.x + r.width / 2;
        const cy = r.y + r.height / 2;
        const top = document.elementFromPoint(cx, cy);
        return !!top && (el.contains(top) || top.contains(el));
      });
      expect(reachable, `${route.label} tab must be reachable after scrolling the tab bar into view`).toBe(true);
    }
  });

  /**
   * Dialogs, sheets and interstitials, which the page sweeps above cannot reach.
   *
   * Radix marks everything behind an open dialog `aria-hidden`, and the audit skips
   * hidden surfaces, so with a dialog open it is the dialog that gets measured.
   */
  const DIALOGS: ReadonlyArray<{ name: string; route: string; open: (page: Page) => Promise<void> }> = [
    {
      name: "Home / Backup",
      route: "/",
      open: async (page) => {
        await page.locator('[data-slot-active="true"]').getByTestId("home-save-ram").click();
      },
    },
    {
      name: "Home / Restore snapshot",
      route: "/",
      open: async (page) => {
        await page.locator('[data-slot-active="true"]').getByTestId("home-load-ram").click();
      },
    },
    {
      name: "Home / Device health",
      route: "/",
      open: async (page) => {
        await page.locator('[data-slot-active="true"]').getByTestId("unified-health-badge").click();
      },
    },
    {
      name: "Home / Remote input",
      route: "/",
      open: async (page) => {
        await page.locator('[data-slot-active="true"]').getByTestId("home-machine-inline-openRemoteInput").click();
      },
    },
    {
      name: "Play / Add items",
      route: "/play",
      open: async (page) => {
        await page
          .locator('[data-slot-active="true"]')
          .getByRole("button", { name: /Add items|Add more items/i })
          .first()
          .click();
      },
    },
    {
      name: "Disks / Add disks",
      route: "/disks",
      open: async (page) => {
        await page
          .locator('[data-slot-active="true"]')
          .getByRole("button", { name: /Add (more )?disks/i })
          .first()
          .click();
      },
    },
    {
      name: "Disks / New disk",
      route: "/disks",
      open: async (page) => {
        await page.locator('[data-slot-active="true"]').getByTestId("new-disk-open").click();
      },
    },
    {
      name: "Settings / Diagnostics",
      route: "/settings",
      open: async (page) => {
        await page.getByRole("button", { name: "Diagnostics", exact: true }).first().click();
      },
    },
  ];

  for (const dialog of DIALOGS) {
    test(`${dialog.name} fits the smallest supported screen @layout`, async ({ page }) => {
      await setup(page, server.baseUrl, { developerMode: true });
      await page.goto(dialog.route, { waitUntil: "domcontentloaded" });
      await settle(page);
      await dialog.open(page);

      const surface = page.locator('[role="dialog"], [data-testid="remote-input-sheet"]').first();
      await expect(surface).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(700);

      await auditAndAssert(page, `${dialog.name} (as it opens)`);
      await expandAllSections(surface, page);
      await auditAndAssert(page, `${dialog.name} (every section open)`);
    });
  }

  /**
   * The Live View stats, which only render once frames are actually flowing.
   *
   * The stub below is the same one the screenshot suite uses: colour-bar frames in the
   * app's own packet format go through the real receiver, controller and decoder, so
   * the stats row is populated with genuine values and is laid out with the widths
   * those values produce.
   */
  test("Live View stats fit the smallest supported screen @layout", async ({ page }) => {
    await setup(page, server.baseUrl, { developerMode: true });
    await page.addInitScript(() => {
      for (const flag of ["audio_mirror_enabled", "video_mirror_enabled"]) {
        localStorage.setItem(`c64u_feature_flag:${flag}`, "1");
        sessionStorage.setItem(`c64u_feature_flag:${flag}`, "1");
      }
      const RealWebSocket = window.WebSocket;
      const HDR = 12;
      const BYTES_PER_LINE = 192;
      const LINES_PER_PKT = 4;
      const WIDTH = 384;
      const HEIGHT = 272;
      const packets: ArrayBuffer[] = [];
      const total = HEIGHT / LINES_PER_PKT;
      for (let i = 0; i < total; i++) {
        const line = i * LINES_PER_PKT;
        const buf = new ArrayBuffer(HDR + LINES_PER_PKT * BYTES_PER_LINE);
        const dv = new DataView(buf);
        const u8 = new Uint8Array(buf);
        dv.setUint16(0, i, true);
        dv.setUint16(4, (line & 0x7fff) | (i === total - 1 ? 0x8000 : 0), true);
        dv.setUint16(6, WIDTH, true);
        u8[8] = LINES_PER_PKT;
        u8[9] = 4;
        for (let k = 0; k < LINES_PER_PKT; k++) {
          const color = Math.floor((line + k) / (HEIGHT / 16)) & 0x0f;
          u8.fill(color | (color << 4), HDR + k * BYTES_PER_LINE, HDR + (k + 1) * BYTES_PER_LINE);
        }
        packets.push(buf);
      }
      class StubStreamWebSocket {
        url: string;
        binaryType = "blob";
        readyState = 0;
        onopen: ((e?: unknown) => void) | null = null;
        onmessage: ((e: { data: unknown }) => void) | null = null;
        onclose: ((e?: unknown) => void) | null = null;
        onerror: ((e?: unknown) => void) | null = null;
        private closed = false;
        constructor(url: string) {
          this.url = String(url);
          if (!this.url.includes("/streams/")) return new RealWebSocket(url) as unknown as StubStreamWebSocket;
          const isVideo = this.url.endsWith("/streams/video");
          setTimeout(() => {
            this.readyState = 1;
            this.onopen?.({});
            if (!isVideo) return;
            let n = 0;
            const tick = () => {
              if (this.closed || n > 900) return;
              for (const p of packets) this.onmessage?.({ data: p.slice(0) });
              n += 1;
              setTimeout(tick, 33);
            };
            tick();
          }, 15);
        }
        send() {}
        close() {
          this.closed = true;
          this.readyState = 3;
          this.onclose?.({});
        }
      }
      window.WebSocket = StubStreamWebSocket as unknown as typeof WebSocket;
    });
    await page.route("**/v1/streams/**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ errors: [] }) }),
    );

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await settle(page);

    const liveView = page.locator('[data-slot-active="true"]').getByTestId("live-view-card");
    await expect(liveView).toBeVisible({ timeout: 15_000 });
    await liveView.scrollIntoViewIfNeeded();
    // Live View is closed on a first visit: mirroring is turned on deliberately, and the card
    // carries a preview, the stream statistics and the A/V measurement tools under it.
    const liveViewToggle = liveView.getByTestId("home-section-toggle-live-view");
    if ((await liveViewToggle.getAttribute("aria-expanded")) !== "true") await liveViewToggle.click();
    await liveView.getByTestId("av-video-toggle").click();
    await expect(liveView.getByTestId("stream-stats")).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(800);

    await auditAndAssert(page, "Live View stats (compact summary)");

    // The detailed view, which carries the widest labels in the panel.
    await liveView.getByTestId("stream-stats-toggle").click();
    await page.waitForTimeout(500);
    await auditAndAssert(page, "Live View stats (detailed view)");

    // The stats grid is the one surface in the app that gets *tighter* as the screen gets
    // wider: the compact profile gives it two columns, the medium profile four. At 393px
    // that leaves each label a 48px box, where "UNDERRUNS" needed 104px and spilled out of
    // the card. Every other test in this file is pinned to 320px, so nothing measured the
    // width where the panel is actually at its narrowest per column.
    for (const profileId of ["medium", "expanded"] as const) {
      await applyDisplayProfileViewport(page, profileId);
      await page.waitForTimeout(500);
      await auditAndAssert(page, `Live View stats (detailed view, ${profileId} profile)`);
    }
  });
});
