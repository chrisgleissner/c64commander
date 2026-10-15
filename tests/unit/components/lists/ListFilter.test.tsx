/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CollapsibleListFilter, describeListFilter, type ListFilterRegion } from "@/components/lists/ListFilter";
import { resetInputModality, setInputModality } from "@/lib/input/inputModality";

const TOGGLE = "filter-toggle";

const Harness = ({
  initialText = "",
  headerSummary = null,
}: {
  initialText?: string;
  headerSummary?: string | null;
}) => {
  const [text, setText] = useState(initialText);
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const region: ListFilterRegion = {
    focusRegion: () => rootRef.current,
    scrollAnchor: () =>
      scrollerRef.current && anchorRef.current ? { anchor: anchorRef.current, scroller: scrollerRef.current } : null,
  };
  return (
    <div ref={rootRef}>
      <button type="button">Before the filter</button>
      <CollapsibleListFilter
        value={text}
        onChange={setText}
        placeholder="Filter files..."
        testId="filter-input"
        toggleTestId={TOGGLE}
        header={<button type="button">Songs</button>}
        headerSummary={headerSummary}
        region={region}
      />
      <div ref={scrollerRef} data-testid="scroller" style={{ overflowY: "auto" }}>
        <div ref={anchorRef} data-testid="anchor">
          <button type="button">First row</button>
        </div>
      </div>
    </div>
  );
};

const toggle = () => screen.getByTestId(TOGGLE);
const isExpanded = () => screen.getByTestId(`${TOGGLE}-panel`).getAttribute("data-expanded") === "true";
const expand = () => {
  fireEvent.click(toggle());
  expect(isExpanded()).toBe(true);
};
const scroller = () => screen.getByTestId("scroller") as HTMLDivElement;

const scrollListTo = (top: number, { byReader }: { byReader: boolean }) => {
  const element = scroller();
  if (byReader) fireEvent.wheel(element, { deltaY: top });
  element.scrollTop = top;
  fireEvent.scroll(element);
};

afterEach(() => {
  vi.restoreAllMocks();
  resetInputModality();
});

describe("CollapsibleListFilter", () => {
  it("starts folded into one row that says nothing is filtered", () => {
    render(<Harness />);
    expect(toggle()).toHaveTextContent("Filter files");
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("filter-input")).not.toBeInTheDocument();
  });

  it("keeps an active filter on screen while folded", () => {
    render(<Harness initialText="demo" headerSummary="Songs" />);
    expect(toggle()).toHaveTextContent("Filter: “demo” · Songs");
    expect(toggle()).toHaveAttribute("data-filter-active", "true");
  });

  it("unfolds on press into the text field and the type controls", () => {
    render(<Harness />);
    expand();
    expect(screen.getByTestId("filter-input")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Songs" })).toBeInTheDocument();
    expect(toggle()).toHaveAccessibleName("Hide filter");
    fireEvent.click(toggle());
    expect(isExpanded()).toBe(false);
  });

  it("folds when focus moves into the list after it, which is how the keypad enters the list", () => {
    render(<Harness />);
    expand();
    act(() => screen.getByRole("button", { name: "First row" }).focus());
    expect(isExpanded()).toBe(false);
  });

  it("stays open while focus moves between its own controls or to a control before it", () => {
    render(<Harness />);
    expand();
    act(() => screen.getByRole("button", { name: "Songs" }).focus());
    act(() => screen.getByRole("button", { name: "Before the filter" }).focus());
    expect(isExpanded()).toBe(true);
  });

  it("folds when the reader scrolls the list", () => {
    render(<Harness />);
    expand();
    scrollListTo(30, { byReader: true });
    expect(isExpanded()).toBe(false);
  });

  it("folds when a finger drags the list", () => {
    render(<Harness />);
    expand();
    fireEvent.touchMove(scroller());
    scroller().scrollTop = 60;
    fireEvent.scroll(scroller());
    expect(isExpanded()).toBe(false);
  });

  it("stays open when a tap is followed by a scroll the tap caused, such as a list shortened by a type filter", () => {
    render(<Harness />);
    expand();
    fireEvent.touchStart(scroller());
    fireEvent.touchEnd(scroller());
    scroller().scrollTop = 200;
    fireEvent.scroll(scroller());
    expect(isExpanded()).toBe(true);
  });

  it("ignores a scroll too small to be the reader moving on", () => {
    render(<Harness />);
    expand();
    scrollListTo(10, { byReader: true });
    expect(isExpanded()).toBe(true);
  });

  it("ignores scrolls the reader did not make", () => {
    render(<Harness />);
    expand();
    scrollListTo(300, { byReader: false });
    expect(isExpanded()).toBe(true);
  });

  it("never folds while the reader is typing in the field", () => {
    render(<Harness />);
    expand();
    const input = screen.getByTestId("filter-input");
    act(() => input.focus());
    fireEvent.change(input, { target: { value: "comm" } });
    scrollListTo(200, { byReader: true });
    act(() =>
      screen.getByRole("button", { name: "First row" }).dispatchEvent(new FocusEvent("focusin", { bubbles: true })),
    );
    expect(isExpanded()).toBe(true);
    expect(toggle()).toHaveAccessibleName("Hide filter");
  });

  it("leaves scrolling to the keypad ring while keys are driving", () => {
    render(<Harness />);
    expand();
    setInputModality("key-navigation");
    scrollListTo(200, { byReader: true });
    expect(isExpanded()).toBe(true);
  });

  it("waits until the list has scrolled far enough to be held still while the filter folds", () => {
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
      if (this.dataset.testid === `${TOGGLE}-panel`) return 100;
      if (this.dataset.testid === TOGGLE) return 44;
      return 0;
    });
    render(<Harness />);
    expand();
    scrollListTo(40, { byReader: true });
    expect(isExpanded()).toBe(true);
    scrollListTo(70, { byReader: true });
    expect(isExpanded()).toBe(false);
  });

  it("scrolls the list back by the distance folding moved it, so the rows stay where they were", () => {
    render(<Harness />);
    const anchor = screen.getByTestId("anchor");
    vi.spyOn(anchor, "getBoundingClientRect").mockImplementation(() => ({ top: isExpanded() ? 300 : 252 }) as DOMRect);
    const scrollBy = vi.fn();
    scroller().scrollBy = scrollBy;
    expand();
    scrollListTo(60, { byReader: true });
    expect(isExpanded()).toBe(false);
    expect(scrollBy).toHaveBeenCalledWith({ top: -48, behavior: "instant" });
  });

  it("does not scroll the list when the reader folds the filter with its own button", () => {
    render(<Harness />);
    const anchor = screen.getByTestId("anchor");
    vi.spyOn(anchor, "getBoundingClientRect").mockImplementation(() => ({ top: isExpanded() ? 300 : 252 }) as DOMRect);
    const scrollBy = vi.fn();
    scroller().scrollBy = scrollBy;
    expand();
    fireEvent.click(toggle());
    expect(isExpanded()).toBe(false);
    expect(scrollBy).not.toHaveBeenCalled();
  });
});

describe("describeListFilter", () => {
  it("joins the quoted text and the type summary, and is empty when neither filters anything", () => {
    expect(describeListFilter("  demo ", "Songs, Disks")).toBe("“demo” · Songs, Disks");
    expect(describeListFilter("", "Disks")).toBe("Disks");
    expect(describeListFilter("   ", null)).toBeNull();
  });
});
