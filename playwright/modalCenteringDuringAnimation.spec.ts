/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { DISPLAY_PROFILE_SEQUENCE } from "../src/lib/displayProfiles";
import {
  APP_DIALOG_CONTENT_CLASS,
  APP_SHEET_CONTENT_CLASS,
  MODAL_SURFACES,
  resolveModalPresentation,
} from "../src/lib/modalPresentation";

// A centered overlay is positioned with `transform: translateX(-50%)`. The
// `enter` and `exit` keyframes of tailwindcss-animate assign `transform` as a
// whole, so a class list that does not also declare an enter/exit translate
// animates from `translateX(0)` and the overlay is off centre for the whole
// animation. The probe below samples the animation at fixed points instead of
// racing it.
const SAMPLE_FRACTIONS = [0, 0.25, 0.5, 0.75, 1];

type ProbeSample = {
  animationCount: number;
  fraction: number;
  left: number;
  right: number;
  width: number;
};

const measureAnimatedOverlay = async (
  page: Page,
  options: { className: string; dataState: "open" | "closed"; inlineTransform: string | null },
): Promise<ProbeSample[]> =>
  page.evaluate(
    async ({ className, dataState, inlineTransform, fractions }) => {
      const probe = document.createElement("div");
      probe.className = className;
      probe.setAttribute("data-state", dataState);
      probe.setAttribute("data-modal-centering-probe", "true");
      probe.style.top = "80px";
      probe.style.zIndex = "2147483647";
      if (inlineTransform) probe.style.transform = inlineTransform;
      probe.textContent = "modal centering probe";
      document.body.appendChild(probe);

      // Force a style flush so the CSS animation exists before it is queried.
      void probe.getBoundingClientRect();

      // Two things can leave the probe with no animation on the first query: the
      // compiled stylesheet may still be loading, and a just-inserted element's
      // CSS animation is not always registered with the Web Animations API in
      // the same task. Poll a bounded number of frames, then pause immediately
      // so a 150ms animation cannot finish and disappear before it is sampled.
      let animations = probe.getAnimations();
      for (let frame = 0; animations.length === 0 && frame < 120; frame += 1) {
        await new Promise(requestAnimationFrame);
        animations = probe.getAnimations();
      }
      for (const animation of animations) animation.pause();
      const samples: ProbeSample[] = [];
      for (const fraction of fractions) {
        for (const animation of animations) {
          animation.pause();
          const duration = animation.effect?.getComputedTiming().activeDuration ?? 0;
          animation.currentTime = typeof duration === "number" ? duration * fraction : 0;
        }
        const rect = probe.getBoundingClientRect();
        samples.push({
          animationCount: animations.length,
          fraction,
          left: rect.left,
          right: rect.right,
          width: rect.width,
        });
      }

      probe.remove();
      return samples;
    },
    {
      className: options.className,
      dataState: options.dataState,
      inlineTransform: options.inlineTransform,
      fractions: SAMPLE_FRACTIONS,
    },
  );

const expectWithinViewport = (samples: ProbeSample[], viewportWidth: number, label: string) => {
  expect(samples.length, `${label}: no samples taken`).toBe(SAMPLE_FRACTIONS.length);
  // Without a running animation the probe proves nothing, so treat that as a failure
  // rather than as a pass.
  expect(samples[0].animationCount, `${label}: no CSS animation was running on the probe`).toBeGreaterThan(0);

  for (const sample of samples) {
    expect(
      sample.left,
      `${label} at ${Math.round(sample.fraction * 100)}% of the animation: left edge ${sample.left.toFixed(2)}px is off screen`,
    ).toBeGreaterThanOrEqual(-1);
    expect(
      sample.right,
      `${label} at ${Math.round(sample.fraction * 100)}% of the animation: right edge ${sample.right.toFixed(2)}px exceeds the ${viewportWidth}px viewport`,
    ).toBeLessThanOrEqual(viewportWidth + 1);
  }
};

test.describe("Centered overlays stay on screen for the whole open and close animation", () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    // The app is loaded only so the compiled Tailwind stylesheet is present; the
    // probe is injected rather than driven through a real dialog so that every
    // surface can be covered without seven different navigation flows.
    await page.goto("/", { waitUntil: "load" });
    await page.waitForFunction(() => document.styleSheets.length > 0);
  });

  for (const profile of DISPLAY_PROFILE_SEQUENCE) {
    for (const surface of MODAL_SURFACES) {
      test(`dialog surface ${surface} on the ${profile} profile`, async ({ page }: { page: Page }) => {
        const viewportWidth = page.viewportSize()?.width ?? 393;
        const { contentClassName } = resolveModalPresentation(profile, surface);

        for (const dataState of ["open", "closed"] as const) {
          const samples = await measureAnimatedOverlay(page, {
            className: contentClassName,
            dataState,
            // useCenteredOverlayPosition applies this inline, alongside the class.
            inlineTransform: "translateX(-50%)",
          });
          expectWithinViewport(samples, viewportWidth, `${surface}/${profile} (${dataState})`);
        }
      });
    }
  }

  test("AppDialogContent", async ({ page }: { page: Page }) => {
    const viewportWidth = page.viewportSize()?.width ?? 393;
    for (const dataState of ["open", "closed"] as const) {
      const samples = await measureAnimatedOverlay(page, {
        className: APP_DIALOG_CONTENT_CLASS,
        dataState,
        inlineTransform: "translateX(-50%)",
      });
      expectWithinViewport(samples, viewportWidth, `AppDialogContent (${dataState})`);
    }
  });

  test("AppSheetContent once its sm breakpoint centres it", async ({ page }: { page: Page }) => {
    // Below `sm` the sheet is full width and not transform-centred, so the defect
    // this guards against can only appear at or above that breakpoint.
    const wideViewport = { height: 800, width: 900 };
    await page.setViewportSize(wideViewport);
    for (const dataState of ["open", "closed"] as const) {
      const samples = await measureAnimatedOverlay(page, {
        className: APP_SHEET_CONTENT_CLASS,
        dataState,
        inlineTransform: null,
      });
      expectWithinViewport(samples, wideViewport.width, `AppSheetContent (${dataState})`);
    }
  });
});
