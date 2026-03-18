/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { Page, TestInfo } from "@playwright/test";

/**
 * Runtime viewport validation - MUST be called in every test.
 * Ensures viewport configuration is correct and screenshots will be valid.
 */
export const validateViewport = async (page: Page, testInfo: TestInfo) => {
  const viewport = page.viewportSize();
  const devicePixelRatio = await page.evaluate(() => window.devicePixelRatio);
  const projectName = testInfo.project.name.toLowerCase();
  const isDesktopWebProject = projectName === "web";

  // Viewport width must be reasonable (CSS pixels)
  // Allow tablet viewport (800px) for mobile/tablet projects.
  // Desktop web project intentionally runs at wider viewport sizes.
  if (!isDesktopWebProject && viewport && viewport.width > 1000) {
    throw new Error(
      `Invalid viewport configuration detected!\n` +
        `  Viewport: ${viewport.width}×${viewport.height}\n` +
        `  Device Pixel Ratio: ${devicePixelRatio}\n` +
        `  Project: ${testInfo.project.name}\n` +
        `\n` +
        `This indicates mixing device presets with physical-pixel viewports.\n` +
        `Screenshot dimensions would be ${viewport.width * devicePixelRatio}×${viewport.height * devicePixelRatio}\n`,
    );
  }

  // Log viewport info for debugging
  testInfo.annotations.push({
    type: "viewport-info",
    description: `${viewport?.width}×${viewport?.height} @ ${devicePixelRatio}x`,
  });
};

/**
 * Comprehensive visual boundary enforcement.
 *
 * Strategy:
 * 1. DOM-level checks: Verify no elements extend beyond viewport
 * 2. Overflow checks: Detect horizontal scroll or clipping
 * 3. Handles all cases: light/dark backgrounds, popups, overlays
 *
 * This runs BEFORE screenshot capture to fail fast.
 */
