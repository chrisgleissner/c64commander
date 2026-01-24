import type { Page, TestInfo } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Runtime viewport validation - MUST be called in every test.
 * Ensures viewport configuration is correct and screenshots will be valid.
 */
export const validateViewport = async (page: Page, testInfo: TestInfo) => {
  const viewport = page.viewportSize();
  const devicePixelRatio = await page.evaluate(() => window.devicePixelRatio);
  
  // Viewport width must be reasonable (CSS pixels)
  // Allow tablet viewport (800px) but reject physical-pixel viewports (>1000px)
  if (viewport && viewport.width > 1000) {
    throw new Error(
      `Invalid viewport configuration detected!\n` +
      `  Viewport: ${viewport.width}×${viewport.height}\n` +
      `  Device Pixel Ratio: ${devicePixelRatio}\n` +
      `  Project: ${testInfo.project.name}\n` +
      `\n` +
      `This indicates mixing device presets with physical-pixel viewports.\n` +
      `Screenshot dimensions would be ${viewport.width * devicePixelRatio}×${viewport.height * devicePixelRatio}\n`
    );
  }
  
  // Log viewport info for debugging
  testInfo.annotations.push({
    type: 'viewport-info',
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
    throw new Error('No viewport configured');
  }

  // DOM-level boundary check
  const violations = await page.evaluate((maxWidth) => {
    const results: Array<{ selector: string; width: number; right: number; reason: string }> = [];
    const isToastElement = (element: Element) =>
      Boolean(
        element.closest(
          '[data-sonner-toast], [data-sonner-toaster], .toaster, .toast, [role="status"], [data-state="open"].destructive'
        )
      );
    
    // Check all visible elements
    const elements = document.querySelectorAll('body *');
    elements.forEach((element) => {
      if (isToastElement(element)) return;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      
      // Skip if element is not visible
      if (rect.width === 0 || rect.height === 0) return;
      if (style.display === 'none' || style.visibility === 'hidden') return;
      
      // Check if element extends beyond viewport
      const SUBPIXEL_TOLERANCE = 3; // Allow tolerance for subpixel rendering and rounding
      if (rect.width > maxWidth + SUBPIXEL_TOLERANCE) {
        const tag = element.tagName.toLowerCase();
        const id = element.id ? `#${element.id}` : '';
        const classes = element.className && typeof element.className === 'string'
          ? `.${element.className.split(/\s+/).filter(Boolean).join('.')}`
          : '';
        const selector = `${tag}${id}${classes}`.slice(0, 150);
        
        results.push({
          selector,
          width: rect.width,
          right: rect.right,
          reason: `Element width (${rect.width}px) exceeds viewport width (${maxWidth}px)`,
        });
      } else if (rect.right > maxWidth + SUBPIXEL_TOLERANCE) {
        // Allow tolerance for rounding and subpixel rendering
        const tag = element.tagName.toLowerCase();
        const id = element.id ? `#${element.id}` : '';
        const classes = element.className && typeof element.className === 'string'
          ? `.${element.className.split(/\s+/).filter(Boolean).join('.')}`
          : '';
        const selector = `${tag}${id}${classes}`.slice(0, 150);
        
        results.push({
          selector,
          width: rect.width,
          right: rect.right,
          reason: `Element extends beyond right edge (right: ${rect.right}px, viewport: ${maxWidth}px)`,
        });
      }
    });
    
    return results;
  }, viewport.width);

  if (violations.length > 0) {
    const details = violations
      .slice(0, 5) // Show first 5 violations
      .map((v: { selector: string; width: number; right: number; reason: string }, i: number) => 
        `  ${i + 1}. ${v.selector}\n     ${v.reason}`
      )
      .join('\n');
    
    throw new Error(
      `Visual boundary violations detected (${violations.length} total):\n\n${details}\n\n` +
      `Device: ${testInfo.project.name}\n` +
      `Viewport: ${viewport.width}×${viewport.height}`
    );
  }

  // Check for horizontal scroll
  const hasHorizontalScroll = await page.evaluate(() => {
    return document.documentElement.scrollWidth > document.documentElement.clientWidth;
  });

  if (hasHorizontalScroll) {
    const scrollInfo = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    
    throw new Error(
      `Horizontal scroll detected:\n` +
      `  Scroll width: ${scrollInfo.scrollWidth}px\n` +
      `  Client width: ${scrollInfo.clientWidth}px\n` +
      `  Overflow: ${scrollInfo.overflow}px\n` +
      `\n` +
      `Device: ${testInfo.project.name}\n` +
      `This indicates content extends beyond viewport boundaries.`
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
