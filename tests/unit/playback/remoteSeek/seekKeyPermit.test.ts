/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MachineInputBatch } from "@/lib/c64api";
import { grantSeekKeyPress, SeekKeyRefusedError, withSeekKeyPermits } from "@/lib/playback/remoteSeek/seekKeyPermit";

const DEVICE = "c64u";
const press = (key: string): MachineInputBatch => ({
  events: [{ kind: "keyboard", inputs: [key as never], transition: "press" }],
});

describe("seek key permits", () => {
  let send: ReturnType<typeof vi.fn>;
  let guarded: (batch: MachineInputBatch) => Promise<unknown>;
  let connected: string | null;

  beforeEach(() => {
    vi.useFakeTimers();
    connected = DEVICE;
    send = vi.fn(async () => ({}));
    guarded = withSeekKeyPermits(send, () => connected);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("refuses a seek key press nobody confirmed the SID player for", async () => {
    for (const key of ["arrow_left", "minus", "plus"]) {
      await expect(guarded(press(key))).rejects.toBeInstanceOf(SeekKeyRefusedError);
    }
    await expect(
      guarded({ events: [{ kind: "keyboard", inputs: ["arrow_left"], transition: "tap" }] }),
    ).rejects.toBeInstanceOf(SeekKeyRefusedError);
    expect(send).not.toHaveBeenCalled();
  });

  it("lets one confirmed press through, once", async () => {
    grantSeekKeyPress(DEVICE, "arrow_left");
    await guarded(press("arrow_left"));
    await expect(guarded(press("arrow_left"))).rejects.toBeInstanceOf(SeekKeyRefusedError);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("refuses a permit for another key, another device, or one that has expired", async () => {
    grantSeekKeyPress(DEVICE, "minus");
    await expect(guarded(press("plus"))).rejects.toBeInstanceOf(SeekKeyRefusedError);
    grantSeekKeyPress("u64", "arrow_left");
    await expect(guarded(press("arrow_left"))).rejects.toBeInstanceOf(SeekKeyRefusedError);
    grantSeekKeyPress(DEVICE, "arrow_left");
    vi.advanceTimersByTime(501);
    await expect(guarded(press("arrow_left"))).rejects.toBeInstanceOf(SeekKeyRefusedError);
    expect(send).not.toHaveBeenCalled();
  });

  it("always lets a release through, since letting a key go never does harm", async () => {
    await guarded({ events: [{ kind: "keyboard", inputs: ["arrow_left", "minus", "plus"], transition: "release" }] });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("leaves keys that are not a seek's, and joysticks, to their own callers", async () => {
    await guarded({ events: [{ kind: "keyboard", inputs: ["a" as never], transition: "press" }] });
    await guarded({ events: [{ kind: "joystick", port: 2, inputs: ["fire" as never], transition: "press" } as never] });
    expect(send).toHaveBeenCalledTimes(2);
  });
});
