/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, describe, expect, it } from "vitest";

import {
  MAX_BREADCRUMB_SEGMENTS,
  accessibleLabelFor,
  guidanceLabelFor,
  classifyFocusKind,
  hasContextMenu,
  resolveGuidanceLabels,
  resolveSoftKeyMenuOverlayLabels,
  resolveSoftKeyMenuPanelLabels,
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
  fieldDeletes: false,
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
    ["tab", "Open"],
    ["link", "Open"],
    ["menu", "Open menu"],
    ["button", "Press"],
    ["none", "Press"],
  ] as const)("'%s' control → OK label '%s'", (kind, label) => {
    expect(resolveGuidanceLabels(state({ currentKind: kind })).center).toBe(label);
  });

  it("names a control's own verb in place of its kind's label", () => {
    expect(resolveGuidanceLabels(state({ currentKind: "button", centerVerb: "Seek" })).center).toBe("Seek");
  });

  it("offers no OK action on a status, such as a page that is still loading", () => {
    expect(resolveGuidanceLabels(state({ currentKind: "status" })).center).toBeNull();
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

  it("'Delete' in a T9 field with text, where a keypad has no other way to erase", () => {
    expect(resolveGuidanceLabels(state({ fieldDeletes: true, hasMenu: true })).right).toBe("Delete");
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
    ['<button aria-expanded="true">Spectrum</button>', "collapse"],
    ['<button aria-expanded="false">Spectrum</button>', "expand"],
    ['<button aria-expanded="false" aria-haspopup="menu">More</button>', "menu"],
    ['<button aria-haspopup="dialog">Edit</button>', "link"],
    ['<button aria-pressed="false">Watch</button>', "switch"],
  ] as const)("%s → %s", (html, kind) => {
    expect(classifyFocusKind(el(html), false)).toBe(kind);
  });

  it("reads a guide paragraph the ring stops on as text, so the bar offers OK no action there", () => {
    const paragraph = el('<p tabindex="0" data-key-nav-reading="true">Press OK to open a card.</p>');
    expect(classifyFocusKind(paragraph, false)).toBe("status");
  });
});

