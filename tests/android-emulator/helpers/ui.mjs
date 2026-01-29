import { adbTap } from './adb.mjs';
import { getDisplaySize } from './device.mjs';
import { sleep } from './utils.mjs';

const tabOrder = ['Home', 'Play', 'Disks', 'Config', 'Settings', 'Docs'];

export const tapRelative = async (deviceId, xRatio, yRatio) => {
  const { width, height } = await getDisplaySize(deviceId);
  const x = Math.round(width * xRatio);
  const y = Math.round(height * yRatio);
  await adbTap(deviceId, x, y);
};

export const tapTab = async (deviceId, label) => {
  const index = tabOrder.indexOf(label);
  if (index === -1) throw new Error(`Unknown tab label: ${label}`);
  const { width, height } = await getDisplaySize(deviceId);
  const cell = width / tabOrder.length;
  const x = Math.round(cell * index + cell / 2);
  const y = Math.round(height * 0.93);
  await adbTap(deviceId, x, y);
  await sleep(600);
};

export const tapConnectivityIndicator = async (deviceId) => {
  // Top-left badge area; approximate coordinates based on common layout.
  const { width, height } = await getDisplaySize(deviceId);
  const x = Math.round(width * 0.14);
  const y = Math.round(height * 0.12);
  await adbTap(deviceId, x, y);
  await sleep(600);
};
