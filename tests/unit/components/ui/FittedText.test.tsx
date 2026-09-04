/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FittedText } from "@/components/ui/FittedText";

/**
 * jsdom has no layout and no canvas, so both inputs the component measures are stubbed: the width
 * available (`clientWidth`) and the width each wording would take (`measureText`). A character is
 * treated as 10px wide, which is enough to decide which wording fits.
 */
const CHAR_PX = 10;

// Anchored regexes throughout: `toHaveTextContent("IEC Drive")` is a substring match, and
// "Soft IEC Drive" satisfies it — which let every assertion here pass against a component that
// always drew the longest wording.

let availableWidth = 0;

const setAvailableWidth = (width: number) => {
  availableWidth = width;
};

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => availableWidth,
  });
  HTMLCanvasElement.prototype.getContext = vi.fn(
    () =>
      ({
        font: "",
        measureText: (text: string) => ({ width: text.length * CHAR_PX }),
      }) as unknown as CanvasRenderingContext2D,
  ) as unknown as HTMLCanvasElement["getContext"];
});

afterEach(() => {
  vi.restoreAllMocks();
});

const VARIANTS = ["Soft IEC Drive", "IEC Drive", "IEC"] as const;

/**
 * The drawn wording, not the whole subtree. When an abbreviation is drawn the host also carries the
 * full wording in a visually hidden node, so `toHaveTextContent` on the host would pass for a
 * component that drew the full wording at every width.
 */
const drawnWording = (accessibleName: string) => screen.getByLabelText(accessibleName).children[0];

describe("FittedText", () => {
  it("draws the longest wording that fits", () => {
    setAvailableWidth("Soft IEC Drive".length * CHAR_PX);
    render(<FittedText variants={VARIANTS} />);

    expect(drawnWording("Soft IEC Drive")).toHaveTextContent(/^Soft IEC Drive$/);
  });

  it("steps down a wording at a time as the space narrows", () => {
    setAvailableWidth("IEC Drive".length * CHAR_PX);
    const { unmount } = render(<FittedText variants={VARIANTS} />);
    expect(drawnWording("Soft IEC Drive")).toHaveTextContent(/^IEC Drive$/);
    unmount();

    setAvailableWidth("IEC".length * CHAR_PX);
    render(<FittedText variants={VARIANTS} />);
    expect(drawnWording("Soft IEC Drive")).toHaveTextContent(/^IEC$/);
  });

  it("falls back to the shortest wording rather than truncating when none fits", () => {
    // The point of the component: a label that has stopped naming its thing is worse than a short
    // one, so the last wording the caller listed is what a hopeless width gets.
    setAvailableWidth(5);
    render(<FittedText variants={VARIANTS} />);

    expect(drawnWording("Soft IEC Drive")).toHaveTextContent(/^IEC$/);
  });

  it("keeps the full wording as the accessible name however narrow the space is", () => {
    setAvailableWidth(5);
    render(<FittedText variants={VARIANTS} />);

    // What a screen reader and the keypad ring announce does not shrink with the column.
    expect(screen.getByLabelText("Soft IEC Drive")).toBeInTheDocument();
  });

  /**
   * `aria-label` alone was not enough. WebKit does not apply it to a span with no role, so on iOS
   * run 33842686343 the "Stable Features" section header carried no title at all in the
   * accessibility tree — Maestro found no element matching "Stable.*" while the words were on
   * screen. A name an ancestor can compute from content is one every engine agrees on.
   */
  it("carries the accessible name as text rather than only as an aria-label", () => {
    setAvailableWidth(5);
    const { container } = render(<FittedText variants={VARIANTS} />);

    const named = container.querySelector("[aria-label='Soft IEC Drive']");
    const readable = Array.from(named?.children ?? []).filter((child) => !child.hasAttribute("aria-hidden"));

    expect(readable.map((child) => child.textContent)).toEqual(["Soft IEC Drive"]);
    // Hidden from sight, not from the accessibility tree.
    expect(readable[0]).toHaveClass("sr-only");
  });

  /**
   * Only an abbreviation needs restating. Hiding a wording that already is the accessible name and
   * then repeating it puts the same words in the tree twice, which a `getByText` query then finds
   * two of.
   */
  it("leaves the drawn wording readable, and adds no second node, when it is the accessible name", () => {
    setAvailableWidth("Soft IEC Drive".length * CHAR_PX);
    const { container } = render(<FittedText variants={VARIANTS} />);

    const named = container.querySelector("[aria-label='Soft IEC Drive']");

    expect(named?.children).toHaveLength(1);
    expect(named?.children[0].hasAttribute("aria-hidden")).toBe(false);
    expect(named).toHaveTextContent(/^Soft IEC Drive$/);
  });

  it("uses an explicit label as the accessible name when the drawn wordings are all abbreviations", () => {
    setAvailableWidth(1000);
    render(<FittedText variants={["Experimental", "Exp."]} label="Experimental Features" />);

    expect(drawnWording("Experimental Features")).toHaveTextContent(/^Experimental$/);
  });

  it("leaves the choice alone while the element has no width", () => {
    // A closed card or a hidden tab reports zero. Choosing on that would latch the shortest
    // wording and never revisit it, so the first wording stands until there is a width to judge.
    setAvailableWidth(0);
    render(<FittedText variants={VARIANTS} />);

    expect(drawnWording("Soft IEC Drive")).toHaveTextContent(/^Soft IEC Drive$/);
  });
});
