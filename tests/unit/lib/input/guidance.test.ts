/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";

import {
  MAX_BREADCRUMB_SEGMENTS,
  accessibleLabelFor,
  classifyFocusKind,
  hasContextMenu,
  resolveGuidanceLabels,
  type GuidanceState,
} from "@/lib/input";

/**
 * The guidance bar's label policy is a PURE function of a DOM-free snapshot
 * (CONFIRMED DECISION 3). These tests pin the policy in isolation: visibility
 * gate, the Back/Exit/Close/Done back-chain labels, the OK label per control
 * kind, the Menu soft key, and the breadcrumb cap. The DOM helpers
 * (classify/accessibleLabel/hasContextMenu) are covered against real jsdom nodes.
 */

const baseState: GuidanceState = {
  enabled: true,
  modality: "key-navigation",
  hasCurrent: true,
  currentKind: "button",
  breadcrumb: [],
  atRoot: true,
  fieldEngaged: false,
  layerOpen: false,
  hasMenu: false,
};

const state = (overrides: Partial<GuidanceState> = {}): GuidanceState => ({ ...baseState, ...overrides });

describe("resolveGuidanceLabels — visibility gate (Prime Directive)", () => {
  it("is hidden when the feature flag is off, even in key-navigation modality", () => {
    expect(resolveGuidanceLabels(state({ enabled: false })).visible).toBe(false);
  });

  it("is hidden in pointer modality, even with the flag on", () => {
    expect(resolveGuidanceLabels(state({ modality: "pointer" })).visible).toBe(false);
  });

  it("is visible only when the flag is on AND modality is key-navigation", () => {
    expect(resolveGuidanceLabels(state()).visible).toBe(true);
  });
});

describe("resolveGuidanceLabels — left soft key (back chain order)", () => {
  it("'Close' when an overlay is open (dismiss first)", () => {
    expect(resolveGuidanceLabels(state({ layerOpen: true })).left).toBe("Close");
  });

  it("'Done' when a text field is engaged (disengage before ascend)", () => {
    expect(resolveGuidanceLabels(state({ fieldEngaged: true })).left).toBe("Done");
  });

  it("'Exit' when inside a nested scope (ascend the group)", () => {
    expect(resolveGuidanceLabels(state({ atRoot: false })).left).toBe("Exit");
  });

  it("'Back' at the page root with nothing to unwind", () => {
    expect(resolveGuidanceLabels(state()).left).toBe("Back");
  });

  it("prioritises an open overlay over an engaged field and a nested scope", () => {
    expect(resolveGuidanceLabels(state({ layerOpen: true, fieldEngaged: true, atRoot: false })).left).toBe("Close");
  });
});

describe("resolveGuidanceLabels — center / OK key", () => {
  it("'Open' on a group (OK descends)", () => {
    expect(resolveGuidanceLabels(state({ currentKind: "group" })).center).toBe("Open");
  });

  it.each([
    ["field", "Edit"],
    ["select", "Select"],
    ["switch", "Toggle"],
    ["slider", "Adjust"],
    ["tab", "Switch"],
    ["link", "Open"],
    ["button", "Activate"],
  ] as const)("'%s' control → OK label '%s'", (kind, label) => {
    expect(resolveGuidanceLabels(state({ currentKind: kind })).center).toBe(label);
  });

  it("'Done' while a field is engaged (OK commits/leaves)", () => {
    expect(resolveGuidanceLabels(state({ fieldEngaged: true, currentKind: "field" })).center).toBe("Done");
  });

  it("'Select' while an overlay is open (the open widget owns option choice)", () => {
    expect(resolveGuidanceLabels(state({ layerOpen: true })).center).toBe("Select");
  });

  it("is null when there is no current item", () => {
    expect(resolveGuidanceLabels(state({ hasCurrent: false, currentKind: "none" })).center).toBeNull();
  });
});

describe("resolveGuidanceLabels — right soft key (Menu)", () => {
  it("'Menu' when the current item exposes a context menu", () => {
    expect(resolveGuidanceLabels(state({ hasMenu: true })).right).toBe("Menu");
  });

  it("is hidden (null) when there is no context menu", () => {
    expect(resolveGuidanceLabels(state({ hasMenu: false })).right).toBeNull();
  });
});

