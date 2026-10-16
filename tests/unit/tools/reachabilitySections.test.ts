/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import {
  OPEN_SECTIONS_EXPR,
  chooseReachabilityTarget,
  closeSectionsExpr,
  sectionsOpenedDuring,
} from "../../../tools/hil/reachability_sections.mjs";

const card = (scope: string, id: string, open: boolean) => {
  const section = document.createElement("section");
  section.dataset.sectionScope = scope;
  section.dataset.sectionId = id;
  section.dataset.open = String(open);
  const toggle = document.createElement("button");
  toggle.setAttribute("aria-expanded", String(open));
  toggle.addEventListener("click", () => {
    section.dataset.open = "false";
    toggle.setAttribute("aria-expanded", "false");
  });
  section.appendChild(toggle);
  return section;
};

describe("keypad reachability sweep cleanup", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("closes only the cards the sweep opened, and leaves the reader's own open cards alone", () => {
    const page = document.createElement("div");
    page.dataset.slotActive = "true";
    page.append(card("config", "audio-mixer", true), card("config", "drives", false));
    document.body.appendChild(page);
    const before = JSON.parse(eval(OPEN_SECTIONS_EXPR)) as string[];

    page.append(card("config", "printers", true), card("config", "network", true));
    const opened = sectionsOpenedDuring(before, JSON.parse(eval(OPEN_SECTIONS_EXPR)) as string[]);

    expect(opened).toEqual(["config:printers", "config:network"]);
    expect(eval(closeSectionsExpr(opened))).toBe(2);
    expect(JSON.parse(eval(OPEN_SECTIONS_EXPR))).toEqual(["config:audio-mixer"]);
  });
});

describe("keypad reachability target", () => {
  const pixel = { targetId: "adb:9B0", transport: "adb", serial: "9B0", state: "device" };
  const tunnel = { targetId: "adb:127.0.0.1:45357", transport: "adb", serial: "127.0.0.1:45357", state: "device" };
  const handset = {
    targetId: "ssh:user@handset",
    transport: "ssh",
    serial: "user@handset",
    state: "device",
    route: "container-adb",
  };

  it("sweeps the handset edition on the handset even when a Pixel is attached", () => {
    expect(
      chooseReachabilityTarget([pixel, tunnel, handset], "uk.gleissner.c64uremote", "uk.gleissner.c64uremote"),
    ).toBe(handset);
  });

  it("leaves the default edition to droidctl's usual choice", () => {
    expect(
      chooseReachabilityTarget([pixel, handset], "uk.gleissner.c64commander", "uk.gleissner.c64uremote"),
    ).toBeUndefined();
  });

  it("refuses the handset edition when no handset can be driven", () => {
    expect(() =>
      chooseReachabilityTarget(
        [pixel, { ...handset, route: "attach" }],
        "uk.gleissner.c64uremote",
        "uk.gleissner.c64uremote",
      ),
    ).toThrow(/no drivable handset/);
  });
});
