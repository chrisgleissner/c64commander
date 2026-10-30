/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from "@/lib/logging";

export type SeekRequestHandler = (positionMs: number) => void;

export interface SeekRequestChannel {
  /** Deliver to the current subscribers. A request nobody receives is dropped and logged, never kept. */
  publish: (positionMs: number) => void;
  subscribe: (handler: SeekRequestHandler) => () => void;
}

/**
 * Lock-screen seeks, deliberately not on `transportCommandBus`. That bus latches a command so a
 * press raised on another page survives the navigation to Play. A seek names an absolute position
 * in one tune, so replaying it after the user has moved on would jump a different tune.
 */
export const createSeekRequestChannel = (): SeekRequestChannel => {
  const handlers = new Set<SeekRequestHandler>();
  return {
    publish: (positionMs) => {
      if (handlers.size === 0) {
        addLog("warn", "Dropped a lock-screen seek request: the Play page is not mounted", {
          source: "lock-screen-seek",
          positionMs,
        });
        return;
      }
      [...handlers].forEach((handler) => {
        try {
          handler(positionMs);
        } catch (error) {
          addLog("error", "A lock-screen seek subscriber failed", {
            source: "lock-screen-seek",
            positionMs,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          });
        }
      });
    },
    subscribe: (handler) => {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
  };
};

export const lockScreenSeekChannel = createSeekRequestChannel();
