/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export const remoteSeekErrorDetails = (error: unknown) => ({
  error: error instanceof Error ? error.message : String(error),
  stack: error instanceof Error ? error.stack : undefined,
});

/** A newer action (stop, pause, another tune, another device) took over before this seek finished. */
export class RemoteSeekCancelled extends Error {
  constructor(reason: string) {
    super(`Remote seek cancelled: ${reason}`);
    this.name = "RemoteSeekCancelled";
  }
}

/**
 * Thrown by a session that has started giving the device back, or whose device is no longer the one
 * the API talks to; the operation using it is over.
 */
export class RemoteSeekSessionClosedError extends Error {
  constructor(message = "This remote seek has already given the device back") {
    super(message);
    this.name = "RemoteSeekSessionClosedError";
  }
}

/** True for the ways a seek ends because something else took over, which are not failures. */
export const isRemoteSeekSuperseded = (error: unknown): error is Error =>
  error instanceof RemoteSeekCancelled || error instanceof RemoteSeekSessionClosedError;
