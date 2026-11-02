/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export const STREAM_TRANSPORT_KEY = "c64u_stream_transport";

export type StreamTransport = "unicast" | "multicast";

/**
 * How Live View asks the Ultimate to send its streams: straight to this phone (unicast), which is
 * what the app always does, or to the multicast groups.
 *
 * There is no control for it. The hardware gate sets it through the page, because the PC that
 * measures the wire can only see the stream in the multicast groups, and it puts it back afterwards.
 * Anything other than "multicast" means unicast.
 */
export const loadStreamTransport = (): StreamTransport =>
  typeof localStorage !== "undefined" && localStorage.getItem(STREAM_TRANSPORT_KEY) === "multicast"
    ? "multicast"
    : "unicast";
