/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { toasts } = vi.hoisted(() => ({ toasts: { value: [] as Array<Record<string, unknown>> } }));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toasts: toasts.value, dismiss: vi.fn() }),
}));

import { Toaster } from "@/components/ui/toaster";
import { discoverInteractiveElements } from "@/lib/input/discovery";

const discoveredToastStops = (): string[] =>
  discoverInteractiveElements(document.body)
    .filter((element) => element.closest('[data-testid="app-toast"]'))
    .map((element) => element.getAttribute("data-testid") ?? element.tagName.toLowerCase());

describe("SPM-NAV-03 an informational toast and the keypad ring", () => {
  it("is not a ring stop, so the ring selection is unchanged while it shows", () => {
    toasts.value = [{ id: "hint", title: "Pages are on keys 1 to 3", informational: true, open: true }];
    render(
      <>
        <button type="button" data-testid="home-search-field">
          Search
        </button>
        <Toaster />
      </>,
    );

    const stops = discoverInteractiveElements(document.body).map((element) => element.getAttribute("data-testid"));
    expect(stops).toContain("home-search-field");
    expect(discoveredToastStops()).toEqual([]);
  });

  it("an ordinary toast is still discovered, which is what the informational flag removes", () => {
    toasts.value = [{ id: "err", title: "Mount failed", open: true }];
    render(<Toaster />);

    expect(discoveredToastStops().length).toBeGreaterThan(0);
  });
});
