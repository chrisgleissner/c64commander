/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const connectionRef = vi.hoisted(() => ({ current: { isConnected: false } }));
vi.mock("@/hooks/useC64Connection", () => ({ useC64Connection: () => ({ status: connectionRef.current }) }));

const connectionStateRef = vi.hoisted(() => ({
  current: { state: "REAL_CONNECTED", lastDiscoveryTrigger: "startup" as string | null },
}));
vi.mock("@/hooks/useConnectionState", () => ({ useConnectionState: () => connectionStateRef.current }));

const discoveryRef = vi.hoisted(() => ({ current: { phase: "idle", trigger: null as string | null } }));
vi.mock("@/hooks/useDeviceDiscovery", () => ({ useDeviceDiscovery: () => discoveryRef.current }));

const interstitialActiveRef = vi.hoisted(() => ({ current: false }));
vi.mock("@/components/ui/interstitial-state", () => ({
  useInterstitialActive: () => interstitialActiveRef.current,
}));

import { TourHost } from "@/components/tour/TourHost";
import { TOUR_STEPS } from "@/lib/tour/steps";
import { resamplePriorAppStateForTests } from "@/lib/tour/tourState";
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
  // Loaded up front, so a test that waits for the tour not to appear is not simply outwaited by its chunk.
  beforeAll(async () => {
    await import("@/components/tour/TourDriver");
  });

  beforeEach(() => {
    localStorage.clear();
    // Production samples this once, when the module is first imported, before anything the app
    // writes to itself can land. A test that clears storage afterwards has to re-sample.
    resamplePriorAppStateForTests();
    connectionRef.current = { isConnected: false };
    interstitialActiveRef.current = false;
    connectionStateRef.current = { state: "REAL_CONNECTED", lastDiscoveryTrigger: "startup" };
    discoveryRef.current = { phase: "idle", trigger: null };
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
      interstitialActiveRef.current = true;
      renderDriver();
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      });
      expect(screen.queryByTestId("tour-overlay")).toBeNull();
    });

    it.each([
      ["before the first connection attempt", { state: "UNKNOWN", lastDiscoveryTrigger: null }, "idle"],
      [
        "while the app looks for its device at launch",
        { state: "DISCOVERING", lastDiscoveryTrigger: "startup" },
        "idle",
      ],
      [
        "while the launch scan searches the network",
        { state: "OFFLINE_NO_DEMO", lastDiscoveryTrigger: "startup" },
        "scanning",
      ],
    ])("does not start %s, which can end in a device picker", async (_when, connection, phase) => {
      connectionStateRef.current = connection;
      discoveryRef.current = { phase, trigger: "startup" };
      renderDriver();
      // Real time, twice the settle window: under fake timers the lazily loaded driver never
      // arrives, so a tour that did start would not be seen.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      });
      expect(screen.queryByTestId("tour-overlay")).toBeNull();
    });

    it("starts while a device the user asked for is being looked up", async () => {
      connectionStateRef.current = { state: "DISCOVERING", lastDiscoveryTrigger: "manual" };
      renderDriver();

      await screen.findByTestId("tour-overlay", undefined, { timeout: 5_000 });
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

    it("spotlights an anchor that arrives after the short settle but inside the resolver's ceiling", async () => {
      /*
       * The resolver waits up to two seconds. Measuring only on a fixed 600 ms delay decided a slow
       * step had failed while its anchor was still on its way, so the caption said the control could
       * not be found and the scrim covered the control that had just appeared.
       */
      const section = document.createElement("div");
      section.setAttribute("data-section-scope", "home");
      section.setAttribute("data-section-id", "quick-actions");
      document.body.appendChild(section);
      renderDriver();
      await startTour();
      for (let index = 0; index < 3; index += 1) fireEvent.click(screen.getByTestId("tour-next"));
      await waitFor(() => expect(screen.getByTestId("tour-overlay")).toHaveAttribute("data-tour-step", "your-tunes"));
      expect(screen.queryByTestId("tour-spotlight")).toBeNull();

      await new Promise((resolve) => setTimeout(resolve, 750));
      act(() => {
        mountAnchor("home-tile-action.resume-session", { top: 100, left: 10, width: 50, height: 44 });
      });

      await waitFor(() => expect(screen.getByTestId("tour-spotlight")).toBeInTheDocument(), { timeout: 3_000 });
      section.remove();
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
      fireEvent.keyDown(window, { key: "ArrowRight", code: "ArrowRight" });
      await waitFor(() => expect(screen.getByTestId("tour-progress").textContent).toContain("Step 2"));
      fireEvent.keyDown(window, { key: "Enter", code: "Enter" });
      await waitFor(() => expect(screen.getByTestId("tour-progress").textContent).toContain("Step 3"));
      fireEvent.keyDown(window, { key: "ArrowLeft", code: "ArrowLeft" });
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

  /*
   * Walks to the first step that needs a machine. Derived rather than counted: the step list is the
   * app's own feature tour and grows, and a hardcoded index silently walks to the wrong step.
   */
  const walkToFirstDeviceStep = async () => {
    const target = TOUR_STEPS.findIndex((step) => step.requiresDevice === true);
    expect(target, "at least one step must need a machine").toBeGreaterThan(0);
    for (let index = 0; index < target; index += 1) fireEvent.click(screen.getByTestId("tour-next"));
    await waitFor(() => expect(screen.getByTestId("tour-progress").textContent).toContain(`Step ${target + 1} `));
  };

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
      await walkToFirstDeviceStep();
      fireEvent.click(screen.getByTestId("tour-skip"));

      await waitFor(() => expect(loadTourState().deviceStepsPending).toBe(true));
    });

    it("does not flag them when a machine was attached the whole way", async () => {
      connectionRef.current = { isConnected: true };
      renderDriver();
      await startTour();
      await walkToFirstDeviceStep();
      fireEvent.click(screen.getByTestId("tour-skip"));

      await waitFor(() => expect(loadTourState().skippedAt).not.toBeNull());
      expect(loadTourState().deviceStepsPending).toBe(false);
    });
  });

  it("mounts the tour on the body, outside the app it is rendered from", async () => {
    const { container } = renderDriver();
    await startTour();

    const overlay = screen.getByTestId("tour-overlay");
    expect(overlay.parentElement).toBe(document.body);
    expect(container.contains(overlay)).toBe(false);
  });

  it("hides the app from assistive technology while the tour is open, and restores it afterwards", async () => {
    const root = document.createElement("div");
    root.id = "root";
    document.body.appendChild(root);
    try {
      renderDriver();
      await startTour();

      expect(root.getAttribute("aria-hidden")).toBe("true");
      expect(screen.getByTestId("tour-next").closest("[aria-hidden=true]")).toBeNull();

      fireEvent.click(screen.getByTestId("tour-skip"));
      await waitFor(() => expect(screen.queryByTestId("tour-overlay")).toBeNull());
      expect(root.hasAttribute("aria-hidden")).toBe(false);
    } finally {
      root.remove();
    }
  });

  it("puts back an aria-hidden value the app root already had when the tour closes", async () => {
    const root = document.createElement("div");
    root.id = "root";
    root.setAttribute("aria-hidden", "false");
    document.body.appendChild(root);
    try {
      renderDriver();
      await startTour();
      expect(root.getAttribute("aria-hidden")).toBe("true");

      fireEvent.click(screen.getByTestId("tour-skip"));
      await waitFor(() => expect(screen.queryByTestId("tour-overlay")).toBeNull());
      expect(root.getAttribute("aria-hidden")).toBe("false");
    } finally {
      root.remove();
    }
  });

  /*
   * The opening step points at nothing, and the viewport is only measured by the effect that draws
   * the hole. Skipping that effect for an anchor-less step left the scrim as one empty rectangle,
   * so the very first thing a new user sees was a caption over a completely undimmed app.
   */
  it("dims the app behind the opening step, which points at nothing", async () => {
    renderDriver();
    await startTour();

    const scrims = screen.getAllByTestId("tour-scrim");
    const covered = scrims.some((scrim) => {
      const style = scrim.getAttribute("style") ?? "";
      return !/width:\s*0(px)?[;\s]/.test(style) && !/height:\s*0(px)?[;\s]/.test(style);
    });
    expect(covered, "at least one scrim rectangle must have a size").toBe(true);
  });

  /*
   * The caption steps back once it has been left alone on a screen it crowds, so the app it is
   * describing can be seen. What must not happen is the title, the progress line or the buttons
   * going with it — see lib/tour/captionReveal for the rule and the numbers behind it.
   */
  describe("when the caption gives the page back", () => {
    /*
     * jsdom has no ResizeObserver, and the panel's height is only ever read through one, so with no
     * stand-in the measured height stays zero and the caption is never in the way of anything.
     */
    const observers: Array<() => void> = [];
    const installResizeObserver = () => {
      observers.length = 0;
      (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
        private readonly callback: () => void;
        constructor(callback: () => void) {
          this.callback = callback;
        }
        observe() {
          observers.push(this.callback);
        }
        disconnect() {}
        unobserve() {}
      };
    };

    const crowdTheCaption = () => {
      const caption = screen.getByTestId("tour-caption");
      caption.getBoundingClientRect = () =>
        ({
          height: 400,
          width: 320,
          top: 0,
          left: 0,
          right: 320,
          bottom: 400,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect;
      observers.forEach((callback) => callback());
      return caption;
    };

    it("keeps the body while the caption is not in the way", async () => {
      installResizeObserver();
      renderDriver();
      await startTour();
      const caption = screen.getByTestId("tour-caption");
      expect(caption.getAttribute("data-body-hidden")).toBeNull();
      expect(caption.textContent).toContain(TOUR_STEPS[0].body);
    });

    it("drops the body, and nothing else, once a crowding caption has been left alone", async () => {
      installResizeObserver();
      vi.useFakeTimers();
      try {
        renderDriver();
        await act(async () => {
          requestTourStart();
          await Promise.resolve();
        });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(50);
        });
        await act(async () => {
          crowdTheCaption();
          await vi.advanceTimersByTimeAsync(12_000);
        });

        const caption = screen.getByTestId("tour-caption");
        expect(caption.getAttribute("data-body-hidden")).toBe("true");
        expect(caption.textContent).not.toContain(TOUR_STEPS[0].body);
        expect(screen.getByTestId("tour-progress")).toBeTruthy();
        expect(screen.getByTestId("tour-next")).toBeTruthy();
        expect(caption.textContent).toContain(TOUR_STEPS[0].title);
      } finally {
        vi.useRealTimers();
      }
    });

    /*
     * Anything the user does puts the body straight back. On a keypad handset moving the highlight
     * is the whole of the interaction, which is why a key counts as well as a press.
     */
    it("puts the body back as soon as the user does anything", async () => {
      installResizeObserver();
      vi.useFakeTimers();
      try {
        renderDriver();
        await act(async () => {
          requestTourStart();
          await Promise.resolve();
        });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(50);
        });
        await act(async () => {
          crowdTheCaption();
          await vi.advanceTimersByTimeAsync(12_000);
        });
        expect(screen.getByTestId("tour-caption").getAttribute("data-body-hidden")).toBe("true");

        await act(async () => {
          // The panel is measured again while the body is hidden; the collapsed height must not be
          // the one that decides, or it would put the body back and take it away for ever.
          crowdTheCaption();
          window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
          await vi.advanceTimersByTimeAsync(600);
        });

        const caption = screen.getByTestId("tour-caption");
        expect(caption.getAttribute("data-body-hidden")).toBeNull();
        expect(caption.textContent).toContain(TOUR_STEPS[0].body);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
