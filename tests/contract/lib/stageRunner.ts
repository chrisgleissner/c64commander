/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { delay } from "./timing.js";

export type StageMutation = {
    mutate: (input: { clientId: string }) => Promise<void>;
};

export async function runStage(input: {
    stage: { concurrency: number; rateDelayMs: number; durationMs: number; stageId: string };
    mutation: StageMutation;
    onAbort: (reason: string) => void;
    shouldAbort?: () => string | null;
}): Promise<string | null> {
    const stageDeadline = input.stage.durationMs === 0 ? Number.POSITIVE_INFINITY : Date.now() + input.stage.durationMs;
    const inFlight = new Set<Promise<void>>();
    const availableClientIds = Array.from({ length: input.stage.concurrency }, (_value, index) => `client-${index + 1}`);
    let nextLaunchAt = Date.now();
    let abortReason: string | null = null;

    const waitForSlot = async (): Promise<string | null> => {
        while (availableClientIds.length === 0 && !abortReason) {
            abortReason ??= input.shouldAbort?.() ?? null;
            if (abortReason) {
                break;
            }
            if (inFlight.size === 0) {
                break;
            }
            await Promise.race(inFlight);
        }
        return availableClientIds.shift() ?? null;
    };

    while (Date.now() < stageDeadline && !abortReason) {
        abortReason ??= input.shouldAbort?.() ?? null;
        if (abortReason) {
            input.onAbort(abortReason);
            break;
        }

        const waitMs = nextLaunchAt - Date.now();
        if (waitMs > 0) {
            await delay(waitMs);
        }
        nextLaunchAt += input.stage.rateDelayMs;

        abortReason ??= input.shouldAbort?.() ?? null;
        if (Date.now() >= stageDeadline || abortReason) {
            if (abortReason) {
                input.onAbort(abortReason);
            }
            break;
        }

        const clientId = await waitForSlot();
        if (!clientId) {
            abortReason = abortReason ?? `No client slot available for ${input.stage.stageId}`;
            input.onAbort(abortReason);
            break;
        }

        const task = input.mutation
            .mutate({ clientId })
            .catch((error) => {
                abortReason ??= String(error);
                input.onAbort(abortReason);
            })
            .finally(() => {
                availableClientIds.push(clientId);
                inFlight.delete(task);
            });
        inFlight.add(task);
    }

    await Promise.allSettled(inFlight);
    return abortReason;
}
