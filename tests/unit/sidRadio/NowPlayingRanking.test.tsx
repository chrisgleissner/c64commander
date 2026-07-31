/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NowPlayingRanking } from "@/pages/playFiles/components/NowPlayingRanking";
import { clearAllRankings, getRanking, setRanking, simulateRankingRestartForTests } from "@/lib/sidRadio/rankingStore";

const MD5 = "0123456789abcdef0123456789abcdef";

beforeEach(async () => {
  localStorage.clear();
  await clearAllRankings();
});

describe("NowPlayingRanking", () => {
  it("renders nothing when disabled", () => {
    const { container } = render(<NowPlayingRanking md5={MD5} enabled={false} />);
    expect(container.firstChild).toBeNull();
  });

  // The labels used to be "Like this tune" and "Not for me". They now name the consequence, which
  // is the point of an accessible name: someone who cannot see the card had no way to tell from
  // "Not for me" that the tune was about to stop playing, and no way to tell either control shapes
  // what the station serves next.
  it("names what each control does, and says so only mentions a skip when a station is running", () => {
    const { rerender } = render(<NowPlayingRanking md5={MD5} enabled />);
    expect(screen.getByTestId("now-playing-like")).toHaveAttribute(
      "aria-label",
      "Like this tune — play more like this",
    );
    expect(screen.getByTestId("now-playing-notforme")).toHaveAttribute(
      "aria-label",
      "Not for me — play less like this",
    );

    rerender(<NowPlayingRanking md5={MD5} enabled onNotForMe={vi.fn()} />);
    expect(screen.getByTestId("now-playing-notforme")).toHaveAttribute(
      "aria-label",
      "Not for me — skip and play less like this",
    );
  });

  /**
   * ✕ sits inboard of ♥ so that the outermost seat of a right-aligned pair — the easiest target for
   * a thumb, and where an overshoot from the Next button below lands — belongs to the harmless half.
   * A stray ♥ is visible and one tap to undo; a stray ✕ takes the tune away and biases every future
   * refill, and the card has already moved on by the time the user notices.
   */
  it("puts ✕ before ♥, so the outermost control is the safe one", () => {
    render(<NowPlayingRanking md5={MD5} enabled />);
    const [first, second] = Array.from(screen.getByTestId("now-playing-ranking").children);
    expect(first).toHaveAttribute("data-testid", "now-playing-notforme");
    expect(second).toHaveAttribute("data-testid", "now-playing-like");
  });

  it("gives both controls the transport's own size and chrome, not a smaller ghost glyph", () => {
    render(<NowPlayingRanking md5={MD5} enabled />);
    for (const testId of ["now-playing-like", "now-playing-notforme"]) {
      const button = screen.getByTestId(testId);
      // 44 px square: the transport's `size="icon"`, and above the project's own 40 px floor.
      expect(button).toHaveClass("h-11", "w-11");
      expect(button.className).not.toMatch(/\bh-8\b|\bw-8\b/);
      // A border is what makes these read as buttons beside the transport — and, for the ✕, what
      // distinguishes it from the app's shared close control, which is defined as a bare × with no
      // chrome at all.
      expect(button).toHaveClass("border");
    }
  });

  it("shows both states by shape as well as colour", async () => {
    const { container } = render(<NowPlayingRanking md5={MD5} enabled />);
    const like = screen.getByTestId("now-playing-like");
    const notForMe = screen.getByTestId("now-playing-notforme");

    // At rest: an outline heart and a bare ✕ (no ring around it).
    expect(like.querySelector("svg")).not.toHaveClass("fill-current");
    expect(notForMe.querySelector("circle")).toBeNull();

    fireEvent.click(like);
    await waitFor(() => expect(getRanking(MD5)).toBe("like"));
    // Liked: the glyph itself fills in, which survives greyscale.
    expect(like.querySelector("svg")).toHaveClass("fill-current");

    fireEvent.click(notForMe);
    await waitFor(() => expect(getRanking(MD5)).toBe("notForMe"));
    // Not-for-me: the ✕ gains a ring, and the surface fills.
    expect(container.querySelector('[data-testid="now-playing-notforme"] circle')).not.toBeNull();
    expect(screen.getByTestId("now-playing-notforme")).toHaveClass("bg-accent");
  });

  it("disables the buttons until the tune's MD5 is resolved", () => {
    render(<NowPlayingRanking md5={null} enabled />);
    expect(screen.getByTestId("now-playing-like")).toBeDisabled();
    expect(screen.getByTestId("now-playing-notforme")).toBeDisabled();
  });

  /**
   * The ratings are durable but the cache they are read from is not, and only a *write* used to
   * hydrate it. So a relaunched app showed every previously rated tune as unrated, and the first
   * rating of the session then made a stale ♥ appear on whatever happened to be playing.
   */
  it("shows a ♥ stored before the app was relaunched", async () => {
    await setRanking(MD5, "like");
    await simulateRankingRestartForTests();

    render(<NowPlayingRanking md5={MD5} enabled />);

    await waitFor(() => expect(screen.getByTestId("now-playing-like")).toHaveAttribute("aria-pressed", "true"));
  });

  it("toggles Like on and off, persisting to the store", async () => {
    render(<NowPlayingRanking md5={MD5} enabled />);
    const like = screen.getByTestId("now-playing-like");
    fireEvent.click(like);
    await waitFor(() => expect(getRanking(MD5)).toBe("like"));
    expect(like).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(like);
    await waitFor(() => expect(getRanking(MD5)).toBeNull());
    expect(like).toHaveAttribute("aria-pressed", "false");
  });

  it("✕ with no active station only records the dislike (no transport call)", async () => {
    render(<NowPlayingRanking md5={MD5} enabled />);
    fireEvent.click(screen.getByTestId("now-playing-notforme"));
    await waitFor(() => expect(getRanking(MD5)).toBe("notForMe"));
    expect(screen.getByTestId("now-playing-notforme")).toHaveAttribute("aria-pressed", "true");
  });

  it("✕ calls onNotForMe (station skip) only when newly marking", async () => {
    const onNotForMe = vi.fn();
    render(<NowPlayingRanking md5={MD5} enabled onNotForMe={onNotForMe} />);
    const notForMe = screen.getByTestId("now-playing-notforme");
    fireEvent.click(notForMe); // newly marks → skip fires
    await waitFor(() => expect(getRanking(MD5)).toBe("notForMe"));
    expect(onNotForMe).toHaveBeenCalledTimes(1);
    fireEvent.click(notForMe); // un-marks → no skip
    await waitFor(() => expect(getRanking(MD5)).toBeNull());
    expect(onNotForMe).toHaveBeenCalledTimes(1);
  });

  it("switching Like → ✕ replaces the signal", async () => {
    render(<NowPlayingRanking md5={MD5} enabled />);
    fireEvent.click(screen.getByTestId("now-playing-like"));
    await waitFor(() => expect(getRanking(MD5)).toBe("like"));
    fireEvent.click(screen.getByTestId("now-playing-notforme"));
    await waitFor(() => expect(getRanking(MD5)).toBe("notForMe"));
    expect(screen.getByTestId("now-playing-like")).toHaveAttribute("aria-pressed", "false");
  });
});