describe("resolveGuidanceLabels — breadcrumb", () => {
  it("passes the breadcrumb through when within the cap", () => {
    expect(resolveGuidanceLabels(state({ breadcrumb: ["Audio Mixer", "Volume"] })).breadcrumb).toEqual([
      "Audio Mixer",
      "Volume",
    ]);
  });

  it(`keeps only the last ${MAX_BREADCRUMB_SEGMENTS} segments (tail) when deeper`, () => {
    const deep = ["A", "B", "C", "D", "E"];
    expect(resolveGuidanceLabels(state({ breadcrumb: deep })).breadcrumb).toEqual(["C", "D", "E"]);
  });
});

describe("classifyFocusKind", () => {
  const el = (html: string): Element => {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = html;
    return wrapper.firstElementChild as Element;
  };

  it("a group wins regardless of the element", () => {
    expect(classifyFocusKind(el("<button>X</button>"), true)).toBe("group");
  });

  it("returns 'none' with no element", () => {
    expect(classifyFocusKind(null, false)).toBe("none");
  });

  it.each([
    ['<div role="slider"></div>', "slider"],
    ['<div role="tab"></div>', "tab"],
    ['<div role="switch"></div>', "switch"],
    ['<div role="checkbox"></div>', "switch"],
    ['<div role="radio"></div>', "switch"],
    ['<button role="combobox">Pick</button>', "select"],
    ['<button aria-haspopup="listbox">Pick</button>', "select"],
    ["<select></select>", "select"],
    ['<input type="text" />', "field"],
    ['<input type="checkbox" />', "switch"],
    ['<input type="button" />', "button"],
    ["<textarea></textarea>", "field"],
    ['<a href="#go">Go</a>', "link"],
    ["<a>No href</a>", "button"],
    ["<button>Press</button>", "button"],
    ['<div role="button"></div>', "button"],
  ] as const)("%s → %s", (html, kind) => {
    expect(classifyFocusKind(el(html), false)).toBe(kind);
  });
});

describe("accessibleLabelFor", () => {
  const make = (html: string): Element => {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = html;
    return wrapper.firstElementChild as Element;
  };

  it("prefers an explicit aria-label", () => {
    expect(accessibleLabelFor(make('<button aria-label="Mute audio">x</button>'))).toBe("Mute audio");
  });

  it("falls back to visible text, collapsing whitespace", () => {
    expect(accessibleLabelFor(make("<button>  Save   config </button>"))).toBe("Save config");
  });

  it("falls back to placeholder, then title", () => {
    expect(accessibleLabelFor(make('<input placeholder="Host or IP" />'))).toBe("Host or IP");
    expect(accessibleLabelFor(make('<div title="Tooltip"></div>'))).toBe("Tooltip");
  });

  it("truncates an over-long label with an ellipsis", () => {
    const long = "This is a very very very long accessible name that overflows";
    expect(accessibleLabelFor(make(`<button aria-label="${long}">x</button>`))).toMatch(/…$/);
  });

  it("returns null with nothing readable", () => {
    expect(accessibleLabelFor(make("<button></button>"))).toBeNull();
    expect(accessibleLabelFor(null)).toBeNull();
  });
});

describe("hasContextMenu", () => {
  const mount = (html: string): Element => {
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.appendChild(host);
    return host.firstElementChild as Element;
  };

  it("true when the element itself is a menu trigger", () => {
    expect(hasContextMenu(mount('<button aria-haspopup="menu">More</button>'))).toBe(true);
  });

  it("true when a menu trigger lives in the same [data-key-nav-menu-host]", () => {
    const host = mount(
      '<div data-key-nav-menu-host><button data-testid="cur">Item</button><button data-key-nav-menu>⋮</button></div>',
    );
    const current = host.querySelector('[data-testid="cur"]');
    expect(hasContextMenu(current)).toBe(true);
  });

  it("false when there is no menu", () => {
    expect(hasContextMenu(mount("<button>Plain</button>"))).toBe(false);
    expect(hasContextMenu(null)).toBe(false);
  });
});
