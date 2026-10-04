/* C64 Commander — GPL-3.0-or-later, Copyright (C) 2026 Christian Gleissner. */
import type { Page } from "@playwright/test";

/** Same kernel in the Pixel WebView and CI Chromium; rate 2 on a desktop is not half a Pixel. */
export const callbackCpuKernel = () => {
  let checksum = 0x1234abcd;
  const start = performance.now();
  for (let index = 0; index < 80_000_000; index += 1) {
    checksum = (Math.imul(checksum ^ index, 1664525) + 1013904223) | 0;
  }
  return { elapsedMs: performance.now() - start, checksum };
};

export const constrainCallbackCpu = async (page: Page, referenceMs: number) => {
  const session = await page.context().newCDPSession(page);
  // Warm the same function rather than repeatedly compiling its source.
  await page.evaluate(`window.__callbackCpuKernel = ${callbackCpuKernel.toString()}`);
  const measure = () => page.evaluate<number>("window.__callbackCpuKernel().elapsedMs");
  await measure();
  await measure();
  const nativeMs = await measure();
  let rate = Math.max(1, referenceMs / nativeMs);
  await session.send("Emulation.setCPUThrottlingRate", { rate });
  const measuredMs = await measure();
  rate = Math.max(1, (rate * referenceMs) / measuredMs);
  await session.send("Emulation.setCPUThrottlingRate", { rate });
  return { session, rate, measuredMs: await measure() };
};
