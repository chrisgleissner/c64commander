/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * The barcode stimulus must declare the hardware it says it declares.
 *
 * `audio_e2e_probe.py` had `0b100100` beside a comment reading "PAL, 6581" — but bits 4-5 are the SID
 * model, so that value says **8580**. It survived unnoticed because the barcode is a bare triangle wave
 * that never touches the filter, and 6581 and 8580 only diverge once the filter is in play: the
 * stimulus sounded right and graded right the whole time. Nothing that grades playback can catch this,
 * which is precisely why it needs a test of its own.
 *
 * Parsed with the app's own `parseSidHeaderMetadata`, so the stimulus is read back through the same
 * bit definitions the product uses rather than through a second copy of them in the test.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseSidHeaderMetadata } from "@/lib/sid/sidUtils";

const PROBE = "tools/hil/audio_e2e_probe.py";

describe("the audio probe's generated SID stimulus", () => {
  let dir: string;
  let header: ReturnType<typeof parseSidHeaderMetadata>;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "audio-probe-"));
    const out = join(dir, "barcode.sid");
    execFileSync("python3", [PROBE, "build-sid", "--out", out], { stdio: "pipe" });
    header = parseSidHeaderMetadata(new Uint8Array(readFileSync(out)));
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("declares PAL, which is what its raster-counted timing assumes", () => {
    // The note lengths are counted in PAL frames (312 lines x 63 cycles at 985248 Hz), so a stimulus
    // declaring NTSC would be asking the player for timing the analyser does not expect.
    expect(header.clock).toBe("pal");
  });

  it("declares the 6581 its comment claims, not the 8580 the old bit pattern said", () => {
    expect(header.sid1Model).toBe("mos6581");
  });

  it("is a well-formed PSID the app's own parser accepts without warnings", () => {
    expect(header.magicId).toBe("PSID");
    expect(header.parserWarnings).toEqual([]);
  });
});
