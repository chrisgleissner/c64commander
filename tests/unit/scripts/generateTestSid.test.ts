/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * The steady-tone generator behind the transition probe.
 *
 * The probe grades the join between two tunes by looking for an instant where both pitches are
 * present at once. That only works if each file really does hold one steady tone at the pitch it
 * claims, so the two ways of quietly producing a file that plays nothing are pinned here: a header
 * whose declared chip and clock do not match what the file was built for, and a `--hz` typo that
 * writes zero into the frequency registers. Either produces a valid-looking SID of the right size
 * that a probe run would grade as a silent pipeline rather than as a broken input.
 */

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildTestSid, frequencyRegister, noteToHz } from "../../../scripts/generate-test-sid.mjs";
import { parseSidHeaderMetadata } from "@/lib/sid/sidUtils";

const scriptPath = path.resolve(fileURLToPath(new URL("../../../scripts/generate-test-sid.mjs", import.meta.url)));

describe("the steady-tone SID generator", () => {
  it("declares the chip and clock the app's own parser reads back", () => {
    // The header is only useful if it says the same thing to the app as it does to the comment
    // beside it. `parseSidHeaderMetadata` is what the rest of the project uses, so it is the judge.
    const sid = buildTestSid({ hz: noteToHz("C3"), name: "Tone C3" });
    const meta = parseSidHeaderMetadata(sid);

    expect(meta.clock).toBe("pal");
    expect(meta.sid1Model).toBe("mos6581");
    // A built-in player, not MUS data — the file carries its own 6502 code.
    expect(meta.musPlayer).toBe(false);
  });

  it("writes the pitch into the frequency registers rather than zero", () => {
    const hz = noteToHz("A4");
    const register = frequencyRegister(hz);
    const sid = buildTestSid({ hz, name: "Tone A4" });

    // The player code sets $D400 and $D401 from immediate operands. Zero in both is the signature of
    // a bad pitch: the file is the right size, the header parses, and the SID emits nothing.
    expect(register).toBeGreaterThan(0);
    expect(sid.includes(Buffer.from([0xa9, register & 0xff, 0x8d, 0x00, 0xd4]))).toBe(true);
    expect(sid.includes(Buffer.from([0xa9, (register >> 8) & 0xff, 0x8d, 0x01, 0xd4]))).toBe(true);
  });

  it("refuses a --hz that is not a number instead of writing a silent file", () => {
    // `Number("foo")` is NaN, and `NaN & 0xff` / `NaN >> 8` are both 0 in JavaScript — so without a
    // guard this produced a perfectly valid SID that plays silence, and the typo only showed up as a
    // probe result that made no sense.
    expect(() =>
      execFileSync(process.execPath, [scriptPath, "--hz", "foo", "--out", "/dev/null"], { stdio: "pipe" }),
    ).toThrow();
  });

  it("refuses a --volume outside the SID's range for the same reason", () => {
    expect(() =>
      execFileSync(process.execPath, [scriptPath, "--note", "C3", "--volume", "99", "--out", "/dev/null"], {
        stdio: "pipe",
      }),
    ).toThrow();
  });

  it("still writes a file for a valid pitch", () => {
    const output = execFileSync(process.execPath, [scriptPath, "--hz", "440", "--out", "/dev/null"], {
      encoding: "utf8",
    });
    expect(output).toContain("440.00 Hz");
  });
});
