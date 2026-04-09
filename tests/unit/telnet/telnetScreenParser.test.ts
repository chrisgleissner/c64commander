/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { parseTelnetScreen, detectMenus } from "@/lib/telnet/telnetScreenParser";
import { TELNET_SCREEN_WIDTH, TELNET_SCREEN_HEIGHT } from "@/lib/telnet/telnetTypes";

/** Helper: encode string to Uint8Array */
const encode = (s: string): Uint8Array => new TextEncoder().encode(s);

describe("parseTelnetScreen", () => {
  it("returns an empty 60x24 grid for empty input", () => {
    const screen = parseTelnetScreen(new Uint8Array(0));
    expect(screen.width).toBe(TELNET_SCREEN_WIDTH);
    expect(screen.height).toBe(TELNET_SCREEN_HEIGHT);
    expect(screen.cells.length).toBe(TELNET_SCREEN_HEIGHT);
    expect(screen.cells[0].length).toBe(TELNET_SCREEN_WIDTH);
    expect(screen.cells[0][0].char).toBe(" ");
    expect(screen.menus).toEqual([]);
    expect(screen.form).toBeNull();
    expect(screen.selectedItem).toBeNull();
  });

  it("places characters at cursor position", () => {
    const data = encode("Hello");
    const screen = parseTelnetScreen(data);
    expect(screen.cells[0][0].char).toBe("H");
    expect(screen.cells[0][1].char).toBe("e");
    expect(screen.cells[0][4].char).toBe("o");
    expect(screen.cells[0][5].char).toBe(" ");
  });

  it("handles cursor positioning via CSI H", () => {
    // Move to row 3, col 5 (1-based) then write "X"
    const data = encode("\x1b[3;5HX");
    const screen = parseTelnetScreen(data);
    expect(screen.cells[2][4].char).toBe("X");
  });

  it("handles RIS (reset) clearing the screen", () => {
    const data = encode("ABC\x1bcDEF");
    const screen = parseTelnetScreen(data);
    // After RIS, screen is reset, cursor at 0,0
    expect(screen.cells[0][0].char).toBe("D");
    expect(screen.cells[0][1].char).toBe("E");
    expect(screen.cells[0][2].char).toBe("F");
  });

  it("handles reverse video SGR", () => {
    const data = encode("\x1b[7mHI\x1b[27mLO");
    const screen = parseTelnetScreen(data);
    expect(screen.cells[0][0].reverse).toBe(true);
    expect(screen.cells[0][1].reverse).toBe(true);
    expect(screen.cells[0][2].reverse).toBe(false);
    expect(screen.cells[0][3].reverse).toBe(false);
  });

  it("handles SGR color codes", () => {
    const data = encode("\x1b[31mR\x1b[32mG");
    const screen = parseTelnetScreen(data);
    expect(screen.cells[0][0].color).toBe(1); // red
    expect(screen.cells[0][1].color).toBe(2); // green
  });

  it("handles SGR reset", () => {
    const data = encode("\x1b[7m\x1b[31mA\x1b[0mB");
    const screen = parseTelnetScreen(data);
    expect(screen.cells[0][0].reverse).toBe(true);
    expect(screen.cells[0][0].color).toBe(1);
    expect(screen.cells[0][1].reverse).toBe(false);
    expect(screen.cells[0][1].color).toBe(7);
  });

  it("handles newline and carriage return", () => {
    const data = encode("AB\r\nCD");
    const screen = parseTelnetScreen(data);
    expect(screen.cells[0][0].char).toBe("A");
    expect(screen.cells[0][1].char).toBe("B");
    expect(screen.cells[1][0].char).toBe("C");
    expect(screen.cells[1][1].char).toBe("D");
  });

  it("handles backspace", () => {
    const data = encode("AB\bX");
    const screen = parseTelnetScreen(data);
    expect(screen.cells[0][0].char).toBe("A");
    expect(screen.cells[0][1].char).toBe("X");
  });

  it("handles cursor movement CSI A/B/C/D", () => {
    // Position at 5,5 then move up 2, right 3
    const data = encode("\x1b[5;5H\x1b[2A\x1b[3CZ");
    const screen = parseTelnetScreen(data);
    expect(screen.cells[2][7].char).toBe("Z");
  });

  it("handles erase display mode 2 (full clear)", () => {
    const data = encode("FILLED\x1b[2JCLEAN");
    const screen = parseTelnetScreen(data);
    // After full clear, cursor stays where it was (row 0 after FILLED), but screen is cleared
    // Then CLEAN is written starting at current cursor position
    expect(screen.cells[0][6].char).toBe("C");
    expect(screen.cells[0][7].char).toBe("L");
  });

  it("handles erase in line mode 0 (to end)", () => {
    const data = encode("ABCDEFGH\x1b[1;4H\x1b[K");
    const screen = parseTelnetScreen(data);
    expect(screen.cells[0][0].char).toBe("A");
    expect(screen.cells[0][1].char).toBe("B");
    expect(screen.cells[0][2].char).toBe("C");
    // From col 3 to end should be cleared
    expect(screen.cells[0][3].char).toBe(" ");
    expect(screen.cells[0][4].char).toBe(" ");
  });

  it("skips Telnet IAC WILL/WONT/DO/DONT sequences", () => {
    // IAC WILL ECHO + IAC DONT LINEMODE + regular text
    const bytes = new Uint8Array([0xff, 0xfb, 0x01, 0xff, 0xfe, 0x22, 0x48, 0x49]);
    const screen = parseTelnetScreen(bytes);
    expect(screen.cells[0][0].char).toBe("H");
    expect(screen.cells[0][1].char).toBe("I");
  });

  it("classifies screen with status bar as file_browser", () => {
    // Put text on last row for status bar
    const data = encode(`\x1b[${TELNET_SCREEN_HEIGHT};1H SD Card: Ready`);
    const screen = parseTelnetScreen(data);
    expect(screen.screenType).toBe("file_browser");
  });

  it("extracts title line from first row", () => {
    const data = encode("Ultimate-II+ V3.11");
    const screen = parseTelnetScreen(data);
    expect(screen.titleLine).toContain("Ultimate-II+ V3.11");
  });

  it("wraps cursor at column boundary", () => {
    // Fill the entire first row
    const longText = "A".repeat(TELNET_SCREEN_WIDTH) + "B";
    const data = encode(longText);
    const screen = parseTelnetScreen(data);
    expect(screen.cells[0][TELNET_SCREEN_WIDTH - 1].char).toBe("A");
    expect(screen.cells[1][0].char).toBe("B");
  });

  it("clamps cursor to screen boundaries on extreme positioning", () => {
    // Move to row 999, col 999
    const data = encode("\x1b[999;999HX");
    const screen = parseTelnetScreen(data);
    expect(screen.cells[TELNET_SCREEN_HEIGHT - 1][TELNET_SCREEN_WIDTH - 1].char).toBe("X");
  });
});

