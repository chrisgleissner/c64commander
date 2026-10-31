/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";
import type { PlayFileCategory } from "@/lib/playback/fileTypes";
import { resolveSeekToFraction } from "@/pages/playFiles/resolveSeekToFraction";

const inputs = (overrides: Partial<Parameters<typeof resolveSeekToFraction>[0]> = {}) => ({
  category: "sid" as PlayFileCategory | undefined,
  remoteHandlers: null,
  localEngineActive: true,
  durationMs: 180_000 as number | undefined,
  seekLocal: vi.fn(),
  ...overrides,
});

describe("resolveSeekToFraction (QW-LS-03)", () => {
  it("seeks the on-device engine for a local SID with a known length", () => {
    const seekLocal = vi.fn();
    const seek = resolveSeekToFraction(inputs({ seekLocal }));

    expect(seek).toBeTypeOf("function");
    seek?.(0.25);

    expect(seekLocal).toHaveBeenCalledWith(0.25, 180_000);
  });

  it.each([undefined, 0])("cannot seek a local SID whose length is %s", (durationMs) => {
    expect(resolveSeekToFraction(inputs({ durationMs }))).toBeUndefined();
  });

  it("uses the C64's own seek when the machine supports it", () => {
    const onSeekToFraction = vi.fn();
    const seekLocal = vi.fn();
    const seek = resolveSeekToFraction(
      inputs({ localEngineActive: false, remoteHandlers: { onSeekToFraction }, seekLocal }),
    );

    seek?.(0.5);

    expect(onSeekToFraction).toHaveBeenCalledWith(0.5);
    expect(seekLocal).not.toHaveBeenCalled();
  });

  it("cannot seek on the C64 when the machine offers no seek", () => {
    expect(resolveSeekToFraction(inputs({ localEngineActive: false, remoteHandlers: null }))).toBeUndefined();
  });

  it("cannot seek on the C64 when its handlers have no seek-to-position", () => {
    expect(
      resolveSeekToFraction(inputs({ localEngineActive: false, remoteHandlers: { onSeek: vi.fn() } })),
    ).toBeUndefined();
  });

  it.each<PlayFileCategory>(["disk", "prg", "crt", "mod"])("never seeks a %s", (category) => {
    expect(resolveSeekToFraction(inputs({ category }))).toBeUndefined();
    expect(
      resolveSeekToFraction(
        inputs({ category, localEngineActive: false, remoteHandlers: { onSeekToFraction: vi.fn() } }),
      ),
    ).toBeUndefined();
  });

  it("cannot seek when nothing is playing", () => {
    expect(resolveSeekToFraction(inputs({ category: undefined }))).toBeUndefined();
  });
});
