import { adbShell, adbShellInput } from './adb.mjs';
import { sleep } from './utils.mjs';

export const writeSmokeConfig = async (deviceId, appId, config) => {
  const payload = JSON.stringify(config);
  const cmd = `run-as ${appId} sh -c 'mkdir -p files && cat > files/c64u-smoke.json'`;
  await adbShellInput(deviceId, cmd, payload);
};

export const readSmokeStatus = async (deviceId, appId) => {
  const cmd = `run-as ${appId} cat files/c64u-smoke-status.json`;
  const { stdout } = await adbShell(deviceId, cmd).catch(() => ({ stdout: '' }));
  return stdout.trim();
};

export const waitForSmokeState = async (deviceId, appId, state, timeoutSeconds = 50) => {
  const start = Date.now();
  while (Date.now() - start < timeoutSeconds * 1000) {
    const payload = await readSmokeStatus(deviceId, appId);
    if (payload && payload.includes(`"state":"${state}"`)) {
      return payload;
    }
    await sleep(1000);
  }
  throw new Error(`Smoke status did not reach state ${state} within ${timeoutSeconds}s.`);
};