describe("guidanceLabelFor", () => {
  const make = (html: string): Element => {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = html;
    return wrapper.firstElementChild as Element;
  };

  it("prefers a control's short guidance label over its full accessible name", () => {
    const badge = make(
      '<button aria-label="Connected to c64u, system healthy" data-guidance-label="c64u: healthy"></button>',
    );
    expect(guidanceLabelFor(badge)).toBe("c64u: healthy");
  });

  it("falls back to the accessible name without one", () => {
    expect(guidanceLabelFor(make('<button aria-label="Mute audio">x</button>'))).toBe("Mute audio");
    expect(guidanceLabelFor(make('<button data-guidance-label=" ">Save</button>'))).toBe("Save");
    expect(guidanceLabelFor(null)).toBeNull();
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

  it("names a titled button by the title it shows, not the description the layout hides", () => {
    const toggle = make("<button><span>Connection</span><span>Saved devices, discovery</span></button>");
    Object.defineProperty(toggle, "innerText", { value: "Connection" });

    expect(accessibleLabelFor(toggle)).toBe("Connection");
  });

  it("keeps a title and the description under it apart, naming the title", () => {
    const toggle = make("<button><span>Connection</span><span>Saved devices</span></button>");
    Object.defineProperty(toggle, "innerText", { value: "Connection\nSaved devices" });

    expect(accessibleLabelFor(toggle)).toBe("Connection");
  });

  it("names an entry by its label, not by the key cap drawn before it", () => {
    const entry = make("<button><kbd>6</kbd>Docs</button>");
    Object.defineProperty(entry, "innerText", { value: "6\nDocs" });

    expect(accessibleLabelFor(entry)).toBe("Docs");
  });

  it("names a close button by its screen-reader text, not the glyph it hides from screen readers", () => {
    const close = make('<button><span aria-hidden="true">×</span><span class="sr-only">Close</span></button>');
    Object.defineProperty(close, "innerText", { value: "×\nClose" });

    expect(accessibleLabelFor(close)).toBe("Close");
  });

  describe("a control named by another element", () => {
    const mountInDocument = (html: string) => {
      const host = document.createElement("div");
      host.innerHTML = html;
      document.body.appendChild(host);
      return host;
    };
    afterEach(() => {
      document.body.innerHTML = "";
    });

    it("names a checkbox by its <label for>, not 'Navigation'", () => {
      mountInDocument(`
        <div><label for="hide-status-bar">Hide status bar</label><p>Extend the app over the status bar.</p></div>
        <button role="checkbox" id="hide-status-bar" data-testid="box"></button>`);
      expect(accessibleLabelFor(document.querySelector('[data-testid="box"]'))).toBe("Hide status bar");
    });

    it("names a number field by its <label for> before its placeholder", () => {
      mountInDocument(`<label for="retries">Config write retries</label><input id="retries" placeholder="3" />`);
      expect(accessibleLabelFor(document.getElementById("retries"))).toBe("Config write retries");
    });

    it("names a select by aria-labelledby before the value it shows", () => {
      mountInDocument(`<span id="mode-label">Mode</span>
        <button role="combobox" aria-labelledby="mode-label" id="mode">Fixed Color</button>`);
      expect(accessibleLabelFor(document.getElementById("mode"))).toBe("Mode");
    });

    it("prefers aria-labelledby over aria-label, as the accessible name does", () => {
      mountInDocument(
        `<span id="title">Drive A</span><button aria-labelledby="title" aria-label="Drive" id="b"></button>`,
      );
      expect(accessibleLabelFor(document.getElementById("b"))).toBe("Drive A");
    });

    it("names a control by its wrapping <label>, without the options inside it", () => {
      mountInDocument(
        `<label>Interval <select id="interval"><option>Daily</option><option>Weekly</option></select></label>`,
      );
      expect(accessibleLabelFor(document.getElementById("interval"))).toBe("Interval");
    });

    it("falls back to the control's own text when the labelled-by element is missing or empty", () => {
      mountInDocument(`<span id="empty"> </span><button aria-labelledby="missing empty" id="b">Save</button>`);
      expect(accessibleLabelFor(document.getElementById("b"))).toBe("Save");
    });
  });

  it("still names a control that shows nothing but a key cap", () => {
    const key = make("<button><kbd>F1</kbd></button>");
    Object.defineProperty(key, "innerText", { value: "F1" });

    expect(accessibleLabelFor(key)).toBe("F1");
  });

  it("reads the text of an element that is not an HTML element, such as an SVG label", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.textContent = "Joystick";
    svg.appendChild(text);

    expect(accessibleLabelFor(svg)).toBe("Joystick");
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

describe("resolveSoftKeyMenuOverlayLabels", () => {
  it("names only Close and Menu, under the overlay's title, where the right soft key opens the menu", () => {
    expect(resolveSoftKeyMenuOverlayLabels(true, "Remote Input", "softRight")).toEqual({
      visible: true,
      breadcrumb: ["Remote Input"],
      left: "Close",
      center: null,
      right: "Menu",
      shortcut: null,
    });
  });

  it("names Menu on Back, Return on OK and Delete on the right soft key where Back opens the menu", () => {
    expect(resolveSoftKeyMenuOverlayLabels(true, "Remote Input", "back")).toEqual({
      visible: true,
      breadcrumb: ["Remote Input"],
      left: "Menu",
      center: "Return",
      right: "Delete",
      shortcut: null,
    });
  });

  it("leaves the breadcrumb empty for an overlay with no title, and keeps the visibility it is given", () => {
    const labels = resolveSoftKeyMenuOverlayLabels(false, null, "softRight");

    expect(labels.breadcrumb).toEqual([]);
    expect(labels.visible).toBe(false);
  });
});

describe("resolveSoftKeyMenuPanelLabels", () => {
  it("names Close and Select under the menu's title, and nothing on the right soft key", () => {
    expect(resolveSoftKeyMenuPanelLabels(true, "Remote Input")).toEqual({
      visible: true,
      breadcrumb: ["Remote Input"],
      left: "Close",
      center: "Select",
      right: null,
      shortcut: null,
    });
    expect(resolveSoftKeyMenuPanelLabels(false, null).breadcrumb).toEqual([]);
  });

  it("adds the selected entry after the menu's title", () => {
    expect(resolveSoftKeyMenuPanelLabels(true, "Remote Input", "Release all").breadcrumb).toEqual([
      "Remote Input",
      "Release all",
    ]);
  });
});

describe("accessibleLabelFor — rendered text reads", () => {
  const withRenderedTextCounter = (html: string) => {
    const host = document.createElement("div");
    host.innerHTML = html;
    const element = host.firstElementChild as HTMLElement;
    let reads = 0;
    Object.defineProperty(element, "innerText", {
      get: () => {
        reads += 1;
        return element.textContent;
      },
    });
    return { element, reads: () => reads };
  };

  it("reads the laid-out text once while the element's text stays the same", () => {
    const { element, reads } = withRenderedTextCounter("<section>Connection</section>");

    expect(accessibleLabelFor(element)).toBe("Connection");
    expect(accessibleLabelFor(element)).toBe("Connection");

    expect(reads()).toBe(1);
  });

  it("reads the laid-out text again once the element's text changes", () => {
    const { element, reads } = withRenderedTextCounter("<section>Connection</section>");

    accessibleLabelFor(element);
    element.textContent = "Devices";

    expect(accessibleLabelFor(element)).toBe("Devices");
    expect(reads()).toBe(2);
  });
});
