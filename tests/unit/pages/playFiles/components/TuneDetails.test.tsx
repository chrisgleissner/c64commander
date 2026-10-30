/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const shareTune = vi.hoisted(() => vi.fn());
vi.mock("@/lib/playback/shareTune", () => ({ shareTune }));

import { buildTuneShare } from "@/lib/playback/tuneShare";
import { TuneDetails, type TuneDetailsProps } from "@/pages/playFiles/components/TuneDetails";

const details = (overrides: Partial<TuneDetailsProps> = {}) => (
  <TuneDetails available tuneKey="a:1" credits={null} facts={null} tuneLine={null} note={null} {...overrides} />
);

const SHARE = {
  ...buildTuneShare({
    title: "Commando",
    composer: "Rob Hubbard",
    released: "1985 Elite",
    virtualPath: "/MUSICIANS/H/Hubbard_Rob/Commando.sid",
    songNr: 3,
    subsongCount: 19,
  }),
  path: "/MUSICIANS/H/Hubbard_Rob/Commando.sid",
};

beforeEach(() => shareTune.mockReset().mockResolvedValue("shared"));
afterEach(cleanup);

describe("TuneDetails", () => {
  it("renders nothing while no tune is current", () => {
    const { container } = render(details({ available: false, tuneLine: "BGM1", credits: "Rob Hubbard" }));
    expect(container).toBeEmptyDOMElement();
  });

  it("keeps its toggle for a tune that STIL does not cover, so the row never comes and goes between tunes", () => {
    render(details());
    expect(screen.getByTestId("tune-details-toggle")).toBeInTheDocument();
  });

  it("says so when nothing is known, and treats a whitespace note as no note", () => {
    render(details({ note: "   " }));
    fireEvent.click(screen.getByTestId("tune-details-toggle"));
    expect(screen.getByTestId("tune-details-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("tune-notes")).toBeNull();
  });

  it("shows the full credits and facts that the card clips to two lines", () => {
    const credits = "Jeroen Tel & Charles Deenen of Maniacs · 1990 A Publisher With A Rather Long Name Ltd";
    render(details({ credits, facts: "6581 · PAL · Tune 1 of 3 · 2:00" }));
    fireEvent.click(screen.getByTestId("tune-details-toggle"));
    expect(screen.getByTestId("tune-details-credits")).toHaveTextContent(credits);
    expect(screen.getByTestId("tune-details-facts")).toHaveTextContent("6581 · PAL · Tune 1 of 3 · 2:00");
    expect(screen.queryByTestId("tune-details-empty")).toBeNull();
  });

  it("starts collapsed and says what it opens", () => {
    render(details({ tuneLine: "BGM1 · music by Tamayo Kawamoto", note: "A note." }));
    const toggle = screen.getByTestId("tune-details-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveTextContent("About this tune");
    expect(screen.queryByTestId("tune-details-body")).toBeNull();
    expect(screen.queryByTestId("playback-current-stil")).toBeNull();
    expect(screen.queryByTestId("tune-notes")).toBeNull();
  });

  it("opens onto the STIL line and the note, and shuts again", () => {
    render(details({ tuneLine: "BGM1 · music by Tamayo Kawamoto", note: "A note." }));
    const toggle = screen.getByTestId("tune-details-toggle");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("playback-current-stil")).toHaveTextContent("BGM1 · music by Tamayo Kawamoto");
    expect(screen.getByTestId("tune-notes-text")).toHaveTextContent("A note.");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("tune-details-body")).toBeNull();
  });

  it("shuts again when the tune changes", () => {
    const { rerender } = render(details({ tuneLine: "BGM1", note: "A note." }));
    fireEvent.click(screen.getByTestId("tune-details-toggle"));
    expect(screen.getByTestId("tune-details-toggle")).toHaveAttribute("aria-expanded", "true");

    rerender(details({ tuneKey: "a:2", tuneLine: "BGM2", note: "Another note." }));
    expect(screen.getByTestId("tune-details-toggle")).toHaveAttribute("aria-expanded", "false");
  });

  it("stays open while the facts, credits and notes of the same tune are refined", () => {
    const { rerender } = render(details({ facts: "6581 · PAL · 3:00" }));
    fireEvent.click(screen.getByTestId("tune-details-toggle"));
    rerender(details({ facts: "6581 · PAL · 2:12", credits: "Rob Hubbard", tuneLine: "BGM1", note: "A note." }));
    expect(screen.getByTestId("tune-details-toggle")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("tune-details-facts")).toHaveTextContent("2:12");
  });

  it("names its body in aria-controls only while the body is rendered", () => {
    render(details());
    const toggle = screen.getByTestId("tune-details-toggle");
    expect(toggle).not.toHaveAttribute("aria-controls");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-controls", screen.getByTestId("tune-details-body").id);
  });

  it("names the control for automation that addresses it by resource id", () => {
    render(details({ tuneLine: "BGM1", note: null }));
    expect(screen.getByTestId("tune-details-toggle")).toHaveAttribute("id", "tune-details-toggle");
  });

  it("keeps the hit target at the project's floor even though the label is small text", () => {
    render(details({ tuneLine: "BGM1", note: null }));
    expect(screen.getByTestId("tune-details-toggle").className).toContain("min-h-11");
  });

  describe("Share", () => {
    it("is rendered only for a tune with a public link", () => {
      const { rerender } = render(details());
      expect(screen.queryByTestId("tune-share")).toBeNull();

      rerender(details({ share: null }));
      expect(screen.queryByTestId("tune-share")).toBeNull();

      rerender(details({ share: SHARE }));
      expect(screen.getByTestId("tune-share")).toBeInTheDocument();
    });

    it("sits on the toggle's row without adding a block element, and stays while the block is shut", () => {
      render(details({ share: SHARE }));
      const toggle = screen.getByTestId("tune-details-toggle");
      const share = screen.getByTestId("tune-share");
      const row = toggle.parentElement as HTMLElement;

      expect(row).not.toBe(screen.getByTestId("tune-details"));
      expect(share.parentElement).toBe(row);
      expect(row.children).toHaveLength(2);
      expect(screen.getByTestId("tune-details").children).toHaveLength(1);
      expect(toggle).toHaveAttribute("aria-expanded", "false");
    });

    it("keeps the row the only child above the body once it opens", () => {
      render(details({ share: SHARE, note: "A note." }));
      fireEvent.click(screen.getByTestId("tune-details-toggle"));
      const root = screen.getByTestId("tune-details");
      expect(root.children).toHaveLength(2);
      expect(root.children[1]).toBe(screen.getByTestId("tune-details-body"));
      expect(screen.getByTestId("tune-share")).toBeInTheDocument();
    });

    it("is named by the tune and labeled Share, with a target of at least 44 px", () => {
      render(details({ share: SHARE }));
      const share = screen.getByTestId("tune-share");
      expect(share).toHaveAccessibleName("Share Commando");
      expect(share).toHaveTextContent("Share");
      expect(share.className).toContain("min-h-11");
      expect(share.className).toContain("min-w-11");
    });

    it("hands the built payload to the share function when pressed", () => {
      render(details({ share: SHARE }));
      fireEvent.click(screen.getByTestId("tune-share"));
      expect(shareTune).toHaveBeenCalledTimes(1);
      expect(shareTune).toHaveBeenCalledWith(SHARE);
    });

    it("does not open or shut the block when pressed", () => {
      render(details({ share: SHARE }));
      fireEvent.click(screen.getByTestId("tune-share"));
      expect(screen.getByTestId("tune-details-toggle")).toHaveAttribute("aria-expanded", "false");
    });
  });
});
