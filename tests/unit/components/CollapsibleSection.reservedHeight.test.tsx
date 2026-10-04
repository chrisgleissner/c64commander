/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Radio } from "lucide-react";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { setProgressiveMountEnabled } from "@/lib/ui/progressiveMount";
import { rememberPagePosition, resetPagePositionsForTests } from "@/lib/navigation/pagePositions";

const seedRememberedHeight = (id: string, height: number) => {
  const slot = document.createElement("div");
  slot.innerHTML = `<div data-page-scroll-container="true"><section data-section-scope="test" data-section-id="${id}" data-body-mounted="true"></section></div>`;
  Object.defineProperty(slot.querySelector("section")!, "offsetHeight", { configurable: true, value: height });
  rememberPagePosition(0, slot);
};

const cards = (
  <>
    {["a", "b", "c"].map((id) => (
      <CollapsibleSection key={id} scope="test" id={id} title={id} icon={Radio} defaultOpen>
        <p>{`body ${id}`}</p>
      </CollapsibleSection>
    ))}
  </>
);

beforeEach(() => {
  resetPagePositionsForTests();
  localStorage.clear();
  setProgressiveMountEnabled(true);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ top: 5000 } as DOMRect);
});
afterEach(() => {
  setProgressiveMountEnabled(false);
  vi.restoreAllMocks();
});

describe("CollapsibleSection remembered height", () => {
  it("keeps the height a card was left at while its body waits to be built, and drops it once built", async () => {
    seedRememberedHeight("c", 333);
    render(cards);

    const waiting = screen.getByTestId("test-section-c");
    expect(screen.queryByText("body c")).not.toBeInTheDocument();
    expect(waiting.style.minHeight).toBe("333px");
    expect(waiting).not.toHaveAttribute("data-body-mounted");
    expect(screen.getByTestId("test-section-a")).toHaveAttribute("data-body-mounted", "true");

    await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))));

    expect(screen.getByText("body c")).toBeInTheDocument();
    expect(waiting.style.minHeight).toBe("");
  });

  it("reserves nothing for a card it has no height for", () => {
    render(cards);
    expect(screen.getByTestId("test-section-c").style.minHeight).toBe("");
  });
});
