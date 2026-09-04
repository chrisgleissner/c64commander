/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { test, expect } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";
import { allowVisualOverflow, attachStepScreenshotTolerant } from "./testArtifacts";
import { VisualBoundaryError } from "./viewportValidation";

const OVERFLOW_PROBE_ID = "layout-gate-integrity-probe";

// Widens a fixed element past the viewport so the boundary check has something
// unambiguous to catch. Removed again by removeOverflowProbe.
const addOverflowProbe = async (page: Page) => {
  const viewport = page.viewportSize();
  const width = (viewport?.width ?? 393) * 2;
  await page.evaluate(
    ({ id, probeWidth }) => {
      const node = document.createElement("div");
      node.id = id;
      node.style.position = "fixed";
      node.style.top = "0";
      node.style.left = "0";
      node.style.height = "40px";
      node.style.width = `${probeWidth}px`;
      node.style.background = "red";
      document.body.appendChild(node);
    },
    { id: OVERFLOW_PROBE_ID, probeWidth: width },
  );
};

const removeOverflowProbe = async (page: Page) => {
  await page.evaluate((id) => document.getElementById(id)?.remove(), OVERFLOW_PROBE_ID);
};

test.describe("Layout gate integrity", () => {
  // A trivial document rather than the app, so the gate's own contract is under
  // test and not whatever the app happens to render on this viewport.
  test.beforeEach(async ({ page }: { page: Page }) => {
    // The viewport meta tag matters: without it the layout viewport falls back to
    // 980px and the document is already wider than the device, which would make
    // the clean-page assertion below fail for a reason unrelated to the gate.
    await page.setContent(
      '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1" />' +
        "</head><body><main>layout gate probe host</main></body></html>",
    );
  });

  test("a step screenshot reports a boundary violation instead of swallowing it", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    // A clean page must not trip the gate, or the failing case below proves nothing.
    await expect(attachStepScreenshotTolerant(page, testInfo, "gate-clean-page")).resolves.toBeUndefined();

    await addOverflowProbe(page);
    try {
      await expect(attachStepScreenshotTolerant(page, testInfo, "gate-overflowing-page")).rejects.toThrow(
        VisualBoundaryError,
      );
    } finally {
      await removeOverflowProbe(page);
    }
  });

  test("allowVisualOverflow is the way to waive a violation", async ({ page }: { page: Page }, testInfo: TestInfo) => {
    allowVisualOverflow(testInfo, "the probe below is injected by this test on purpose");
    await addOverflowProbe(page);
    try {
      await expect(attachStepScreenshotTolerant(page, testInfo, "gate-waived-page")).resolves.toBeUndefined();
    } finally {
      await removeOverflowProbe(page);
    }
  });
});
