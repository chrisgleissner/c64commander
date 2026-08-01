/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ensureStilReady = vi.fn(async () => true);
const getStilInfo = vi.fn(async () => null as unknown);

vi.mock("@/lib/hvsc", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    ensureStilReady: () => ensureStilReady(),
    getStilInfo: (...args: unknown[]) => getStilInfo(...(args as [])),
  };
});

import { toStilDisplay, useStilInfo } from "@/pages/playFiles/hooks/useStilInfo";

describe("toStilDisplay", () => {
  it("strips the section start time from the title", () => {
    // STIL times the sections of a medley. Meaningful in the full credit list, noise on the one
    // credit that is shown, whose time is by definition where the tune starts.
    expect(
      toStilDisplay({ credits: [{ title: "BGM1 [from the arcade game Commando] (0:00)", artist: "Tamayo Kawamoto" }] }),
    ).toEqual({
      title: "BGM1 [from the arcade game Commando]",
      originalArtist: "Tamayo Kawamoto",
      note: null,
    });
  });

  it("falls back to STIL's own name when there is no titled credit", () => {
    expect(toStilDisplay({ name: "ASM Chronicles: Tea for the Seasick" }).title).toBe(
      "ASM Chronicles: Tea for the Seasick",
    );
  });

  it("says nothing at all for a tune STIL does not describe", () => {
    expect(toStilDisplay(null)).toEqual({ title: null, originalArtist: null, note: null });
    expect(toStilDisplay({ credits: [{ title: "   " }], comment: "  " })).toEqual({
      title: null,
      originalArtist: null,
      note: null,
    });
  });
});

describe("useStilInfo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureStilReady.mockResolvedValue(true);
    getStilInfo.mockResolvedValue(null);
  });

  it("looks nothing up for a tune that did not come from the archive", async () => {
    const { result } = renderHook(() => useStilInfo({ virtualPath: null, songNr: 1 }));
    expect(result.current).toEqual({ title: null, originalArtist: null, note: null });
    expect(getStilInfo).not.toHaveBeenCalled();
  });

  it("asks for the tune that is playing, not just the file", async () => {
    getStilInfo.mockResolvedValue({ credits: [{ title: "BGM1", artist: "Tamayo Kawamoto" }] });
    const { result } = renderHook(() =>
      useStilInfo({ virtualPath: "/MUSICIANS/H/Hubbard_Rob/Commando.sid", songNr: 3 }),
    );
    await waitFor(() => expect(result.current.title).toBe("BGM1"));
    expect(getStilInfo).toHaveBeenCalledWith("/MUSICIANS/H/Hubbard_Rob/Commando.sid", 3);
  });

  it("clears what it was showing when the tune changes", async () => {
    // A stale note under a new tune reads as that tune's note.
    getStilInfo.mockResolvedValue({ comment: "First tune's note" });
    const { result, rerender } = renderHook(
      ({ path }: { path: string }) => useStilInfo({ virtualPath: path, songNr: 1 }),
      {
        initialProps: { path: "/A/one.sid" },
      },
    );
    await waitFor(() => expect(result.current.note).toBe("First tune's note"));

    let release: (value: unknown) => void = () => {};
    getStilInfo.mockReturnValue(new Promise((resolve) => (release = resolve)));
    rerender({ path: "/A/two.sid" });
    expect(result.current.note).toBeNull();
    release(null);
  });

  it("shows nothing rather than throwing when the lookup fails", async () => {
    getStilInfo.mockRejectedValue(new Error("shard unreadable"));
    const { result } = renderHook(() => useStilInfo({ virtualPath: "/A/one.sid", songNr: 1 }));
    await waitFor(() => expect(result.current).toEqual({ title: null, originalArtist: null, note: null }));
  });
});
