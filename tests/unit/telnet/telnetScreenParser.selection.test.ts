/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/*
 * The escape sequences below are what a C64 Ultimate on firmware 1.2RC actually sends over Telnet,
 * copied from a capture. Its tree browser marks the row under the cursor by repainting it bold
 * white (`0;37;1`) and repainting the row it left dim red (`0;31;2`); there is no reverse video
 * anywhere on the screen. The parser looked only for reverse video, so `selectedItem` was null for
 * every file-browser screen and every walk through the browser ran to its step limit without
 * matching a name.
 */

import { describe, expect, it } from "vitest";
import { parseTelnetScreen } from "@/lib/telnet/telnetScreenParser";

const encode = (text: string) => new TextEncoder().encode(text);

/** A full repaint: a bold title, a bold box frame, and four drive rows with the first selected. */
const FULL_PAINT =
  "\x1b[1;6H\x1b[0;37;1m*** C64 Ultimate (V1.4F) 1.2RC *** Remote ***" +
  "\x1b[3;1H\x1b[0;37;2m\x1b(0x\x1b(B" +
  "\x1b[4;1H\x1b[0;37;2m\x1b(0x\x1b(B\x1b[4;2H\x1b[0;37;1m\x1b[27mSD      SD Card                                  \x1b[0;32;1mNo media " +
  "\x1b[5;1H\x1b[0;37;2m\x1b(0x\x1b(B\x1b[5;2H\x1b[0;31;2m\x1b[27mFlash   Internal Memory                          \x1b[0;32;1mReady    " +
  "\x1b[6;1H\x1b[0;37;2m\x1b(0x\x1b(B\x1b[6;2H\x1b[0;31;2m\x1b[27mTemp    RAM Disk                                 \x1b[0;32;1mReady    ";

/** What a single DOWN produces: the row left behind, then the row moved onto. */
const DOWN_DELTA =
  "\x1b[4;2H\x1b[0;31;2m\x1b[27mSD      SD Card                                  \x1b[0;32;1mNo media " +
  "\x1b[5;2H\x1b[0;37;1m\x1b[27mFlash   Internal Memory                          \x1b[0;32;1mReady    ";

/** A file row: name, type and size columns. The caller asks for the name. */
const FILE_ROW =
  "\x1b[4;2H\x1b[0;31;2m\x1b[27mcache                                            \x1b[0;32;1mDIR      " +
  "\x1b[5;2H\x1b[0;37;1m\x1b[27mhilprobe.cfg                                     \x1b[0;32;1mCFG   59 ";

describe("finding the entry under the cursor", () => {
  it("reads the bold row of a full repaint", () => {
    expect(parseTelnetScreen(encode(FULL_PAINT)).selectedItem).toBe("SD");
  });

  it("reads the row a keypress moved onto", () => {
    expect(parseTelnetScreen(encode(DOWN_DELTA)).selectedItem).toBe("Flash");
  });

  /* The row is name, description and status padded apart; a caller asks for "hilprobe.cfg". */
  it("returns the name column rather than the whole row", () => {
    expect(parseTelnetScreen(encode(FILE_ROW)).selectedItem).toBe("hilprobe.cfg");
  });

  /* The title line is bold as well, and it is not an entry. */
  it("does not mistake the bold title line for the entry under the cursor", () => {
    const titleOnly = "\x1b[1;6H\x1b[0;37;1m*** C64 Ultimate (V1.4F) 1.2RC *** Remote ***";
    expect(parseTelnetScreen(encode(titleOnly)).selectedItem).toBeNull();
  });

  /* So is the box frame, which is made only of the alternate charset's line glyphs. */
  it("does not mistake a bold box border for an entry", () => {
    const borderOnly = "\x1b[3;1H\x1b[0;37;1m\x1b(0lqqqqqqqqqqk\x1b(B";
    expect(parseTelnetScreen(encode(borderOnly)).selectedItem).toBeNull();
  });

  /* Reverse video still wins where a firmware uses it. */
  it("still reads a reverse-video row", () => {
    const reversed = "\x1b[4;2H\x1b[7mUSB2    Verbatim STORE N GO                       Ready    ";
    expect(parseTelnetScreen(encode(reversed)).selectedItem).toBe("USB2");
  });

  /*
   * A menu is drawn inside a box made of the alternate charset's line glyphs, which arrive as the
   * ASCII letters l k m j q x. Stripping them off a label's ends without regard to case ate the
   * first letter of every item that began with one of them: "Load Settings" came back as
   * "oad Settings" and "Move to..." as "ove to...", so neither the config workflow nor the REU
   * workflow could find its own action in the menu it had just opened.
   */
  it("keeps the first letter of a menu item that starts with a line-drawing letter", () => {
    const contextMenu =
      "\x1b[6;20H\x1b[0;37;2m\x1b(0lqqqqqqqqqqqqqk\x1b(B" +
      "\x1b[7;20H\x1b(0x\x1b(B\x1b[0;37;1mLoad Settings\x1b[0;37;2m\x1b(0x\x1b(B" +
      "\x1b[8;20H\x1b(0x\x1b(B\x1b[0;31;2mMove to...   \x1b[0;37;2m\x1b(0x\x1b(B" +
      "\x1b[9;20H\x1b(0x\x1b(B\x1b[0;31;2mDelete       \x1b[0;37;2m\x1b(0x\x1b(B" +
      "\x1b[10;20H\x1b(0mqqqqqqqqqqqqqj\x1b(B";
    const labels = parseTelnetScreen(encode(contextMenu)).menus.flatMap((menu) => menu.items.map((item) => item.label));
    expect(labels).toContain("Load Settings");
    expect(labels).toContain("Move to...");
  });
});
