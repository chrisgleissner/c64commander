import type { BackgroundExecutionPlugin } from './backgroundExecution';

/**
 * No-op web fallback — background execution is only relevant on native platforms.
 */
export class BackgroundExecutionWeb implements BackgroundExecutionPlugin {
    async start(): Promise<void> {
        /* no-op on web */
    }

    async stop(): Promise<void> {
        /* no-op on web */
    }
}
