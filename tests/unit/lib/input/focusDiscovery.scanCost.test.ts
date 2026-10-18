/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { FocusController } from "@/lib/input/focusController";
import { createDiscoveryScan, isSkipped } from "@/lib/input/discovery";
import { FocusDiscoveryEngine, type ExplicitRegistration } from "@/lib/input/focusDiscovery";

const ROWS = 150;

const buildExpandedConfigPage = (): ExplicitRegistration[] => {
  const page = document.createElement("div");
  const registrations: ExplicitRegistration[] = [];
  for (let sectionIndex = 0; sectionIndex < 6; sectionIndex += 1) {
    const section = document.createElement("section");
    section.setAttribute("data-section-label", `Section ${sectionIndex}`);
    for (let rowIndex = 0; rowIndex < ROWS / 6; rowIndex += 1) {
      const row = document.createElement("div");
      const control = document.createElement("button");
      control.textContent = `row ${sectionIndex}.${rowIndex}`;
      row.appendChild(control);
      section.appendChild(row);
      registrations.push({
        descriptor: { id: `row-${sectionIndex}-${rowIndex}` },
        resolveElement: () => control,
      });
    }
    page.appendChild(section);
  }
  document.body.appendChild(page);
  return registrations;
};

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("ring scan cost on a page with many registered rows", () => {
  it("does not test containment between every pair of ring stops", () => {
    const explicit = buildExpandedConfigPage();
    const contains = vi.spyOn(Node.prototype, "contains");
    const engine = new FocusDiscoveryEngine({ controller: new FocusController(), listExplicit: () => explicit });

    engine.start();

    expect(contains.mock.calls.length).toBeLessThan(ROWS * 4);
    engine.stop();
  });

  it("still gives each registered row its own ring stop and keeps sections as groups", () => {
    const explicit = buildExpandedConfigPage();
    const controller = new FocusController();
    const engine = new FocusDiscoveryEngine({ controller, listExplicit: () => explicit });

    engine.start();

    const items = controller.list();
    expect(items.filter((item) => item.id.startsWith("row-"))).toHaveLength(ROWS);
    expect(items.filter((item) => item.group?.startsWith("Section "))).toHaveLength(6);
    engine.stop();
  });
});

describe("isSkipped with a scan", () => {
  it("answers as the uncached walk does, for every element and scope", () => {
    document.body.innerHTML = `
      <div id="outer">
        <div data-key-nav-skip id="skipped"><div><button id="inside">in</button></div></div>
        <div id="open"><button id="outside">out</button></div>
      </div>`;
    const scan = createDiscoveryScan();
    const scopes = [document.body, document.getElementById("outer")!, document.getElementById("skipped")!];
    for (const scope of scopes) {
      for (const element of document.body.querySelectorAll("*")) {
        expect(isSkipped(element, scope, scan)).toBe(isSkipped(element, scope));
      }
    }
    expect(isSkipped(document.getElementById("inside")!, document.body, scan)).toBe(true);
    expect(isSkipped(document.getElementById("outside")!, document.body, scan)).toBe(false);
  });

  it("reads each ancestor's attribute once per scope however many controls sit below it", () => {
    document.body.innerHTML = `<div id="host">${'<button class="b">x</button>'.repeat(50)}</div>`;
    const host = document.getElementById("host")!;
    const hasAttribute = vi.spyOn(Element.prototype, "hasAttribute");
    const scan = createDiscoveryScan();

    for (const button of host.querySelectorAll("button")) isSkipped(button, document.body, scan);

    const hostReads = hasAttribute.mock.contexts.filter((context) => context === host).length;
    expect(hostReads).toBe(1);
  });
});
