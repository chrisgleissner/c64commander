import { waitForLogPattern, assertNoDemoState } from '../helpers/assertions.mjs';

export const spec = {
  id: 'connection',
  title: 'Connection smoke (mock target)',
  targets: ['mock'],
  tests: [
    {
      id: 'mock-connects-and-navigates',
      title: 'Connects to mock and navigates tabs',
      expected: 'App connects to internal mock and navigation works.',
      retryable: false,
      run: async (ctx) => {
        await ctx.startFreshApp();
        const payload = await ctx.waitForSmokeState('REAL_CONNECTED', 50);
        assertNoDemoState(payload);

        await ctx.capture('home-connected');
        await ctx.tapTab('Play');
        await ctx.capture('play-tab');
        await ctx.tapTab('Settings');
        await ctx.capture('settings-tab');

        await waitForLogPattern(ctx.evidence.logcatPath, /C64U_HTTP_NATIVE/);
        await waitForLogPattern(ctx.evidence.logcatPath, /C64U_SMOKE_MOCK_CONNECTED|C64U_SMOKE_DISCOVERY_OVERRIDE/);
      },
    },
    {
      id: 'manual-discovery',
      title: 'Manual discovery remains mock',
      expected: 'Manual discovery does not leave mock mode.',
      retryable: false,
      run: async (ctx) => {
        await ctx.startFreshApp();
        const payload = await ctx.waitForSmokeState('REAL_CONNECTED', 50);
        assertNoDemoState(payload);
        await ctx.capture('connected');

        await ctx.tapConnectivityIndicator();
        await ctx.capture('manual-discovery');

        await waitForLogPattern(ctx.evidence.logcatPath, /C64U_DISCOVERY_DECISION/);
      },
    },
  ],
};
