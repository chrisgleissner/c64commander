/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const connectionRef = vi.hoisted(() => ({ current: { isConnected: false } }));
vi.mock("@/hooks/useC64Connection", () => ({ useC64Connection: () => ({ status: connectionRef.current }) }));

const interstitialActiveRef = vi.hoisted(() => ({ current: false }));
vi.mock("@/components/ui/interstitial-state", () => ({
  useInterstitialActive: () => interstitialActiveRef.current,
}));

import { TourHost } from "@/components/tour/TourHost";
import { TOUR_STEPS } from "@/lib/tour/steps";
import { TOUR_ACTIVE_ATTRIBUTE, TOUR_STATE_KEY, loadTourState, requestTourStart } from "@/lib/tour/tourState";

/*
 * Rendered through the HOST, not the driver directly. The host is what App mounts: it owns the
 * first-launch decision and loads the driver lazily, so the driver's steps, spotlight geometry and
 * scrim never reach the index bundle. Testing the driver alone would leave that wiring unproven.
 */
const renderDriver = () =>
  render(
    <MemoryRouter>
      <TourHost />
    </MemoryRouter>,
  );

const startTour = async () => {
  await act(async () => {
    requestTourStart();
    // The driver is behind React.lazy; let its chunk resolve before anything asserts on it.
    await Promise.resolve();
  });
  await screen.findByTestId("tour-overlay");
};

const mountAnchor = (testId: string, rect = { top: 100, left: 20, width: 80, height: 44 }) => {
  const element = document.createElement("div");
  element.setAttribute("data-testid", testId);
  element.getBoundingClientRect = () =>
    ({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    }) as DOMRect;
  document.body.appendChild(element);
  return element;
};

