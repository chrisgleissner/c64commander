/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { test, expect, type Locator, type Page } from "@playwright/test";
import { createMockC64Server } from "../tests/mocks/mockC64Server";
import { createMockArchiveServer } from "./mockArchiveServer";
import { seedUiMocks } from "./uiMocks";
import { disableTraceAssertions } from "./traceUtils";
import { clickSourceSelectionButton } from "./sourceSelection";
import {
  auditCompactSurface,
  formatDefects,
  type CompactSurfaceMeasurement,
  type SurfaceKind,
} from "./compactUsabilityAudit";

/**
 * Whether each dialog and sheet is usable on the smallest screen the app supports.
 *
 * `smallScreenLayoutIntegrity.spec.ts` and `callbackSmallScreen.spec.ts` already prove that
 * nothing is clipped and that text fits. Both passed while the Add items browser was showing one
 * row of a file list on a 320x427 panel, because a surface that spends four fifths of the screen
 * on its own chrome is not clipping anything. This spec measures what is left for the content.
 *
 * The viewport is the smallest supported panel: 480x640 at device pixel ratio 1.5 gives the page
 * 320x427 CSS px. `deviceScaleFactor` is set to match, though only the CSS size affects layout.
 *
 * Surfaces are grouped into tests by the setup they share, so one page session measures several of
 * them. Each grouped test collects defects and asserts once at the end: failing on the first
 * surface would leave the rest unmeasured, and the complete list is the point of this spec.
 *
 * Deliberately NOT tagged `@layout`. That tag also runs a spec on the `android-tablet` project at
 * 800x1280, which is the opposite of what is being measured here.
 *
 * Two surfaces from the survey are not covered, both for reasons in the app rather than the test:
 *
 * - "Clear custom edits?" (`PlayFilesPage.tsx:3088`) only opens when the config picker offers a
 *   second `.cfg` for an item that already carries custom overrides. The repository contains no
 *   `.cfg` fixture at all, and `createMockC64Server` takes `{ timingMode }` and no file injection,
 *   so there is no way to put one in front of the picker without adding a fixture first.
 * - "Clear flash configuration?" (`ClearFlashDialog.tsx`) cannot be opened on a fresh session; the
 *   reason is recorded at its call site below.
 * - `LikedTunesSheet` is measured empty. Likes live in IndexedDB (`c64u-sid-rankings`,
 *   `rankingStore.ts:117-149`) and `localStorage["c64u_sid_rankings"]` is only a fallback the
 *   browser build never reaches, so a seeded like would be silently ignored.
 */

test.use({ viewport: { width: 320, height: 427 }, deviceScaleFactor: 1.5 });

const COMPACT_PROFILE = "compact";

/** Opens the app at `route` on the compact profile, with the fake device already reachable. */
const openCompact = async (page: Page, route: string) => {
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    (expected) => document.documentElement.dataset.displayProfile === expected,
    COMPACT_PROFILE,
  );
  // The tab pages are mounted as slots, so the profile can resolve a frame before the route's
  // own `main` is in the tree. Measuring in that gap fails with "no element matches main".
  await page.locator("main").first().waitFor({ state: "attached", timeout: 15_000 });
  await page.waitForTimeout(400);
};

/**
 * Measures the surface and fails with every defect listed at once. Reporting one defect per run
 * would mean one build per defect on a surface that has several.
 */
const expectUsable = async (page: Page, name: string, selector: string, kind: SurfaceKind) => {
  const measurement = await auditCompactSurface(page, selector, kind);
  expect(measurement.defects, formatDefects(name, measurement)).toEqual([]);
  return measurement;
};

const openDialog = (page: Page): Locator => page.locator('[role="dialog"][data-state="open"]').last();

/**
 * The audit takes a CSS selector because it runs `document.querySelector` inside the page, and
 * most of these surfaces are identified by a role and an accessible name rather than by a testid.
 * Stamping the resolved element with a marker gives every Locator a selector the audit can use,
 * and picks the right one when surfaces are stacked, which `querySelector` alone cannot.
 */
const MARKER = "data-compact-audit-root";

const auditSurface = async (page: Page, surface: Locator, kind: SurfaceKind): Promise<CompactSurfaceMeasurement> => {
  await surface.evaluate((element, marker) => {
    document.querySelectorAll(`[${marker}]`).forEach((node) => node.removeAttribute(marker));
    element.setAttribute(marker, "true");
  }, MARKER);
  return auditCompactSurface(page, `[${MARKER}]`, kind);
};

/**
 * Measures several surfaces in one page session and reports all of their defects together.
 *
 * `expectUsable` throws on the first surface that fails, which in a session that opens eight of
 * them leaves seven unmeasured. This collects instead, so one run produces the whole list.
 */
