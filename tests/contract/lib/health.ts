/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export type ProbeResult = {
    ok: boolean;
    status?: number;
    error?: string;
    latencyMs?: number;
};

export type ProbeFn = () => Promise<ProbeResult>;

export type HealthConfig = {
    maxConsecutiveFailures: number;
    maxUnreachableMs: number;
};

export class HealthMonitor {
    private consecutiveFailures = 0;
    private lastSuccessAt = Date.now();

    constructor(private readonly probe: ProbeFn, private readonly config: HealthConfig) { }

    async check(): Promise<ProbeResult> {
        const result = await this.probe();
        if (result.ok) {
            this.consecutiveFailures = 0;
            this.lastSuccessAt = Date.now();
        } else {
            this.consecutiveFailures += 1;
        }
        return result;
    }

    shouldAbort(): { abort: boolean; reason?: string } {
        if (this.consecutiveFailures >= this.config.maxConsecutiveFailures) {
            return { abort: true, reason: `Health probe failed ${this.consecutiveFailures} times` };
        }
        const unreachableMs = Date.now() - this.lastSuccessAt;
        if (unreachableMs >= this.config.maxUnreachableMs) {
            return { abort: true, reason: `Health probe unreachable for ${unreachableMs}ms` };
        }
        return { abort: false };
    }
}
