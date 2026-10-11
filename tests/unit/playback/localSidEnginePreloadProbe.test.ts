/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@capacitor/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@capacitor/core")>();
  return {
    ...actual,
    Capacitor: {
      ...actual.Capacitor,
      getPlatform: () => "android",
      isPluginAvailable: () => true,
      isNativePlatform: () => true,
    },
  };
});
const answer = vi.hoisted(() => ({ resolve: null as null | ((value: unknown) => void) }));
vi.mock("@/lib/native/sidAudio", () => ({
  SidAudio: {
    describe: () => new Promise((resolve) => (answer.resolve = resolve)),
  },
}));

import { LocalSidEngine, type LocalSidWorkerLike } from "@/lib/playback/localSidEngine";
import { __setSidplayEzAvailabilityForTests } from "@/lib/playback/sidRenderer/sidRendererAvailability";

describe("LocalSidEngine.preload on Android", () => {
  afterEach(() => __setSidplayEzAvailabilityForTests(null));

  it("waits for the native probe before choosing the renderer to load", async () => {
    // Choosing first would load a WASM worker, as libSidplayEZ counts as missing until the probe answers.
    const renderers: string[] = [];
    const engine = new LocalSidEngine({
      rendererFactory: (renderer) => {
        renderers.push(renderer);
        return {
          postMessage: () => undefined,
          addEventListener: () => undefined,
          terminate: () => undefined,
        } as unknown as LocalSidWorkerLike;
      },
    });
    void engine.preload().catch(() => undefined);
    await Promise.resolve();
    expect(renderers).toEqual([]);
    answer.resolve?.({ sidplayezAvailable: true, sidplayezRevision: "test" });
    await vi.waitFor(() => expect(renderers).toEqual(["sidplayez"]));
    engine.dispose();
  });
});