describe("TourDriver", () => {
  beforeEach(() => {
    localStorage.clear();
    connectionRef.current = { isConnected: false };
    interstitialActiveRef.current = false;
    document.documentElement.removeAttribute(TOUR_ACTIVE_ATTRIBUTE);
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("is not on screen until something asks for it", () => {
    localStorage.setItem(
      TOUR_STATE_KEY,
      JSON.stringify({ completedAt: 1, skippedAt: null, lastStepId: null, deviceStepsPending: false }),
    );
    renderDriver();
    expect(screen.queryByTestId("tour-overlay")).toBeNull();
  });

  describe("the launch sequence", () => {
    /*
     * Section 8.1: the splash and fade, automatic discovery and the simulated-device offer all run
     * first. A tour that began under one of them would spotlight a page nobody could see.
     */
    it("does not start while an interstitial is on screen", async () => {
      vi.useFakeTimers();
      try {
        interstitialActiveRef.current = true;
        renderDriver();
        await act(async () => {
          vi.advanceTimersByTime(10_000);
        });
        expect(screen.queryByTestId("tour-overlay")).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it("starts once every interstitial has gone and the app has settled", async () => {
      interstitialActiveRef.current = true;
      const { rerender } = renderDriver();
      expect(screen.queryByTestId("tour-overlay")).toBeNull();

      interstitialActiveRef.current = false;
      rerender(
        <MemoryRouter>
          <TourHost />
        </MemoryRouter>,
      );
      // Real timers: the driver is behind React.lazy, and its chunk resolves on a microtask that
      // fake timers do not advance. The settle window is short enough to wait out.
      await screen.findByTestId("tour-overlay", undefined, { timeout: 5_000 });
    });

    it("does not offer itself again once it has been completed or skipped", async () => {
      vi.useFakeTimers();
      try {
        localStorage.setItem(
          TOUR_STATE_KEY,
          JSON.stringify({ completedAt: null, skippedAt: 123, lastStepId: "search", deviceStepsPending: false }),
        );
        renderDriver();
        await act(async () => {
          vi.advanceTimersByTime(10_000);
        });
        expect(screen.queryByTestId("tour-overlay")).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("running", () => {
    it("marks the document while it runs, so swipe navigation and Home can stand down", async () => {
      renderDriver();
      await startTour();
      await waitFor(() => expect(document.documentElement.hasAttribute(TOUR_ACTIVE_ATTRIBUTE)).toBe(true));

      fireEvent.click(screen.getByTestId("tour-skip"));
      await waitFor(() => expect(document.documentElement.hasAttribute(TOUR_ACTIVE_ATTRIBUTE)).toBe(false));
    });

    it("is the same length every time, whatever can be reached", async () => {
      renderDriver();
      await startTour();
      expect(screen.getByTestId("tour-progress").textContent).toBe(`Step 1 of ${TOUR_STEPS.length}`);
    });

    it("walks forward and back through every step", async () => {
      renderDriver();
      await startTour();
      for (let index = 1; index < TOUR_STEPS.length; index += 1) {
        fireEvent.click(screen.getByTestId("tour-next"));
        await waitFor(() =>
          expect(screen.getByTestId("tour-progress").textContent).toBe(`Step ${index + 1} of ${TOUR_STEPS.length}`),
        );
      }
      fireEvent.click(screen.getByTestId("tour-back"));
      await waitFor(() =>
        expect(screen.getByTestId("tour-progress").textContent).toBe(
          `Step ${TOUR_STEPS.length - 1} of ${TOUR_STEPS.length}`,
        ),
      );
    });

    it("cannot go back from the first step", async () => {
      renderDriver();
      await startTour();
      expect(screen.getByTestId("tour-back")).toBeDisabled();
    });

    it("degrades a step whose anchors never appear to the caption alone", async () => {
      renderDriver();
      await startTour();
      // Nothing is mounted, so no anchor can be measured on any step.
      fireEvent.click(screen.getByTestId("tour-next"));
      await waitFor(() => expect(screen.getByTestId("tour-overlay")).toHaveAttribute("data-tour-degraded", "true"));
      expect(screen.queryByTestId("tour-spotlight")).toBeNull();
      expect(screen.getByTestId("tour-caption").textContent).toContain("Everything is one search away");
    });

    it("spotlights the union of a two-anchor step's rects", async () => {
      mountAnchor("home-tile-action.resume-session", { top: 100, left: 10, width: 50, height: 44 });
      mountAnchor("home-tile-action.recently-played", { top: 100, left: 80, width: 50, height: 44 });
      renderDriver();
      await startTour();
      // Step 4 is "your-tunes".
      for (let index = 0; index < 3; index += 1) fireEvent.click(screen.getByTestId("tour-next"));

      await waitFor(() => expect(screen.getByTestId("tour-overlay")).toHaveAttribute("data-tour-step", "your-tunes"));
      await waitFor(() => expect(screen.getByTestId("tour-spotlight")).toBeInTheDocument());
      const spotlight = screen.getByTestId("tour-spotlight");
      // 10 - 6 padding on the left, and 130 - 10 + 12 across.
      expect(spotlight.style.left).toBe("4px");
      expect(spotlight.style.width).toBe("132px");
    });

    it("keeps every control at the 44 px floor", async () => {
      renderDriver();
      await startTour();
      for (const testId of ["tour-skip", "tour-back", "tour-next"]) {
        expect(screen.getByTestId(testId).className).toContain("min-h-11");
      }
    });
  });

  describe("keyboard", () => {
    it("moves with Left and Right, and Enter is Next", async () => {
      renderDriver();
      await startTour();
      fireEvent.keyDown(window, { key: "ArrowRight" });
      await waitFor(() => expect(screen.getByTestId("tour-progress").textContent).toContain("Step 2"));
      fireEvent.keyDown(window, { key: "Enter" });
      await waitFor(() => expect(screen.getByTestId("tour-progress").textContent).toContain("Step 3"));
      fireEvent.keyDown(window, { key: "ArrowLeft" });
      await waitFor(() => expect(screen.getByTestId("tour-progress").textContent).toContain("Step 2"));
    });

    it("skips on the Back key", async () => {
      renderDriver();
      await startTour();
      fireEvent.keyDown(window, { key: "Escape" });
      await waitFor(() => expect(screen.queryByTestId("tour-overlay")).toBeNull());
      expect(loadTourState().skippedAt).not.toBeNull();
    });
  });

  describe("what it records", () => {
    it("writes skippedAt and the step it was on, from any step", async () => {
      renderDriver();
      await startTour();
      fireEvent.click(screen.getByTestId("tour-next"));
      await waitFor(() => expect(screen.getByTestId("tour-progress").textContent).toContain("Step 2"));
      fireEvent.click(screen.getByTestId("tour-skip"));

      await waitFor(() => expect(loadTourState().skippedAt).not.toBeNull());
      expect(loadTourState().lastStepId).toBe(TOUR_STEPS[1].id);
      expect(loadTourState().completedAt).toBeNull();
    });

    it("writes completedAt on the last step", async () => {
      renderDriver();
      await startTour();
      for (let index = 1; index < TOUR_STEPS.length; index += 1) {
        fireEvent.click(screen.getByTestId("tour-next"));
        await waitFor(() => expect(screen.getByTestId("tour-progress").textContent).toContain(`Step ${index + 1}`));
      }
      fireEvent.click(screen.getByTestId("tour-next"));
      await waitFor(() => expect(loadTourState().completedAt).not.toBeNull());
      expect(screen.queryByTestId("tour-overlay")).toBeNull();
    });

    it("flags the device steps as pending when they ran with nothing connected", async () => {
      connectionRef.current = { isConnected: false };
      renderDriver();
      await startTour();
      // Walk as far as the first device step (index 4).
      for (let index = 0; index < 4; index += 1) fireEvent.click(screen.getByTestId("tour-next"));
      await waitFor(() => expect(screen.getByTestId("tour-progress").textContent).toContain("Step 5"));
      fireEvent.click(screen.getByTestId("tour-skip"));

      await waitFor(() => expect(loadTourState().deviceStepsPending).toBe(true));
    });

    it("does not flag them when a machine was attached the whole way", async () => {
      connectionRef.current = { isConnected: true };
      renderDriver();
      await startTour();
      for (let index = 0; index < 4; index += 1) fireEvent.click(screen.getByTestId("tour-next"));
      await waitFor(() => expect(screen.getByTestId("tour-progress").textContent).toContain("Step 5"));
      fireEvent.click(screen.getByTestId("tour-skip"));

      await waitFor(() => expect(loadTourState().skippedAt).not.toBeNull());
      expect(loadTourState().deviceStepsPending).toBe(false);
    });
  });
});
