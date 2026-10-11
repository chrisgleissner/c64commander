/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";

import { lazyRendererCore } from "@/lib/playback/sidRenderer/lazyRendererCore";
import type { SidRendererCore } from "@/lib/playback/sidRenderer/sidRendererContract";

const fakeCore = (): SidRendererCore & { dispose: ReturnType<typeof vi.fn> } => ({
  load: vi.fn(async () => undefined),
  open: vi.fn(async () => ({ sampleRate: 48000, channels: 2, tuneInfo: null })),
  render: vi.fn(async () => null),
  seek: vi.fn(async (position: number) => position),
  prerender: vi.fn(async () => ({ sampleRate: 48000, channels: 2, seconds: 3 })),
  close: vi.fn(async () => undefined),
  dispose: vi.fn(),
});

const request = { sidBytes: new ArrayBuffer(4), songIndex: 0, sampleRate: 48000 } as never;

describe("lazyRendererCore", () => {
  it("imports the core once, on first use, and passes every call through", async () => {
    const core = fakeCore();
    const loadCore = vi.fn(async () => core);
    const lazy = lazyRendererCore(loadCore);
    expect(loadCore).not.toHaveBeenCalled();
    await Promise.all([lazy.load({ pcmHeadroomSamples: 12 }), lazy.open(request)]);
    expect(await lazy.seek(7)).toBe(7);
    await lazy.render(0.5);
    const onSlice = vi.fn();
    const isSuperseded = () => false;
    expect(await lazy.prerender({ ...(request as object), seconds: 3 } as never, onSlice, isSuperseded)).toEqual({
      sampleRate: 48000,
      channels: 2,
      seconds: 3,
    });
    await lazy.close();
    expect(loadCore).toHaveBeenCalledTimes(1);
    expect(core.load).toHaveBeenCalledWith({ pcmHeadroomSamples: 12 });
    expect(core.open).toHaveBeenCalledWith(request);
    expect(core.render).toHaveBeenCalledWith(0.5);
    expect(core.prerender).toHaveBeenCalledWith(expect.objectContaining({ seconds: 3 }), onSlice, isSuperseded);
    expect(core.close).toHaveBeenCalled();
  });

  it("fails the call whose import failed, naming the cause, and tries the import again next time", async () => {
    const core = fakeCore();
    const loadCore = vi.fn().mockRejectedValueOnce(new Error("chunk missing")).mockResolvedValueOnce(core);
    const lazy = lazyRendererCore(loadCore);
    await expect(lazy.load({})).rejects.toThrow("Loading the SID renderer failed: chunk missing");
    await lazy.load({});
    expect(loadCore).toHaveBeenCalledTimes(2);
    expect(core.load).toHaveBeenCalledTimes(1);
  });

  it("disposes a core that arrives after the channel was disposed", async () => {
    const core = fakeCore();
    let resolve!: (value: SidRendererCore) => void;
    const lazy = lazyRendererCore(() => new Promise((r) => (resolve = r)));
    const pending = lazy.load({});
    lazy.dispose();
    resolve(core);
    await pending;
    expect(core.dispose).toHaveBeenCalledTimes(1);
  });

  it("disposes a loaded core straight away, and does nothing when none was ever loaded", async () => {
    const core = fakeCore();
    const lazy = lazyRendererCore(async () => core);
    await lazy.load({});
    lazy.dispose();
    expect(core.dispose).toHaveBeenCalledTimes(1);
    const loadCore = vi.fn(async () => fakeCore());
    lazyRendererCore(loadCore).dispose();
    expect(loadCore).not.toHaveBeenCalled();
  });
});
