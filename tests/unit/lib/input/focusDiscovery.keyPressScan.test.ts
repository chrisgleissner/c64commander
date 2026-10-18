/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { FocusController } from "@/lib/input/focusController";
import { FocusDiscoveryEngine } from "@/lib/input/focusDiscovery";
import { afterRingRescan } from "../../helpers/ringRescan";

const afterObserver = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const startOnCards = () => {
  document.body.innerHTML = `
    <section id="card-a" data-section-scope="config" data-section-label="Card A">
      <div id="body-a"><button id="a1">A1</button></div>
    </section>
    <section id="card-b" data-section-scope="config" data-section-label="Card B">
      <div id="body-b"><button id="b1">B1</button></div>
    </section>`;
  const controller = new FocusController();
  const engine = new FocusDiscoveryEngine({ controller, listExplicit: () => [] });
  engine.start();
  const refresh = vi.spyOn(engine, "refresh");
  return { controller, engine, refresh };
};

const stopsOf = (controller: FocusController) => controller.list().map((item) => item.id);

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("a key press with a ring re-scan pending", () => {
  it("acts on the last ring without scanning when the pending change only added content to a card", async () => {
    const { controller, engine, refresh } = startOnCards();
    const stopsBefore = stopsOf(controller);
    document.getElementById("body-a")!.insertAdjacentHTML("beforeend", `<button id="a2">A2</button>`);
    await afterObserver();
    const computedStyle = vi.spyOn(window, "getComputedStyle");
    const querySelectorAll = vi.spyOn(Element.prototype, "querySelectorAll");

    engine.flushPendingRefresh({ allowStaleRing: true });

    expect(computedStyle).not.toHaveBeenCalled();
    expect(querySelectorAll).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(stopsOf(controller)).toEqual(stopsBefore);
    engine.stop();
  });

  it("acts on the last ring without scanning when nothing is selected yet", async () => {
    const { controller, engine, refresh } = startOnCards();
    vi.spyOn(controller, "current").mockReturnValue(null);
    document.getElementById("body-a")!.insertAdjacentHTML("beforeend", `<button id="a2">A2</button>`);
    await afterObserver();

    engine.flushPendingRefresh({ allowStaleRing: true });

    expect(refresh).not.toHaveBeenCalled();
    engine.stop();
  });

  it("scans inside the press when the selection is the last known stop of its group and rows were added after it", async () => {
    const { controller, engine, refresh } = startOnCards();
    controller.setCurrent("a1");
    const current = controller.current()!;
    const lastOfGroup = controller
      .list()
      .filter((item) => (item.parentId ?? null) === (current.parentId ?? null))
      .at(-1)!;
    controller.setCurrent(lastOfGroup.id);
    document.getElementById("body-b")!.insertAdjacentHTML("beforeend", `<button id="b2">B2</button>`);
    await afterObserver();

    engine.flushPendingRefresh({ allowStaleRing: true });

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(engine.isRingStop(document.getElementById("b2")!)).toBe(true);
    engine.stop();
  });

  it("scans after the next paint and picks up the content the key did not wait for", async () => {
    const { controller, engine, refresh } = startOnCards();
    document.getElementById("body-a")!.insertAdjacentHTML("beforeend", `<button id="a2">A2</button>`);
    await afterObserver();
    engine.flushPendingRefresh({ allowStaleRing: true });

    await afterRingRescan();

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(controller.list().length).toBeGreaterThan(0);
    expect(engine.isRingStop(document.getElementById("a2")!)).toBe(true);
    engine.stop();
  });

  it("still scans inside the press when the caller does not accept a stale ring", async () => {
    const { engine, refresh } = startOnCards();
    document.getElementById("body-a")!.insertAdjacentHTML("beforeend", `<button id="a2">A2</button>`);
    await afterObserver();

    engine.flushPendingRefresh();

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(engine.isRingStop(document.getElementById("a2")!)).toBe(true);
    engine.stop();
  });

  it("scans inside the press when the pending change opened a dialog", async () => {
    const { engine, refresh } = startOnCards();
    document
      .getElementById("body-a")!
      .insertAdjacentHTML("beforeend", `<div role="dialog"><button id="in-dialog">Dialog</button></div>`);
    await afterObserver();

    engine.flushPendingRefresh({ allowStaleRing: true });

    expect(refresh).toHaveBeenCalledTimes(1);
    engine.stop();
  });

  it("scans inside the press when a stop of the last ring has been removed", async () => {
    const { engine, refresh } = startOnCards();
    document.getElementById("a1")!.remove();
    await afterObserver();

    engine.flushPendingRefresh({ allowStaleRing: true });

    expect(refresh).toHaveBeenCalledTimes(1);
    engine.stop();
  });

  it("scans inside the press when the change was outside any card", async () => {
    const { engine, refresh } = startOnCards();
    document.body.insertAdjacentHTML("beforeend", `<button id="loose">Loose</button>`);
    await afterObserver();

    engine.flushPendingRefresh({ allowStaleRing: true });

    expect(refresh).toHaveBeenCalledTimes(1);
    engine.stop();
  });

  it("scans inside the press when a card change is followed by a change outside any card", async () => {
    const { engine, refresh } = startOnCards();
    document.getElementById("body-a")!.insertAdjacentHTML("beforeend", `<button id="a2">A2</button>`);
    await afterObserver();
    document.body.insertAdjacentHTML("beforeend", `<button id="loose">Loose</button>`);
    await afterObserver();

    engine.flushPendingRefresh({ allowStaleRing: true });

    expect(refresh).toHaveBeenCalledTimes(1);
    engine.stop();
  });
});
