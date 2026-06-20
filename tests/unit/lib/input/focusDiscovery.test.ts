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

const makeEngine = (explicit: ExplicitRegistration[] = []) => {
  const controller = new FocusController();
  const engine = new FocusDiscoveryEngine({ controller, listExplicit: () => explicit });
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
