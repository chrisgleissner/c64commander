/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";

const plugin = vi.hoisted(() => ({
  attach: vi.fn(async () => undefined),
  createRenderer: vi.fn(async (_options: { background: boolean }) => ({ renderer: 7 })),
  disposeRenderer: vi.fn(async () => undefined),
}));
vi.mock("@/lib/native/sidAudio", () => ({ SidAudio: plugin }));

import type { LocalSidWorkerToMain } from "@/lib/playback/localSidWorkerProtocol";
import { defaultRendererChannelFactory } from "@/lib/playback/sidRenderer/rendererFactory";

describe("a native renderer channel from the factory", () => {
  it("creates its libSidplayEZ renderer only when loaded, after attaching, in the background unless it plays", async () => {
    const received: LocalSidWorkerToMain[] = [];
    const prerender = defaultRendererChannelFactory("sidplayez", "prerender");
    prerender.addEventListener("message", (event) => received.push(event.data));
    expect(plugin.createRenderer).not.toHaveBeenCalled();
    prerender.postMessage({ type: "load" });
    await vi.waitFor(() => expect(received.map((message) => message.type)).toEqual(["ready"]));
    expect(plugin.attach).toHaveBeenCalled();
    expect(plugin.createRenderer).toHaveBeenLastCalledWith({ background: true });

    const playback = defaultRendererChannelFactory("sidplayez", "playback");
    playback.postMessage({ type: "load" });
    await vi.waitFor(() => expect(plugin.createRenderer).toHaveBeenLastCalledWith({ background: false }));
    prerender.terminate();
    playback.terminate();
  });
});
