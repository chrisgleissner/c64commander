/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Tell a stream that stopped from a stream that is being thrown away.
 *
 * The native receiver accepts packets only from the machine the app selected, which is what keeps
 * the picture right when a second Ultimate streams into the same multicast group. The filter is
 * keyed to the REST host, and the Ultimate streams from whichever interface its firmware routes
 * through — so on a machine with both Wi-Fi and Ethernet connected, the app can be talking to one
 * address and receiving from the other. Every packet is then dropped before it is counted as an
 * arrival: the socket is busy, the mirror sees silence, and eight seconds later the card reports
 * that the stream stopped arriving. That message sends the user to check the C64 and the cable,
 * which is the one place the fault is not.
 *
 * The plugin already knows both addresses. Naming them turns the dead end into a diagnosis with a
 * recovery, which is why this exists rather than a wider timeout or a filter that fails open.
 */

/** The sender-filter counters the native plugin reports for one stream. */
export interface SenderFilterDiagnostics {
  rejectedPackets: number;
  lastRejectedSource?: string;
  expectedSource?: string;
}

/** A stream arriving from an address the filter is not accepting. */
export interface SenderMismatch {
  /** The address the packets are actually coming from. */
  readonly source: string;
  /** The address the filter is accepting, as the user's saved host reads. */
  readonly expected: string | null;
  readonly rejectedPackets: number;
}

/**
 * A mismatch, or null when the silence has some other cause.
 *
 * Only called once a live stream has gone silent, so a non-zero rejection count at that moment
 * means the filter accounts for the silence: nothing was accepted, and something was refused.
 */
export const detectSenderMismatch = (
  diagnostics: SenderFilterDiagnostics | null | undefined,
  expectedHost: string | null,
): SenderMismatch | null => {
  if (!diagnostics) return null;
  const source = diagnostics.lastRejectedSource?.trim();
  if (!source || diagnostics.rejectedPackets <= 0) return null;
  const expected = expectedHost?.trim() || diagnostics.expectedSource?.trim() || null;
  // A filter already pointed at the sender cannot be the reason the sender is not being heard.
  if (expected !== null && source === expected) return null;
  return { source, expected, rejectedPackets: diagnostics.rejectedPackets };
};

/** The sentence the Live View card shows instead of "the stream stopped arriving". */
export const describeSenderMismatch = (mismatch: SenderMismatch, stream: "audio" | "video"): string => {
  const what = stream === "audio" ? "Audio" : "Video";
  const from = mismatch.expected === null ? "" : ` — the app is only accepting packets from ${mismatch.expected}`;
  return `${what} packets are arriving from ${mismatch.source} and being dropped${from}.`;
};

/** The label of the one-tap recovery: accept the machine that is actually sending. */
export const describeSenderAdoption = (mismatch: SenderMismatch): string => `Use ${mismatch.source}`;
