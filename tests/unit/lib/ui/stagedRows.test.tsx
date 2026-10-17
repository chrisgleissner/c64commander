/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountAllWaiting } from "@/lib/ui/progressiveMount";
import {
  buildStagedRowsFirstIn,
  resetStagedRowsForTests,
  setStagedRowsEnabled,
  useStagedRows,
} from "@/lib/ui/stagedRows";

const ROWS = 40;

const List = ({ name, rows = ROWS }: { name: string; rows?: number }) => {
  const staged = useStagedRows(rows);
  return (
    <div>
      {Array.from({ length: staged.count }, (_, index) => (
        <div key={index} data-testid="row" data-list={name}>{`${name} ${index + 1}`}</div>
      ))}
      {staged.marker}
    </div>
  );
};

const builtIn = (name: string) => document.querySelectorAll(`[data-list="${name}"]`).length;
const placeMarkersAt = (top: number) =>
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ top, bottom: top + 20 } as DOMRect);
const FAKED = ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] as const;

describe("useStagedRows", () => {
  afterEach(() => {
    setStagedRowsEnabled(false);
    resetStagedRowsForTests();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("caps the rows built before the paint when every list reads as on screen, as lists in opening cards do", async () => {
    setStagedRowsEnabled(true);
    // A card that is opening animates from zero height, so its list's end stays on screen however many
    // rows it is given.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ top: 100, bottom: 120 } as DOMRect);

    render(
      <>
        <List name="First" />
        <List name="Second" />
        <List name="Third" />
      </>,
    );

    const beforePaint = screen.getAllByTestId("row").length;
    expect(beforePaint).toBeGreaterThan(0);
    expect(beforePaint).toBeLessThanOrEqual(36);

    await waitFor(() => expect(screen.getAllByTestId("row")).toHaveLength(3 * ROWS));
  });

  it("builds a long list below the screen over several background tasks of at most 32 rows each", () => {
    vi.useFakeTimers({ toFake: [...FAKED] });
    setStagedRowsEnabled(true);
    placeMarkersAt(5000);
    render(<List name="Long" rows={200} />);
    expect(builtIn("Long")).toBe(12);

    act(() => vi.advanceTimersToNextFrame());
    act(() => vi.advanceTimersToNextTimer());
    const afterFirstTask = builtIn("Long");
    expect(afterFirstTask).toBeGreaterThan(12);
    expect(afterFirstTask).toBeLessThanOrEqual(12 + 32);

    act(() => vi.runAllTimers());
    expect(builtIn("Long")).toBe(200);
  });

  it("builds the lists in document order, not in the order they started waiting", () => {
    vi.useFakeTimers({ toFake: [...FAKED] });
    setStagedRowsEnabled(true);
    placeMarkersAt(5000);
    const page = (topRows: number) => (
      <>
        <List name="Top" rows={topRows} />
        <List name="Middle" />
        <List name="Bottom" />
      </>
    );
    const view = render(page(0));
    view.rerender(page(ROWS));
    const before = { top: builtIn("Top"), middle: builtIn("Middle"), bottom: builtIn("Bottom") };
    expect(before.top).toBeLessThan(ROWS);

    act(() => vi.advanceTimersToNextFrame());
    act(() => vi.advanceTimersToNextTimer());

    expect(builtIn("Top")).toBeGreaterThan(before.top);
    expect(builtIn("Middle")).toBe(before.middle);
    expect(builtIn("Bottom")).toBe(before.bottom);
  });

  it("builds a list scrolled toward the screen before the next paint, ahead of the background tasks", () => {
    // Frames are run by hand, so the background task queued for the first frame never runs here.
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    setStagedRowsEnabled(true);
    const marker = placeMarkersAt(5000);
    render(<List name="Long" rows={200} />);
    expect(builtIn("Long")).toBe(12);

    document.dispatchEvent(new Event("scroll"));
    act(() => frames.pop()?.(0));
    expect(builtIn("Long")).toBe(12);

    marker.mockReturnValue({ top: 100, bottom: 120 } as DOMRect);
    const queued = frames.length;
    document.dispatchEvent(new Event("scroll"));
    document.dispatchEvent(new Event("scroll"));
    expect(frames).toHaveLength(queued + 1);
    act(() => frames.pop()?.(0));

    expect(builtIn("Long")).toBeGreaterThan(12);
    expect(builtIn("Long")).toBeLessThan(200);
  });

  it("builds every row without requestAnimationFrame, and a scroll then waits for the background tasks", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.stubGlobal("requestAnimationFrame", undefined);
    setStagedRowsEnabled(true);
    placeMarkersAt(100);
    render(<List name="Long" rows={200} />);
    const beforeScroll = builtIn("Long");
    expect(beforeScroll).toBeLessThan(200);

    document.dispatchEvent(new Event("scroll"));
    expect(builtIn("Long")).toBe(beforeScroll);

    act(() => vi.runAllTimers());
    expect(builtIn("Long")).toBe(200);
  });

  it("builds a list whose unbuilt end is above the screen completely before the paint", () => {
    setStagedRowsEnabled(true);
    placeMarkersAt(-100);
    render(<List name="Above" rows={200} />);
    expect(builtIn("Above")).toBe(200);
  });

  it("goes on to the next list when the list ahead of it finishes in a background task", () => {
    vi.useFakeTimers({ toFake: [...FAKED] });
    setStagedRowsEnabled(true);
    placeMarkersAt(5000);
    // The first task builds 6 rows, which is exactly what Ahead still lacks, so Behind gets none in it.
    render(
      <>
        <List name="Ahead" rows={18} />
        <List name="Behind" />
      </>,
    );
    expect(builtIn("Ahead")).toBe(12);
    expect(builtIn("Behind")).toBe(0);

    act(() => vi.advanceTimersToNextFrame());
    act(() => vi.advanceTimersToNextTimer());
    expect(builtIn("Ahead")).toBe(18);
    expect(builtIn("Behind")).toBe(0);

    act(() => vi.runAllTimers());
    expect(builtIn("Behind")).toBe(ROWS);
  });

  it("does not build the rows staged inside a card when a key asks to mount it without completing rows", () => {
    vi.useFakeTimers({ toFake: [...FAKED] });
    setStagedRowsEnabled(true);
    placeMarkersAt(5000);
    render(
      <div data-testid="card">
        <List name="Card" rows={200} />
      </div>,
    );
    expect(builtIn("Card")).toBe(12);

    act(() => {
      mountAllWaiting(screen.getByTestId("card"), { completeRows: false });
    });
    expect(builtIn("Card")).toBe(12);

    act(() => {
      mountAllWaiting(screen.getByTestId("card"));
    });
    expect(builtIn("Card")).toBe(200);
  });

  it("builds the lists of the card a key is in before the lists ahead of it", () => {
    vi.useFakeTimers({ toFake: [...FAKED] });
    setStagedRowsEnabled(true);
    placeMarkersAt(5000);
    render(
      <>
        <List name="Ahead" rows={200} />
        <div data-testid="card">
          <List name="Card" rows={200} />
        </div>
      </>,
    );
    buildStagedRowsFirstIn(screen.getByTestId("card"));

    act(() => vi.advanceTimersToNextFrame());
    act(() => vi.advanceTimersToNextTimer());
    expect(builtIn("Card")).toBeGreaterThan(0);
    expect(builtIn("Ahead")).toBe(12);
  });

  it("builds at most 8 ms worth of rows in one background task", () => {
    vi.useFakeTimers({ toFake: [...FAKED] });
    setStagedRowsEnabled(true);
    placeMarkersAt(5000);
    render(<List name="Long" rows={200} />);
    act(() => vi.advanceTimersToNextFrame());
    act(() => vi.advanceTimersToNextTimer());
    expect(builtIn("Long") - 12).toBeLessThanOrEqual(6);
  });
});
