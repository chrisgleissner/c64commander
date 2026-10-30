/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FocusController } from "@/lib/input/focusController";
import { FocusDiscoveryEngine } from "@/lib/input/focusDiscovery";

const afterObserver = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const BUTTON_COUNT = 6;
const engines = new Set<FocusDiscoveryEngine>();

const startOnButtons = (inDialog = false) => {
  document.body.innerHTML = `<main${inDialog ? ' role="dialog"' : ""}>${Array.from(
    { length: BUTTON_COUNT },
    (_, index) => `<button id="b${index}">B${index}</button>`,
  ).join("")}</main>`;
  const controller = new FocusController();
  const engine = new FocusDiscoveryEngine({ controller, listExplicit: () => [] });
  engines.add(engine);
  engine.start();
  const refresh = vi.spyOn(engine, "refresh");
  return { controller, engine, refresh };
};

const addButtonAndReachFirstSlice = async () => {
  document.querySelector("main")!.insertAdjacentHTML("beforeend", `<button id="late">Late</button>`);
  await afterObserver();
  vi.advanceTimersByTime(17);
};

beforeEach(() => {
  vi.useFakeTimers();
  let clock = 0;
  vi.spyOn(performance, "now").mockImplementation(() => {
    clock += 10;
    return clock;
  });
});

afterEach(() => {
  for (const engine of engines) engine.stop();
  engines.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("a ring re-scan after a page change", () => {
  it("measures the page over several tasks and scans once at the end", async () => {
    const { engine, refresh } = startOnButtons();
    await addButtonAndReachFirstSlice();

    expect(refresh).not.toHaveBeenCalled();

    vi.advanceTimersByTime(200);

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(engine.isRingStop(document.getElementById("late")!)).toBe(true);
    engine.stop();
  });

  it("scans on the measurements it took instead of measuring the page again", async () => {
    const { engine, refresh } = startOnButtons();
    await addButtonAndReachFirstSlice();
    vi.advanceTimersByTime(200);

    const warmedScan = refresh.mock.calls[0][0];
    expect(warmedScan?.positions.size).toBeGreaterThanOrEqual(BUTTON_COUNT + 1);
    expect(warmedScan?.visible.size).toBeGreaterThanOrEqual(BUTTON_COUNT + 1);
    engine.stop();
  });

  it("lets a key press that needs a current ring scan at once and ends the slicing", async () => {
    const { engine, refresh } = startOnButtons();
    await addButtonAndReachFirstSlice();
    expect(refresh).not.toHaveBeenCalled();

    engine.flushPendingRefresh();
    expect(refresh).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(200);
    expect(refresh).toHaveBeenCalledTimes(1);
    engine.stop();
  });

  it("discards measurements taken before a further change and scans after it", async () => {
    const { engine, refresh } = startOnButtons();
    await addButtonAndReachFirstSlice();
    document.querySelector("main")!.insertAdjacentHTML("beforeend", `<button id="later">Later</button>`);
    await afterObserver();

    vi.advanceTimersByTime(500);

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(engine.isRingStop(document.getElementById("later")!)).toBe(true);
    engine.stop();
  });

  it("discards measurements taken before the window was resized and scans after it", async () => {
    const { engine, refresh } = startOnButtons();
    await addButtonAndReachFirstSlice();
    const measuredScan = vi.fn();
    window.addEventListener("resize", measuredScan);

    window.dispatchEvent(new Event("resize"));
    vi.advanceTimersByTime(500);
    window.removeEventListener("resize", measuredScan);

    expect(measuredScan).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(engine.isRingStop(document.getElementById("late")!)).toBe(true);
    engine.stop();
  });

  it("scans an open dialog in one task", async () => {
    const { engine, refresh } = startOnButtons();
    document.body.insertAdjacentHTML("beforeend", `<div role="dialog"><button id="in-dialog">Dialog</button></div>`);
    await afterObserver();

    vi.advanceTimersByTime(20);

    expect(refresh).toHaveBeenCalledTimes(1);
    engine.stop();
  });

  it("splits geometry reads across tasks when a large dialog changes its rows", async () => {
    const { engine, refresh } = startOnButtons(true);
    const rectangles = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");
    await addButtonAndReachFirstSlice();

    expect(refresh).not.toHaveBeenCalled();
    expect(rectangles.mock.contexts.filter((element) => element.tagName === "BUTTON")).toHaveLength(1);

    vi.advanceTimersByTime(200);

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(engine.isRingStop(document.getElementById("late")!)).toBe(true);
    engine.stop();
  });

  it("reuses warmed dialog geometry when rebuilding the ring", async () => {
    const { engine, refresh } = startOnButtons(true);
    await addButtonAndReachFirstSlice();
    vi.advanceTimersByTime(200);

    const warmedScan = refresh.mock.calls[0][0];
    expect(warmedScan?.positions.size).toBeGreaterThanOrEqual(BUTTON_COUNT + 1);
    expect(warmedScan?.visible.size).toBeGreaterThanOrEqual(BUTTON_COUNT + 1);
    engine.stop();
  });

  it("lets a key flush a pending dialog scan once before all slices finish", async () => {
    const { engine, refresh } = startOnButtons(true);
    await addButtonAndReachFirstSlice();
    expect(refresh).not.toHaveBeenCalled();

    engine.flushPendingRefresh();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(engine.isRingStop(document.getElementById("late")!)).toBe(true);

    vi.advanceTimersByTime(200);
    expect(refresh).toHaveBeenCalledTimes(1);
    engine.stop();
  });

  it("discards partial dialog measurements when a newer overlay opens", async () => {
    const { controller, engine, refresh } = startOnButtons(true);
    await addButtonAndReachFirstSlice();
    document.body.insertAdjacentHTML("beforeend", `<div role="dialog"><button id="new-dialog">New</button></div>`);
    await afterObserver();

    vi.advanceTimersByTime(500);

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(engine.isRingStop(document.getElementById("new-dialog")!)).toBe(true);
    expect(controller.list().some((item) => engine.elementForId(item.id)?.id === "late")).toBe(false);
    engine.stop();
  });

  it("discards partial dialog measurements when the dialog closes", async () => {
    const { engine, refresh } = startOnButtons(true);
    await addButtonAndReachFirstSlice();
    document.querySelector("main")!.remove();
    document.body.insertAdjacentHTML("beforeend", `<button id="page-return">Page</button>`);
    await afterObserver();

    vi.advanceTimersByTime(500);

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(engine.isRingStop(document.getElementById("page-return")!)).toBe(true);
    engine.stop();
  });
});
