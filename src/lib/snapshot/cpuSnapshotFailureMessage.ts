/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { CpuCaptureFailedError } from "./cpu/captureEngine";
import { CpuSnapshotUnsupportedError } from "./snapshotCreation";

const RAM_SNAPSHOT_FALLBACK = "Use a Program or Basic RAM snapshot instead.";

/**
 * What to tell the user when a CPU + RAM snapshot could not be taken, or null for an error this does not describe.
 *
 * Capture rides an interrupt the running program already takes, through the KERNAL vector `$0314` or the RAM
 * vector `$FFFE`. When none arrives the app cannot tell which of the possible reasons applies, so the message
 * names them all rather than asserting one.
 */
export const describeCpuSnapshotFailure = (error: unknown): string | null => {
  if (error instanceof CpuSnapshotUnsupportedError) {
    return `Couldn't capture the CPU state: the C64 did not report its device information (${error.message}). ${RAM_SNAPSHOT_FALLBACK}`;
  }
  if (!(error instanceof CpuCaptureFailedError)) return null;
  if (error.failure === "unstable-registers") {
    return `Couldn't capture the CPU state: the saved registers changed between two reads, so they cannot be trusted. Try again. ${RAM_SNAPSHOT_FALLBACK}`;
  }
  return (
    "Couldn't capture the CPU state: no interrupt reached the capture hook. This happens when the running program " +
    `disables interrupts, uses interrupt vectors of its own, or runs from a cartridge. ${RAM_SNAPSHOT_FALLBACK}`
  );
};
