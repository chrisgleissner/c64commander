/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChipRow } from "@/components/sound/ChipRow";

const CHIPS = [
  { id: "a", label: "Alpha" },
  { id: "b", label: "Beta" },
  { id: "c", label: "Gamma" },
];

const renderRow = (activeId: string | undefined, accentFor = () => null as null | { light: string; dark: string }) =>
  render(
    <ChipRow
      chips={CHIPS}
      activeId={activeId}
      onSelect={() => {}}
      ariaLabel="Letters"
      testIdPrefix="chip"
      accentFor={accentFor}
    />,
  );

describe("ChipRow", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
  });

  it("scrolls the active chip to the middle of the row, smoothly, when the active chip changes", () => {
    const scrollTo = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: scrollTo });
    vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockReturnValue(300);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(100);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(200);
    const { rerender } = renderRow("a");
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 250, behavior: "smooth" });
    rerender(
      <ChipRow
        chips={CHIPS}
        activeId="b"
        onSelect={() => {}}
        ariaLabel="Letters"
        testIdPrefix="chip"
        accentFor={() => null}
      />,
    );
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });

  it("does not scroll when no chip is active", () => {
    const scrollTo = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: scrollTo });
    renderRow(undefined);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("does not fail where the browser has no scrollTo", () => {
    expect(() => renderRow("b")).not.toThrow();
    expect(screen.getByTestId("chip-b")).toHaveAttribute("aria-pressed", "true");
  });

  it("draws a color dot on each inactive chip that has an accent, and none without one", () => {
    renderRow("a", () => null);
    expect(screen.getByTestId("chip-a").querySelector("[data-chip-dot]")).toBeNull();
    const { container } = renderRow("a", () => ({ light: "#123456", dark: "#abcdef" }));
    expect(container.querySelectorAll("[data-chip-dot]")).toHaveLength(CHIPS.length - 1);
  });

  it("reports the chosen chip", () => {
    const onSelect = vi.fn();
    render(
      <ChipRow
        chips={CHIPS}
        activeId="a"
        onSelect={onSelect}
        ariaLabel="Letters"
        testIdPrefix="chip"
        accentFor={() => null}
      />,
    );
    fireEvent.click(screen.getByTestId("chip-c"));
    expect(onSelect).toHaveBeenCalledWith("c");
  });
});
