import { adbExec, adbShell, adbInstall, adbForceStop, adbClearApp, adbStartActivity } from './adb.mjs';
import { sleep } from './utils.mjs';

export const getDeviceModel = async (deviceId) => {
  const { stdout } = await adbShell(deviceId, 'getprop ro.product.model');
  const model = stdout.trim();
  if (model) return model;
  const { stdout: name } = await adbShell(deviceId, 'getprop ro.product.name');
  return name.trim() || deviceId;
};

export const getDisplaySize = async (deviceId) => {
  const { stdout } = await adbShell(deviceId, 'wm size');
  const match = stdout.match(/Physical size:\s*(\d+)x(\d+)/i) || stdout.match(/Override size:\s*(\d+)x(\d+)/i);
  if (!match) {
    return { width: 1080, height: 1920 };
  }
  return { width: Number(match[1]), height: Number(match[2]) };
};

export const installApk = async (deviceId, apkPath) => adbInstall(deviceId, apkPath);

export const clearAppData = async (deviceId, appId) => adbClearApp(deviceId, appId);

export const forceStopApp = async (deviceId, appId) => adbForceStop(deviceId, appId);

export const launchApp = async (deviceId, activity) => adbStartActivity(deviceId, activity);

export const waitForBoot = async (deviceId, timeoutSeconds = 120) => {
  await adbExec(deviceId, ['wait-for-device']);
  let elapsed = 0;
  while (elapsed < timeoutSeconds) {
    const { stdout } = await adbShell(deviceId, 'getprop sys.boot_completed');
    if (stdout.trim() === '1') return true;
    await sleep(2000);
    elapsed += 2;
  }
  throw new Error('Emulator did not finish booting in time.');
};