export const enforceVisualBoundaries = async (page: Page, testInfo: TestInfo) => {
  const viewport = page.viewportSize();
  if (!viewport) {
    throw new Error("No viewport configured");
  }

  // DOM-level boundary check
  const violations = await page.evaluate((maxWidth: number) => {
    const results: Array<{
      selector: string;
      width: number;
      right: number;
      reason: string;
    }> = [];
    const activeSwipeSlot =
      document.querySelector<HTMLElement>('[data-testid^="swipe-slot-"][data-slot-active="true"]') ??
      document.querySelector<HTMLElement>('[data-testid^="swipe-slot-"][data-panel-position="1"]');
    const activeSwipeSlotRect = activeSwipeSlot?.getBoundingClientRect() ?? null;
    const isToastElement = (element: Element) =>
      Boolean(
        element.closest(
          '[data-sonner-toast], [data-sonner-toaster], .toaster, .toast, [role="status"], [data-state="open"].destructive, [aria-label="Notifications (F8)"], [data-radix-toast-viewport]',
        ),
      );
    const isInsideSwipeRunway = (element: Element) => Boolean(element.closest('[data-testid="swipe-navigation-runway"]'));
    const isInsideActiveSwipeSlot = (element: Element) => Boolean(activeSwipeSlot && activeSwipeSlot.contains(element));

    // Check all visible elements
    const elements = document.querySelectorAll("body *");
    elements.forEach((element) => {
      if (isToastElement(element)) return;
      if (isInsideSwipeRunway(element) && !isInsideActiveSwipeSlot(element)) return;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);

      // Skip if element is not visible
      if (rect.width === 0 || rect.height === 0) return;
      if (style.display === "none" || style.visibility === "hidden") return;

      const rightBoundary =
        isInsideActiveSwipeSlot(element) && activeSwipeSlotRect
          ? activeSwipeSlotRect.left + activeSwipeSlotRect.width
          : maxWidth;
      const widthBoundary =
        isInsideActiveSwipeSlot(element) && activeSwipeSlotRect ? activeSwipeSlotRect.width : maxWidth;

      // Check if element extends beyond viewport
      const SUBPIXEL_TOLERANCE = 3; // Allow tolerance for subpixel rendering and rounding
      if (rect.width > widthBoundary + SUBPIXEL_TOLERANCE) {
        const tag = element.tagName.toLowerCase();
        const id = element.id ? `#${element.id}` : "";
        const classes =
          element.className && typeof element.className === "string"
            ? `.${element.className.split(/\s+/).filter(Boolean).join(".")}`
            : "";
        const selector = `${tag}${id}${classes}`.slice(0, 150);

        results.push({
          selector,
          width: rect.width,
          right: rect.right,
          reason: `Element width (${rect.width}px) exceeds active boundary width (${widthBoundary}px)`,
        });
      } else if (rect.right > rightBoundary + SUBPIXEL_TOLERANCE) {
        // Allow tolerance for rounding and subpixel rendering
        const tag = element.tagName.toLowerCase();
        const id = element.id ? `#${element.id}` : "";
        const classes =
          element.className && typeof element.className === "string"
            ? `.${element.className.split(/\s+/).filter(Boolean).join(".")}`
            : "";
        const selector = `${tag}${id}${classes}`.slice(0, 150);

        results.push({
          selector,
          width: rect.width,
          right: rect.right,
          reason: `Element extends beyond right edge (right: ${rect.right}px, boundary: ${rightBoundary}px)`,
        });
      }
    });

    return results;
  }, viewport.width);

  if (violations.length > 0) {
    const details = violations
      .slice(0, 5) // Show first 5 violations
      .map(
        (v: { selector: string; width: number; right: number; reason: string }, i: number) =>
          `  ${i + 1}. ${v.selector}\n     ${v.reason}`,
      )
      .join("\n");

    throw new Error(
      `Visual boundary violations detected (${violations.length} total):\n\n${details}\n\n` +
        `Device: ${testInfo.project.name}\n` +
        `Viewport: ${viewport.width}×${viewport.height}`,
    );
  }

  // Check for horizontal scroll
  const hasHorizontalScroll = await page.evaluate(() => {
    const activeSlot =
      document.querySelector<HTMLElement>('[data-testid^="swipe-slot-"][data-slot-active="true"]') ??
      document.querySelector<HTMLElement>('[data-testid^="swipe-slot-"][data-panel-position="1"]');
    if (activeSlot) {
      return activeSlot.scrollWidth > activeSlot.clientWidth + 1;
    }
    return document.documentElement.scrollWidth > document.documentElement.clientWidth;
  });

  if (hasHorizontalScroll) {
    const scrollInfo = await page.evaluate(() => ({
      scrollWidth:
        (document.querySelector<HTMLElement>('[data-testid^="swipe-slot-"][data-slot-active="true"]') ??
          document.querySelector<HTMLElement>('[data-testid^="swipe-slot-"][data-panel-position="1"]'))?.scrollWidth ??
        document.documentElement.scrollWidth,
      clientWidth:
        (document.querySelector<HTMLElement>('[data-testid^="swipe-slot-"][data-slot-active="true"]') ??
          document.querySelector<HTMLElement>('[data-testid^="swipe-slot-"][data-panel-position="1"]'))?.clientWidth ??
        document.documentElement.clientWidth,
      overflow:
        ((document.querySelector<HTMLElement>('[data-testid^="swipe-slot-"][data-slot-active="true"]') ??
          document.querySelector<HTMLElement>('[data-testid^="swipe-slot-"][data-panel-position="1"]'))?.scrollWidth ??
          document.documentElement.scrollWidth) -
        ((document.querySelector<HTMLElement>('[data-testid^="swipe-slot-"][data-slot-active="true"]') ??
          document.querySelector<HTMLElement>('[data-testid^="swipe-slot-"][data-panel-position="1"]'))?.clientWidth ??
          document.documentElement.clientWidth),
    }));

    throw new Error(
      `Horizontal scroll detected:\n` +
        `  Scroll width: ${scrollInfo.scrollWidth}px\n` +
        `  Client width: ${scrollInfo.clientWidth}px\n` +
        `  Overflow: ${scrollInfo.overflow}px\n` +
        `\n` +
        `Device: ${testInfo.project.name}\n` +
        `This indicates content extends beyond viewport boundaries.`,
    );
  }
};

/**
 * Combined viewport validation and boundary enforcement.
 * Call this after page load and after major UI changes.
 */
export const validateVisualConstraints = async (page: Page, testInfo: TestInfo) => {
  await validateViewport(page, testInfo);
  await enforceVisualBoundaries(page, testInfo);
};
