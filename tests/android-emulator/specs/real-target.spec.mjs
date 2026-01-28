import { waitForLogPattern } from '../helpers/assertions.mjs';

export const spec = {
  id: 'real-target',
  title: 'Connection smoke (external mock target)',
  targets: ['real'],
  tests: [
    {
      id: 'real-connects',
      title: 'Connects to external mock host',
      expected: 'App connects to external mock and stays in real mode.',
      retryable: false,
      run: async (ctx) => {
        await ctx.startFreshApp();
        const payload = await ctx.waitForSmokeState('REAL_CONNECTED', 50);
        if (!payload.includes('"mode":"real"')) {
          throw new Error('Expected smoke mode to report real connection.');
        }
        await ctx.capture('real-connected');
        await waitForLogPattern(ctx.evidence.logcatPath, /C64U_HTTP_NATIVE/);
      },
    },
    {
      id: 'navigate-config',
      title: 'Config tab loads against external mock',
      expected: 'Config tab renders without demo fallback using external mock.',
      retryable: false,
      run: async (ctx) => {
        await ctx.startFreshApp();
        const payload = await ctx.waitForSmokeState('REAL_CONNECTED', 50);
        if (!payload.includes('"mode":"real"')) {
          throw new Error('Expected smoke mode to report real connection.');
        }
        await ctx.capture('home-real');
        await ctx.tapTab('Config');
        await ctx.capture('config-tab');
        await waitForLogPattern(ctx.evidence.logcatPath, /C64U_ROUTING_UPDATED/);
      },
    },
  ],
};
