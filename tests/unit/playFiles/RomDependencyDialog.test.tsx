/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RomDependencyDialog } from "@/pages/playFiles/components/RomDependencyDialog";
import { useRomDependencyPrompt } from "@/pages/playFiles/hooks/useRomDependencyPrompt";
import type { PlaylistItem } from "@/pages/playFiles/types";

const item = (label: string) => ({ id: label, label }) as PlaylistItem;

describe("RomDependencyDialog", () => {
  it("is closed without a song", () => {
    render(<RomDependencyDialog prompt={null} onChoose={vi.fn()} />);
    expect(screen.queryByTestId("rom-dependency-dialog")).toBeNull();
  });

  it("names the song and offers Play anyway and Cancel", () => {
    const onChoose = vi.fn();
    render(<RomDependencyDialog prompt={{ label: "Comic Bakery", canPlayAnyway: true }} onChoose={onChoose} />);

    expect(screen.getByText("Needs the C64 ROMs")).toBeInTheDocument();
    expect(screen.getByText(/Comic Bakery.*needs the C64.s ROMs to play correctly on this phone/)).toBeInTheDocument();

    // Closing the dialog also reports a dismissal; the first answer is the one that counts.
    fireEvent.click(screen.getByTestId("rom-dependency-play-anyway"));
    expect(onChoose).toHaveBeenNthCalledWith(1, "play-anyway");
    onChoose.mockClear();
    fireEvent.click(screen.getByTestId("rom-dependency-cancel"));
    expect(onChoose).toHaveBeenNthCalledWith(1, "cancel");
  });

  it("offers only OK, and no Play anyway, for a song the phone cannot play without the ROMs", () => {
    const onChoose = vi.fn();
    render(<RomDependencyDialog prompt={{ label: "Comic Bakery", canPlayAnyway: false }} onChoose={onChoose} />);

    expect(screen.getByText(/Comic Bakery.*cannot play on this phone without the C64.s ROMs/)).toBeInTheDocument();
    expect(screen.queryByTestId("rom-dependency-play-anyway")).toBeNull();
    expect(screen.getByTestId("rom-dependency-cancel")).toHaveTextContent("OK");

    fireEvent.click(screen.getByTestId("rom-dependency-cancel"));
    expect(onChoose).toHaveBeenNthCalledWith(1, "cancel");
  });

  it("counts Escape as Cancel", () => {
    const onChoose = vi.fn();
    render(<RomDependencyDialog prompt={{ label: "Comic Bakery", canPlayAnyway: true }} onChoose={onChoose} />);
    fireEvent.keyDown(screen.getByTestId("rom-dependency-dialog"), { key: "Escape" });
    expect(onChoose).toHaveBeenCalledWith("cancel");
  });
});

describe("useRomDependencyPrompt", () => {
  it("resolves with the listener's choice and closes", async () => {
    const { result } = renderHook(() => useRomDependencyPrompt());
    let answer: Promise<string> | undefined;
    act(() => {
      answer = result.current.ask(item("Comic Bakery"), { canPlayAnyway: true });
    });
    expect(result.current.pending).toEqual({ label: "Comic Bakery", canPlayAnyway: true });
    act(() => result.current.choose("play-anyway"));
    act(() => result.current.choose("cancel")); // the dismissal that follows a button press changes nothing
    await expect(answer).resolves.toBe("play-anyway");
    expect(result.current.pending).toBeNull();
  });

  it("answers Cancel to a question it replaces, and to one left open when the page goes", async () => {
    const { result, unmount } = renderHook(() => useRomDependencyPrompt());
    let first: Promise<string> | undefined;
    let second: Promise<string> | undefined;
    act(() => {
      first = result.current.ask(item("one"), { canPlayAnyway: true });
    });
    act(() => {
      second = result.current.ask(item("two"), { canPlayAnyway: false });
    });
    await expect(first).resolves.toBe("cancel");
    expect(result.current.pending).toEqual({ label: "two", canPlayAnyway: false });
    unmount();
    await expect(second).resolves.toBe("cancel");
  });
});
