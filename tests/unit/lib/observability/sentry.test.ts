/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const init = vi.fn();

vi.mock('@sentry/react', () => ({
    init,
}));

describe('initializeSentry', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does nothing when DSN missing', async () => {
        vi.stubEnv('VITE_SENTRY_DSN', '');
        const { initializeSentry } = await import('@/lib/observability/sentry');
        initializeSentry();
        expect(init).not.toHaveBeenCalled();
    });

    it('initializes with parsed sample rates and fallbacks', async () => {
        vi.stubEnv('VITE_SENTRY_DSN', 'https://dsn.example');
        vi.stubEnv('VITE_SENTRY_TRACES_SAMPLE_RATE', '0.2');
        vi.stubEnv('VITE_SENTRY_REPLAY_SESSION_SAMPLE_RATE', 'invalid');
        vi.stubEnv('VITE_SENTRY_REPLAY_ERROR_SAMPLE_RATE', '2.0');

        const { initializeSentry } = await import('@/lib/observability/sentry');
        initializeSentry();

        expect(init).toHaveBeenCalledWith(expect.objectContaining({
            dsn: 'https://dsn.example',
            tracesSampleRate: 0.2,
            replaysSessionSampleRate: 0.0,
            replaysOnErrorSampleRate: 1.0,
        }));
    });
});
