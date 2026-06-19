/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_T9_CONFIG,
  applySemanticAction,
  commitPending,
  createT9State,
  cycleMode,
  moveCursor,
  pressDelete,
  pressDigit,
  pressPunctuation,
  setText,
  toggleCase,
  type T9State,
} from "@/lib/input/t9";

const cfg = DEFAULT_T9_CONFIG;

/** Press a multi-tap key `taps` times (within the window), then commit. */
const typeMultitap = (state: T9State, key: number, taps: number, base = 0): T9State => {
  let s = state;
  for (let i = 0; i < taps; i++) {
    s = pressDigit(s, key, base + i * 10, cfg);
  }
  return commitPending(s);
};

describe("T9 multitap mode", () => {
  it("cycles candidates on repeated same-key presses within the window", () => {
    let s = createT9State();
    s = pressDigit(s, 2, 100, cfg);
    expect(s.text).toBe("a");
    s = pressDigit(s, 2, 200, cfg);
    expect(s.text).toBe("b");
    s = pressDigit(s, 2, 300, cfg);
    expect(s.text).toBe("c");
    s = pressDigit(s, 2, 400, cfg);
    expect(s.text).toBe("2");
    s = pressDigit(s, 2, 500, cfg);
    expect(s.text).toBe("a");
    expect(s.cursor).toBe(1);
  });

  it("commits the pending candidate when the window expires", () => {
    let s = createT9State();
    s = pressDigit(s, 2, 100, cfg);
    // 900ms later (> 800ms window): the first 'a' commits, a new 'a' starts.
    s = pressDigit(s, 2, 1000, cfg);
    expect(s.text).toBe("aa");
    expect(s.cursor).toBe(2);
  });

  it("commits the pending candidate when a different key is pressed", () => {
    let s = createT9State();
    s = pressDigit(s, 2, 100, cfg);
    s = pressDigit(s, 3, 150, cfg);
    expect(s.text).toBe("ad");
  });

  it("toggles case of the pending/last character via star", () => {
    let s = createT9State();
    s = pressDigit(s, 2, 100, cfg);
    s = toggleCase(s);
    expect(s.text).toBe("A");
    expect(s.pending).toBeNull();
    // star is wired to toggleCase in multitap mode.
    s = pressDigit(s, 5, 200, cfg); // 'j'
    s = applySemanticAction(s, "star", 250, cfg);
    expect(s.text).toBe("AJ");
  });

  it("delete removes the pending candidate first, then committed characters", () => {
    let s = createT9State();
    s = pressDigit(s, 2, 100, cfg); // 'a' committed-able
    s = pressDigit(s, 3, 150, cfg); // 'd' pending, 'a' committed -> "ad"
    s = pressDelete(s); // drops pending 'd'
    expect(s.text).toBe("a");
    s = pressDelete(s); // drops committed 'a'
    expect(s.text).toBe("");
    expect(s.cursor).toBe(0);
  });

  it("moveCursor commits the pending candidate before moving", () => {
    let s = createT9State();
    s = pressDigit(s, 2, 100, cfg); // "a" pending, cursor 1
    s = moveCursor(s, "left");
    expect(s.pending).toBeNull();
    expect(s.cursor).toBe(0);
    s = pressDigit(s, 3, 200, cfg); // inserts at cursor 0
    expect(s.text).toBe("da");
  });

  it("setText replaces the buffer and clears pending", () => {
    let s = createT9State();
    s = pressDigit(s, 2, 100, cfg);
    s = setText(s, "hello");
    expect(s.text).toBe("hello");
    expect(s.cursor).toBe(5);
    expect(s.pending).toBeNull();
  });
});

describe("T9 mode cycling", () => {
  it("cycles multitap -> hostname -> multitap", () => {
    let s = createT9State();
    expect(s.mode).toBe("multitap");
    s = cycleMode(s, cfg);
    expect(s.mode).toBe("hostname");
    s = cycleMode(s, cfg);
    expect(s.mode).toBe("multitap");
  });

  it("hash/toggleInputMode cycle the mode via applySemanticAction", () => {
    let s = createT9State();
    s = applySemanticAction(s, "hash", 0, cfg);
    expect(s.mode).toBe("hostname");
    s = applySemanticAction(s, "toggleInputMode", 0, cfg);
    expect(s.mode).toBe("multitap");
  });
});

