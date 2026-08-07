/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { TuneDetails } from "@/pages/playFiles/components/TuneDetails";

afterEach(cleanup);

describe("TuneDetails", () => {
  it("renders nothing when STIL has neither a tune line nor a note", () => {
    const { container } = render(<TuneDetails tuneLine={null} note={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("treats a note of nothing but whitespace as no note at all", () => {
    const { container } = render(<TuneDetails tuneLine={null} note="   " />);
    expect(container).toBeEmptyDOMElement();
  });

  it("starts collapsed and says what it opens", () => {
    render(<TuneDetails tuneLine="BGM1 · music by Tamayo Kawamoto" note="A note." />);
    const toggle = screen.getByTestId("tune-details-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveTextContent("About this tune");
    expect(screen.queryByTestId("tune-details-body")).toBeNull();
    expect(screen.queryByTestId("playback-current-stil")).toBeNull();
    expect(screen.queryByTestId("tune-notes")).toBeNull();
  });

  it("opens onto the STIL line and the note, and shuts again", () => {
    render(<TuneDetails tuneLine="BGM1 · music by Tamayo Kawamoto" note="A note." />);
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
    const { rerender } = render(<TuneDetails tuneLine="BGM1" note="A note." />);
    fireEvent.click(screen.getByTestId("tune-details-toggle"));
    expect(screen.getByTestId("tune-details-toggle")).toHaveAttribute("aria-expanded", "true");

    rerender(<TuneDetails tuneLine="BGM2" note="Another note." />);
    expect(screen.getByTestId("tune-details-toggle")).toHaveAttribute("aria-expanded", "false");
  });

  it("names the control for automation that addresses it by resource id", () => {
    render(<TuneDetails tuneLine="BGM1" note={null} />);
    expect(screen.getByTestId("tune-details-toggle")).toHaveAttribute("id", "tune-details-toggle");
  });

  it("keeps the hit target at the project's floor even though the label is small text", () => {
    render(<TuneDetails tuneLine="BGM1" note={null} />);
    // 44 px: the general tap-target floor in AGENTS.md, enforced by
    // smallScreenErgonomics.spec.ts (MIN_TARGET_PX). The 40 px figure in
    // docs/ux-guidelines.md is scoped to CloseControl, the interstitial dismissal glyph,
    // and does not apply to an ordinary disclosure button.
    expect(screen.getByTestId("tune-details-toggle").className).toContain("min-h-11");
  });
});