describe("detectMenus", () => {
  it("detects a bordered menu overlay", () => {
    // Build a simple menu with line-drawing characters
    const cells: Array<Array<{ char: string; reverse: boolean; color: number }>> = [];
    for (let r = 0; r < TELNET_SCREEN_HEIGHT; r++) {
      cells.push([]);
      for (let c = 0; c < TELNET_SCREEN_WIDTH; c++) {
        cells[r].push({ char: " ", reverse: false, color: 7 });
      }
    }

    // Draw a 10x5 menu box at row 2, col 3
    const boxTop = 2;
    const boxLeft = 3;
    const boxWidth = 10;
    const boxHeight = 5;

    // Top border
    cells[boxTop][boxLeft].char = "l";
    for (let c = boxLeft + 1; c < boxLeft + boxWidth - 1; c++) {
      cells[boxTop][c].char = "q";
    }
    cells[boxTop][boxLeft + boxWidth - 1].char = "k";

    // Left and right borders + content
    for (let r = boxTop + 1; r < boxTop + boxHeight - 1; r++) {
      cells[r][boxLeft].char = "x";
      cells[r][boxLeft + boxWidth - 1].char = "x";
    }

    // Bottom border
    cells[boxTop + boxHeight - 1][boxLeft].char = "m";
    for (let c = boxLeft + 1; c < boxLeft + boxWidth - 1; c++) {
      cells[boxTop + boxHeight - 1][c].char = "q";
    }
    cells[boxTop + boxHeight - 1][boxLeft + boxWidth - 1].char = "j";

    // Fill items
    const items = ["Power", "Config", "Debug"];
    for (let i = 0; i < items.length; i++) {
      const row = boxTop + 1 + i;
      for (let j = 0; j < items[i].length; j++) {
        cells[row][boxLeft + 1 + j].char = items[i][j];
      }
    }

    // Select second item
    for (let c = boxLeft + 1; c < boxLeft + boxWidth - 1; c++) {
      cells[boxTop + 2][c].reverse = true;
    }

    const menus = detectMenus(cells);
    expect(menus.length).toBe(1);
    expect(menus[0].items.length).toBe(3);
    expect(menus[0].items[0].label).toBe("Power");
    expect(menus[0].items[1].label).toBe("Config");
    expect(menus[0].items[1].selected).toBe(true);
    expect(menus[0].items[2].label).toBe("Debug");
    expect(menus[0].selectedIndex).toBe(1);
    expect(menus[0].bounds).toEqual({
      x: boxLeft,
      y: boxTop,
      width: boxWidth,
      height: boxHeight,
    });
  });

  it("returns empty array when no menu borders detected", () => {
    const cells: Array<Array<{ char: string; reverse: boolean; color: number }>> = [];
    for (let r = 0; r < TELNET_SCREEN_HEIGHT; r++) {
      cells.push([]);
      for (let c = 0; c < TELNET_SCREEN_WIDTH; c++) {
        cells[r].push({ char: " ", reverse: false, color: 7 });
      }
    }
    const menus = detectMenus(cells);
    expect(menus).toEqual([]);
  });

  it("strips edge wrappers from noisy real-device menu labels", () => {
    const cells: Array<Array<{ char: string; reverse: boolean; color: number }>> = [];
    for (let r = 0; r < TELNET_SCREEN_HEIGHT; r++) {
      cells.push([]);
      for (let c = 0; c < TELNET_SCREEN_WIDTH; c++) {
        cells[r].push({ char: " ", reverse: false, color: 7 });
      }
    }

    const boxTop = 2;
    const boxLeft = 3;
    const boxWidth = 18;
    const boxHeight = 4;

    cells[boxTop][boxLeft].char = "l";
    for (let c = boxLeft + 1; c < boxLeft + boxWidth - 1; c++) {
      cells[boxTop][c].char = "q";
    }
    cells[boxTop][boxLeft + boxWidth - 1].char = "k";
    for (let r = boxTop + 1; r < boxTop + boxHeight - 1; r++) {
      cells[r][boxLeft].char = "x";
      cells[r][boxLeft + boxWidth - 1].char = "x";
    }
    cells[boxTop + boxHeight - 1][boxLeft].char = "m";
    for (let c = boxLeft + 1; c < boxLeft + boxWidth - 1; c++) {
      cells[boxTop + boxHeight - 1][c].char = "q";
    }
    cells[boxTop + boxHeight - 1][boxLeft + boxWidth - 1].char = "j";

    const noisyLabel = "xPower & Reset x";
    for (let j = 0; j < noisyLabel.length; j++) {
      cells[boxTop + 1][boxLeft + 1 + j].char = noisyLabel[j];
    }

    const menus = detectMenus(cells);
    expect(menus[0].items[0].label).toBe("Power & Reset");
  });

  it("rejects incomplete box (no bottom-right corner)", () => {
    const cells: Array<Array<{ char: string; reverse: boolean; color: number }>> = [];
    for (let r = 0; r < TELNET_SCREEN_HEIGHT; r++) {
      cells.push([]);
      for (let c = 0; c < TELNET_SCREEN_WIDTH; c++) {
        cells[r].push({ char: " ", reverse: false, color: 7 });
      }
    }
    // Top border OK
    cells[2][3].char = "l";
    cells[2][4].char = "q";
    cells[2][5].char = "q";
    cells[2][6].char = "q";
    cells[2][7].char = "k";
    // Left side OK
    cells[3][3].char = "x";
    cells[3][7].char = "x";
    // Bottom-left present but bottom-right missing
    cells[4][3].char = "m";
    cells[4][7].char = " ";
    const menus = detectMenus(cells);
    expect(menus).toEqual([]);
  });

  it("rejects box that is too small", () => {
    const cells: Array<Array<{ char: string; reverse: boolean; color: number }>> = [];
    for (let r = 0; r < TELNET_SCREEN_HEIGHT; r++) {
      cells.push([]);
      for (let c = 0; c < TELNET_SCREEN_WIDTH; c++) {
        cells[r].push({ char: " ", reverse: false, color: 7 });
      }
    }
    // 3-wide box (too narrow: width < 4)
    cells[0][0].char = "l";
    cells[0][1].char = "q";
    cells[0][2].char = "k";
    cells[1][0].char = "x";
    cells[1][2].char = "x";
    cells[2][0].char = "m";
    cells[2][1].char = "q";
    cells[2][2].char = "j";
    const menus = detectMenus(cells);
    expect(menus).toEqual([]);
  });
});

