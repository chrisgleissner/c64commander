/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 */

import { describe, expect, it } from "vitest";

import { parseVpl } from "@/lib/streams/vpl";

const validVpl = `# NAME: Device palette
# DESC: From the Ultimate
00 00 00
11 11 11
22 22 22
33 33 33
44 44 44
55 55 55
66 66 66
77 77 77
88 88 88
99 99 99
aa aa aa
bb bb bb
cc cc cc
dd dd dd
ee ee ee
ff ff ff`;

describe("VPL parser", () => {
  it("preserves the device palette metadata and VIC index order", () => {
    expect(parseVpl(validVpl, "device:/Usb0/device.vpl")).toEqual({
      id: "device:/Usb0/device.vpl",
      name: "Device palette",
      description: "From the Ultimate",
      rgb: [
        [0, 0, 0],
        [17, 17, 17],
        [34, 34, 34],
        [51, 51, 51],
        [68, 68, 68],
        [85, 85, 85],
        [102, 102, 102],
        [119, 119, 119],
        [136, 136, 136],
        [153, 153, 153],
        [170, 170, 170],
        [187, 187, 187],
        [204, 204, 204],
        [221, 221, 221],
        [238, 238, 238],
        [255, 255, 255],
      ],
    });
  });

  it("rejects a partial palette instead of shifting colour indices", () => {
    expect(() => parseVpl(validVpl.split("\n").slice(0, -1).join("\n"), "partial.vpl")).toThrow(
      "partial.vpl: expected 16 colours, found 15",
    );
  });

  it.each(["ffjunk", "1.5", "0g"])("rejects a malformed hexadecimal component (%s)", (component) => {
    expect(() => parseVpl(validVpl.replace("00 00 00", `${component} 00 00`), "malformed.vpl")).toThrow(
      "malformed.vpl: cannot read",
    );
  });
});
