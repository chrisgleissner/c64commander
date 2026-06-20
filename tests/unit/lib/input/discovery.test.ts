/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  compareFocusables,
  discoverInteractiveElements,
  isFocusDisabled,
  isFocusVisible,
  isHorizontalKeyOwner,
  isNativelyFocusable,
  resolveActiveScope,
} from "@/lib/input/discovery";

const mount = (html: string): HTMLElement => {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("discoverInteractiveElements", () => {
  it("collects interactive elements in DOM order and dedupes", () => {
    const host = mount(`
      <button id="b1">one</button>
      <a id="a1" href="#x">link</a>
      <input id="i1" />
      <div id="role-btn" role="button">role button</div>
      <span id="not-interactive">text</span>
      <span id="slider" role="slider" tabindex="0"></span>
    `);
    const ids = discoverInteractiveElements(host).map((el) => el.id);
    expect(ids).toEqual(["b1", "a1", "i1", "role-btn", "slider"]);
  });

  it("excludes disabled, aria-hidden, hidden, display:none, and skip subtrees", () => {
    const host = mount(`
      <button id="ok">ok</button>
      <button id="disabled" disabled>nope</button>
      <button id="aria-disabled" aria-disabled="true">nope</button>
      <button id="aria-hidden" aria-hidden="true">nope</button>
      <button id="hidden" hidden>nope</button>
      <button id="display-none" style="display:none">nope</button>
      <div data-key-nav-skip>
        <button id="skipped">nope</button>
      </div>
      <input type="hidden" id="hidden-input" />
    `);
    const ids = discoverInteractiveElements(host).map((el) => el.id);
    expect(ids).toEqual(["ok"]);
  });

  it("excludes elements inside an excluded subtree selector (the TabBar)", () => {
    const host = mount(`
      <button id="page-cta">page</button>
      <nav data-focus-scope="tabbar"><button id="tab">tab</button></nav>
    `);
    const ids = discoverInteractiveElements(host, { excludeSubtrees: ["[data-focus-scope='tabbar']"] }).map(
      (el) => el.id,
    );
    expect(ids).toEqual(["page-cta"]);
  });

  it("uses geometry to order same-source elements into reading order when boxes exist", () => {
    const host = mount(`<button id="visually-second">a</button><button id="visually-first">b</button>`);
    const first = host.querySelector<HTMLElement>("#visually-first")!;
    const second = host.querySelector<HTMLElement>("#visually-second")!;
    // jsdom has no layout, so stub the boxes: #visually-first sits on the row above.
    first.getBoundingClientRect = () => ({ top: 0, left: 0, width: 50, height: 20 }) as DOMRect;
    second.getBoundingClientRect = () => ({ top: 40, left: 0, width: 50, height: 20 }) as DOMRect;
    const ids = discoverInteractiveElements(host).map((el) => el.id);
    expect(ids).toEqual(["visually-first", "visually-second"]);
  });
});

describe("resolveActiveScope", () => {
  it("returns the page (body) when no overlay is open", () => {
    mount(`<button>x</button>`);
    const scope = resolveActiveScope(document);
    expect(scope.kind).toBe("page");
    expect(scope.element).toBe(document.body);
  });

  it("prefers an explicit page scope root when present", () => {
    const host = mount(`<div data-focus-scope="page" id="page-root"><button>x</button></div>`);
    const scope = resolveActiveScope(document);
    expect(scope.kind).toBe("page");
    expect(scope.element).toBe(host.querySelector("#page-root"));
  });

  it("switches to the topmost overlay that contains a focusable", () => {
    mount(`
      <button id="behind">behind</button>
      <div role="dialog" id="dialog"><button id="in-dialog">ok</button></div>
    `);
    const scope = resolveActiveScope(document);
    expect(scope.kind).toBe("overlay");
    expect((scope.element as HTMLElement).id).toBe("dialog");
  });

  it("ignores an empty overlay (a content-less popper) and stays on the page", () => {
    mount(`
      <button id="page-cta">x</button>
      <div data-radix-popper-content-wrapper id="empty-tooltip">just text</div>
    `);
    const scope = resolveActiveScope(document);
    expect(scope.kind).toBe("page");
  });

  it("picks the deeper (later) overlay when two are open", () => {
    mount(`
      <div role="dialog" id="outer"><button>a</button></div>
      <div role="listbox" id="inner"><div role="option" tabindex="-1">opt</div></div>
    `);
    // The listbox has only a tabindex=-1 option → no discoverable focusable, so the
    // dialog wins; add a real option to make the listbox the topmost.
    const inner = document.querySelector("#inner")!;
    inner.innerHTML = `<div role="option" tabindex="0">opt</div>`;
    const scope = resolveActiveScope(document);
    expect((scope.element as HTMLElement).id).toBe("inner");
  });
});

describe("predicates", () => {
  it("isFocusVisible walks ancestors for display:none / aria-hidden / inert", () => {
    const host = mount(`
      <div style="display:none"><button id="under-none">x</button></div>
      <div aria-hidden="true"><button id="under-aria">x</button></div>
      <div inert><button id="under-inert">x</button></div>
      <button id="plain">x</button>
    `);
    expect(isFocusVisible(host.querySelector("#under-none")!)).toBe(false);
    expect(isFocusVisible(host.querySelector("#under-aria")!)).toBe(false);
    expect(isFocusVisible(host.querySelector("#under-inert")!)).toBe(false);
    expect(isFocusVisible(host.querySelector("#plain")!)).toBe(true);
  });

  it("isFocusDisabled covers the disabled property, attribute, and aria-disabled", () => {
    const host = mount(`
      <button id="prop" disabled>x</button>
      <div id="aria" role="button" aria-disabled="true">x</div>
      <button id="ok">x</button>
    `);
    expect(isFocusDisabled(host.querySelector("#prop")!)).toBe(true);
    expect(isFocusDisabled(host.querySelector("#aria")!)).toBe(true);
    expect(isFocusDisabled(host.querySelector("#ok")!)).toBe(false);
  });

  it("isNativelyFocusable distinguishes native controls from shim-needing roles", () => {
    const host = mount(`
      <button id="btn">x</button>
      <a id="link" href="#">x</a>
      <a id="anchor">x</a>
      <div id="role-btn" role="button">x</div>
      <span id="tabbed" tabindex="0">x</span>
    `);
    expect(isNativelyFocusable(host.querySelector("#btn")!)).toBe(true);
    expect(isNativelyFocusable(host.querySelector("#link")!)).toBe(true);
    expect(isNativelyFocusable(host.querySelector("#anchor")!)).toBe(false);
    expect(isNativelyFocusable(host.querySelector("#role-btn")!)).toBe(false);
    expect(isNativelyFocusable(host.querySelector("#tabbed")!)).toBe(true);
  });

  it("isHorizontalKeyOwner matches sliders, tablists, radiogroups, and the opt-in attr", () => {
    const host = mount(`
      <span id="thumb" role="slider"></span>
      <div role="tablist"><button id="tab" role="tab">x</button></div>
      <div id="seg" data-key-nav-horizontal><button id="seg-item">x</button></div>
      <button id="plain">x</button>
    `);
    expect(isHorizontalKeyOwner(host.querySelector("#thumb"))).toBe(true);
    expect(isHorizontalKeyOwner(host.querySelector("#tab"))).toBe(true);
    expect(isHorizontalKeyOwner(host.querySelector("#seg-item"))).toBe(true);
    expect(isHorizontalKeyOwner(host.querySelector("#plain"))).toBe(false);
    expect(isHorizontalKeyOwner(null)).toBe(false);
  });
});

describe("compareFocusables", () => {
  it("falls back to DOM order without geometry (jsdom)", () => {
    const host = mount(`<button id="first">a</button><button id="second">b</button>`);
    const a = host.querySelector("#first")!;
    const b = host.querySelector("#second")!;
    expect(compareFocusables(a, b)).toBeLessThan(0);
    expect(compareFocusables(b, a)).toBeGreaterThan(0);
  });
});