describe("parseTelnetScreen additional coverage", () => {
  it("handles erase display mode 0 (cursor to end)", () => {
    // Fill first two rows, then erase from mid-first-row to end
    const data = encode("AABBCC\x1b[2;1HDDDDDD\x1b[1;3H\x1b[0J");
    const screen = parseTelnetScreen(data);
    expect(screen.cells[0][0].char).toBe("A");
    expect(screen.cells[0][1].char).toBe("A");
    // From col 2 onward on row 0 should be erased
    expect(screen.cells[0][2].char).toBe(" ");
    // Row 1 should be fully erased
    expect(screen.cells[1][0].char).toBe(" ");
  });

  it("handles erase display mode 1 (start to cursor)", () => {
    const data = encode("AABBCC\x1b[2;1HDDDDDD\x1b[2;3H\x1b[1J");
    const screen = parseTelnetScreen(data);
    // Row 0 should be fully erased (before cursor row)
    expect(screen.cells[0][0].char).toBe(" ");
    // Row 1 cols 0-2 should be erased (up to cursor col)
    expect(screen.cells[1][0].char).toBe(" ");
    expect(screen.cells[1][1].char).toBe(" ");
    expect(screen.cells[1][2].char).toBe(" ");
  });

  it("handles erase in line mode 1 (start to cursor)", () => {
    const data = encode("ABCDEF\x1b[1;4H\x1b[1K");
    const screen = parseTelnetScreen(data);
    // Cols 0-3 should be erased
    expect(screen.cells[0][0].char).toBe(" ");
    expect(screen.cells[0][1].char).toBe(" ");
    expect(screen.cells[0][2].char).toBe(" ");
    expect(screen.cells[0][3].char).toBe(" ");
    // Col 4+ should be preserved
    expect(screen.cells[0][4].char).toBe("E");
  });

  it("handles erase in line mode 2 (entire line)", () => {
    const data = encode("ABCDEF\x1b[1;3H\x1b[2K");
    const screen = parseTelnetScreen(data);
    // Entire first row should be erased
    expect(screen.cells[0][0].char).toBe(" ");
    expect(screen.cells[0][5].char).toBe(" ");
  });

  it("handles background color SGR codes", () => {
    const data = encode("\x1b[41mR\x1b[42mG");
    const screen = parseTelnetScreen(data);
    expect(screen.cells[0][0].color).toBe(1); // bg red
    expect(screen.cells[0][1].color).toBe(2); // bg green
  });

  it("handles alternate charset mode", () => {
    // Switch to alt charset, write line-draw chars, then back
    const data = encode("\x1b(0lqqk\x1b(Bnormal");
    const screen = parseTelnetScreen(data);
    // Line-draw chars should be placed
    expect(screen.cells[0][0].char).toBe("l");
    expect(screen.cells[0][1].char).toBe("q");
  });

  it("handles CSI cursor positioning with f command", () => {
    const data = encode("\x1b[5;10fX");
    const screen = parseTelnetScreen(data);
    expect(screen.cells[4][9].char).toBe("X");
  });

  it("handles CSI h and l (set/reset mode) without error", () => {
    const data = encode("\x1b[?25h\x1b[?25lHello");
    const screen = parseTelnetScreen(data);
    expect(screen.cells[0][0].char).toBe("H");
  });

  it("returns unknown screen type when no indicators present", () => {
    const screen = parseTelnetScreen(new Uint8Array(0));
    expect(screen.screenType).toBe("unknown");
  });

  it("handles cursor backward CSI D", () => {
    const data = encode("ABCD\x1b[2DXX");
    const screen = parseTelnetScreen(data);
    expect(screen.cells[0][0].char).toBe("A");
    expect(screen.cells[0][1].char).toBe("B");
    expect(screen.cells[0][2].char).toBe("X");
    expect(screen.cells[0][3].char).toBe("X");
  });

  it("handles cursor down CSI B", () => {
    const data = encode("A\x1b[3BX");
    const screen = parseTelnetScreen(data);
    expect(screen.cells[3][1].char).toBe("X");
  });

  it("handles escape at end of input without panic (line 114)", () => {
    // ESC byte at end triggers the len-guard (state.pos >= len) in parseEscape
    const screen = parseTelnetScreen(encode("\x1b"));
    expect(screen.cells[0][0].char).toBe(" ");
  });

  it("ignores unknown escape sequences other than [ ( c (line 133)", () => {
    // \x1bX is not [ ( c — hits the else branch and advances pos without crashing
    const screen = parseTelnetScreen(encode("\x1bXHi"));
    expect(screen.cells[0][0].char).toBe("H");
    expect(screen.cells[0][1].char).toBe("i");
  });

  it("treats empty CSI param before semicolon as zero (line 169)", () => {
    // \x1b[;5H — first param is empty, should become 0 → row 0-1=-1 → clamped to 0
    const screen = parseTelnetScreen(encode("\x1b[;5HX"));
    expect(screen.cells[0][4].char).toBe("X");
  });

  it("cursors to home when CSI H has no params (lines 191/192)", () => {
    // \x1b[H with no params uses the || 1 fallback → row=0, col=0
    const screen = parseTelnetScreen(encode("ABC\x1b[HX"));
    expect(screen.cells[0][0].char).toBe("X");
  });

  it("cursor A/B/C/D with no params default to 1 (lines 199/205/211/217)", () => {
    // Start at 5,5, then move up/down/forward/backward each by default (1)
    const screen = parseTelnetScreen(encode("\x1b[5;5H\x1b[AX"));
    expect(screen.cells[3][4].char).toBe("X");

    const screen2 = parseTelnetScreen(encode("\x1b[5;5H\x1b[BX"));
    expect(screen2.cells[5][4].char).toBe("X");

    const screen3 = parseTelnetScreen(encode("\x1b[5;5H\x1b[CX"));
    expect(screen3.cells[4][5].char).toBe("X");

    const screen4 = parseTelnetScreen(encode("\x1b[5;5H\x1b[DX"));
    expect(screen4.cells[4][3].char).toBe("X");
  });

  it("SGR with no params inserts a zero param (line 223)", () => {
    // \x1b[m — empty SGR → params.length===0 → pushes 0 → reset command
    const screen = parseTelnetScreen(encode("\x1b[7m\x1b[mX"));
    expect(screen.cells[0][0].reverse).toBe(false);
  });

  it("handles function key tilde sequence without error (line 241)", () => {
    // \x1b[5~ is a VT function key (e.g. page up) — parser ignores it
    const screen = parseTelnetScreen(encode("\x1b[5~Hi"));
    expect(screen.cells[0][0].char).toBe("H");
    expect(screen.cells[0][1].char).toBe("i");
  });

  it("ignores unknown CSI command (line 250)", () => {
    // CSI G is not a handled command — hits default switch case
    const screen = parseTelnetScreen(encode("\x1b[5GHi"));
    expect(screen.cells[0][0].char).toBe("H");
  });

  it("handles IAC at end of byte stream (line 362)", () => {
    // A lone 0xFF at end means skipTelnetCommand hits the pos>=len guard
    const bytes = new Uint8Array([0x48, 0x69, 0xff]); // "Hi" + IAC
    const screen = parseTelnetScreen(bytes);
    expect(screen.cells[0][0].char).toBe("H");
    expect(screen.cells[0][1].char).toBe("i");
  });

  it("classifies menu with File Search title as search_form (line 518)", () => {
    // Build a bordered menu box; the row after the top border must contain "File Search"
    // Use short lines (< TELNET_SCREEN_WIDTH) to avoid auto-wrap distorting placement
    const raw = "lqqqqqqqqqqqqk\r\n" + "x File Search x\r\n" + "mqqqqqqqqqqqqj";
    const screen = parseTelnetScreen(encode(raw));
    expect(screen.screenType).toBe("search_form");
  });
});
