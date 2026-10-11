/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const logs = vi.hoisted(() => [] as Array<{ level: string; message: string }>);
vi.mock("@/lib/logging", () => ({ addLog: (level: string, message: string) => logs.push({ level, message }) }));

import type { SidAudioPlugin } from "@/lib/native/sidAudio";
import { __resetSidAudioAttachForTests, ensureSidAudioAttached } from "@/lib/playback/sidRenderer/sidAudioAttach";

describe("attaching to the native SID audio plugin", () => {
  beforeEach(() => {
    logs.length = 0;
    __resetSidAudioAttachForTests();
  });

  it("attaches once per page, however often it is asked", async () => {
    const attach = vi.fn(async () => undefined);
    const plugin = { attach } as unknown as SidAudioPlugin;
    await Promise.all([ensureSidAudioAttached(plugin), ensureSidAudioAttached(plugin)]);
    await ensureSidAudioAttached(plugin);
    expect(attach).toHaveBeenCalledTimes(1);
  });

  it("logs a failed attach and settles, so playback can still start", async () => {
    const plugin = {
      attach: vi.fn(async () => Promise.reject(new Error("plugin missing"))),
    } as unknown as SidAudioPlugin;
    await expect(ensureSidAudioAttached(plugin)).resolves.toBeUndefined();
    expect(logs).toEqual([{ level: "warn", message: "Native SID audio: attaching to the plugin failed" }]);
  });
});
