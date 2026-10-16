/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SCROLL_INDICATOR_IDLE_MS, ScrollPositionIndicator } from "@/components/ScrollPositionIndicator";
import { ScreenActivityProvider } from "@/hooks/useScreenActivity";

const defineMetrics = (element: HTMLElement, metrics: { scrollHeight: number; clientHeight: number }) => {
  Object.defineProperty(element, "scrollHeight", { configurable: true, value: metrics.scrollHeight });
  Object.defineProperty(element, "clientHeight", { configurable: true, value: metrics.clientHeight });
  Object.defineProperty(element, "clientWidth", { configurable: true, value: 320 });
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    top: 50,
    left: 0,
    right: 320,
    bottom: 50 + metrics.clientHeight,
    width: 320,
    height: metrics.clientHeight,
    x: 0,
    y: 50,
    toJSON: () => ({}),
  });
};

const scrollTo = async (element: HTMLElement, scrollTop: number) => {
  element.scrollTop = scrollTop;
  element.dispatchEvent(new Event("scroll"));
  await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
};

const indicator = () => document.querySelector<HTMLElement>('[data-testid="scroll-position-indicator"]');
const thumb = () => indicator()?.firstElementChild as HTMLElement | null;

describe("ScrollPositionIndicator", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    cleanup();
    document.querySelectorAll("main, [data-app-surface]").forEach((element) => element.remove());
  });

  it("shows a proportional thumb at the right edge while the page scrolls", async () => {
    const page = document.createElement("main");
    document.body.appendChild(page);
    defineMetrics(page, { scrollHeight: 1600, clientHeight: 408 });
    render(<ScrollPositionIndicator target={page} />);

    expect(indicator()).toHaveAttribute("data-visible", "false");
    expect(indicator()?.parentElement).toBe(document.body);

    await scrollTo(page, 1192);

    expect(indicator()).toHaveAttribute("data-visible", "true");
    // A 400px track from y=54 and a 102px thumb (408/1600 of it), at the bottom of the track.
    expect(thumb()?.style.height).toBe("102px");
    expect(thumb()?.style.transform).toBe("translate3d(315px, 352px, 0)");
  });

  it("holds for 840 ms after scrolling, then retains tracking until the opacity fade finishes", () => {
    vi.useFakeTimers();
    const page = document.createElement("main");
    document.body.appendChild(page);
    defineMetrics(page, { scrollHeight: 1600, clientHeight: 408 });
    render(<ScrollPositionIndicator target={page} />);
    page.scrollTop = 100;
    act(() => {
      page.dispatchEvent(new Event("scroll"));
      vi.advanceTimersByTime(20);
    });
    expect(indicator()).toHaveAttribute("data-visible", "true");

    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(indicator()).toHaveAttribute("data-visible", "true");
    act(() => {
      vi.advanceTimersByTime(240);
    });
    expect(indicator()).toHaveAttribute("data-visible", "false");
    expect(thumb()).toHaveAttribute("data-tracking", "true");
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(thumb()).toHaveAttribute("data-tracking", "false");
  });

  it("shows on first entry and every return to a kept page without needing a scroll event", () => {
    vi.useFakeTimers();
    const page = document.createElement("main");
    document.body.appendChild(page);
    defineMetrics(page, { scrollHeight: 1600, clientHeight: 408 });
    const view = (active: boolean) => (
      <ScreenActivityProvider active={active}>
        <ScrollPositionIndicator target={page} showOnPageEntry />
      </ScreenActivityProvider>
    );
    const { rerender } = render(view(true));
    act(() => vi.advanceTimersByTime(20));
    expect(indicator()).toHaveAttribute("data-visible", "true");
    act(() => vi.advanceTimersByTime(SCROLL_INDICATOR_IDLE_MS + 300));
    expect(indicator()).toHaveAttribute("data-visible", "false");
    rerender(view(false));
    expect(indicator()).toHaveAttribute("hidden");
    act(() => {
      page.dispatchEvent(new Event("scroll"));
      vi.advanceTimersByTime(20);
    });
    expect(indicator()).toHaveAttribute("data-visible", "false");
    page.scrollTop = 800;
    rerender(view(true));
    expect(indicator()).not.toHaveAttribute("hidden");
    act(() => vi.advanceTimersByTime(20));
    expect(indicator()).toHaveAttribute("data-visible", "true");
    expect(thumb()?.style.transform).toBe("translate3d(315px, 254px, 0)");
  });

  it("waits for launch and the page slide to finish before showing the entry marker", async () => {
    vi.useFakeTimers();
    const shell = document.createElement("div");
    shell.dataset.launchPhase = "fade-out";
    const runway = document.createElement("div");
    runway.dataset.runwayPhase = "transitioning";
    const page = document.createElement("main");
    shell.appendChild(runway);
    runway.appendChild(page);
    document.body.appendChild(shell);
    defineMetrics(page, { scrollHeight: 1600, clientHeight: 408 });
    const { unmount } = render(<ScrollPositionIndicator target={page} showOnPageEntry />);
    act(() => vi.advanceTimersByTime(1000));
    expect(indicator()).toHaveAttribute("data-visible", "false");
    await act(async () => {
      shell.dataset.launchPhase = "app-ready";
    });
    act(() => vi.advanceTimersByTime(20));
    expect(indicator()).toHaveAttribute("data-visible", "false");
    await act(async () => {
      runway.dataset.runwayPhase = "idle";
    });
    act(() => vi.advanceTimersByTime(20));
    expect(indicator()).toHaveAttribute("data-visible", "true");
    unmount();
    shell.remove();
  });

  it.each([false, true])("stays hidden when the content fits (show on entry: %s)", async (showOnPageEntry) => {
    const page = document.createElement("main");
    document.body.appendChild(page);
    defineMetrics(page, { scrollHeight: 408, clientHeight: 408 });
    render(<ScrollPositionIndicator target={page} showOnPageEntry={showOnPageEntry} />);
    await scrollTo(page, 0);
    expect(indicator()).toHaveAttribute("data-visible", "false");
  });

  it("draws inside the sheet or dialog that owns the scroll body", async () => {
    const sheet = document.createElement("div");
    sheet.setAttribute("data-app-surface", "sheet");
    const body = document.createElement("div");
    sheet.appendChild(body);
    document.body.appendChild(sheet);
    defineMetrics(body, { scrollHeight: 1600, clientHeight: 408 });
    vi.spyOn(sheet, "getBoundingClientRect").mockReturnValue({
      top: 40,
      left: 0,
      right: 320,
      bottom: 426,
      width: 320,
      height: 386,
      x: 0,
      y: 40,
      toJSON: () => ({}),
    });
    render(<ScrollPositionIndicator target={body} />);

    expect(indicator()?.parentElement).toBe(sheet);
    expect(indicator()).toHaveAttribute("data-host", "surface");
    await scrollTo(body, 0);
    expect(thumb()?.style.transform).toBe("translate3d(315px, 14px, 0)");
  });

  it("hands the travel to a scroll-driven animation where the browser has one", async () => {
    vi.stubGlobal("CSS", { ...globalThis.CSS, supports: () => true });
    const page = document.createElement("main");
    document.body.appendChild(page);
    defineMetrics(page, { scrollHeight: 1600, clientHeight: 408 });
    const { unmount } = render(<ScrollPositionIndicator target={page} />);

    const timeline = page.style.getPropertyValue("scroll-timeline").split(" ")[0];
    expect(timeline).toMatch(/^--scroll-position-\d+$/);
    expect(document.body.style.getPropertyValue("timeline-scope")).toContain(timeline);
    expect(thumb()).toHaveAttribute("data-mode", "timeline");
    expect(thumb()?.style.getPropertyValue("--scroll-indicator-timeline")).toBe(timeline);

    expect(thumb()).toHaveAttribute("data-tracking", "false");
    await scrollTo(page, 600);
    expect(indicator()).toHaveAttribute("data-visible", "true");
    expect(thumb()).toHaveAttribute("data-tracking", "true");
    expect(thumb()?.style.transform).toBe("");
    expect(thumb()?.style.getPropertyValue("--scroll-indicator-from")).toBe("54px");
    expect(thumb()?.style.getPropertyValue("--scroll-indicator-to")).toBe("352px");

    unmount();
    expect(page.style.getPropertyValue("scroll-timeline")).toBe("");
    expect(document.body.style.getPropertyValue("timeline-scope")).toBe("");
  });
});
