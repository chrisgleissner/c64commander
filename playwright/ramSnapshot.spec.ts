/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { test, expect } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";
import { createMockC64Server } from "../tests/mocks/mockC64Server";
import { seedUiMocks, uiFixtures } from "./uiMocks";
import { saveCoverageFromPage } from "./withCoverage";
import { attachStepScreenshot, assertNoUiIssues, finalizeEvidence, startStrictUiMonitoring } from "./testArtifacts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const snap = async (page: Page, testInfo: TestInfo, label: string) => {
  await attachStepScreenshot(page, testInfo, label);
};

const waitForConnected = async (page: Page) => {
  await expect(page.getByTestId("connectivity-indicator")).toHaveAttribute("data-connection-state", "REAL_CONNECTED", {
    timeout: 10000,
  });
};

/**
 * Builds a minimal valid .c64snap binary and base64-encodes it.
 * Layout: 28-byte header + 0 range descriptors + metadata.
 */
const buildMinimalSnapshotBase64 = (typeCode: number, timestampSeconds: number): string => {
  const HEADER_SIZE = 28;
  const meta = JSON.stringify({
    snapshot_type: "program",
    display_ranges: ["$0000\u2013$00FF", "$0200\u2013$FFFF"],
    created_at: "2026-01-10 09:00:00",
  });
  const metaBytes = new TextEncoder().encode(meta);
  const total = HEADER_SIZE + metaBytes.length;
  const buf = new Uint8Array(total);
  const view = new DataView(buf.buffer);

  // Magic "C64SNAP\0"
  new TextEncoder().encode("C64SNAP\0").forEach((b, i) => {
    buf[i] = b;
  });
  view.setUint16(8, 1, true); // version
  view.setUint16(10, typeCode, true); // type code
  view.setUint32(12, timestampSeconds, true); // timestamp
  view.setUint16(16, 0, true); // range_count = 0
  view.setUint16(18, 0, true); // flags
  view.setUint32(20, HEADER_SIZE, true); // metadata_offset
  view.setUint32(24, metaBytes.length, true); // metadata_size
  buf.set(metaBytes, HEADER_SIZE);

  let binary = "";
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
  return btoa(binary);
};

/**
 * Seed localStorage with snapshot entries for Snapshot Manager tests.
 */