const createAuditor = () => {
  const reports: string[] = [];
  let total = 0;
  return {
    async check(page: Page, name: string, surface: Locator, kind: SurfaceKind) {
      await expect(surface, `${name}: surface never became visible`).toBeVisible({ timeout: 15_000 });
      // Let the open animation finish; a surface measured mid-transform reports its own animation.
      await page.waitForTimeout(400);
      const measurement = await auditSurface(page, surface, kind);
      if (measurement.defects.length > 0) {
        total += measurement.defects.length;
        reports.push(formatDefects(name, measurement));
      }
      return measurement;
    },
    assertAllUsable() {
      expect(total, `\n\n${reports.join("\n\n")}\n`).toBe(0);
    },
  };
};

/** Closes the top surface, preferring Escape and falling back to its own dismiss control. */
const dismiss = async (page: Page, surface: Locator) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!(await surface.isVisible().catch(() => false))) return;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(350);
  }
  const control = surface.getByRole("button", { name: /^(Cancel|Close)$/ }).first();
  if (await control.isVisible().catch(() => false)) {
    await control.click({ force: true });
  }
  await surface.waitFor({ state: "hidden", timeout: 5000 }).catch(() => undefined);
};

/** SwipeNavigationLayer keeps three page slots mounted; only one of them is the page on screen. */
const activeSlot = (page: Page): Locator => page.locator('[data-slot-active="true"]');

/** Opens a collapsible card unless it is already open. Ids come from `CollapsibleSection.tsx:305`. */
const expandSection = async (page: Page, scope: string, id: string) => {
  const toggle = page.getByTestId(`${scope}-section-toggle-${id}`).first();
  await expect(toggle).toBeVisible({ timeout: 15_000 });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.scrollIntoViewIfNeeded();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
  }
  await page.waitForTimeout(250);
};

/** A playlist the Play page can show rows for. The key is scoped to the seeded device's id. */
const seedPlaylist = async (page: Page) => {
  await page.addInitScript(() => {
    /*
     * Thirty entries, not two. A share-of-surface measurement only means something when the list
     * has more rows than fit: with a short list the body shrinks to its content and every surface
     * looks fine, which is exactly the state that let the Add items browser ship at 30%.
     */
    const items = Array.from({ length: 30 }, (_, index) => ({
      source: "ultimate",
      path: `/Usb0/Demos/Commodore_Anniversary_Megademo_Part_${index + 1}.sid`,
      name: `Commodore_Anniversary_Megademo_Part_${index + 1}.sid`,
      durationMs: 214_000,
      songNr: 1,
      sourceId: null,
    }));
    localStorage.setItem("c64u_playlist:v1:TEST-123", JSON.stringify({ items, currentIndex: 0 }));
    localStorage.setItem("c64u_list_preview_limit", "1");
  });
};

/** Thirty disks, so the row menu, the bulk-select controls and "View all" all have more than fits. */
const seedDisks = async (page: Page) => {
  await page.addInitScript(() => {
    const now = new Date().toISOString();
    const disks = Array.from({ length: 30 }, (_, index) => ({
      id: `ultimate:/Usb0/Disks/Long-Disk-Name-For-Layout-Measurement-${index + 1}.d64`,
      name: `Long-Disk-Name-For-Layout-Measurement-${index + 1}.d64`,
      path: `/Usb0/Disks/Long-Disk-Name-For-Layout-Measurement-${index + 1}.d64`,
      location: "ultimate",
      group: index % 2 === 0 ? "Group-With-An-Extra-Long-Name" : null,
      importOrder: index + 1,
      importedAt: now,
      sizeBytes: 174_848,
      modifiedAt: now,
    }));
    localStorage.setItem(
      "c64u_disk_library:TEST-123",
      JSON.stringify({
        disks,
      }),
    );
    localStorage.setItem("c64u_list_preview_limit", "1");
  });
};

/**
 * One saved app config. `listAppConfigs` filters on an exact `baseUrl` match
 * (`appConfigStore.ts:74-77`), and the Load and Manage tiles stay disabled at zero configs
 * (`HomePage.tsx:1981`), so the mock server's own URL has to go into the entry.
 */
const seedAppConfig = async (page: Page, baseUrl: string) => {
  await page.addInitScript((url: string) => {
    localStorage.setItem(
      "c64u_app_configs",
      JSON.stringify([
        {
          id: "compact-usability-config",
          name: "Saved compact config",
          baseUrl: url,
          savedAt: new Date().toISOString(),
          data: {},
        },
      ]),
    );
  }, baseUrl);
};

