/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Every Quick Action tile draws its label whole, at every profile, width and Text size.
 *
 * A tile label is one word with `break-normal`, so a word wider than its track cannot wrap out of
 * it — it is cut. `searchOverlay.spec.ts` already checks this, but only for the four promoted
 * tiles, and only on the compact profile at 320px at the largest Text size. The tightest track in
 * the app is somewhere else entirely: the MEDIUM profile at 393px draws four tracks of 69.6px,
 * which leaves the label 65.6px. Nothing measured that, and two labels shipped cut there —
 * "Resume" needed 61.4px against the 58.6px the tile gave before its horizontal padding was
 * trimmed, and "Manage" on the Config card needed 61.7px.
 *
 * This sweeps the profile x width x Text size matrix and measures every action tile on Home,
 * Quick Actions and Config actions alike. It runs with the machine paused for one configuration,
 * because "Resume" only exists in that state and is the longest label the Pause tile can take.
 */
import { expect, test, type Page } from "@playwright/test";
import { createMockC64Server } from "../tests/mocks/mockC64Server";
import { seedUiMocks } from "./uiMocks";
import { disableTraceAssertions } from "./traceUtils";

const FLAGS = [
  "ram_snapshots_enabled",
  "remote_input_enabled",
  "audio_mirror_enabled",
  "video_mirror_enabled",
  "c64u_sid_radio_enabled",
  "home_telnet_config_actions_enabled",
];

/** The profile, width and Text size combinations that produce a different track width. */
const MATRIX = [
  { profile: "compact", width: 320 },
  { profile: "compact", width: 393 },
  { profile: "medium", width: 320 },
  { profile: "medium", width: 360 },
  { profile: "medium", width: 393 },
] as const;

type ClippedLabel = { grid: string; label: string; needs: number; has: number };
type LabelSweep = { clipped: ClippedLabel[]; grids: string[]; spans: number; tiles: number };

/*
 * The sweep reports what it inspected as well as what it found. Asserting only that
 * `clipped` is empty passes when the selector matches nothing, so renaming the
 * `quick-action` class would have removed all eleven of these layout cases with no
 * red check anywhere.
 */
const sweepTileLabels = (page: Page) =>
  page.evaluate((): LabelSweep => {
    const clipped: ClippedLabel[] = [];
    const grids = new Set<string>();
    let tiles = 0;
    let spans = 0;
    for (const tile of document.querySelectorAll<HTMLElement>("button.quick-action")) {
      const grid = tile.closest("[data-testid]")?.getAttribute("data-testid") ?? "unknown";
      tiles += 1;
      grids.add(grid);
      for (const span of tile.querySelectorAll<HTMLElement>("span")) {
        spans += 1;
        if (span.scrollWidth - span.clientWidth <= 1 && span.scrollHeight - span.clientHeight <= 1) continue;
        clipped.push({
          grid,
          label: (span.textContent ?? "").trim(),
          needs: Math.round(span.scrollWidth),
          has: Math.round(span.clientWidth),
        });
      }
    }
    return { clipped, grids: [...grids].sort(), spans, tiles };
  });

/*
 * Every case below must inspect at least this much, or it measured nothing. The
 * thinnest case today inspects 12 tiles across 2 grids, so a case that opened no
 * Config actions section, or found no tile at all, fails here instead of passing.
 */
const MIN_TILES = 8;
const MIN_SPANS = 8;
const MIN_GRIDS = 2;

const expectNoClippedLabel = (sweep: LabelSweep, label: string) => {
  expect(sweep.tiles, `${label}: the tile sweep found no quick-action button`).toBeGreaterThanOrEqual(MIN_TILES);
  expect(sweep.spans, `${label}: the tile sweep found no label span`).toBeGreaterThanOrEqual(MIN_SPANS);
  expect(
    sweep.grids.length,
    `${label}: the tile sweep covered only ${sweep.grids.join(", ") || "no grid"}`,
  ).toBeGreaterThanOrEqual(MIN_GRIDS);
  expect(
    sweep.clipped,
    `${label}: inspected ${sweep.tiles} tiles in ${sweep.grids.join(", ")}\n` +
      sweep.clipped.map((c) => `${c.grid}: "${c.label}" needs ${c.needs}px, has ${c.has}px`).join("\n"),
  ).toEqual([]);
};

const openHomeSection = async (page: Page, id: string) => {
  const toggle = page.getByTestId(`home-section-toggle-${id}`);
  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.scrollIntoViewIfNeeded();
    await toggle.click();
  }
};

