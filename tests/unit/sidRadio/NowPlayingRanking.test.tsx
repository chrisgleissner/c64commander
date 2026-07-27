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
import { clearAllRankings, getRanking } from "@/lib/sidRadio/rankingStore";

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

  it("shows ♥ and ✕ with accessible labels when enabled", () => {
    render(<NowPlayingRanking md5={MD5} enabled />);
    expect(screen.getByTestId("now-playing-like")).toHaveAttribute("aria-label", "Like this tune");
    expect(screen.getByTestId("now-playing-notforme")).toHaveAttribute("aria-label", "Not for me");
  });

  it("disables the buttons until the tune's MD5 is resolved", () => {
    render(<NowPlayingRanking md5={null} enabled />);
    expect(screen.getByTestId("now-playing-like")).toBeDisabled();
    expect(screen.getByTestId("now-playing-notforme")).toBeDisabled();
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