/** Adapted from `ramSnapshot.spec.ts:71-129`: a valid `C64SNAP` blob the Restore list can render. */
const seedSnapshots = async (page: Page) => {
  await page.addInitScript(() => {
    const HEADER_SIZE = 28;
    const meta = JSON.stringify({
      snapshot_type: "program",
      display_ranges: ["$0000–$00FF", "$0200–$FFFF"],
      created_at: "2026-01-10 09:00:00",
      label: "JupiterLander.crt",
    });
    const metaBytes = new TextEncoder().encode(meta);
    const buf = new Uint8Array(HEADER_SIZE + metaBytes.length);
    const view = new DataView(buf.buffer);
    new TextEncoder().encode("C64SNAP\0").forEach((byte: number, index: number) => {
      buf[index] = byte;
    });
    view.setUint16(8, 1, true);
    view.setUint16(10, 0, true);
    view.setUint32(12, 1_736_499_600, true);
    view.setUint16(16, 0, true);
    view.setUint16(18, 0, true);
    view.setUint32(20, HEADER_SIZE, true);
    view.setUint32(24, metaBytes.length, true);
    buf.set(metaBytes, HEADER_SIZE);
    let binary = "";
    for (let index = 0; index < buf.length; index += 1) binary += String.fromCharCode(buf[index]);
    localStorage.setItem(
      "c64u_snapshots:v1",
      JSON.stringify({
        version: 1,
        snapshots: [
          {
            id: "snap-1",
            filename: "c64-program-1.c64snap",
            bytesBase64: btoa(binary),
            createdAt: "2026-01-10T09:00:00.000Z",
            snapshotType: "program",
            metadata: {
              snapshot_type: "program",
              display_ranges: ["$0000–$00FF", "$0200–$FFFF"],
              created_at: "2026-01-10 09:00:00",
              label: "JupiterLander.crt",
            },
          },
        ],
      }),
    );
  });
};

