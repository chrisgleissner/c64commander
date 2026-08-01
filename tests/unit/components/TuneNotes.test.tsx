/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TuneNotes } from "@/pages/playFiles/components/TuneNotes";

/**
 * jsdom gives every element a scrollHeight and clientHeight of 0, so overflow has to be staged
 * explicitly. These stubs are what stands in for "the note is longer than three lines".
 */
const stageOverflow = ({ scrollHeight, clientHeight }: { scrollHeight: number; clientHeight: number }) => {
  const scroll = vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(scrollHeight);
  const client = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(clientHeight);
  return () => {
    scroll.mockRestore();
    client.mockRestore();
  };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TuneNotes", () => {
  it("renders nothing at all for an empty note", () => {
    const { container } = render(<TuneNotes note="   " />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a short note in full, with no control to reveal it", () => {
    // The majority case: the median note in the real document is 64 characters. A control here
    // would be a tap that reveals nothing.
    const restore = stageOverflow({ scrollHeight: 40, clientHeight: 40 });
    render(<TuneNotes note="Remix of /MUSICIANS/R/Rockin_Limited/Ein_Fall_fuer_2.sid" />);
    expect(screen.getByTestId("tune-notes-text")).toHaveTextContent("Remix of");
    expect(screen.queryByTestId("tune-notes-toggle")).toBeNull();
    restore();
  });

  it("clamps a long note and offers to show the rest", () => {
    const restore = stageOverflow({ scrollHeight: 200, clientHeight: 48 });
    render(<TuneNotes note={"There is an interesting story behind Commando. ".repeat(12)} />);
    // Clamped, not hidden: the first lines are readable without any interaction.
    expect(screen.getByTestId("tune-notes-text")).toHaveAttribute("data-expanded", "false");
    expect(screen.getByTestId("tune-notes-text").className).toContain("line-clamp-2");
    expect(screen.getByTestId("tune-notes-toggle")).toHaveTextContent("Show more");
    restore();
  });

  it("expands and collapses again", () => {
    const restore = stageOverflow({ scrollHeight: 200, clientHeight: 48 });
    render(<TuneNotes note={"long ".repeat(200)} />);
    const region = screen.getByTestId("tune-notes");

    fireEvent.click(region);
    expect(screen.getByTestId("tune-notes-text")).toHaveAttribute("data-expanded", "true");
    expect(screen.getByTestId("tune-notes-text").className).not.toContain("line-clamp-2");
    expect(screen.getByTestId("tune-notes-toggle")).toHaveTextContent("Show less");
    expect(region).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(region);
    expect(screen.getByTestId("tune-notes-text")).toHaveAttribute("data-expanded", "false");
    restore();
  });

  it("takes a tap anywhere in the note, not only on the label", () => {
    // Three lines of text with a small link under them is a large thing to read and a small thing
    // to hit, and the text is where the eye already is.
    const restore = stageOverflow({ scrollHeight: 200, clientHeight: 48 });
    render(<TuneNotes note={"long ".repeat(200)} />);
    fireEvent.click(screen.getByTestId("tune-notes-text"));
    expect(screen.getByTestId("tune-notes-text")).toHaveAttribute("data-expanded", "true");
    restore();
  });

  it("offers no target at all when the note already fits", () => {
    const restore = stageOverflow({ scrollHeight: 40, clientHeight: 40 });
    render(<TuneNotes note="Remix of another tune." />);
    expect(screen.getByTestId("tune-notes").tagName).not.toBe("BUTTON");
    expect(screen.queryByTestId("tune-notes-toggle")).toBeNull();
    restore();
  });

  it("collapses again when the tune changes", () => {
    // Otherwise a note left expanded on one tune blows the card out on the next.
    const restore = stageOverflow({ scrollHeight: 200, clientHeight: 48 });
    const { rerender } = render(<TuneNotes note={"first ".repeat(100)} />);
    fireEvent.click(screen.getByTestId("tune-notes-toggle"));
    expect(screen.getByTestId("tune-notes-text")).toHaveAttribute("data-expanded", "true");

    rerender(<TuneNotes note={"second ".repeat(100)} />);
    expect(screen.getByTestId("tune-notes-text")).toHaveAttribute("data-expanded", "false");
    restore();
  });
});

describe("TuneNotes expanded height", () => {
  it("scrolls inside itself rather than pushing the transport off the card", () => {
    // The longest note in the collection is 2,390 characters. Unbounded, expanding it put the
    // progress bar, the transport and even "Show less" below the fold.
    const restore = stageOverflow({ scrollHeight: 900, clientHeight: 48 });
    render(<TuneNotes note={"long ".repeat(500)} />);
    fireEvent.click(screen.getByTestId("tune-notes"));
    const text = screen.getByTestId("tune-notes-text");
    expect(text.className).toContain("max-h-52");
    expect(text.className).toContain("overflow-y-auto");
    restore();
  });

  it("takes no height cap while collapsed, where the clamp already bounds it", () => {
    const restore = stageOverflow({ scrollHeight: 200, clientHeight: 48 });
    render(<TuneNotes note={"long ".repeat(200)} />);
    expect(screen.getByTestId("tune-notes-text").className).not.toContain("max-h-52");
    restore();
  });
});
