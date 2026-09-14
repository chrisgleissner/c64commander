/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import net from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockC64Server, type MockC64Server } from "../mocks/mockC64Server";

// On a bench where "c64u" names a real C64 Ultimate, the Remote Input tests sent it
// PUT /v1/streams/video:start and left its video stream running.
describe("the unit test setup", () => {
  let server: MockC64Server | null = null;

  afterEach(async () => {
    vi.restoreAllMocks();
    await server?.close();
    server = null;
  });

  it("fails a request for the app's default device host without opening a connection", async () => {
    const connect = vi.spyOn(net.Socket.prototype, "connect");

    // A read, so that this test cannot change a real device even with the guard removed.
    await expect(fetch("http://c64u/v1/version")).rejects.toThrow("fetch failed");

    expect(connect).not.toHaveBeenCalled();
  });

  it("still lets a test reach the fake Ultimate on this machine", async () => {
    server = await createMockC64Server();

    const response = await fetch(`${server.baseUrl}/v1/version`);

    expect(response.ok).toBe(true);
  });
});