test.describe("Every surface is usable on a 320x427 panel", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }, testInfo) => {
    disableTraceAssertions(testInfo, "Layout-only coverage; trace assertions disabled.");
    server = await createMockC64Server({});
    await seedUiMocks(page, server.baseUrl);
    await page.addInitScript(() => {
      localStorage.setItem("c64u_display_profile_override", "compact");
    });
  });

  test.afterEach(async () => {
    await server.close();
  });

  test("the Add items browser leaves room for the file list", async ({ page }) => {
    await openCompact(page, "/play");

    await page.getByRole("button", { name: /Add items|Add more items/i }).click();
    await expect(openDialog(page)).toBeVisible();

    await expectUsable(page, "Add items source interstitial", '[role="dialog"][data-state="open"]', "form");

    await clickSourceSelectionButton(page, "C64U");
    await expect(page.getByTestId("c64u-file-picker")).toBeVisible({ timeout: 15_000 });

    await expectUsable(page, "Add items browser (C64U)", '[data-app-surface="sheet"]', "list");
  });

  test("the primary pages leave room for their own content", async ({ page }) => {
    for (const route of ["/", "/play", "/disks", "/config", "/settings", "/docs"]) {
      await openCompact(page, route);
      const measurement = await auditCompactSurface(page, "main", "form");
      const structural = measurement.defects.filter(
        (defect) => defect.kind === "horizontal-overflow" || defect.kind === "clipped-content",
      );
      expect(structural, formatDefects(`page ${route}`, measurement)).toEqual([]);
    }
  });

  /* Session A1 — the machine controls on Home, which all live in the Quick Actions card. */
  test("Home machine dialogs fit the panel", async ({ page }) => {
    await seedSnapshots(page);
    await openCompact(page, "/");
    const audit = createAuditor();

    await activeSlot(page).getByTestId("home-power-actions").click();
    const power = page.getByTestId("home-power-sheet");
    await audit.check(page, "Home / Power", power, "list");

    // Power off is a row inside the Power sheet, so its confirmation opens from there.
    await page.getByTestId("home-power-action-power-off").click();
    const powerOff = page.getByRole("dialog", { name: "Confirm power off" });
    await audit.check(page, "Home / Confirm power off", powerOff, "confirmation");
    await dismiss(page, powerOff);
    await dismiss(page, power);

    await activeSlot(page)
      .getByTestId("home-machine-controls")
      .getByRole("button", { name: "Reset", exact: true })
      .click();
    const confirmation = page.getByTestId("machine-action-confirmation");
    await audit.check(page, "Home / Reset confirmation", confirmation, "confirmation");
    await dismiss(page, confirmation);

    await activeSlot(page).getByTestId("home-save-ram").click();
    const backup = page.getByTestId("save-ram-dialog");
    await audit.check(page, "Home / Backup", backup, "form");
    await dismiss(page, backup);

    await activeSlot(page).getByTestId("home-load-ram").click();
    const manager = page.getByTestId("snapshot-manager-dialog");
    await audit.check(page, "Home / Restore", manager, "list");

    await page.getByTestId("snapshot-row").first().click();
    const restore = page.getByTestId("restore-snapshot-dialog");
    await audit.check(page, "Home / Restore snapshot", restore, "confirmation");
    await dismiss(page, restore);
    await dismiss(page, manager);

    await activeSlot(page).getByTestId("home-machine-inline-openRemoteInput").click();
    const remoteInput = page.getByTestId("remote-input-sheet");
    await audit.check(page, "Home / Remote Input", remoteInput, "form");
    await dismiss(page, remoteInput);

    audit.assertAllUsable();
  });

  /* Session A2 — the Config and Lighting cards on Home, plus the Video card's palette row. */
  test("Home config, lighting and palette surfaces fit the panel", async ({ page }) => {
    await seedAppConfig(page, server.baseUrl);
    await openCompact(page, "/");
    const audit = createAuditor();

    await expandSection(page, "home", "config-actions");

    await activeSlot(page).getByTestId("home-config-save-app").click();
    const save = page.getByRole("dialog", { name: "Save to app" });
    await audit.check(page, "Home / Save to app", save, "form");
    await dismiss(page, save);

    await activeSlot(page).getByTestId("home-config-load-app").click();
    const load = page.getByTestId("load-config-sheet");
    await audit.check(page, "Home / Load from app", load, "list");
    await dismiss(page, load);

    await activeSlot(page).getByTestId("home-config-manage-app").click();
    const manage = page.getByTestId("manage-configs-sheet");
    await audit.check(page, "Home / Manage app configs", manage, "list");

    // Both nested dialogs carry a button with the same name as their trigger, so the trigger click
    // is scoped to the sheet.
    await manage
      .getByRole("button", { name: /^rename$/i })
      .first()
      .click();
    const rename = page.getByTestId("manage-configs-rename-dialog");
    await audit.check(page, "Home / Rename config", rename, "form");
    await dismiss(page, rename);

    await manage
      .getByRole("button", { name: /^delete$/i })
      .first()
      .click();
    const remove = page.getByTestId("manage-configs-delete-dialog");
    await audit.check(page, "Home / Delete config", remove, "confirmation");
    await dismiss(page, remove);
    await dismiss(page, manage);

    /*
     * Clear Flash is deliberately not measured. Setting
     * `c64u_feature_flag:home_telnet_config_actions_enabled` renders the tile, but it stays
     * `disabled` regardless: its gate is `clearFlashDisabledReason` (`HomePage.tsx:354`, `:2039`),
     * which is non-null until a Telnet capability snapshot exists. `useTelnetActions` only reads
     * that snapshot from cache on mount (`useTelnetActions.ts:296-322`) and only ever discovers one
     * while executing a Telnet action (`:374`), so on a fresh session every action reports
     * `status: "unknown"`. Priming the cache needs another flagged Telnet action to run first, so
     * there is no first-visit route to this dialog in a browser build.
     */

    await expandSection(page, "home", "lighting");
    await activeSlot(page).getByTestId("home-lighting-studio").click();
    const studio = page.getByTestId("lighting-studio-sheet");
    await audit.check(page, "Home / Lighting Studio", studio, "form");

    await page.getByTestId("lighting-open-context-lens").click();
    const lens = page.getByTestId("lighting-context-lens-sheet");
    await audit.check(page, "Home / Context Lens", lens, "list");
    await dismiss(page, lens);
    await dismiss(page, studio);

    await expandSection(page, "home", "video");
    const colorsRow = activeSlot(page).getByTestId("home-video-screen-colors");
    await colorsRow.scrollIntoViewIfNeeded();
    await colorsRow.click();
    const colors = page.getByRole("dialog", { name: "Screen colors" });
    await audit.check(page, "Home / Screen colors", colors, "list");
    await dismiss(page, colors);

    audit.assertAllUsable();
  });

  /* Session A3 — Diagnostics and every surface reachable from inside it. */
  test("Diagnostics and its sub-surfaces fit the panel", async ({ page }) => {
    await openCompact(page, "/");
    const audit = createAuditor();

    const badge = page.locator('[data-panel-position="1"]').getByTestId("unified-health-badge");
    await expect(badge).toBeVisible({ timeout: 15_000 });
    // A plain click is intercepted by the app bar's own overlay at this width.
    await badge.evaluate((node) => (node as HTMLButtonElement).click());
    const sheet = page.getByTestId("diagnostics-sheet");
    await audit.check(page, "Diagnostics", sheet, "list");

    await sheet.getByTestId("open-filters-editor").click();
    const filters = page.getByTestId("filters-editor-surface");
    await audit.check(page, "Diagnostics / Filters", filters, "form");
    await dismiss(page, filters);

    // Every overflow item closes the panel on click, so it is re-opened before each one.
    await sheet.getByTestId("diagnostics-overflow-menu").click();
    await sheet.getByTestId("diagnostics-connection-details-action").click();
    const connection = page.getByTestId("connection-view-surface");
    await audit.check(page, "Diagnostics / Connection details", connection, "form");
    await dismiss(page, connection);

    await sheet.getByTestId("diagnostics-overflow-menu").click();
    await sheet.getByTestId("open-config-drift-screen").click();
    const drift = page.getByTestId("config-drift-surface");
    await audit.check(page, "Diagnostics / Config drift", drift, "list");
    await dismiss(page, drift);

    await sheet.getByTestId("diagnostics-overflow-menu").click();
    await sheet.getByTestId("open-decision-state-screen").click();
    const decision = page.getByTestId("decision-state-surface");
    await audit.check(page, "Diagnostics / Decision state", decision, "list");
    await dismiss(page, decision);

    await sheet.getByTestId("diagnostics-overflow-menu").click();
    await sheet.getByTestId("diagnostics-clear-all-trigger").click();
    const clear = page.getByRole("alertdialog").filter({ hasText: "Clear diagnostics" });
    await audit.check(page, "Diagnostics / Clear diagnostics?", clear, "confirmation");
    await dismiss(page, clear);
    await dismiss(page, sheet);

    audit.assertAllUsable();
  });

  /* Session A3b — the Quick menu and the search overlay it hands over to. */
  test("the Quick menu and search overlay fit the panel", async ({ page }) => {
    await openCompact(page, "/");
    const audit = createAuditor();

    await page.getByTestId("app-bar-quick-menu").first().click();
    const menu = page.getByTestId("keypad-quick-menu");
    await audit.check(page, "Quick menu", menu, "list");

    await page.getByTestId("keypad-quick-menu-search").click();
    const search = page.getByTestId("search-overlay");
    await audit.check(page, "Search overlay", search, "list");
    await dismiss(page, search);

    audit.assertAllUsable();
  });

  /*
   * Session A4 — the device switcher, which `UnifiedHealthBadge.tsx:381` hides behind
   * `devices.length > 1`. The override is registered after `seedUiMocks`, which writes the same
   * key in its own init script.
   */
  test("the device switcher fits the panel", async ({ page }) => {
    await page.addInitScript((host: string) => {
      localStorage.setItem(
        "c64u_saved_devices:v1",
        JSON.stringify({
          version: 1,
          selectedDeviceId: "device-a",
          devices: [
            {
              id: "device-a",
              name: "Living room C64",
              nameSource: "custom",
              host,
              httpPort: 80,
              ftpPort: 21,
              telnetPort: 23,
              lastKnownProduct: "C64U",
              lastKnownHostname: "c64u-primary",
              lastKnownUniqueId: "UID-C64U-1",
              lastSuccessfulConnectionAt: null,
              lastUsedAt: null,
              hasPassword: false,
            },
            {
              id: "device-b",
              name: "Workshop C64",
              nameSource: "custom",
              host: "c64u-secondary",
              httpPort: 80,
              ftpPort: 21,
              telnetPort: 23,
              lastKnownProduct: "C64U",
              lastKnownHostname: "c64u-secondary",
              lastKnownUniqueId: "UID-C64U-2",
              lastSuccessfulConnectionAt: null,
              lastUsedAt: null,
              hasPassword: false,
            },
          ],
          summaries: {},
          summaryLru: [],
          hasEverHadMultipleDevices: true,
        }),
      );
    }, new URL(server.baseUrl).host);

    await openCompact(page, "/");
    const audit = createAuditor();

    const badge = page.locator('[data-panel-position="1"]').getByTestId("unified-health-badge");
    await expect(badge).toBeVisible({ timeout: 15_000 });
    await badge.dispatchEvent("pointerdown");
    // The long press is 450ms (`UnifiedHealthBadge.tsx:48`).
    await page.waitForTimeout(700);
    const switcher = page.getByTestId("switch-device-sheet");
    await audit.check(page, "Switch device", switcher, "list");
    await badge.dispatchEvent("pointerup");

    audit.assertAllUsable();
  });

  /* Session B — the Play page transport surfaces, which share one seeded playlist. */
  test("Play page sheets fit the panel", async ({ page }) => {
    await seedPlaylist(page);
    await openCompact(page, "/play");
    const audit = createAuditor();

    const main = activeSlot(page);

    await main.getByTestId("hvsc-search-open").click();
    const find = page.getByTestId("hvsc-search-sheet");
    // Measured with results on screen. An empty search sheet sizes itself to its intro text, and
    // a body that is not hiding anything cannot show whether the results get enough room.
    await find.getByTestId("hvsc-search-input").fill("a");
    await page.waitForTimeout(900);
    await audit.check(page, "Play / Find a tune", find, "list");
    await dismiss(page, find);

    await main.getByTestId("sid-radio-liked-tunes-open").click();
    const liked = page.getByTestId("liked-tunes-sheet");
    await audit.check(page, "Play / Liked Tunes", liked, "list");
    await dismiss(page, liked);

    await main.getByTestId("sid-radio-launcher").click();
    const radio = page.getByTestId("sid-radio-launcher-sheet");
    await audit.check(page, "Play / SID Radio", radio, "list");
    await dismiss(page, radio);

    await page.getByTestId("playlist-item").first().getByRole("button", { name: "Item actions" }).click();
    await page.getByRole("menuitem", { name: "Review playback config" }).click();
    const config = page.getByRole("dialog").filter({ hasText: "Playback config" }).last();
    await audit.check(page, "Play / Playback config", config, "form");
    await dismiss(page, config);

    await main.getByRole("button", { name: "View all" }).first().click();
    const viewAll = page.getByTestId("action-list-view-all");
    await audit.check(page, "Play / View all (Playlist)", viewAll, "list");
    await dismiss(page, viewAll);

    audit.assertAllUsable();
  });

  /*
   * Session B2 — the tune list, which only exists for a file with more than one subsong: the
   * trigger is not rendered unless `knownSubsongCount > 1` (`PlayFilesPage.tsx:2567`).
   */
  test("the tune list sheet fits the panel", async ({ page }) => {
    await openCompact(page, "/play");
    const audit = createAuditor();

    await page.getByRole("button", { name: /Add items|Add more items/i }).click();
    await clickSourceSelectionButton(page.getByRole("dialog"), "This device");
    await page
      .locator('[data-slot-active="true"] input[type="file"][webkitdirectory]')
      .setInputFiles("playwright/fixtures/local-play-multi-song");
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 20_000 });

    await page
      .getByTestId("playlist-item")
      .filter({ hasText: "multi.sid" })
      .first()
      .getByRole("button", { name: "Play" })
      .click();

    const trigger = page.getByTestId("playback-current-tunes");
    await expect(trigger).toBeVisible({ timeout: 25_000 });
    await trigger.click();

    const tunes = page.getByTestId("tune-list-sheet");
    await audit.check(page, "Play / Tunes in this file", tunes, "list");

    audit.assertAllUsable();
  });

  /*
   * Session C — the HVSC preparation sheet. `shouldOpenHvscPreparation` requires the library to be
   * anything but READY (`hvscControlsVisibility.ts:13`), and the `seedUiMocks` bridge reports
   * "ready", so the status call is replaced here. Registered after `seedUiMocks`, which installs
   * `window.__hvscMock__` in its own init script.
   */
  test("the HVSC preparation sheet fits the panel", async ({ page }) => {
    await page.addInitScript(() => {
      const notInstalled = async () => ({
        installedBaselineVersion: 0,
        installedVersion: 0,
        ingestionState: "idle",
        lastUpdateCheckUtcMs: Date.now(),
        ingestionError: null,
      });
      const patch = () => {
        const bridge = (window as unknown as { __hvscMock__?: Record<string, unknown> }).__hvscMock__;
        if (!bridge) return false;
        bridge.getHvscStatus = notInstalled;
        return true;
      };
      if (!patch()) document.addEventListener("readystatechange", patch);
    });

    await openCompact(page, "/play");
    const audit = createAuditor();

    await page.getByRole("button", { name: /Add items|Add more items/i }).click();
    await expect(page.getByTestId("import-selection-interstitial")).toBeVisible();
    await page.getByTestId("import-option-hvsc").click();

    const preparation = page.getByTestId("hvsc-preparation-sheet");
    await audit.check(page, "Play / Preparing HVSC library", preparation, "confirmation");

    audit.assertAllUsable();
  });

  /* Session D — the Disks page, which shares one seeded disk library. */
  test("Disk dialogs fit the panel", async ({ page }) => {
    await seedDisks(page);
    await openCompact(page, "/disks");
    const audit = createAuditor();

    await page.getByTestId("drive-mount-toggle-a").click();
    const mountSheet = page.getByTestId("mount-disk-sheet");
    await audit.check(page, "Disks / Mount disk to drive", mountSheet, "list");
    await dismiss(page, mountSheet);

    await page
      .getByTestId("disk-row")
      .first()
      .getByRole("button", { name: /^Mount / })
      .click();
    const mountOptions = page.getByRole("dialog").filter({ hasText: "Select the drive to mount" }).last();
    await audit.check(page, "Disks / Mount disk options", mountOptions, "list");
    await dismiss(page, mountOptions);

    for (const [menuItem, name, kind] of [
      ["Set group…", "Set group", "form"],
      ["Rename disk…", "Rename disk", "form"],
      ["Remove from collection", "Remove disk?", "confirmation"],
    ] as const) {
      await page.getByTestId("disk-row").first().getByRole("button", { name: "Item actions" }).click();
      await page.getByRole("menuitem", { name: menuItem }).click();
      const dialog = page.getByRole("dialog", { name }).last();
      await audit.check(page, `Disks / ${name}`, dialog, kind);
      await dismiss(page, dialog);
    }

    await page.getByTestId("disk-list-toggle-select-all").click();
    await page.getByTestId("disk-list-remove-selected").click();
    const bulk = page.getByRole("dialog", { name: "Remove selected disks?" });
    await audit.check(page, "Disks / Remove selected disks?", bulk, "confirmation");
    await dismiss(page, bulk);
    await page.getByTestId("disk-list-toggle-select-all").click();

    await page.getByTestId("new-disk-open").click();
    const newDisk = page.getByRole("dialog", { name: "New disk" });
    await audit.check(page, "Disks / New disk", newDisk, "form");
    await dismiss(page, newDisk);

    await activeSlot(page).getByRole("button", { name: "View all" }).first().click();
    const viewAll = page.getByTestId("action-list-view-all");
    await audit.check(page, "Disks / View all (All disks)", viewAll, "list");
    await dismiss(page, viewAll);

    audit.assertAllUsable();
  });

  /*
   * Session D2 — the Disk Explorer. It reads the image's directory, and a localStorage-seeded
   * local disk has no runtime `File` behind it, so the disk is added through the picker instead.
   * `tests/fixtures/local-source-assets` is the one fixture folder whose `.d64` has a real
   * directory entry; every image under `playwright/fixtures` has an empty one.
   */
  test("the Disk Explorer fits the panel", async ({ page }) => {
    await openCompact(page, "/disks");
    const audit = createAuditor();

    await page.getByRole("button", { name: /Add disks|Add more disks/i }).click();
    await clickSourceSelectionButton(page.getByRole("dialog"), "This device");
    await page
      .locator('[data-slot-active="true"] input[type="file"][webkitdirectory]')
      .setInputFiles("tests/fixtures/local-source-assets");
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 20_000 });
    await expect(page.getByTestId("disk-row").first()).toBeVisible({ timeout: 20_000 });

    await page
      .getByTestId("disk-row")
      .filter({ hasText: "demo.d64" })
      .first()
      .getByRole("button", { name: "Item actions" })
      .click();
    const explorer = page.getByRole("menuitem", { name: /Open \(Disk Explorer\)/ });
    await explorer.scrollIntoViewIfNeeded();
    await explorer.click();

    const dialog = page.getByRole("dialog").filter({ hasText: "demo.d64" }).last();
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await expect(dialog.getByTestId("disk-contents-loading")).toHaveCount(0, { timeout: 20_000 });
    await audit.check(page, "Disks / Disk contents", dialog, "list");

    audit.assertAllUsable();
  });

  /* Session E — the Settings page dialogs. */
  test("Settings dialogs fit the panel", async ({ page }) => {
    await openCompact(page, "/settings");
    const audit = createAuditor();

    const deleteTrigger = page.getByTestId("settings-delete-device");
    await deleteTrigger.scrollIntoViewIfNeeded();
    await deleteTrigger.click();
    const deleteDevice = page.getByRole("alertdialog", { name: "Delete device?" });
    await audit.check(page, "Settings / Delete device?", deleteDevice, "confirmation");
    await dismiss(page, deleteDevice);

    // The Device Safety card holds exactly one Select, so the combobox role is unambiguous.
    const safety = page.getByTestId("settings-section-device-safety");
    await safety.scrollIntoViewIfNeeded();
    await safety.getByRole("combobox").click();
    await page.getByRole("option", { name: /^Relaxed/ }).click();
    const relaxed = page.getByRole("dialog", { name: "Enable relaxed safety mode?" });
    await audit.check(page, "Settings / Enable relaxed safety mode?", relaxed, "confirmation");
    await dismiss(page, relaxed);

    audit.assertAllUsable();
  });

  /*
   * Session E2 — the Online Archive browser. It fetches presets the moment it opens, so it is
   * pointed at the archive mock; the override key is `appSettings.ts:30`.
   */
  test("the Online Archive dialog fits the panel", async ({ page }) => {
    const archive = await createMockArchiveServer({});
    try {
      await page.addInitScript((host: string) => {
        localStorage.setItem("c64u_archive_host_override", host);
      }, archive.host);

      await openCompact(page, "/settings");
      const audit = createAuditor();

      const open = page.getByTestId("open-online-archive");
      await open.scrollIntoViewIfNeeded();
      await open.click();
      const dialog = page.getByTestId("online-archive-dialog");
      await audit.check(page, "Settings / Online Archive", dialog, "list");

      audit.assertAllUsable();
    } finally {
      await archive.close();
    }
  });

  /*
   * Session H — the guided tour, started on demand. `TourHost` subscribes to the start request
   * unconditionally, so the recorded "already taken" state seeded by `seedUiMocks` still applies
   * and only the automatic offer is suppressed.
   */
  test("the guided tour fits the panel", async ({ page }) => {
    await openCompact(page, "/settings");
    const audit = createAuditor();

    const start = page.getByTestId("settings-about-take-the-tour");
    await start.scrollIntoViewIfNeeded();
    await start.click();

    const tour = page.getByTestId("tour-overlay");
    await audit.check(page, "Guided tour", tour, "confirmation");
    await page.getByTestId("tour-skip").click();

    audit.assertAllUsable();
  });
});

