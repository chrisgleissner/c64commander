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

const findClippedLabels = (page: Page) =>
  page.evaluate((): ClippedLabel[] => {
    const clipped: ClippedLabel[] = [];
    for (const tile of document.querySelectorAll<HTMLElement>("button.quick-action")) {
      const grid = tile.closest("[data-testid]")?.getAttribute("data-testid") ?? "unknown";
      for (const span of tile.querySelectorAll<HTMLElement>("span")) {
        if (span.scrollWidth - span.clientWidth <= 1 && span.scrollHeight - span.clientHeight <= 1) continue;
        clipped.push({
          grid,
          label: (span.textContent ?? "").trim(),
          needs: Math.round(span.scrollWidth),
          has: Math.round(span.clientWidth),
        });
      }
    }
    return clipped;
  });

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

        const clipped = await findClippedLabels(page);
        expect(
          clipped,
          clipped.map((c) => `${c.grid}: "${c.label}" needs ${c.needs}px, has ${c.has}px`).join("\n"),
        ).toEqual([]);
      });
    }
  }

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

    const clipped = await findClippedLabels(page);
    expect(
      clipped,
      clipped.map((c) => `${c.grid}: "${c.label}" needs ${c.needs}px, has ${c.has}px`).join("\n"),
    ).toEqual([]);
  });
});
