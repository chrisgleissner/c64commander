import { expect, test } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";

import { createMockC64Server } from "../tests/mocks/mockC64Server";
import { DISPLAY_PROFILE_VIEWPORT_SEQUENCE, DISPLAY_PROFILE_VIEWPORTS } from "./displayProfileViewports";
import { seedUiMocks, uiFixtures } from "./uiMocks";
import { assertNoUiIssues, finalizeEvidence, startStrictUiMonitoring } from "./testArtifacts";
import { saveCoverageFromPage } from "./withCoverage";

type SeedDisk = {
  id: string;
  name: string;
  path: string;
  location: "local" | "ultimate";
  group?: string | null;
  importOrder?: number | null;
};

const applyDisplayProfileViewport = async (page: Page, profileId: keyof typeof DISPLAY_PROFILE_VIEWPORTS) => {
  const profile = DISPLAY_PROFILE_VIEWPORTS[profileId];
  await page.setViewportSize(profile.viewport);
  await page.evaluate((override) => {
    localStorage.setItem("c64u_display_profile_override", override);
    window.dispatchEvent(
      new CustomEvent("c64u-ui-preferences-changed", {
        detail: { displayProfileOverride: override },
      }),
    );
  }, profile.override);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.displayProfile))
    .toBe(profile.expectedProfile);
};

const applyListPreviewLimit = async (page: Page, limit: number) => {
  await page.evaluate((value) => {
    localStorage.setItem("c64u_list_preview_limit", String(value));
    window.dispatchEvent(
      new CustomEvent("c64u-ui-preferences-changed", {
        detail: { listPreviewLimit: value },
      }),
    );
  }, limit);
};

const seedDiskLibrary = async (page: Page, disks: SeedDisk[]) => {
  await page.addInitScript(
    ({ seedDisks }: { seedDisks: SeedDisk[] }) => {
      localStorage.setItem(
        "c64u_disk_library:TEST-123",
        JSON.stringify({
          disks: seedDisks.map((disk) => ({
            ...disk,
            group: disk.group ?? null,
            importOrder: disk.importOrder ?? null,
            importedAt: new Date().toISOString(),
          })),
        }),
      );
    },
    { seedDisks: disks },
  );
};

const expectDialogPresentationMode = async (
  dialog: ReturnType<Page["getByRole"]>,
  expectedMode: "fullscreen" | "centered" | "large",
) => {
  if (expectedMode === "fullscreen") {
    await expect(dialog).toHaveClass(/inset-\[var\(--display-profile-modal-inset\)\]/);
    await expect(dialog).toHaveClass(/rounded-lg/);
    await expect(dialog).toHaveClass(/border/);
    return;
  }

  await expect(dialog).not.toHaveClass(/inset-0/);
  await expect(dialog).toHaveClass(/left-\[50%\]/);
};

const expectLocatorWithinViewport = async (
  page: Page,
  locator: ReturnType<Page["getByRole"]> | ReturnType<Page["getByTestId"]>,
) => {
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (box && viewport) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  }
};

const scaleRootTextSize = async (page: Page, scale: number) => {
  await page.evaluate((nextScale) => {
    const root = document.documentElement;
    const current = Number.parseFloat(getComputedStyle(root).fontSize);
    root.style.fontSize = `${current * nextScale}px`;
  }, scale);
};

const setBrowserZoom = async (page: Page, scale: number) => {
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setPageScaleFactor", { pageScaleFactor: scale });
  return session;
};

