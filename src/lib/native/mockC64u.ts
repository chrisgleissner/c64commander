import { registerPlugin } from '@capacitor/core';
import type { MockConfigPayload } from '@/lib/mock/mockConfig';

export type MockC64UPlugin = {
  startServer: (options: { config: MockConfigPayload; preferredPort?: number }) => Promise<{
    baseUrl: string;
    port: number;
    ftpPort?: number;
  }>;
  stopServer: () => Promise<void>;
};

export const MockC64U = registerPlugin<MockC64UPlugin>('MockC64U', {
  web: () => import('./mockC64u.web').then((module) => new module.MockC64UWeb()),
});
