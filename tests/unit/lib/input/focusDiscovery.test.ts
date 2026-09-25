/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { FocusController } from "@/lib/input/focusController";
import { FocusDiscoveryEngine, type ExplicitRegistration } from "@/lib/input/focusDiscovery";

const mount = (html: string): HTMLElement => {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
};

const el = (id: string): HTMLElement => document.querySelector(`#${id}`)!;

const makeEngine = (explicit: ExplicitRegistration[] = [], freezeDuringTransientLayer?: () => boolean) => {
  const controller = new FocusController();
  const engine = new FocusDiscoveryEngine({
    controller,
    listExplicit: () => explicit,
    freezeDuringTransientLayer,
  });
  return { controller, engine };
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("FocusDiscoveryEngine", () => {
  it("auto-discovers interactive elements into the ring in DOM order, no wiring", () => {
    mount(`<button id="one">1</button><button id="two">2</button><button id="three">3</button>`);
    const { controller, engine } = makeEngine();
    engine.start();

    const ids = controller.list().map((item) => item.id);
    expect(ids).toHaveLength(3);
    expect(controller.current()).not.toBeNull();
    expect(ids.map((id) => engine.sourceForId(id))).toEqual(["dom", "dom", "dom"]);
    // Traverses all three by Down with no per-component registration.
    const visited = [controller.current()!.id];
    visited.push(controller.focusNext()!.id, controller.focusNext()!.id);
    expect(new Set(visited).size).toBe(3);
    engine.stop();
  });

  it("puts the tab bar after the page content, wherever the content has scrolled to", () => {
    // The tab bar sits outside the scrolling `main.page-shell`, so a single sort over the union of
    // both by viewport position interleaved them: on a 320x427 screen the whole tab bar landed
    // between every one or two content stops, because content that had scrolled above the tab bar
    // sorted before it and content still below it sorted after.
    mount(`
      <main id="scroller">
        <button id="content-top">top</button>
        <button id="content-bottom">bottom</button>
      </main>
      <nav data-focus-scope="tabbar">
        <button id="tab-a">A</button>
        <button id="tab-b">B</button>
      </nav>
    `);
    const scroller = el("scroller");
    let scrolled = 0;
    Object.defineProperty(scroller, "scrollTop", { configurable: true, get: () => scrolled });
    const layOut = (id: string, documentTop: number, scrolls: boolean) => {
      Object.defineProperty(el(id), "getBoundingClientRect", {
        configurable: true,
        value: () => ({ top: documentTop - (scrolls ? scrolled : 0), left: 0, width: 100, height: 20 }) as DOMRect,
      });
    };
    layOut("content-top", 10, true);
    layOut("content-bottom", 400, true);
    // The tab bar does not move when the content scrolls.
    layOut("tab-a", 300, false);
    layOut("tab-b", 300, false);

    const { controller, engine } = makeEngine();
    const order = (scroll: number) => {
      scrolled = scroll;
      engine.stop();
      engine.start();
      return controller.list().map((item) => engine.elementForId(item.id)?.id ?? item.id);
    };

    for (const scroll of [0, 150, 390]) {
      expect(order(scroll)).toEqual(["content-top", "content-bottom", "tab-a", "tab-b"]);
    }
    engine.stop();
  });

  it("builds groups from DOM containment so the top level traverses cards, OK descends", () => {
    mount(`
      <div data-focus-group="card-a" id="card-a">
        <button id="a-primary">primary</button>
        <button id="a-secondary">secondary</button>
      </div>
      <div data-focus-group="card-b" id="card-b">
        <button id="b-primary">primary</button>
      </div>
      <button id="loose">loose</button>
    `);
    const { controller, engine } = makeEngine();
    engine.start();

    // Top-level ring = the two cards + the loose button (children are hidden until descend).
    expect(controller.current()?.id).toBe("card-a");
    expect(controller.hasEnabledChildren("card-a")).toBe(true);
    const childEls = controller.enabledChildrenOf("card-a").map((i) => engine.elementForId(i.id)?.id);
    expect(childEls).toEqual(["a-primary", "a-secondary"]);
    expect(controller.focusNext()?.id).toBe("card-b"); // next card, not its child
    expect(engine.elementForId(controller.focusNext()!.id)?.id).toBe("loose");
    // Descend into card-a.
    controller.setCurrent("card-a");
    expect(engine.elementForId(controller.focusFirstChild()!.id)?.id).toBe("a-primary");
    expect(engine.elementForId(controller.focusNext()!.id)?.id).toBe("a-secondary");
    expect(controller.focusParent()?.id).toBe("card-a");
    engine.stop();
  });

  it("treats existing labelled sections as implicit focus groups", () => {
    mount(`
      <section id="streams" data-section-label="Streams">
        <button id="edit">edit</button>
        <button id="start">start</button>
      </section>
      <section id="docs" data-section-label="Docs">
        <button id="toggle">toggle</button>
      </section>
    `);
    const { controller, engine } = makeEngine();
    engine.start();

    expect(controller.current()?.group).toBe("Streams");
    expect(engine.elementForId(controller.current()!.id)?.id).toBe("streams");
    expect(
      controller.enabledChildrenOf(controller.current()!.id).map((item) => engine.elementForId(item.id)?.id),
    ).toEqual(["edit", "start"]);
    expect(engine.elementForId(controller.focusNext()!.id)?.id).toBe("docs");
    engine.stop();
  });

  /*
   * Home's System info is a <button> that carries data-section-label and has no interactive
   * children. It was discovered as a group, found to be empty, and dropped from the ring, so no
   * key could reach it: the ring went from the Config card straight to the tab bar.
   */
  it("keeps a labelled section that is itself a control and has no children", () => {
    mount(`
      <section id="streams" data-section-label="Streams">
        <button id="edit">edit</button>
      </section>
      <button id="system-info" data-section-label="System info">App 1.0.5</button>
      <div id="decoration" data-section-label="Decoration"></div>
    `);
    const { controller, engine } = makeEngine();
    engine.start();

    const ids = controller.list().map((item) => engine.elementForId(item.id)?.id);
    expect(ids).toContain("system-info");
    // Still a leaf, not a card to descend into, and the decorative container is still dropped.
    expect(
      controller.hasEnabledChildren(
        controller.list().find((item) => engine.elementForId(item.id)?.id === "system-info")!.id,
      ),
    ).toBe(false);
    expect(ids).not.toContain("decoration");
    engine.stop();
  });

  it("promotes only the innermost labelled section when sections nest (no needless descend)", () => {
    // Mirrors Home: an outer "Quick Config" wrapper around inner cards. The outer
    // wrapper must NOT become a focus stop that swallows the whole section and
    // forces an extra OK-descend; the inner cards are the top-level groups.
    mount(`
      <section id="quick-config" data-section-label="Quick Config">
        <section id="cpu" data-section-label="CPU & RAM">
          <button id="turbo">turbo</button>
          <button id="speed">speed</button>
        </section>
        <section id="ports" data-section-label="Ports">
          <button id="joystick">joystick</button>
        </section>
      </section>
    `);
    const { controller, engine } = makeEngine();
    engine.start();

    const topLevel = controller
      .list()
      .filter((item) => !item.parentId)
      .map((item) => engine.elementForId(item.id)?.id);
    expect(topLevel).toEqual(["cpu", "ports"]);
    expect(controller.list().map((item) => engine.elementForId(item.id)?.id)).not.toContain("quick-config");

    // Current starts on the first inner card; OK descends straight to its controls.
    expect(engine.elementForId(controller.current()!.id)?.id).toBe("cpu");
    expect(controller.current()?.group).toBe("CPU & RAM");
    expect(
      controller.enabledChildrenOf(controller.current()!.id).map((item) => engine.elementForId(item.id)?.id),
    ).toEqual(["turbo", "speed"]);
    engine.stop();
  });

  it("treats app modal and sheet content roots as implicit focus groups", () => {
    mount(`
      <button id="behind">behind</button>
      <div role="dialog" id="dialog" data-modal-surface="confirmation">
        <button id="confirm">confirm</button>
        <button id="cancel">cancel</button>
      </div>
    `);
    const { controller, engine } = makeEngine();
    engine.start();

    const current = controller.current();
    expect(current?.group).toBe("confirmation");
    expect(engine.elementForId(current!.id)?.id).toBe("dialog");
    expect(controller.enabledChildrenOf(current!.id).map((item) => engine.elementForId(item.id)?.id)).toEqual([
      "confirm",
      "cancel",
    ]);
    expect(controller.list().map((item) => engine.elementForId(item.id)?.id)).not.toContain("behind");
    engine.stop();
  });

  it("names a dialog group by its visible title rather than its presentation attribute", () => {
    mount(`
      <div role="dialog" id="dialog" aria-labelledby="title" data-sheet-presentation="sheet">
        <h2 id="title">Diagnostics</h2>
        <button id="run">Run health check</button>
        <button id="close">Close</button>
      </div>
    `);
    const { controller, engine } = makeEngine();
    engine.start();

    expect(controller.current()?.group).toBe("Diagnostics");
    engine.stop();
  });

  it("shims tabindex on non-natively-focusable elements while running and removes it on stop", () => {
    mount(`<div data-focus-group="card" id="card"><button id="btn">b</button></div>`);
    const { engine } = makeEngine();
    engine.start();
    expect(el("card").getAttribute("tabindex")).toBe("-1");
    expect(el("btn").hasAttribute("tabindex")).toBe(false); // native — no shim
    engine.stop();
    expect(el("card").hasAttribute("tabindex")).toBe(false);
  });

  it("lets an explicit registration refine id, order, and activation", () => {
    mount(`<button id="real">real</button>`);
    const activate = vi.fn();
    const { controller, engine } = makeEngine([
      { descriptor: { id: "custom-id", activate }, resolveElement: () => el("real") },
    ]);
    engine.start();
    expect(controller.list().map((i) => i.id)).toEqual(["custom-id"]);
    expect(engine.sourceForId("custom-id")).toBe("dom+explicit");
    controller.setCurrent("custom-id");
    controller.activateCurrent();
    expect(activate).toHaveBeenCalledTimes(1);
    engine.stop();
  });

  it("reports descriptor-only items separately from DOM-discovered controls", () => {
    mount(`<button id="real">real</button><div id="proxy">proxy</div>`);
    const { controller, engine } = makeEngine([
      { descriptor: { id: "proxy-id", activate: vi.fn() }, resolveElement: () => el("proxy") },
    ]);
    engine.start();

    const proxy = controller.list().find((item) => item.id === "proxy-id");
    expect(proxy).toBeDefined();
    expect(engine.sourceForId("proxy-id")).toBe("explicit");
    expect(controller.list().map((item) => engine.sourceForId(item.id))).toContain("dom");
    engine.stop();
  });

  it("opts an auto-discovered element out of the ring via a skip descriptor", () => {
    mount(`<button id="keep">keep</button><button id="drop">drop</button>`);
    const { controller, engine } = makeEngine([
      { descriptor: { id: "drop", skip: true }, resolveElement: () => el("drop") },
    ]);
    engine.start();
    expect(controller.list().map((i) => engine.elementForId(i.id)?.id)).toEqual(["keep"]);
    engine.stop();
  });

  it("switches scope to an ungrouped open dialog and makes the page behind inert", () => {
    mount(`
      <button id="behind">behind</button>
      <div role="dialog" id="dialog"><button id="confirm">confirm</button><button id="cancel">cancel</button></div>
    `);
    const { controller, engine } = makeEngine();
    engine.start();
    // Only the dialog's two buttons are in the ring; the page button behind is inert.
    expect(controller.list()).toHaveLength(2);
    const resolved = controller.list().map((item) => engine.elementForId(item.id)?.id);
    expect(resolved).toEqual(["confirm", "cancel"]);
    expect(resolved).not.toContain("behind");
    engine.stop();
  });

  it("returns the ring to the item that opened an overlay once the overlay closes", () => {
    mount(`<button id="first">first</button><button id="opener">opener</button><button id="last">last</button>`);
    const { controller, engine } = makeEngine();
    engine.start();
    const idOf = (domId: string) => controller.list().find((item) => engine.elementForId(item.id)?.id === domId)!.id;
    controller.setCurrent(idOf("opener"));

    const listbox = mount(
      `<div role="listbox" id="menu"><button id="option-a">A</button><button id="option-b">B</button></div>`,
    );
    engine.refresh();
    expect(engine.elementForId(controller.current()!.id)?.id).toBe("option-a");
    controller.focusNext();

    listbox.remove();
    engine.refresh();

    expect(engine.elementForId(controller.current()!.id)?.id).toBe("opener");
    engine.stop();
  });

  describe("an opener that is disabled while the overlay closes", () => {
    const openAndCloseOverDisabledOpener = () => {
      mount(`<button id="first">first</button><button id="opener">opener</button><button id="last">last</button>`);
      const { controller, engine } = makeEngine();
      engine.start();
      const idOf = (domId: string) => controller.list().find((item) => engine.elementForId(item.id)?.id === domId)!.id;
      controller.setCurrent(idOf("opener"));
      const listbox = mount(`<div role="listbox"><button id="option">A</button></div>`);
      engine.refresh();
      // The write the choice started is pending, and the opener is disabled until it settles.
      el("opener").setAttribute("disabled", "");
      listbox.remove();
      engine.refresh();
      return { controller, engine, idOf };
    };

    afterEach(() => vi.useRealTimers());

    it("returns to the opener once it is enabled again", () => {
      const { controller, engine } = openAndCloseOverDisabledOpener();
      expect(engine.elementForId(controller.current()!.id)?.id).toBe("first");
      engine.refresh();
      expect(engine.elementForId(controller.current()!.id)?.id).toBe("first");

      el("opener").removeAttribute("disabled");
      engine.refresh();

      expect(engine.elementForId(controller.current()!.id)?.id).toBe("opener");
      engine.stop();
    });

    it("stays where the user moved in the meantime", () => {
      const { controller, engine, idOf } = openAndCloseOverDisabledOpener();
      controller.setCurrent(idOf("last"));

      el("opener").removeAttribute("disabled");
      engine.refresh();

      expect(engine.elementForId(controller.current()!.id)?.id).toBe("last");
      engine.stop();
    });

    it("gives up when the opener stays disabled past the window", () => {
      vi.useFakeTimers();
      const { controller, engine } = openAndCloseOverDisabledOpener();
      vi.advanceTimersByTime(5001);

      el("opener").removeAttribute("disabled");
      engine.refresh();

      expect(engine.elementForId(controller.current()!.id)?.id).toBe("first");
      engine.stop();
    });
  });

  it("returns to the opener when the page behind a closed dialog reappears a scan later", () => {
    // Radix unhides the page behind a dialog after the dialog has gone, so the first scan
    // afterwards sees only what was never hidden.
    const page = mount(`<div id="page"><button id="first">first</button><button id="opener">opener</button></div>`);
    mount(`<button id="tab">tab</button>`);
    const { controller, engine } = makeEngine();
    engine.start();
    const openerId = controller.list().find((item) => engine.elementForId(item.id)?.id === "opener")!.id;
    controller.setCurrent(openerId);

    const dialog = mount(`<div role="dialog"><button id="ok">OK</button></div>`);
    engine.refresh();
    page.setAttribute("aria-hidden", "true");
    dialog.remove();
    engine.refresh();
    page.removeAttribute("aria-hidden");
    engine.refresh();

    expect(engine.elementForId(controller.current()!.id)?.id).toBe("opener");
    engine.stop();
  });

  it("keeps the selection on a card whose own stop moves inside it as it opens", () => {
    // Only the innermost labelled container is a group, so opening a card that renders a labelled
    // group of rows takes the card itself out of the ring.
    mount(`<button id="first">first</button>`);
    const card = mount(`<section data-section-label="Ports" id="card"><button id="toggle">Ports</button></section>`);
    const { controller, engine } = makeEngine();
    engine.start();
    const cardId = controller.list().find((item) => engine.elementForId(item.id)?.id === "card")!.id;
    controller.setCurrent(cardId);

    card
      .querySelector("#card")!
      .insertAdjacentHTML(
        "beforeend",
        `<div data-section-label="Ports rows" id="rows"><button id="joystick">Joystick</button><button id="bus">Bus</button></div>`,
      );
    engine.refresh();

    expect(engine.elementForId(controller.current()!.id)?.id).not.toBe("first");
    expect(card.querySelector("#card")!.contains(engine.elementForId(controller.current()!.id))).toBe(true);
    engine.stop();
  });

  it("does not restore a remembered item that the page no longer has", () => {
    const page = mount(`<button id="first">first</button><button id="opener">opener</button>`);
    const { controller, engine } = makeEngine();
    engine.start();
    const openerId = controller.list().find((item) => engine.elementForId(item.id)?.id === "opener")!.id;
    controller.setCurrent(openerId);

    const dialog = mount(`<div role="dialog"><button id="ok">OK</button></div>`);
    engine.refresh();
    page.querySelector("#opener")!.remove();
    dialog.remove();
    engine.refresh();

    expect(engine.elementForId(controller.current()!.id)?.id).toBe("first");
    engine.stop();
  });

  it("freezes discovery while a transient popup layer owns option navigation", () => {
    let freeze = false;
    mount(`<button id="trigger">Pick</button>`);
    const { controller, engine } = makeEngine([], () => freeze);
    engine.start();

    expect(engine.elementForId(controller.current()!.id)?.id).toBe("trigger");

    document.body.insertAdjacentHTML(
      "beforeend",
      `<div role="listbox" id="options"><div role="option" id="option-one" tabindex="0">One</div></div>`,
    );
    freeze = true;
    engine.refresh();

    expect(controller.list().map((item) => engine.elementForId(item.id)?.id)).toEqual(["trigger"]);
    expect(engine.elementForId(controller.current()!.id)?.id).toBe("trigger");

    freeze = false;
    engine.refresh();
    expect(controller.list().map((item) => engine.elementForId(item.id)?.id)).toEqual(["option-one"]);
    engine.stop();
  });

  it("re-scans on DOM mutation (coalesced) and preserves the current selection", async () => {
    mount(`<button id="one">1</button><button id="two">2</button>`);
    const { controller, engine } = makeEngine();
    engine.start();
    controller.focusNext(); // current = "two"
    const currentId = controller.current()?.id;

    const host = document.body.querySelector("div")!;
    const added = document.createElement("button");
    added.id = "three";
    added.textContent = "3";
    host.appendChild(added);
    await new Promise((resolve) => setTimeout(resolve, 0)); // flush observer → coalesced refresh

    expect(controller.list().map((i) => engine.elementForId(i.id)?.id)).toContain("three");
    expect(controller.current()?.id).toBe(currentId); // selection survived the re-scan
    engine.stop();
  });

  it("exposes the scope breadcrumb chain for the descended group", () => {
    mount(`
      <div data-focus-group="settings" id="settings">
        <button id="audio">audio</button>
        <button id="video">video</button>
      </div>
    `);
    const { controller, engine } = makeEngine();
    engine.start();
    expect(engine.currentScopeChain()).toEqual([]); // at root
    controller.setCurrent("settings");
    controller.focusFirstChild();
    engine.refresh(); // recompute chain from the controller's scope
    expect(engine.currentScopeChain().map((i) => i.id)).toEqual(["settings"]);
    engine.stop();
  });
});

describe("mutations inside a skipped subtree", () => {
  /*
   * The ring is the same either way; what this pins is whether the engine does the work to find
   * that out. The search overlay is skipped and rewrites its result list on every keystroke, and
   * each of those rescanned the whole page behind it — over 100 ms per keystroke on a Pixel 4.
   */
  it("do not trigger a rescan", async () => {
    document.body.innerHTML = `
      <div id="page"><button id="a">A</button></div>
      <div id="overlay" role="dialog" data-key-nav-skip="true"><ul id="rows"></ul></div>`;
    const { engine } = makeEngine();
    engine.start();
    const refresh = vi.spyOn(engine, "refresh");

    el("rows").appendChild(document.createElement("li"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(refresh).not.toHaveBeenCalled();
    engine.stop();
  });

  it("still trigger a rescan when the skip attribute itself changes", async () => {
    document.body.innerHTML = `
      <div id="page"><button id="a">A</button></div>
      <div id="overlay" role="dialog" data-key-nav-skip="true"><button id="b">B</button></div>`;
    const { engine } = makeEngine();
    engine.start();
    const refresh = vi.spyOn(engine, "refresh");

    el("overlay").removeAttribute("data-key-nav-skip");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(refresh).toHaveBeenCalled();
    engine.stop();
  });

  // A dialog nested inside a skipped region is the active scope, so its own mutations still count.
  it("still trigger a rescan when the active scope is inside the skipped subtree", async () => {
    document.body.innerHTML = `
      <div id="outer" data-key-nav-skip="true">
        <div id="overlay" role="dialog"><button id="b">B</button></div>
      </div>`;
    const { engine } = makeEngine();
    engine.start();
    const refresh = vi.spyOn(engine, "refresh");

    el("overlay").appendChild(document.createElement("button"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(refresh).toHaveBeenCalled();
    engine.stop();
  });

  /*
   * The moment before the one above: the dialog is being mounted, so the scope has not moved into
   * it yet and containment cannot see it. Without this the ring never learns the dialog is there.
   */
  it("still trigger a rescan when a dialog OPENS inside the skipped subtree", async () => {
    document.body.innerHTML = `
      <div id="page"><button id="a">A</button></div>
      <div id="outer" data-key-nav-skip="true"></div>`;
    const { engine } = makeEngine();
    engine.start();
    const refresh = vi.spyOn(engine, "refresh");

    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.innerHTML = `<button id="b">B</button>`;
    el("outer").appendChild(dialog);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(refresh).toHaveBeenCalled();
    engine.stop();
  });

  /*
   * And the case that must stay cheap. The search overlay's result list is a listbox whose rows
   * are options, rewritten on every keystroke; waking on those is the 100 ms-per-keystroke fault
   * the guard exists to prevent, so the wake test above is deliberately not written against
   * OVERLAY_SELECTOR, which includes listbox.
   */
  it("do not trigger a rescan when a skipped listbox rewrites its own options", async () => {
    document.body.innerHTML = `
      <div id="page"><button id="a">A</button></div>
      <div id="overlay" role="dialog" data-key-nav-skip="true"><ul id="rows" role="listbox"></ul></div>`;
    const { engine } = makeEngine();
    engine.start();
    const refresh = vi.spyOn(engine, "refresh");

    for (let index = 0; index < 3; index += 1) {
      const row = document.createElement("li");
      row.setAttribute("role", "option");
      el("rows").appendChild(row);
    }
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(refresh).not.toHaveBeenCalled();
    engine.stop();
  });
});

describe("a skipped overlay", () => {
  it("is not chosen as the active scope, without walking it", () => {
    document.body.innerHTML = `
      <div id="page"><button id="a">A</button></div>
      <div id="overlay" role="dialog" data-key-nav-skip="true"><button id="b">B</button></div>`;
    const spy = vi.spyOn(el("overlay"), "querySelectorAll");
    const { controller, engine } = makeEngine();

    engine.start();

    expect(controller.list().map((item) => engine.elementForId(item.id)?.id)).toContain("a");
    expect(spy).not.toHaveBeenCalled();
    engine.stop();
  });
});
