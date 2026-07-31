/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";

import {
  decodeStilText,
  parseStil,
  primaryCredit,
  stilInfoForSubsong,
  stripSectionTimestamp,
} from "@/lib/hvsc/stilParser";

/**
 * Every fixture below is copied verbatim out of the real `DOCUMENTS/STIL.txt` (v84), including its
 * exact indentation, because the indentation is what the format uses to tell a field from the
 * continuation of the one above it.
 */
const COMMANDO = `/MUSICIANS/H/Hubbard_Rob/Commando.sid
COMMENT: "There is an interesting story behind Commando. I went down to their
         office and started working on it late at night, and worked on it
         through the night." (RH)
(#1)
  TITLE: BGM1 [from the arcade game Commando] (0:00)
 ARTIST: Tamayo Kawamoto
  TITLE: Base [from the arcade game Commando] (0:53)
 ARTIST: Tamayo Kawamoto
(#3)
  TITLE: <?> [from the arcade game Commando]
 ARTIST: Tamayo Kawamoto
`;

describe("parseStil", () => {
  it("reads a file-level comment and its per-tune credits", () => {
    const entry = parseStil(COMMANDO).get("/MUSICIANS/H/Hubbard_Rob/Commando.sid");
    expect(entry?.comment).toContain("There is an interesting story behind Commando");
    // The continuation lines belong to the comment, not to a field of their own.
    expect(entry?.comment).toContain("office and started working on it late at night");
    expect(entry?.subsongs?.[1]?.credits).toEqual([
      { title: "BGM1 [from the arcade game Commando] (0:00)", artist: "Tamayo Kawamoto" },
      { title: "Base [from the arcade game Commando] (0:53)", artist: "Tamayo Kawamoto" },
    ]);
    // Sparse: STIL skips #2 entirely and the numbering must not shift to compensate.
    expect(entry?.subsongs?.[2]).toBeUndefined();
    expect(primaryCredit(entry?.subsongs?.[3])?.artist).toBe("Tamayo Kawamoto");
  });

  it("names the original composer of an arrangement, which the SID header cannot", () => {
    // The whole point of the feature: the header for this file says the author is Rob Hubbard.
    const entry = parseStil(COMMANDO).get("/MUSICIANS/H/Hubbard_Rob/Commando.sid");
    expect(primaryCredit(entry?.subsongs?.[1])?.artist).toBe("Tamayo Kawamoto");
  });

  it("does not treat a colon-terminated word inside comment prose as a new field", () => {
    // Real prose from Nighthunter. A looser rule reads "BTW:" as a field and truncates the comment.
    const text = `/MUSICIANS/T/Tel_Jeroen/Nighthunter.sid
COMMENT: "The laughing is ME and my BROTHER, just before we hit town.
         BTW: that explains the silly 'BURP!' too." (JT)
`;
    const entry = parseStil(text).get("/MUSICIANS/T/Tel_Jeroen/Nighthunter.sid");
    expect(entry?.comment).toContain("BTW: that explains the silly");
    expect(entry?.credits).toBeUndefined();
  });

  it("skips the preamble and the ### folder banners", () => {
    const text = `##############################################################################
#  STIL v84 - SID Tune Information List (December 25, 2025)
##############################################################################

### /DEMOS/ ##################################################################

/DEMOS/0-9/12345.sid
  TITLE: 1.2.3.4.5.6.7.8
 ARTIST: Ken Laszlo
`;
    const map = parseStil(text);
    expect(map.size).toBe(1);
    expect(primaryCredit(map.get("/DEMOS/0-9/12345.sid"))).toEqual({
      title: "1.2.3.4.5.6.7.8",
      artist: "Ken Laszlo",
    });
  });

  it("reads NAME on its own, with no title or artist", () => {
    const text = `/DEMOS/A-F/ASM_Chronicles_Tea_for_the_Seasick.sid
   NAME: ASM Chronicles: Tea for the Seasick
`;
    const entry = parseStil(text).get("/DEMOS/A-F/ASM_Chronicles_Tea_for_the_Seasick.sid");
    // "Chronicles:" sits inside the value and must survive intact.
    expect(entry?.name).toBe("ASM Chronicles: Tea for the Seasick");
  });

  it("drops a heading that carries nothing", () => {
    expect(parseStil("/MUSICIANS/A/Anon/Empty.sid\n\n/MUSICIANS/A/Anon/Real.sid\n  TITLE: x\n").size).toBe(1);
  });

  it("keeps an ARTIST that arrives without a title of its own", () => {
    const entry = parseStil("/DEMOS/X/Cover.sid\n ARTIST: Jean-Michel Jarre\n").get("/DEMOS/X/Cover.sid");
    expect(entry?.credits).toEqual([{ title: "", artist: "Jean-Michel Jarre" }]);
  });

  it("tolerates CRLF line endings", () => {
    const entry = parseStil("/DEMOS/X/A.sid\r\n  TITLE: Hello\r\n ARTIST: Someone\r\n").get("/DEMOS/X/A.sid");
    expect(primaryCredit(entry)).toEqual({ title: "Hello", artist: "Someone" });
  });
});

