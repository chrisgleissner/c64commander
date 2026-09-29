/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
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
      expect(screen.getByTestId("tour-progress").textContent).toContain(`Step 1 of ${TOUR_STEPS.length}`);
    });

    it("walks forward and back through every step", async () => {
      renderDriver();
      await startTour();
      for (let index = 1; index < TOUR_STEPS.length; index += 1) {
        fireEvent.click(screen.getByTestId("tour-next"));
        await waitFor(() =>
          expect(screen.getByTestId("tour-progress").textContent).toContain(
            `Step ${index + 1} of ${TOUR_STEPS.length}`,
          ),
        );
      }
      fireEvent.click(screen.getByTestId("tour-back"));
      await waitFor(() =>
        expect(screen.getByTestId("tour-progress").textContent).toContain(
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
      expect(screen.getByTestId("tour-caption").textContent).toContain(TOUR_STEPS[1].title);
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
   * The caption folds only when the user asks: a timer took the explanation away from someone still
   * reading it, and a key press put it back, so every navigation key made the panel jump.
   */
  describe("folding the caption", () => {
    it("keeps the explanation however long the step is left alone", async () => {
      /*
       * A caption covering 300 of 427 px, measured through a ResizeObserver stand-in: jsdom has none,
       * and without one a caption never measures as crowding anything.
       */
      const originalObserver = globalThis.ResizeObserver;
      const originalHeight = window.innerHeight;
      (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
        constructor(private readonly callback: () => void) {}
        observe() {
          this.callback();
        }
        disconnect() {}
      };
      Object.defineProperty(window, "innerHeight", { configurable: true, value: 427 });
      const originalRect = HTMLElement.prototype.getBoundingClientRect;
      HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
        if (this.dataset.testid === "tour-caption") return { top: 127, height: 300, width: 320 } as DOMRect;
        return originalRect.call(this);
      };
      onTestFinished(() => {
        (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = originalObserver;
        Object.defineProperty(window, "innerHeight", { configurable: true, value: originalHeight });
        HTMLElement.prototype.getBoundingClientRect = originalRect;
      });
      renderDriver();
      await startTour();
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 7_000));
      });
      expect(screen.getByTestId("tour-caption")).toHaveAttribute("data-mode", "read");
      expect(screen.getByTestId("tour-body").textContent).toBe(TOUR_STEPS[0].body);
    }, 15_000);

    it("folds to its title and buttons on Down and unfolds on Up", async () => {
      renderDriver();
      await startTour();
      fireEvent.keyDown(window, { key: "ArrowDown", code: "ArrowDown" });
      await waitFor(() => expect(screen.getByTestId("tour-caption")).toHaveAttribute("data-mode", "look"));
      expect(screen.queryByTestId("tour-body")).toBeNull();
      expect(screen.getByTestId("tour-caption").textContent).toContain(TOUR_STEPS[0].title);
      expect(screen.getByTestId("tour-next")).toBeInTheDocument();

      fireEvent.keyDown(window, { key: "ArrowUp", code: "ArrowUp" });
      await waitFor(() => expect(screen.getByTestId("tour-caption")).toHaveAttribute("data-mode", "read"));
      expect(screen.getByTestId("tour-body")).toBeInTheDocument();
    });

    it("folds and unfolds from its own button, which says what it does", async () => {
      renderDriver();
      await startTour();
      const toggle = screen.getByTestId("tour-toggle-text");
      expect(toggle).toHaveAttribute("aria-pressed", "false");
      expect(toggle).toHaveAccessibleName("Hide the text");
      expect(toggle.className).toContain("size-11");
      fireEvent.click(toggle);
      await waitFor(() => expect(screen.getByTestId("tour-caption")).toHaveAttribute("data-mode", "look"));
      expect(screen.getByTestId("tour-toggle-text")).toHaveAttribute("aria-pressed", "true");
    });

    it("stays folded while the user walks on", async () => {
      renderDriver();
      await startTour();
      fireEvent.click(screen.getByTestId("tour-toggle-text"));
      fireEvent.keyDown(window, { key: "ArrowRight", code: "ArrowRight" });
      await waitFor(() => expect(screen.getByTestId("tour-progress")).toHaveAttribute("data-step", "2"));
      expect(screen.getByTestId("tour-caption")).toHaveAttribute("data-mode", "look");
    });
  });

  describe("key ownership", () => {
    it("acts once for a held key, so holding Next cannot run through and complete the tour", async () => {
      renderDriver();
      await startTour();
      fireEvent.keyDown(window, { key: "ArrowRight", code: "ArrowRight" });
      for (let count = 0; count < TOUR_STEPS.length + 2; count += 1) {
        fireEvent.keyDown(window, { key: "ArrowRight", code: "ArrowRight", repeat: true });
      }
      await waitFor(() => expect(screen.getByTestId("tour-progress")).toHaveAttribute("data-step", "2"));
      expect(screen.getByTestId("tour-overlay")).toBeInTheDocument();
      expect(loadTourState().completedAt).toBeNull();
    });

    it("swallows a repeated key without acting on it", async () => {
      renderDriver();
      await startTour();
      const repeat = new KeyboardEvent("keydown", { key: "Escape", repeat: true, cancelable: true });
      window.dispatchEvent(repeat);
      expect(repeat.defaultPrevented).toBe(true);
      expect(screen.getByTestId("tour-overlay")).toBeInTheDocument();
    });

    it("puts focus on Next when it opens", async () => {
      renderDriver();
      await startTour();
      await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("tour-next")));
    });

    it("presses the guide button that has focus on OK, not always Next", async () => {
      renderDriver();
      await startTour();
      screen.getByTestId("tour-skip").focus();
      fireEvent.keyDown(window, { key: "Enter", code: "Enter" });
      await waitFor(() => expect(screen.queryByTestId("tour-overlay")).toBeNull());
      expect(loadTourState().skippedAt).not.toBeNull();
    });

    it("gives focus back to where it was when the guide closes", async () => {
      const before = document.createElement("button");
      document.body.appendChild(before);
      before.focus();
      try {
        renderDriver();
        await startTour();
        await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("tour-next")));
        fireEvent.click(screen.getByTestId("tour-skip"));
        await waitFor(() => expect(screen.queryByTestId("tour-overlay")).toBeNull());
        expect(document.activeElement).toBe(before);
      } finally {
        before.remove();
      }
    });
  });

  it("makes the app inert while the guide is open, so a tap in the spotlight reaches nothing", async () => {
    const root = document.createElement("div");
    root.id = "root";
    document.body.appendChild(root);
    try {
      renderDriver();
      await startTour();
      expect(root.hasAttribute("inert")).toBe(true);
      fireEvent.click(screen.getByTestId("tour-skip"));
      await waitFor(() => expect(screen.queryByTestId("tour-overlay")).toBeNull());
      expect(root.hasAttribute("inert")).toBe(false);
    } finally {
      root.remove();
    }
  });

  it("leaves an app root that was already inert inert when it closes", async () => {
    const root = document.createElement("div");
    root.id = "root";
    root.setAttribute("inert", "");
    document.body.appendChild(root);
    try {
      renderDriver();
      await startTour();
      fireEvent.click(screen.getByTestId("tour-skip"));
      await waitFor(() => expect(screen.queryByTestId("tour-overlay")).toBeNull());
      expect(root.hasAttribute("inert")).toBe(true);
    } finally {
      root.remove();
    }
  });

  describe("what the caption says", () => {
    it("says Radio needs a download on an installation with no HVSC collection", async () => {
      renderDriver();
      await startTour();
      for (let index = 0; index < 2; index += 1) fireEvent.click(screen.getByTestId("tour-next"));
      await waitFor(() =>
        expect(screen.getByTestId("tour-overlay")).toHaveAttribute("data-tour-step", "listening-without-a-c64"),
      );
      expect(screen.getByTestId("tour-body").textContent).toContain("download");
    });

    it("does not mention a download once the HVSC collection is installed", async () => {
      localStorage.setItem("c64u_hvsc_state:v1", JSON.stringify({ installedVersion: 84 }));
      renderDriver();
      await startTour();
      for (let index = 0; index < 2; index += 1) fireEvent.click(screen.getByTestId("tour-next"));
      await waitFor(() =>
        expect(screen.getByTestId("tour-overlay")).toHaveAttribute("data-tour-step", "listening-without-a-c64"),
      );
      expect(screen.getByTestId("tour-body").textContent).not.toContain("download");
    });

    it("says a connected device lacks the feature when its anchor never appears", async () => {
      connectionRef.current = { isConnected: true };
      renderDriver();
      await act(async () => {
        requestTourStart({ fromStepId: "live-view", throughStepId: "live-view" });
        await Promise.resolve();
      });
      await screen.findByTestId("tour-overlay");
      const live = TOUR_STEPS.find((step) => step.id === "live-view")!;
      await waitFor(() => expect(screen.getByTestId("tour-body").textContent).toBe(live.unavailableBody), {
        timeout: 4_000,
      });
    });
  });

  /*
   * On a Pixel 4 at 320 x 427 CSS px the caption covered the Radio tile it was describing: the
   * resolver had scrolled the tile to the middle of the page, under a caption that covered the
   * bottom two thirds. The tour now scrolls the anchor's own container until it sits clear.
   */
  it("scrolls an anchor the caption would cover into the part of the screen it leaves free", async () => {
    const originalObserver = globalThis.ResizeObserver;
    const originalHeight = window.innerHeight;
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      constructor(private readonly callback: () => void) {}
      observe() {
        this.callback();
      }
      disconnect() {}
    };
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 427 });
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      if (this.dataset.testid === "tour-caption") return { top: 277, height: 150, width: 320 } as DOMRect;
      return originalRect.call(this);
    };
    const container = document.createElement("div");
    container.style.overflowY = "auto";
    Object.defineProperty(container, "scrollHeight", { configurable: true, value: 2000 });
    Object.defineProperty(container, "clientHeight", { configurable: true, value: 300 });
    // Like Home's page shell: the page scrolls between the app bar and the tab bar.
    container.getBoundingClientRect = () => ({ top: 87, bottom: 337, height: 250, width: 320 }) as DOMRect;
    const scrollBy = vi.fn();
    container.scrollBy = scrollBy as unknown as typeof container.scrollBy;
    document.body.appendChild(container);
    const anchor = mountAnchor("home-search-field", { top: 200, left: 10, width: 300, height: 200 });
    container.appendChild(anchor);
    onTestFinished(() => {
      (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = originalObserver;
      Object.defineProperty(window, "innerHeight", { configurable: true, value: originalHeight });
      HTMLElement.prototype.getBoundingClientRect = originalRect;
      container.remove();
    });

    renderDriver();
    await startTour();
    fireEvent.click(screen.getByTestId("tour-next"));
    await waitFor(() => expect(screen.getByTestId("tour-overlay")).toHaveAttribute("data-tour-step", "search"));

    // The caption goes on top (150 px), leaving 150..337 of the page. The anchor, 194..406 with its
    // padding, is taller than that band, so it is scrolled until its top shows: 194 - (150 + 8).
    await waitFor(() => expect(scrollBy).toHaveBeenCalledWith({ top: 36, behavior: "instant" }));
  });

  /*
   * An anchor on a page that does not scroll, with the Pixel's 30 px status bar: nothing to scroll,
   * so the caption takes the edge that leaves the anchor showing, and its fold button's icon says
   * which way it will move.
   */
  it("puts the caption on the edge that leaves an unscrollable anchor showing", async () => {
    const originalObserver = globalThis.ResizeObserver;
    const originalHeight = window.innerHeight;
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      constructor(private readonly callback: () => void) {}
      observe() {
        this.callback();
      }
      disconnect() {}
    };
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 427 });
    document.documentElement.style.setProperty("--safe-area-inset-top", "30px");
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      if (this.dataset.testid === "tour-caption") return { top: 0, height: 150, width: 320 } as DOMRect;
      return originalRect.call(this);
    };
    const anchor = mountAnchor("home-search-field", { top: 330, left: 10, width: 300, height: 44 });
    onTestFinished(() => {
      (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = originalObserver;
      Object.defineProperty(window, "innerHeight", { configurable: true, value: originalHeight });
      HTMLElement.prototype.getBoundingClientRect = originalRect;
      document.documentElement.style.removeProperty("--safe-area-inset-top");
      anchor.remove();
    });

    renderDriver();
    await startTour();
    fireEvent.click(screen.getByTestId("tour-next"));
    await waitFor(() => expect(screen.getByTestId("tour-caption")).toHaveAttribute("data-placement", "top"));
    const icon = () => screen.getByTestId("tour-toggle-text").querySelector("svg")!.getAttribute("class") ?? "";
    expect(icon()).toContain("panel-top-close");

    fireEvent.click(screen.getByTestId("tour-toggle-text"));
    await waitFor(() => expect(icon()).toContain("panel-top-open"));
  });

  it("walks on with Enter or Space when focus has left the guide's buttons", async () => {
    renderDriver();
    await startTour();
    (document.activeElement as HTMLElement | null)?.blur();

    fireEvent.keyDown(window, { key: "Enter", code: "Enter" });
    await waitFor(() => expect(screen.getByTestId("tour-progress")).toHaveAttribute("data-step", "2"));
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(window, { key: " ", code: "Space" });
    await waitFor(() => expect(screen.getByTestId("tour-progress")).toHaveAttribute("data-step", "3"));
  });

  it("does not try to give focus back to an element that has left the page", async () => {
    const before = document.createElement("button");
    document.body.appendChild(before);
    before.focus();
    const focus = vi.spyOn(before, "focus");
    renderDriver();
    await startTour();
    before.remove();

    fireEvent.click(screen.getByTestId("tour-skip"));
    await waitFor(() => expect(screen.queryByTestId("tour-overlay")).toBeNull());
    expect(focus).not.toHaveBeenCalled();
  });

  // Focus stays on Next as the user walks on, so a screen reader had nothing new to read.
  it("announces each step's title and text to a screen reader", async () => {
    renderDriver();
    await startTour();
    const announcement = screen.getByTestId("tour-announcement");
    expect(announcement).toHaveAttribute("aria-live", "polite");
    expect(announcement.textContent).toBe(
      `Step 1 of ${TOUR_STEPS.length}. ${TOUR_STEPS[0].title}. ${TOUR_STEPS[0].body}`,
    );

    fireEvent.click(screen.getByTestId("tour-next"));
    await waitFor(() => expect(announcement.textContent).toContain(TOUR_STEPS[1].title));
    const dialog = screen.getByTestId("tour-overlay");
    expect(document.getElementById(dialog.getAttribute("aria-labelledby")!)?.textContent).toBe(TOUR_STEPS[1].title);
  });

  // Toasts render inside the app, which the tour makes inert: one left open drew over the caption
  // and could not be dismissed.
  it("dismisses the toasts on screen when it opens", async () => {
    const toasts = await import("@/hooks/use-toast");
    const dismiss = vi.spyOn(toasts, "dismissAllToasts");
    renderDriver();
    await startTour();
    expect(dismiss).toHaveBeenCalled();
    dismiss.mockRestore();
  });
});
