/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Every piece of text the app draws has to be readable whole on the smallest screen.
 *
 * `smallScreenLayoutIntegrity` measures the six tabs and eight dialogs, and that is where
 * most text lives - but a surface it cannot reach is a surface nothing checks. The HVSC
 * buttons are the worked example: they sit behind the `hvsc_enabled` feature flag, the
 * layout spec runs with the default flags, so "Download HVSC" ran past the edge of its
 * button for as long as it existed without a single test noticing.
 *
 * This sweep turns every feature flag on, so the surfaces that only appear behind one are
 * drawn and measured too. It reuses the same audit as the layout spec rather than
 * measuring differently.
 */
import { expect, test } from "@playwright/test";
import { createMockC64Server } from "../tests/mocks/mockC64Server";
import { seedUiMocks } from "./uiMocks";
import { disableTraceAssertions } from "./traceUtils";
import { auditSmallScreenLayout, formatDefects, type LayoutDefect } from "./smallScreenLayoutAudit";

const ALL_FLAGS = [
  "hvsc_enabled",
  "commoserve_enabled",
  "ram_snapshots_enabled",
  "disk_explorer_enabled",
  "remote_input_enabled",
  "audio_mirror_enabled",
  "background_execution_enabled",
  "c64u_sid_radio_enabled",
  "c64u_sid_ranking_enabled",
  "c64u_local_engine_enabled",
  "c64u_auto_rotation_enabled",
  "home_telnet_config_actions_enabled",
  "home_telnet_drive_actions_enabled",
  "home_telnet_clear_ram_reboot_enabled",
];

const ROUTES = [
  { label: "Home", path: "/" },
  { label: "Play", path: "/play" },
  { label: "Disks", path: "/disks" },
  { label: "Config", path: "/config" },
  { label: "Settings", path: "/settings" },
  { label: "Docs", path: "/docs" },
];

test.describe("Compact text sweep with every feature switched on", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }, testInfo) => {
    disableTraceAssertions(testInfo, "Layout-only coverage; trace assertions disabled.");
    server = await createMockC64Server();
    void page;
  });

  test.afterEach(async () => {
    await server.close();
  });

  for (const route of ROUTES) {
    test(`${route.label} draws every label whole with all features on @layout`, async ({ page }) => {
      await seedUiMocks(page, server.baseUrl);
      await page.addInitScript(
        ({ flags }) => {
          localStorage.setItem("c64u_display_profile_override", "compact");
          localStorage.setItem("c64u_dev_mode_enabled", "1");
          for (const flag of flags) localStorage.setItem(`c64u_feature_flag:${flag}`, "1");
        },
        { flags: ALL_FLAGS },
      );
      await page.setViewportSize({ width: 320, height: 426 });
      await page.goto(route.path, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1500);

      // Open every disclosure this page has, so nothing is measured only while folded away.
      // Bounded: each click can reveal more toggles, and Home has enough of them that an
      // unbounded loop spends the whole test budget opening things.
      for (let round = 0; round < 3; round += 1) {
        const collapsed = await page.locator('[aria-expanded="false"]').all();
        if (collapsed.length === 0) break;
        for (const toggle of collapsed.slice(0, 20)) {
          await toggle.click({ timeout: 1000 }).catch(() => undefined);
        }
        await page.waitForTimeout(300);
      }
      await page.waitForTimeout(600);

      const defects: LayoutDefect[] = await auditSmallScreenLayout(page);
      expect(defects, formatDefects(`${route.label} with every feature on`, defects)).toEqual([]);
    });
  }
});
