/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  activePageStyleRoot,
  isOnActivePage,
  queryAllOnActivePage,
  queryOnActivePage,
} from "@/lib/navigation/activePage";

const slot = (active: boolean, testId: string) => {
  const element = document.createElement("div");
  element.setAttribute("data-slot-active", active ? "true" : "false");
  element.innerHTML = `<button data-testid="${testId}"></button>`;
  document.body.appendChild(element);
  return element;
};

describe("active page lookups", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("skips a kept page that comes first in the document and answers for the page on screen", () => {
    const kept = slot(false, "app-bar-row");
    const shown = slot(true, "app-bar-row");

    expect(queryOnActivePage('[data-testid="app-bar-row"]')).toBe(shown.firstElementChild);
    expect(queryAllOnActivePage('[data-testid="app-bar-row"]')).toEqual([shown.firstElementChild]);
    expect(isOnActivePage(kept.firstElementChild!)).toBe(false);
  });

  it("counts anything outside the tab slots, such as a dialog, as on screen", () => {
    slot(false, "dialog-button");
    const dialog = document.createElement("div");
    dialog.innerHTML = '<button data-testid="dialog-button"></button>';
    document.body.appendChild(dialog);

    expect(queryOnActivePage('[data-testid="dialog-button"]')).toBe(dialog.firstElementChild);
  });

  it("reads page styles from the slot on screen, or from the root outside the tab layer", () => {
    expect(activePageStyleRoot()).toBe(document.documentElement);
    slot(false, "a");
    const shown = slot(true, "b");
    expect(activePageStyleRoot()).toBe(shown);
  });
});