test.describe("Action tile labels are drawn whole", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }, testInfo) => {
    disableTraceAssertions(testInfo, "Layout-only coverage; trace assertions disabled.");
    server = await createMockC64Server();
    void page;
  });

  test.afterEach(async () => {
    await server.close();
  });

  for (const { profile, width } of MATRIX) {
    for (const scale of ["default", "large"] as const) {
      test(`${profile} profile at ${width}px, ${scale} text @layout`, async ({ page }) => {
        await seedUiMocks(page, server.baseUrl);
        await page.addInitScript(
          ({ profile, scale, flags }) => {
            localStorage.setItem("c64u_display_profile_override", profile);
            localStorage.setItem("c64u_text_scale", scale);
            localStorage.setItem("c64u_dev_mode_enabled", "1");
            for (const flag of flags) localStorage.setItem(`c64u_feature_flag:${flag}`, "1");
          },
          { profile, scale, flags: FLAGS },
        );
        await page.setViewportSize({ width, height: 800 });
        await page.goto("/", { waitUntil: "domcontentloaded" });
        await page.getByTestId("home-machine-controls").waitFor({ timeout: 30_000 });
        // Config actions is a closed card, so its tiles are not in the DOM until it is opened.
        await openHomeSection(page, "config-actions");
        await page.waitForTimeout(400);

        expectNoClippedLabel(await sweepTileLabels(page), `${profile} at ${width}px, ${scale} text`);
      });
    }
  }

  /*
   * The cartridge case, which nothing here covered and which shipped broken.
   *
   * An Ultimate II+L reports no `core_version`, so `supportsStreaming` is false and Home greys the
   * Live tile and prints the reason under it. That reason used to be the full sentence "This model
   * cannot stream picture or sound" — 41 characters in a tile about 68 px wide. It wrapped to six
   * lines of one word each, and because a grid row is as tall as its tallest tile, the whole top
   * row of Quick Actions measured 204 px on a cartridge against 91 px on a C64 Ultimate.
   *
   * The sweep above would not have caught it: wrapped text is not clipped text. The row height is,
   * so it is what this measures. 140 px is above the 114 px the fixed short caption produces at
   * this profile and width, and far below the 204 px the defect produced.
   */
  test("a device that cannot stream does not stretch the Quick Actions row @layout", async ({ page }) => {
    // No `core_version` and no "Data Streams" category is what a real Ultimate-II+L answers, and
    // between them they are what `deriveDeviceCapabilities` reads to decide the device does not
    // stream. The config signal is the more precise of the two and overrides the other, so both are
    // needed: dropping `core_version` alone left the Live tile enabled.
    const cartridge = await createMockC64Server(
      {},
      {},
      {
        deviceInfo: { product: "Ultimate II+L", core_version: null },
        omitConfigCategories: ["Data Streams"],
      },
    );
    try {
      await seedUiMocks(page, cartridge.baseUrl);
      await page.addInitScript((flags: string[]) => {
        localStorage.setItem("c64u_display_profile_override", "medium");
        for (const flag of flags) localStorage.setItem(`c64u_feature_flag:${flag}`, "1");
      }, FLAGS);
      // The tightest track in the app: four columns of 69.6px.
      await page.setViewportSize({ width: 393, height: 800 });
      await page.goto("/", { waitUntil: "domcontentloaded" });
      const machineControls = page.getByTestId("home-machine-controls");
      await machineControls.waitFor({ timeout: 30_000 });

      const live = page.getByTestId("home-tile-home.section.live-view");
      await expect(live).toBeDisabled();

      // The height first, because it is what this case is named for: with the long reason restored
      // the caption assertion below also fails, and a run that stopped there would not have said
      // what the defect was.
      const tallest = await machineControls.evaluate((grid) =>
        Math.max(
          ...[...grid.querySelectorAll<HTMLElement>("button.quick-action")].map(
            (tile) => tile.getBoundingClientRect().height,
          ),
        ),
      );
      expect(tallest, `tallest Quick Actions tile on a cartridge: ${Math.round(tallest)}px`).toBeLessThan(140);

      await expect(live).toHaveText(/No streaming/);
      expectNoClippedLabel(await sweepTileLabels(page), "cartridge at 393px");
    } finally {
      await cartridge.close();
    }
  });

  test('the paused Pause tile reads "Resume" without clipping it @layout', async ({ page }) => {
    await seedUiMocks(page, server.baseUrl);
    await page.addInitScript((flags: string[]) => {
      localStorage.setItem("c64u_display_profile_override", "medium");
      for (const flag of flags) localStorage.setItem(`c64u_feature_flag:${flag}`, "1");
    }, FLAGS);
    // The tightest track in the app: four columns of 69.6px.
    await page.setViewportSize({ width: 393, height: 800 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const machineControls = page.getByTestId("home-machine-controls");
    await machineControls.waitFor({ timeout: 30_000 });

    await machineControls.getByRole("button", { name: "Pause", exact: true }).click();
    await expect(machineControls.getByRole("button", { name: "Resume", exact: true })).toBeVisible({
      timeout: 15_000,
    });

    expectNoClippedLabel(await sweepTileLabels(page), "paused Pause tile");
  });
});