test.describe("display profiles", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server(uiFixtures.configState);
    await seedUiMocks(page, server.baseUrl);
  });

  test.afterEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    try {
      await saveCoverageFromPage(page, testInfo.title);
      await assertNoUiIssues(page, testInfo);
    } finally {
      await finalizeEvidence(page, testInfo);
      await server.close();
    }
  });

  test("medium viewport keeps the home quick actions in the existing four-column layout", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await applyDisplayProfileViewport(page, "medium");

    await expect(page.getByTestId("home-machine-controls")).toBeVisible();
    const mediumColumns = await page.getByTestId("home-machine-controls").evaluate((element) => {
      return getComputedStyle(element).gridTemplateColumns.split(" ").filter(Boolean).length;
    });
    expect(mediumColumns).toBe(4);

    await expect(page.getByTestId("home-machine-controls")).toHaveAttribute("data-profile", "medium");
  });

  test("expanded profile scales the base UI above medium instead of only widening the layout", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto("/config", { waitUntil: "domcontentloaded" });
    await applyDisplayProfileViewport(page, "medium");

    const mediumSizing = await page.evaluate(() => ({
      rootFontSize: getComputedStyle(document.documentElement).fontSize,
      shellPaddingTop: getComputedStyle(document.querySelector(".page-shell") as Element).paddingTop,
      buttonHeight: getComputedStyle(document.querySelector("button") as Element).height,
    }));

    await applyDisplayProfileViewport(page, "expanded");

    const expandedSizing = await page.evaluate(() => ({
      rootFontSize: getComputedStyle(document.documentElement).fontSize,
      shellPaddingTop: getComputedStyle(document.querySelector(".page-shell") as Element).paddingTop,
      buttonHeight: getComputedStyle(document.querySelector("button") as Element).height,
    }));

    expect(Number.parseFloat(expandedSizing.rootFontSize)).toBeGreaterThan(
      Number.parseFloat(mediumSizing.rootFontSize),
    );
    expect(Number.parseFloat(expandedSizing.shellPaddingTop)).toBeGreaterThan(
      Number.parseFloat(mediumSizing.shellPaddingTop),
    );
    expect(Number.parseFloat(expandedSizing.buttonHeight)).toBeGreaterThan(
      Number.parseFloat(mediumSizing.buttonHeight),
    );
  });

  test("compact auto layout can be overridden to large display without losing the chosen profile", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await applyDisplayProfileViewport(page, "compact");

    await expect(page.getByTestId("home-machine-controls")).toBeVisible();
    const compactColumns = await page.getByTestId("home-machine-controls").evaluate((element) => {
      return getComputedStyle(element).gridTemplateColumns.split(" ").filter(Boolean).length;
    });
    expect(compactColumns).toBe(2);

    const compactOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    expect(compactOverflow).toBe(true);

    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await page.getByTestId("settings-display-profile-override").getByRole("button", { name: "Large display" }).click();

    await expect
      .poll(() =>
        page.evaluate(() => ({
          stored: localStorage.getItem("c64u_display_profile_override"),
          applied: document.documentElement.dataset.displayProfile,
        })),
      )
      .toEqual({ stored: "expanded", applied: "expanded" });

    await page.goto("/play", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("play-primary-layout")).toHaveAttribute("data-profile", "expanded");
  });

  test("source chooser order and scoped selection stay stable across all display profiles", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const profileId of DISPLAY_PROFILE_VIEWPORT_SEQUENCE) {
      await page.goto("/play", { waitUntil: "domcontentloaded" });
      await applyDisplayProfileViewport(page, profileId);

      await page.getByRole("button", { name: /Add items|Add more items/i }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByTestId("import-selection-interstitial")).toBeVisible();

      const optionLabels = await dialog
        .locator('[data-testid="import-selection-interstitial"] > button')
        .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label") ?? ""));
      expect(optionLabels.slice(0, 3)).toEqual([
        "Add file / folder from Local",
        "Add file / folder from C64U",
        "Add file / folder from HVSC",
      ]);

      await dialog.getByTestId("import-option-hvsc").click();
      await expect(dialog.getByTestId("source-file-picker")).toBeVisible();
      await expect(dialog.getByRole("button", { name: /^Play$/i })).toHaveCount(0);
      await expect(dialog.getByRole("button", { name: /Mount/i })).toHaveCount(0);
      await expect(dialog.getByTestId("add-items-confirm")).toBeVisible();

      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(dialog).toHaveCount(0);
    }
  });

  test("profile-aware dialogs remain viewport-safe and keep primary CTAs reachable", async ({
    page,
  }: {
    page: Page;
  }) => {
    await seedDiskLibrary(
      page,
      Array.from({ length: 6 }, (_, index) => ({
        id: `ultimate:/Usb0/Disks/Profile_Test_${String(index + 1).padStart(2, "0")}.d64`,
        name: `Profile_Test_${String(index + 1).padStart(2, "0")}.d64`,
        path: `/Usb0/Disks/Profile_Test_${String(index + 1).padStart(2, "0")}.d64`,
        location: "ultimate" as const,
        group: "Profile Test",
        importOrder: index + 1,
      })),
    );

    for (const profileId of DISPLAY_PROFILE_VIEWPORT_SEQUENCE) {
      await page.goto("/disks", { waitUntil: "domcontentloaded" });
      await applyDisplayProfileViewport(page, profileId);
      await applyListPreviewLimit(page, 3);
      await page.reload({ waitUntil: "domcontentloaded" });
      await applyDisplayProfileViewport(page, profileId);

      await page.getByRole("button", { name: "View all" }).click();
      const listDialog = page.getByRole("dialog");
      await expect(listDialog.getByTestId("action-list-view-all")).toBeVisible();
      await expectDialogPresentationMode(listDialog, profileId === "compact" ? "fullscreen" : "large");
      await expect(page.getByTestId("view-all-filter-input")).toBeVisible();
      await expect(page.getByTestId("disk-row").first()).toBeVisible();
      const diskOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
      expect(diskOverflow).toBe(true);
      await page.keyboard.press("Escape");

      await page.goto("/settings", { waitUntil: "domcontentloaded" });
      await applyDisplayProfileViewport(page, profileId);
      await page.getByRole("button", { name: "Diagnostics", exact: true }).click();
      const diagnosticsDialog = page.getByRole("dialog", { name: "Diagnostics" });
      await expect(diagnosticsDialog).toBeVisible();
      await expectDialogPresentationMode(diagnosticsDialog, profileId === "compact" ? "fullscreen" : "centered");
      await expect(diagnosticsDialog.getByRole("button", { name: "Share All" })).toBeVisible();
      await expect(diagnosticsDialog.getByRole("button", { name: "Clear All" })).toBeVisible();
      const settingsOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
      expect(settingsOverflow).toBe(true);
      await page.keyboard.press("Escape");
    }
  });

  test("compact diagnostics CTA layout remains reachable when text size increases", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await applyDisplayProfileViewport(page, "compact");

    await page.getByRole("button", { name: "Diagnostics", exact: true }).click();
    const diagnosticsDialog = page.getByRole("dialog", { name: "Diagnostics" });
    await expect(diagnosticsDialog).toBeVisible();

    await scaleRootTextSize(page, 1.5);

    const shareAllButton = diagnosticsDialog.getByRole("button", { name: "Share All", exact: true });
    const clearAllButton = diagnosticsDialog.getByRole("button", { name: "Clear All", exact: true });
    await expect(shareAllButton).toBeVisible();
    await expect(clearAllButton).toBeVisible();
    await expectLocatorWithinViewport(page, diagnosticsDialog);
    await expectLocatorWithinViewport(page, shareAllButton);
    await expectLocatorWithinViewport(page, clearAllButton);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    expect(overflow).toBe(true);
  });

  test("compact diagnostics CTA layout remains reachable after reduced viewport height", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await applyDisplayProfileViewport(page, "compact");

    await page.getByRole("button", { name: "Diagnostics", exact: true }).click();
    const diagnosticsDialog = page.getByRole("dialog", { name: "Diagnostics" });
    await expect(diagnosticsDialog).toBeVisible();

    await page.setViewportSize({ width: 360, height: 420 });
    await expect
      .poll(() => page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })))
      .toEqual({ width: 360, height: 420 });

    const shareAllButton = diagnosticsDialog.getByRole("button", { name: "Share All", exact: true });
    const clearAllButton = diagnosticsDialog.getByRole("button", { name: "Clear All", exact: true });
    await expect(shareAllButton).toBeVisible();
    await expect(clearAllButton).toBeVisible();
    await expectLocatorWithinViewport(page, shareAllButton);
    await expectLocatorWithinViewport(page, clearAllButton);
  });

  test("compact diagnostics CTA layout remains reachable under browser zoom on web", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    if (testInfo.project.name !== "web") {
      test.skip(true, "Browser zoom proof only runs on the Chromium web project");
    }

    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await applyDisplayProfileViewport(page, "compact");

    const session = await setBrowserZoom(page, 1.5);
    await page.getByRole("button", { name: "Diagnostics", exact: true }).click();
    const diagnosticsDialog = page.getByRole("dialog", { name: "Diagnostics" });
    await expect(diagnosticsDialog).toBeVisible();

    const shareAllButton = diagnosticsDialog.getByRole("button", { name: "Share All", exact: true });
    const clearAllButton = diagnosticsDialog.getByRole("button", { name: "Clear All", exact: true });
    await expect(shareAllButton).toBeVisible();
    await expect(clearAllButton).toBeVisible();
    await expectLocatorWithinViewport(page, shareAllButton);
    await expectLocatorWithinViewport(page, clearAllButton);

    await session.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
  });

  test("core pages avoid horizontal overflow across the compact medium and expanded matrix", async ({
    page,
  }: {
    page: Page;
  }) => {
    const routes = ["/", "/play", "/disks", "/config", "/settings"];

    for (const profileId of DISPLAY_PROFILE_VIEWPORT_SEQUENCE) {
      for (const route of routes) {
        await page.goto(route, { waitUntil: "domcontentloaded" });
        await applyDisplayProfileViewport(page, profileId);

        const overflow = await page.evaluate(() => ({
          root: document.documentElement.scrollWidth <= window.innerWidth + 1,
          body: document.body.scrollWidth <= window.innerWidth + 1,
        }));
        expect(overflow.root, `${route} overflowed in ${profileId}`).toBe(true);
        expect(overflow.body, `${route} body overflowed in ${profileId}`).toBe(true);
      }
    }
  });
});
