import {
  adbExec,
  adbShell,
  adbInstall,
  adbForceStop,
  adbClearApp,
  adbStartActivity,
  adbKeyEvent,
} from './adb.mjs';
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
  const match =
    stdout.match(/Physical size:\s*(\d+)x(\d+)/i) ||
    stdout.match(/Override size:\s*(\d+)x(\d+)/i);
  if (!match) {
    return { width: 1080, height: 1920 };
  }
  return { width: Number(match[1]), height: Number(match[2]) };
};

export const installApk = async (deviceId, apkPath) =>
  adbInstall(deviceId, apkPath);

export const clearAppData = async (deviceId, appId) =>
  adbClearApp(deviceId, appId);

export const forceStopApp = async (deviceId, appId) =>
  adbForceStop(deviceId, appId);

export const launchApp = async (deviceId, activity) =>
  adbStartActivity(deviceId, activity);

export const getCurrentFocusWindow = async (deviceId) => {
  const { stdout } = await adbShell(
    deviceId,
    'dumpsys window windows | grep -E "mCurrentFocus|mFocusedApp"',
  );
  return stdout.trim();
};

export const isKeyguardShowing = async (deviceId) => {
  const { stdout } = await adbShell(
    deviceId,
    'dumpsys window policy | grep -E "isStatusBarKeyguard|mShowingLockscreen|mDreamingLockscreen"',
  );
  const normalized = stdout.toLowerCase();
  return normalized.includes('=true');
};

export const unlockDevice = async (deviceId) => {
  await adbKeyEvent(deviceId, 224).catch(() => {});
  await adbShell(deviceId, 'wm dismiss-keyguard').catch(() => {});
  await adbKeyEvent(deviceId, 82).catch(() => {});
  await adbKeyEvent(deviceId, 4).catch(() => {});
};

export const ensureDeviceReadyForAutomation = async ({
  deviceId,
  appId,
  mainActivity,
  timeoutMs = 12000,
}) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await unlockDevice(deviceId);
    await adbStartActivity(deviceId, mainActivity);
    await sleep(800);
    const focus = await getCurrentFocusWindow(deviceId);
    const keyguardVisible = await isKeyguardShowing(deviceId);
    if (!keyguardVisible && focus.includes(appId)) {
      return;
    }
  }
  const focus = await getCurrentFocusWindow(deviceId).catch(() => 'unknown');
  throw new Error(
    `Device preflight failed: app not focused or keyguard still active (focus=${focus})`,
  );
};

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
