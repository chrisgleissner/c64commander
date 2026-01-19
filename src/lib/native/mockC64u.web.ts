import type { MockC64UPlugin } from './mockC64u';

export class MockC64UWeb implements MockC64UPlugin {
  async startServer(): Promise<{ baseUrl: string; port: number }> {
    throw new Error('Mock C64U server is only available on native platforms.');
  }

  async stopServer(): Promise<void> {
    return;
  }
}
