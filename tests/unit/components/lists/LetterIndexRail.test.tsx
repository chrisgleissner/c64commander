/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LetterIndexRail, useLetterRailModel } from "@/components/lists/LetterIndexRail";
import type { LetterIndexSource } from "@/lib/lists/letterIndex";

type Row = { id: string; title: string; variant?: "header" };

const SCROLLER_HEIGHT = 200;
const ITEM_HEIGHT = 100;

const rowsFor = (titles: string[]): Row[] => [
  { id: "folder", title: "/Usb0/", variant: "header" },
  ...titles.map((title, index) => ({ id: `row-${index}`, title })),
];

const TITLES = ["Arkanoid", "Alleykat", "Bubble", "Bruce", "Commando", "Paradroid", "Quedex", "Rambo", "Sanxion"];

function Harness({
  rows,
  source,
  scrollToListIndex,
  unrenderedIds,
}: {
  rows: Row[];
  source?: LetterIndexSource;
  scrollToListIndex: (index: number) => void;
  /** Rows a virtualised list has not rendered yet. */
  unrenderedIds?: ReadonlySet<string>;
}) {
  const model = useLetterRailModel(rows, ITEM_HEIGHT, source);
  const [scope, setScope] = useState<HTMLElement | null>(null);
  return (
    <div ref={setScope} data-testid="scope">
      <input data-testid="filter" />
      <div ref={model.setScroller} data-testid="scroller" data-height={SCROLLER_HEIGHT}>
        {rows
          .filter((row) => !unrenderedIds?.has(row.id))
          .map((row) =>
            row.variant === "header" ? (
              <div key={row.id} data-row-id={row.id} />
            ) : (
              <div key={row.id} data-row-id={row.id}>
                <button type="button" data-row-title="true">
                  {row.title}
                </button>
              </div>
            ),
          )}
      </div>
      {model.eligible ? <LetterIndexRail model={model} scrollToListIndex={scrollToListIndex} keyScope={scope} /> : null}
    </div>
  );
}

const nextFrame = () => act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

/** The title the keypad selection is on, or null when focus is anywhere but a row title. */
const focusedTitle = () =>
  document.activeElement?.getAttribute("data-row-title") === "true" ? document.activeElement.textContent : null;

const pressKey = (key: string, target: Element = screen.getByTestId("scope")) => {
  fireEvent.keyDown(target, { key });
};

describe("LetterIndexRail", () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
      return Number(this.dataset.height ?? 0);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is not offered for a list shorter than four screens", () => {
    render(<Harness rows={rowsFor(["Arkanoid", "Bubble"])} scrollToListIndex={vi.fn()} />);
    expect(screen.queryByTestId("alphabet-rail")).toBeNull();
  });

  it("jumps by touch to the first item of the letter and selects its title when the finger lifts", async () => {
    const scrollToListIndex = vi.fn();
    render(<Harness rows={rowsFor(TITLES)} scrollToListIndex={scrollToListIndex} />);
    const rail = screen.getByTestId("alphabet-rail");
    vi.spyOn(rail, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 70,
      height: 70,
      left: 0,
      right: 44,
      width: 44,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    // Seven letters (A B C P Q R S) over 70px: 35px is the fourth band, P.
    fireEvent.pointerDown(rail, { clientY: 35 });
    await nextFrame();
    expect(scrollToListIndex).toHaveBeenLastCalledWith(6);
    // Selection waits for the finger to lift, so a drag does not move focus at every letter.
    expect(focusedTitle()).toBeNull();

    fireEvent.pointerUp(rail, { clientY: 35 });
    await nextFrame();
    expect(focusedTitle()).toBe("Paradroid");
    expect(screen.getByTestId("alphabet-badge")).toHaveTextContent("P");
    expect(screen.getByTestId("alphabet-badge")).toHaveAttribute("data-visible", "true");
  });

  it("multi-taps keypad digits to letters and selects the first item of each", async () => {
    const scrollToListIndex = vi.fn();
    render(<Harness rows={rowsFor(TITLES)} scrollToListIndex={scrollToListIndex} />);

    pressKey("2");
    await nextFrame();
    expect(scrollToListIndex).toHaveBeenLastCalledWith(1);
    expect(focusedTitle()).toBe("Arkanoid");

    pressKey("2");
    await nextFrame();
    expect(scrollToListIndex).toHaveBeenLastCalledWith(3);
    expect(focusedTitle()).toBe("Bubble");

    pressKey("7");
    await nextFrame();
    expect(focusedTitle()).toBe("Paradroid");
  });

  it("keeps the selection on the latest jump when the row of an earlier jump renders later", async () => {
    const rows = rowsFor(TITLES);
    const view = render(<Harness rows={rows} scrollToListIndex={vi.fn()} unrenderedIds={new Set(["row-0"])} />);

    pressKey("a");
    await nextFrame();
    expect(focusedTitle()).toBeNull();
    pressKey("b");
    await nextFrame();
    expect(focusedTitle()).toBe("Bubble");

    view.rerender(<Harness rows={rows} scrollToListIndex={vi.fn()} />);
    for (let frame = 0; frame < 3; frame += 1) await nextFrame();

    expect(focusedTitle()).toBe("Bubble");
  });

  it("jumps on a typed letter", async () => {
    const scrollToListIndex = vi.fn();
    render(<Harness rows={rowsFor(TITLES)} scrollToListIndex={scrollToListIndex} />);
    pressKey("q");
    await nextFrame();
    expect(focusedTitle()).toBe("Quedex");
  });

  it("leaves keys typed into a text field alone", () => {
    const scrollToListIndex = vi.fn();
    render(<Harness rows={rowsFor(TITLES)} scrollToListIndex={scrollToListIndex} />);
    pressKey("2", screen.getByTestId("filter"));
    pressKey("q", screen.getByTestId("filter"));
    expect(scrollToListIndex).not.toHaveBeenCalled();
  });

  it("shows the letter first, then asks for the page holding it, then lands on it", async () => {
    const all = [...TITLES, "Thrust", "Zoids"];
    const ensureLoaded = vi.fn();
    const source: LetterIndexSource = {
      getEntries: () => all.map((title, index) => ({ id: `row-${index}`, title })),
      ensureLoaded,
    };
    const scrollToListIndex = vi.fn();
    const { rerender } = render(
      <Harness rows={rowsFor(TITLES)} source={source} scrollToListIndex={scrollToListIndex} />,
    );

    pressKey("9");
    expect(screen.getByTestId("alphabet-badge")).toHaveTextContent("Z");
    expect(ensureLoaded).not.toHaveBeenCalled();
    await nextFrame();
    expect(ensureLoaded).toHaveBeenCalledWith(all.indexOf("Zoids") + 1);
    expect(scrollToListIndex).not.toHaveBeenCalled();

    rerender(<Harness rows={rowsFor(all)} source={source} scrollToListIndex={scrollToListIndex} />);
    await waitFor(() => expect(focusedTitle()).toBe("Zoids"));
    expect(scrollToListIndex).toHaveBeenLastCalledWith(all.indexOf("Zoids") + 1);
  });
});