describe("T9 hostname mode", () => {
  it("inserts digits directly", () => {
    let s = createT9State({ mode: "hostname" });
    s = pressDigit(s, 1, 0, cfg);
    s = pressDigit(s, 9, 0, cfg);
    s = pressDigit(s, 2, 0, cfg);
    expect(s.text).toBe("192");
    expect(s.pending).toBeNull();
  });

  it("enters 192.168.1.13", () => {
    let s = createT9State({ mode: "hostname" });
    const digits = (value: string) => {
      for (const ch of value) {
        s = pressDigit(s, Number(ch), 0, cfg);
      }
    };
    digits("192");
    s = pressPunctuation(s, 100, cfg); // "."
    digits("168");
    s = pressPunctuation(s, 200, cfg); // "."
    digits("1");
    s = pressPunctuation(s, 300, cfg); // "."
    digits("13");
    expect(s.text).toBe("192.168.1.13");
  });

  it("enters 192.168.1.13:8080 (double star -> ':')", () => {
    let s = createT9State({ mode: "hostname" });
    const digits = (value: string, base = 0) => {
      let i = 0;
      for (const ch of value) {
        s = pressDigit(s, Number(ch), base + i++ * 10, cfg);
      }
    };
    digits("192");
    s = pressPunctuation(s, 100, cfg);
    digits("168", 110);
    s = pressPunctuation(s, 200, cfg);
    digits("1", 210);
    s = pressPunctuation(s, 300, cfg);
    digits("13", 310);
    // ":" = star twice within the window.
    s = pressPunctuation(s, 400, cfg); // "."
    s = pressPunctuation(s, 410, cfg); // ":"
    digits("8080", 500);
    expect(s.text).toBe("192.168.1.13:8080");
  });

  it("enters the c64u hostname via multitap", () => {
    let s = createT9State();
    s = typeMultitap(s, 2, 3); // c
    s = typeMultitap(s, 6, 4); // 6
    s = typeMultitap(s, 4, 4); // 4
    s = typeMultitap(s, 8, 2); // u
    expect(s.text).toBe("c64u");
  });

  it("enters c64u.local via multitap", () => {
    let s = createT9State();
    s = typeMultitap(s, 2, 3); // c
    s = typeMultitap(s, 6, 4); // 6
    s = typeMultitap(s, 4, 4); // 4
    s = typeMultitap(s, 8, 2); // u
    s = typeMultitap(s, 1, 1); // .
    s = typeMultitap(s, 5, 3); // l
    s = typeMultitap(s, 6, 3); // o
    s = typeMultitap(s, 2, 3); // c
    s = typeMultitap(s, 2, 1); // a
    s = typeMultitap(s, 5, 3); // l
    expect(s.text).toBe("c64u.local");
  });
});

describe("applySemanticAction bridge", () => {
  it("maps digit actions to presses", () => {
    let s = createT9State();
    s = applySemanticAction(s, "digit5", 100, cfg);
    expect(s.text).toBe("j");
  });

  it("commits on enter/center/activate", () => {
    let s = createT9State();
    s = pressDigit(s, 2, 100, cfg);
    s = applySemanticAction(s, "enter", 150, cfg);
    expect(s.pending).toBeNull();
    expect(s.text).toBe("a");
  });

  it("uses star for punctuation in hostname mode", () => {
    let s = createT9State({ mode: "hostname" });
    s = applySemanticAction(s, "star", 100, cfg);
    expect(s.text).toBe(".");
  });

  it("leaves state unchanged for unmapped actions", () => {
    const s = createT9State({ text: "abc" });
    expect(applySemanticAction(s, "openMenu", 100, cfg)).toBe(s);
  });
});
