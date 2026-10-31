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
    render(<RomDependencyDialog label={null} onChoose={vi.fn()} />);
    expect(screen.queryByTestId("rom-dependency-dialog")).toBeNull();
  });

  it("names the song and offers Play anyway and Cancel", () => {
    const onChoose = vi.fn();
    render(<RomDependencyDialog label="Comic Bakery" onChoose={onChoose} />);

    expect(screen.getByText("Needs the C64 ROMs")).toBeInTheDocument();
    expect(screen.getByText(/Comic Bakery.*needs the C64.s ROMs to play correctly on this phone/)).toBeInTheDocument();

    // Closing the dialog also reports a dismissal; the first answer is the one that counts.
    fireEvent.click(screen.getByTestId("rom-dependency-play-anyway"));
    expect(onChoose).toHaveBeenNthCalledWith(1, "play-anyway");
    onChoose.mockClear();
    fireEvent.click(screen.getByTestId("rom-dependency-cancel"));
    expect(onChoose).toHaveBeenNthCalledWith(1, "cancel");
  });

  it("says a BASIC tune needs the BASIC ROM, with one dismiss button and no Play anyway", () => {
    const onChoose = vi.fn();
    render(<RomDependencyDialog label="Comic Bakery" kind="needs-basic" onChoose={onChoose} />);

    expect(screen.getByText(/This tune is a BASIC program and needs the C64.s BASIC ROM/)).toBeInTheDocument();
    expect(screen.getByText(/Connect a C64, or add the ROMs in Settings/)).toBeInTheDocument();
    expect(screen.queryByTestId("rom-dependency-play-anyway")).toBeNull();
    expect(screen.queryByTestId("rom-dependency-cancel")).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);

    fireEvent.click(screen.getByTestId("rom-dependency-dismiss"));
    expect(onChoose).toHaveBeenNthCalledWith(1, "cancel");
  });

  it("counts Escape on the BASIC notice as a dismissal", () => {
    const onChoose = vi.fn();
    render(<RomDependencyDialog label="Comic Bakery" kind="needs-basic" onChoose={onChoose} />);
    fireEvent.keyDown(screen.getByTestId("rom-dependency-dialog"), { key: "Escape" });
    expect(onChoose).toHaveBeenCalledWith("cancel");
  });

  it("counts Escape as Cancel", () => {
    const onChoose = vi.fn();
    render(<RomDependencyDialog label="Comic Bakery" onChoose={onChoose} />);
    fireEvent.keyDown(screen.getByTestId("rom-dependency-dialog"), { key: "Escape" });
    expect(onChoose).toHaveBeenCalledWith("cancel");
  });
});

describe("useRomDependencyPrompt", () => {
  it("resolves with the listener's choice and closes", async () => {
    const { result } = renderHook(() => useRomDependencyPrompt());
    let answer: Promise<string> | undefined;
    act(() => {
      answer = result.current.ask(item("Comic Bakery"));
    });
    expect(result.current.label).toBe("Comic Bakery");
    act(() => result.current.choose("play-anyway"));
    act(() => result.current.choose("cancel")); // the dismissal that follows a button press changes nothing
    await expect(answer).resolves.toBe("play-anyway");
    expect(result.current.label).toBeNull();
  });

  it("carries the kind of question it was asked", () => {
    const { result } = renderHook(() => useRomDependencyPrompt());
    expect(result.current.kind).toBe("listed");
    act(() => {
      void result.current.ask(item("Comic Bakery"), "needs-basic");
    });
    expect(result.current.kind).toBe("needs-basic");
    act(() => result.current.choose("cancel"));
  });

  it("answers Cancel to a question it replaces, and to one left open when the page goes", async () => {
    const { result, unmount } = renderHook(() => useRomDependencyPrompt());
    let first: Promise<string> | undefined;
    let second: Promise<string> | undefined;
    act(() => {
      first = result.current.ask(item("one"));
    });
    act(() => {
      second = result.current.ask(item("two"));
    });
    await expect(first).resolves.toBe("cancel");
    unmount();
    await expect(second).resolves.toBe("cancel");
  });
});