const seedSnapshots = async (page: Page, count = 3) => {
  await page.addInitScript((total: number) => {
    const builder = (typeCode: number, ts: number): string => {
      const HEADER_SIZE = 28;
      const meta = JSON.stringify({
        snapshot_type: typeCode === 0 ? "program" : typeCode === 1 ? "basic" : "screen",
        display_ranges: typeCode === 0 ? ["$0000\u2013$00FF", "$0200\u2013$FFFF"] : ["$0000\u2013$FFFF"],
        created_at: "2026-01-10 09:00:00",
      });
      const metaBytes = new TextEncoder().encode(meta);
      const total = HEADER_SIZE + metaBytes.length;
      const buf = new Uint8Array(total);
      const view = new DataView(buf.buffer);
      new TextEncoder().encode("C64SNAP\0").forEach((b: number, i: number) => {
        buf[i] = b;
      });
      view.setUint16(8, 1, true);
      view.setUint16(10, typeCode, true);
      view.setUint32(12, ts, true);
      view.setUint16(16, 0, true);
      view.setUint16(18, 0, true);
      view.setUint32(20, HEADER_SIZE, true);
      view.setUint32(24, metaBytes.length, true);
      buf.set(metaBytes, HEADER_SIZE);
      let binary = "";
      for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
      return btoa(binary);
    };

    const typeCodes = [0, 1, 2] as const;
    const snapshots = Array.from({ length: total }, (_, index) => {
      const typeCode = typeCodes[index % typeCodes.length];
      const timestamp = 1736499600 - index * 3600;
      const snapshotType = typeCode === 0 ? "program" : typeCode === 1 ? "basic" : "screen";
      return {
        id: `snap-${index + 1}`,
        filename: `c64-${snapshotType}-${index + 1}.c64snap`,
        bytesBase64: builder(typeCode, timestamp),
        createdAt: new Date(timestamp * 1000).toISOString(),
        snapshotType,
        metadata: {
          snapshot_type: snapshotType,
          display_ranges:
            typeCode === 0
              ? ["$0000\u2013$00FF", "$0200\u2013$FFFF"]
              : typeCode === 1
                ? ["$0801\u2013STREND"]
                : ["VICBANK", "$D000\u2013$D02E", "$D800\u2013$DBFF", "$DD00\u2013$DD0F"],
          created_at: new Date(timestamp * 1000).toISOString().slice(0, 19).replace("T", " "),
          ...(index === 0 ? { label: "JupiterLander.crt" } : {}),
        },
      };
    });
    const store = {
      version: 1,
      snapshots,
    };
    localStorage.setItem("c64u_snapshots:v1", JSON.stringify(store));
  }, count);
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe("RAM Snapshot system", () => {
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

  // -------------------------------------------------------------------------
  // Save RAM dialog
  // -------------------------------------------------------------------------

  test("Save RAM button opens dialog with type list @layout", async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto("/");
    await waitForConnected(page);
    await snap(page, testInfo, "home-connected");

    await page.getByTestId("home-save-ram").click();
    await expect(page.getByTestId("save-ram-dialog")).toBeVisible();
    await snap(page, testInfo, "save-ram-dialog-open");

    // All four type buttons visible
    await expect(page.getByTestId("save-ram-type-program")).toBeVisible();
    await expect(page.getByTestId("save-ram-type-basic")).toBeVisible();
    await expect(page.getByTestId("save-ram-type-screen")).toBeVisible();
    await expect(page.getByTestId("save-ram-type-custom")).toBeVisible();
  });

  test("Save RAM — custom type shows address form with multiple ranges", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto("/");
    await waitForConnected(page);

    await page.getByTestId("home-save-ram").click();
    await expect(page.getByTestId("save-ram-dialog")).toBeVisible();

    await page.getByTestId("save-ram-type-custom").click();
    await expect(page.getByTestId("save-ram-custom-form")).toBeVisible();
    await expect(page.getByTestId("save-ram-custom-add-range")).toBeVisible();

    await page.getByTestId("save-ram-custom-start").fill("0400");
    await page.getByTestId("save-ram-custom-end").fill("07E7");
    await page.getByTestId("save-ram-custom-add-range").click();
    await expect(page.getByTestId("save-ram-custom-start-1")).toBeVisible();
    await page.getByTestId("save-ram-custom-start-1").fill("2000");
    await page.getByTestId("save-ram-custom-end-1").fill("20FF");

    await snap(page, testInfo, "save-ram-custom-form");
  });

  test("Save RAM — invalid custom addresses show validation toast", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto("/");
    await waitForConnected(page);

    await page.getByTestId("home-save-ram").click();
    await page.getByTestId("save-ram-type-custom").click();

    await page.getByTestId("save-ram-custom-start").fill("ZZZZ");
    await page.getByTestId("save-ram-custom-end").fill("07E7");
    await page.getByTestId("save-ram-custom-confirm").click();

    await expect(page.getByText("Invalid address").first()).toBeVisible();
  });

  test("Save RAM — overlapping custom ranges show validation toast", async ({ page }: { page: Page }) => {
    await page.goto("/");
    await waitForConnected(page);

    await page.getByTestId("home-save-ram").click();
    await page.getByTestId("save-ram-type-custom").click();

    await page.getByTestId("save-ram-custom-start").fill("0400");
    await page.getByTestId("save-ram-custom-end").fill("07E7");
    await page.getByTestId("save-ram-custom-add-range").click();
    await page.getByTestId("save-ram-custom-start-1").fill("0700");
    await page.getByTestId("save-ram-custom-end-1").fill("0800");
    await page.getByTestId("save-ram-custom-confirm").click();

    await expect(page.getByText("Overlapping ranges").first()).toBeVisible();
  });

  test("Save RAM — custom ranges persist across reload", async ({ page }: { page: Page }) => {
    await page.goto("/");
    await waitForConnected(page);

    await page.getByTestId("home-save-ram").click();
    await page.getByTestId("save-ram-type-custom").click();
    await page.getByTestId("save-ram-custom-start").fill("C000");
    await page.getByTestId("save-ram-custom-end").fill("CFFF");
    await page.getByTestId("save-ram-custom-add-range").click();
    await page.getByTestId("save-ram-custom-start-1").fill("D800");
    await page.getByTestId("save-ram-custom-end-1").fill("DBFF");
    await page.keyboard.press("Escape");

    await page.reload();
    await waitForConnected(page);

    await page.getByTestId("home-save-ram").click();
    await page.getByTestId("save-ram-type-custom").click();

    await expect(page.getByTestId("save-ram-custom-start")).toHaveValue("C000");
    await expect(page.getByTestId("save-ram-custom-end")).toHaveValue("CFFF");
    await expect(page.getByTestId("save-ram-custom-start-1")).toHaveValue("D800");
    await expect(page.getByTestId("save-ram-custom-end-1")).toHaveValue("DBFF");
  });

  test("Save RAM — program snapshot triggers API read and stores snapshot", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto("/");
    await waitForConnected(page);

    await page.getByTestId("home-save-ram").click();
    await expect(page.getByTestId("save-ram-dialog")).toBeVisible();

    await page.getByTestId("save-ram-type-program").click();

    // Dialog closes and machine starts a readmem sequence
    await expect(page.getByTestId("save-ram-dialog")).not.toBeVisible({ timeout: 5000 });

    // Wait for success toast
    await expect(page.getByText("Snapshot saved", { exact: true })).toBeVisible({ timeout: 15000 });
    await snap(page, testInfo, "save-ram-program-done");

    // Verify readmem requests were fired
    const readmemCount = server.requests.filter(
      (r) => r.method === "GET" && r.url.includes("/v1/machine:readmem"),
    ).length;
    expect(readmemCount).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Snapshot Manager dialog
  // -------------------------------------------------------------------------

  test("Load RAM button opens Snapshot Manager @layout", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await seedSnapshots(page);
    await page.goto("/");
    await waitForConnected(page);
    await snap(page, testInfo, "home-loaded");

    await page.getByTestId("home-load-ram").click();
    await expect(page.getByTestId("snapshot-manager-dialog")).toBeVisible();
    await snap(page, testInfo, "snapshot-manager-open");

    // All three seeded snapshots should appear
    const rows = page.getByTestId("snapshot-row");
    await expect(rows).toHaveCount(3);
  });

  test("Snapshot Manager — central list scrolls independently for many snapshots", async ({ page }: { page: Page }) => {
    await seedSnapshots(page, 18);
    await page.goto("/");
    await waitForConnected(page);

    await page.getByTestId("home-load-ram").click();
    await expect(page.getByTestId("snapshot-manager-dialog")).toBeVisible();

    const metrics = await page.getByTestId("snapshot-list").evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      overflowY: window.getComputedStyle(element).overflowY,
    }));

    expect(metrics.overflowY).toMatch(/auto|scroll/);
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);

    await page.getByTestId("snapshot-list").evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });

    await expect
      .poll(() => page.getByTestId("snapshot-list").evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
  });

  test("Snapshot Manager — empty state shown when no snapshots", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto("/");
    await waitForConnected(page);

    await page.getByTestId("home-load-ram").click();
    await expect(page.getByTestId("snapshot-empty")).toBeVisible();
    await snap(page, testInfo, "snapshot-manager-empty");
  });

  test("Snapshot Manager — type filter narrows list", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await seedSnapshots(page);
    await page.goto("/");
    await waitForConnected(page);

    await page.getByTestId("home-load-ram").click();
    await expect(page.getByTestId("snapshot-manager-dialog")).toBeVisible();

    await page.getByTestId("snapshot-filter-type-basic").click();
    await expect(page.getByTestId("snapshot-row")).toHaveCount(1);
    await snap(page, testInfo, "snapshot-manager-filter-basic");
  });

  test("Snapshot Manager — text filter narrows list", async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await seedSnapshots(page);
    await page.goto("/");
    await waitForConnected(page);

    await page.getByTestId("home-load-ram").click();
    await expect(page.getByTestId("snapshot-manager-dialog")).toBeVisible();

    await page.getByTestId("snapshot-filter-input").fill("JupiterLander.crt");
    await expect(page.getByTestId("snapshot-row")).toHaveCount(1);
    await snap(page, testInfo, "snapshot-manager-filter-text");
  });

  test("Snapshot Manager — delete removes snapshot from list", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await seedSnapshots(page);
    await page.goto("/");
    await waitForConnected(page);

    await page.getByTestId("home-load-ram").click();
    await expect(page.getByTestId("snapshot-row")).toHaveCount(3);

    await page.getByTestId("snapshot-delete").first().click();
    await expect(page.getByTestId("snapshot-row")).toHaveCount(2);
    await snap(page, testInfo, "snapshot-manager-after-delete");
  });

  test("Snapshot Manager — comment edits update the stored snapshot label", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await seedSnapshots(page);
    await page.goto("/");
    await waitForConnected(page);

    await page.getByTestId("home-load-ram").click();
    await expect(page.getByTestId("snapshot-manager-dialog")).toBeVisible();

    await page.getByTestId("snapshot-comment-toggle-snap-1").click();
    await page.getByTestId("snapshot-comment-input-snap-1").fill("After game");
    await page.getByTestId("snapshot-comment-confirm-snap-1").click();

    await expect(page.getByTestId("snapshot-comment-toggle-snap-1")).toHaveText("After game");
    const storedLabel = await page.evaluate(() => {
      const raw = localStorage.getItem("c64u_snapshots:v1");
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { snapshots?: Array<{ id: string; metadata?: { label?: string } }> };
      return parsed.snapshots?.find((snapshot) => snapshot.id === "snap-1")?.metadata?.label ?? null;
    });
    expect(storedLabel).toBe("After game");
    await snap(page, testInfo, "snapshot-manager-comment-updated");
  });

  // -------------------------------------------------------------------------
  // Restore confirmation dialog
  // -------------------------------------------------------------------------

  test("Snapshot Manager — clicking snapshot row opens restore confirmation", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await seedSnapshots(page);
    await page.goto("/");
    await waitForConnected(page);

    await page.getByTestId("home-load-ram").click();
    await expect(page.getByTestId("snapshot-manager-dialog")).toBeVisible();

    // Click the first snapshot row to trigger restore
    await page.getByTestId("snapshot-row").first().click();
    await expect(page.getByTestId("restore-snapshot-dialog")).toBeVisible();
    await snap(page, testInfo, "restore-dialog-open");
  });

  test("Restore confirmation — cancel returns to manager", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await seedSnapshots(page);
    await page.goto("/");
    await waitForConnected(page);

    await page.getByTestId("home-load-ram").click();
    await page.getByTestId("snapshot-row").first().click();
    await expect(page.getByTestId("restore-snapshot-dialog")).toBeVisible();

    // Cancel — closes restore dialog but manager stays (snapshotManagerOpen stays true)
    const cancelBtn = page.getByTestId("restore-snapshot-dialog").getByRole("button", { name: /cancel/i });
    await cancelBtn.click();
    await expect(page.getByTestId("restore-snapshot-dialog")).not.toBeVisible();
    await snap(page, testInfo, "restore-cancelled");
  });

  test("Snapshot Manager — tapping outside closes the dialog", async ({ page }: { page: Page }) => {
    await seedSnapshots(page);
    await page.goto("/");
    await waitForConnected(page);

    await page.getByTestId("home-load-ram").click();
    await expect(page.getByTestId("snapshot-manager-dialog")).toBeVisible();

    await page.mouse.click(10, 10);

    await expect(page.getByTestId("snapshot-manager-dialog")).not.toBeVisible();
  });
});
