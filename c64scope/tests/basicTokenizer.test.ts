/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import {
  basicToPrg,
  COLOR_AND_SOUND_PROGRAM,
  EXPECTED_BG_COLOR,
  EXPECTED_BORDER_COLOR,
  STREAM_VALIDATION_PROGRAM,
} from "../src/basicTokenizer.js";

describe("basic tokenizer", () => {
  it("builds a BASIC PRG with a load address and terminator", () => {
    const prg = basicToPrg('10 PRINT "HELLO"\n20 END');

    expect(prg.readUInt16LE(0)).toBe(0x0801);
    expect(prg.at(-2)).toBe(0x00);
    expect(prg.at(-1)).toBe(0x00);
  });

  it("tokenizes keywords while preserving quoted strings and REM text", () => {
    const prg = basicToPrg('10 print "goto"\n20 rem goto stays text');
    const body = prg.subarray(2);

    expect(body.includes(0x99)).toBe(true);
    expect(body.includes(0x8f)).toBe(true);
    expect(Buffer.from(body).includes(Buffer.from('"goto"'))).toBe(true);
    expect(Buffer.from(body).includes(Buffer.from("goto stays text"))).toBe(true);
  });

  it("handles empty lines and validates line numbers", () => {
    const prg = basicToPrg("10   \n20");
    expect(prg.length).toBeGreaterThan(6);
    expect(() => basicToPrg("PRINT 1")).toThrow(/Expected line number/);
    expect(() => basicToPrg("70000 PRINT 1")).toThrow(/Line number out of range/);
  });

  it("publishes the expected hardware validation programs", () => {
    expect(COLOR_AND_SOUND_PROGRAM).toContain("POKE 53280,2");
    expect(COLOR_AND_SOUND_PROGRAM).toContain('PRINT "TEST COMPLETE"');
    expect(STREAM_VALIDATION_PROGRAM).toContain("GOTO 110");
    expect(EXPECTED_BORDER_COLOR).toBe(2);
    expect(EXPECTED_BG_COLOR).toBe(6);
  });
});
