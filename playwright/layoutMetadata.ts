/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { Page, TestInfo } from "@playwright/test";

/**
 * Bounding box captured from the DOM (CSS pixels relative to viewport top-left).
 * null means the element was not found in the DOM.
 */
export interface ElementBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutMetadata {
  /** Key → null if element absent, ElementBounds if present */
  elements: Record<string, ElementBounds | null>;
  /** Viewport dimensions at capture time */
  viewport: { width: number; height: number };
  /** Profile active at capture time (value of data-display-profile attribute on <html>) */
  displayProfile: string | null;
  /** ISO timestamp of capture */
  capturedAt: string;
}

/**
 * Capture bounding boxes for a set of CSS selectors and write a JSON sidecar file
 * alongside the screenshot.
 *
 * @param page         Playwright page
 * @param testInfo     Playwright TestInfo (for attaching to the test report)
 * @param outputPath   Absolute path where the JSON file should be written
 * @param selectors    Map from logical key to CSS selector
 */
export const captureLayoutMetadata = async (
  page: Page,
  testInfo: TestInfo,
  outputPath: string,
  selectors: Record<string, string>,
): Promise<LayoutMetadata> => {
  const metadata: LayoutMetadata = await page.evaluate(
    ({ selMap }: { selMap: Record<string, string> }) => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const profile = (document.documentElement as HTMLElement).dataset.displayProfile ?? null;
      const elements: Record<string, { x: number; y: number; width: number; height: number } | null> = {};
      for (const [key, selector] of Object.entries(selMap)) {
        const el = document.querySelector(selector);
        if (!el) {
          elements[key] = null;
        } else {
          const r = el.getBoundingClientRect();
          elements[key] = { x: r.x, y: r.y, width: r.width, height: r.height };
        }
      }
      return {
        elements,
        viewport: { width: vw, height: vh },
        displayProfile: profile,
        capturedAt: new Date().toISOString(),
      };
    },
    { selMap: selectors },
  );

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

  await testInfo.attach(path.basename(outputPath), {
    path: outputPath,
    contentType: "application/json",
  });

  return metadata;
};
