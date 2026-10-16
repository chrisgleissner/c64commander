/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";
import { afterNextPaint } from "@/lib/ui/afterNextPaint";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("afterNextPaint", () => {
  it("runs after the frame, not inside the frame callbacks that precede its paint", async () => {
    const run = vi.fn();
    let callsDuringFrame = -1;
    afterNextPaint(run);
    requestAnimationFrame(() => {
      callsDuringFrame = run.mock.calls.length;
    });

    await wait(60);

    expect(callsDuringFrame).toBe(0);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not run once cancelled, before or after the frame", async () => {
    const early = vi.fn();
    afterNextPaint(early)();
    const late = vi.fn();
    const cancelLate = afterNextPaint(late);
    requestAnimationFrame(() => cancelLate());

    await wait(60);

    expect(early).not.toHaveBeenCalled();
    expect(late).not.toHaveBeenCalled();
  });
});
