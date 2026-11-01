/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { registerListRowScroller, revealListRow } from "@/components/lists/listRowReveal";

const rowMarkup = (id: string) => `<div data-row-id="${id}"><button aria-label="Item actions"></button></div>`;

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("revealListRow", () => {
  it("answers at once with the menu button of a row that is already rendered", async () => {
    document.body.innerHTML = rowMarkup("a") + rowMarkup("b");
    const scroller = vi.fn(() => true);
    const unregister = registerListRowScroller(scroller);

    const button = await revealListRow("b");

    expect(button).toBe(document.querySelectorAll("button")[1]);
    expect(scroller).not.toHaveBeenCalled();
    unregister();
  });

  it("asks a virtualized list to scroll a row it has not rendered into range, then finds it", async () => {
    const scroller = vi.fn((rowId: string) => {
      setTimeout(() => {
        document.body.innerHTML = rowMarkup(rowId);
      }, 20);
      return true;
    });
    const unregister = registerListRowScroller(scroller);

    const button = await revealListRow("far");

    expect(scroller).toHaveBeenCalledWith("far");
    expect(button).toBe(document.querySelector("button"));
    unregister();
  });

  it("gives up after its bound when the list never renders the row", async () => {
    vi.useFakeTimers();
    const unregister = registerListRowScroller(() => true);

    const pending = revealListRow("missing");
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(pending).resolves.toBeNull();
    unregister();
  });

  it("stops asking a list that has unregistered", async () => {
    vi.useFakeTimers();
    const scroller = vi.fn(() => true);
    registerListRowScroller(scroller)();

    const pending = revealListRow("gone");
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(pending).resolves.toBeNull();
    expect(scroller).not.toHaveBeenCalled();
  });
});
