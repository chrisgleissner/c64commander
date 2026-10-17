/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * What a seek through the render worker costs, and how long its reply may take.
 *
 * The worker replays the tune from its start, so the work grows with the target. While a seek is
 * outstanding the engine discards every rendered chunk, so a reply that never comes would silence
 * the tune; the acknowledgement timeout is the bound that reopens that gate.
 */

/** Minimum wait for a seek reply; a seek into the opening of a tune lands well inside it. */
const SEEK_ACK_TIMEOUT_MS = 20_000;

/** Upper bound on the wait for a seek reply, however deep the target. */
const SEEK_ACK_TIMEOUT_MAX_MS = 15 * 60_000;

/** A worker seek's cost per second of tune replayed, until measured: 115 s took 42 s on a busy Pixel 4. */
export const SEEK_COST_FLOOR_MS_PER_SECOND = 400;

/**
 * How long a worker seek to `targetSeconds` may take before its reply is given up on.
 *
 * 20 s is generous for a seek into the opening and far too short for 19:23 of a 20-minute tune,
 * where giving up reopened the gate on a renderer that had not arrived and the tune was then ended
 * with nothing played.
 */
export const seekAckTimeoutMs = (targetSeconds: number, renderMsPerSecondP99: number): number => {
  const costMsPerSecond = Math.max(renderMsPerSecondP99, SEEK_COST_FLOOR_MS_PER_SECOND);
  return Math.min(SEEK_ACK_TIMEOUT_MAX_MS, Math.max(SEEK_ACK_TIMEOUT_MS, targetSeconds * costMsPerSecond * 1.5));
};
