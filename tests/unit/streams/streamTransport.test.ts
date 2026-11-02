/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, describe, expect, it } from "vitest";
import { STREAM_TRANSPORT_KEY, loadStreamTransport } from "@/lib/streams/streamTransport";

describe("the stream transport the app asks for", () => {
  afterEach(() => localStorage.removeItem(STREAM_TRANSPORT_KEY));

  it("is unicast when nothing has been set", () => {
    expect(loadStreamTransport()).toBe("unicast");
  });

  it("is multicast only when the hardware gate has set exactly that", () => {
    localStorage.setItem(STREAM_TRANSPORT_KEY, "multicast");
    expect(loadStreamTransport()).toBe("multicast");
  });

  it("is unicast for any other stored value", () => {
    localStorage.setItem(STREAM_TRANSPORT_KEY, "udp");
    expect(loadStreamTransport()).toBe("unicast");
    localStorage.setItem(STREAM_TRANSPORT_KEY, "Multicast");
    expect(loadStreamTransport()).toBe("unicast");
  });
});