describe("decodeStilText", () => {
  it("decodes ISO-8859-1, which is what the document actually is", () => {
    // "Ein Fall für Zwei": 0xFC is ü in ISO-8859-1 and an invalid UTF-8 start byte. Decoding as
    // UTF-8 silently yields a replacement character and the composer's name stays broken from
    // there on, through search and display alike.
    const bytes = Uint8Array.from([0x45, 0x69, 0x6e, 0x20, 0x46, 0x61, 0x6c, 0x6c, 0x20, 0x66, 0xfc, 0x72]);
    expect(decodeStilText(bytes)).toBe("Ein Fall für");
    expect(new TextDecoder().decode(bytes)).not.toBe("Ein Fall für");
  });
});

describe("stilInfoForSubsong", () => {
  const entry = parseStil(COMMANDO).get("/MUSICIANS/H/Hubbard_Rob/Commando.sid");

  it("prefers the tune's own credits", () => {
    expect(primaryCredit(stilInfoForSubsong(entry, 1))?.title).toContain("BGM1");
  });

  it("falls back to the file's comment when the tune has none of its own", () => {
    expect(stilInfoForSubsong(entry, 1)?.comment).toContain("interesting story");
  });

  it("falls back to the whole file when the tune has no block at all", () => {
    // STIL has no (#2). Showing nothing there would hide the file's own notes.
    expect(stilInfoForSubsong(entry, 2)?.comment).toContain("interesting story");
  });

  it("returns nothing for a file STIL has never heard of", () => {
    expect(stilInfoForSubsong(undefined, 1)).toBeUndefined();
  });
});

describe("comment reflow", () => {
  it("joins STIL's fixed-width wrapping back into a paragraph", () => {
    // The breaks are an artifact of a 79-column text file. Kept, they wrap again on a phone and
    // break mid-clause: "I went down to their" / "office and started working".
    const text = `/MUSICIANS/H/Hubbard_Rob/Commando.sid
COMMENT: "There is an interesting story behind Commando. I went down to their
         office and started working on it late at night." (RH)
`;
    const entry = parseStil(text).get("/MUSICIANS/H/Hubbard_Rob/Commando.sid");
    expect(entry?.comment).toBe(
      '"There is an interesting story behind Commando. I went down to their office and started working on it late at night." (RH)',
    );
    expect(entry?.comment).not.toContain("\n");
  });

  it("renders as one block, blank lines included", () => {
    // Blank lines are far rarer than the wrapping, so honouring only those produced a note that
    // was flush in most places and split in a few — which reads as a rendering fault.
    const text = `/DEMOS/X/A.sid
COMMENT: First paragraph, which
         wraps.

         Second paragraph.
`;
    const comment = parseStil(text).get("/DEMOS/X/A.sid")?.comment;
    expect(comment).toBe("First paragraph, which wraps. Second paragraph.");
    expect(comment).not.toContain("\n");
  });

  it("leaves no run of whitespace for the layout to trip over", () => {
    const text = `/DEMOS/X/B.sid
COMMENT: Spaced    out    text
             and   more.
`;
    expect(parseStil(text).get("/DEMOS/X/B.sid")?.comment).toBe("Spaced out text and more.");
  });
});

describe("stripSectionTimestamp", () => {
  it("drops the section start time, which says nothing on the one credit that is shown", () => {
    expect(stripSectionTimestamp("BGM1 [from the arcade game Commando] (0:00)")).toBe(
      "BGM1 [from the arcade game Commando]",
    );
    expect(stripSectionTimestamp("Level Complete (1:16-1:32)")).toBe("Level Complete");
  });

  it("leaves a title that merely ends in brackets alone", () => {
    expect(stripSectionTimestamp("Theme (Reprise)")).toBe("Theme (Reprise)");
    expect(stripSectionTimestamp("Ocean Loader 3")).toBe("Ocean Loader 3");
  });
});
