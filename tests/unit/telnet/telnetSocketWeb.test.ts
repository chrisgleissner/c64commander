/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { TelnetSocketWeb } from "@/lib/native/telnetSocket.web";
import { TelnetError } from "@/lib/telnet/telnetTypes";

describe("TelnetSocketWeb", () => {
  it("throws TelnetError on connect", async () => {
    const web = new TelnetSocketWeb();
    await expect(web.connect({ host: "localhost", port: 23 })).rejects.toThrow(TelnetError);
  });

  it("disconnect is a no-op", async () => {
    const web = new TelnetSocketWeb();
    // Should not throw
    await web.disconnect();
  });

  it("throws TelnetError on send", async () => {
    const web = new TelnetSocketWeb();
    await expect(web.send({ data: "AAAA" })).rejects.toThrow(TelnetError);
  });

  it("throws TelnetError on read", async () => {
    const web = new TelnetSocketWeb();
    await expect(web.read({ timeoutMs: 500 })).rejects.toThrow(TelnetError);
  });

  it("reports not connected", async () => {
    const web = new TelnetSocketWeb();
    const result = await web.isConnected();
    expect(result.connected).toBe(false);
  });
});
