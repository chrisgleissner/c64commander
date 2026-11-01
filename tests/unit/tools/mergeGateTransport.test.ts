/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { streamTransportScript } from "../../../tools/hil/merge_gate.mjs";

describe("switching the page's stream transport for the stages that measure the wire", () => {
  it("writes the key the app reads, with the transport asked for", () => {
    expect(streamTransportScript("multicast")).toContain('localStorage.setItem("c64u_stream_transport","multicast")');
    expect(streamTransportScript("unicast")).toContain('localStorage.setItem("c64u_stream_transport","unicast")');
  });

  it("refuses a transport the app would not understand, rather than writing it into the page", () => {
    expect(() => streamTransportScript("broadcast")).toThrow(/unknown stream transport "broadcast"/);
    expect(() => streamTransportScript('multicast");alert(1);("')).toThrow(/unknown stream transport/);
  });
});