/*
 * The offline surfaces. All three are decided by the same startup probe, so they are mutually
 * exclusive within one page load and cannot share the connected fixture above.
 */
test.describe("Offline surfaces are usable on a 320x427 panel", () => {
  const TOUR_TAKEN = JSON.stringify({
    completedAt: 1735689600000,
    skippedAt: null,
    lastStepId: null,
    deviceStepsPending: false,
  });

  const auditOne = async (page: Page, name: string, surface: Locator, kind: SurfaceKind) => {
    const audit = createAuditor();
    await audit.check(page, name, surface, kind);
    audit.assertAllUsable();
  };

  test.beforeEach(async ({ page }, testInfo) => {
    disableTraceAssertions(testInfo, "Layout-only coverage; trace assertions disabled.");
    await page.addInitScript((tourTaken: string) => {
      localStorage.setItem("c64u_display_profile_override", "compact");
      localStorage.setItem("c64u_tour_state:v1", tourTaken);
      localStorage.setItem("c64u_startup_discovery_window_ms", "1000");
      localStorage.setItem("c64u_discovery_probe_timeout_ms", "600");
      localStorage.setItem("c64u_background_rediscovery_interval_ms", "60000");
      localStorage.setItem("c64u_device_host", "127.0.0.1:1");
      localStorage.removeItem("c64u_password");
      localStorage.removeItem("c64u_has_password");
    }, TOUR_TAKEN);
  });

  test("the Demo Mode offer fits the panel", async ({ page }) => {
    await page.addInitScript(() => {
      // `c64u_demo_mode_enabled` is left unset on purpose: the legacy key is only consulted when
      // the canonical one is absent (`appSettings.ts:116-123`).
      localStorage.setItem("c64u_automatic_demo_mode_enabled", "1");
      localStorage.setItem("c64u_feature_flag:demo_mode_enabled", "1");
      sessionStorage.removeItem("c64u_demo_interstitial_shown");
      (window as unknown as { __c64uMockDeviceDiscovery?: unknown }).__c64uMockDeviceDiscovery = {
        candidates: [],
      };
    });

    await openCompact(page, "/");
    await auditOne(page, "Demo Mode offer", page.getByRole("dialog", { name: "Demo Mode" }), "confirmation");
  });

  test("the device discovery picker fits the panel", async ({ page }) => {
    await page.addInitScript(() => {
      // Demo Mode off, or the offer takes the app to DEMO_ACTIVE and the picker never renders.
      localStorage.setItem("c64u_demo_mode_enabled", "0");
      localStorage.setItem("c64u_automatic_demo_mode_enabled", "0");
      // A browser cannot LAN-scan, so the web facade reads injected results instead
      // (`deviceDiscovery.web.ts:31-45`).
      (window as unknown as { __c64uMockDeviceDiscovery?: unknown }).__c64uMockDeviceDiscovery = {
        supported: true,
        scannedHosts: 254,
        elapsedMs: 120,
        unsupported: false,
        candidates: [
          {
            address: "192.168.1.64",
            host: "192.168.1.64",
            httpPort: 80,
            source: ["lan-scan"],
            product: "C64 Ultimate",
            firmwareVersion: "3.12.0",
            hostname: "c64u-livingroom",
            uniqueId: "UID-DISCOVERED-1",
          },
          {
            address: "192.168.1.65",
            host: "192.168.1.65",
            httpPort: 80,
            source: ["lan-scan"],
            product: "Ultimate 64",
            firmwareVersion: "3.12.0",
            hostname: "u64-workshop",
            uniqueId: "UID-DISCOVERED-2",
          },
        ],
      };
    });

    await openCompact(page, "/");
    await auditOne(page, "Device discovery", page.getByRole("dialog", { name: /Choose your C64/i }), "list");
  });

  test("the network password dialog fits the panel", async ({ page }) => {
    const server = await createMockC64Server({});
    try {
      await seedUiMocks(page, server.baseUrl);
      await page.addInitScript(() => {
        // Without this the failed probe falls through to the Demo Mode offer, which stacks on top.
        localStorage.setItem("c64u_demo_mode_enabled", "0");
        localStorage.setItem("c64u_automatic_demo_mode_enabled", "0");
        localStorage.setItem("c64u_display_profile_override", "compact");
      });
      // Every route answers 401 while this is set (`mockC64Server.ts:371`).
      server.setFaultMode("auth");

      await openCompact(page, "/");
      await auditOne(
        page,
        "Network password required",
        page.getByRole("dialog", { name: "Network password required" }),
        "form",
      );
    } finally {
      await server.close();
    }
  });
});
