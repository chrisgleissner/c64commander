#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseDeviceSwitchSoakRunnerResult } from './device-switch-soak-log.mjs';

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.split('=');
    return [key, value ?? ''];
  }),
);

const target = args.get('--target') || process.env.C64_SWITCH_SOAK_TARGET || 'mock';
const timeoutMs = Number(args.get('--timeoutMs') || process.env.C64_SWITCH_SOAK_TIMEOUT_MS || '180000');
const outFile = args.get('--out') || process.env.C64_SWITCH_SOAK_OUT_FILE || '';
const apkPath = args.get('--apkPath') || process.env.C64_SWITCH_SOAK_APK_PATH || '';
const activity = args.get('--activity') || process.env.C64_SWITCH_SOAK_ACTIVITY || 'uk.gleissner.c64commander/.MainActivity';
const appId = args.get('--appId') || process.env.C64_SWITCH_SOAK_APP_ID || 'uk.gleissner.c64commander';

const run = (command, commandArgs, options = {}) => {
  const result = spawnSync(command, commandArgs, {
    encoding: 'utf8',
    stdio: 'pipe',
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(' ')} failed: ${result.stderr || result.stdout || 'unknown failure'}`);
  }
  return result.stdout;
};

const getAndroidSerial = () => {
  const explicit = args.get('--serial') || process.env.ANDROID_SERIAL || '';
  if (explicit) return explicit;

  const adbDevices = run('adb', ['devices']);
  const devices = adbDevices
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s+/, 2))
    .filter(([serial, state]) => serial && state === 'device' && !serial.startsWith('emulator-'))
    .map(([serial]) => serial);
  const preferred = devices.filter((serial) => serial.startsWith('9B0'));
  if (preferred.length === 1) return preferred[0];
  if (devices.length === 1) return devices[0];
  throw new Error(`Unable to resolve a single Android device for switch soak (${devices.join(', ') || 'none'})`);
};

const adbArgsFor = (serial, extra) => (serial ? ['-s', serial, ...extra] : extra);

const adb = (serial, extra, options = {}) => run('adb', adbArgsFor(serial, extra), options);

const wait = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));

const runMockSoak = () => {
  const env = {
    ...process.env,
    VITE_ENABLE_TEST_PROBES: process.env.VITE_ENABLE_TEST_PROBES || '1',
    PLAYWRIGHT_WORKERS: process.env.PLAYWRIGHT_WORKERS || '1',
  };
  const result = spawnSync('npx', ['playwright', 'test', 'playwright/deviceSwitchSoak.spec.ts'], {
    cwd: process.cwd(),
    env,
    stdio: 'inherit',
  });
  process.exit(result.status ?? 1);
};

const pollForResult = async (serial) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const logcat = adb(serial, ['logcat', '-d', '-v', 'raw']);
    const parsed = parseDeviceSwitchSoakRunnerResult(logcat);
    if (parsed) {
      return { parsed, logcat };
    }
    await wait(1000);
  }
  const logcat = adb(serial, ['logcat', '-d', '-v', 'brief']);
  throw new Error(`Timed out waiting for device switch soak result. Recent logcat:\n${logcat.slice(-8000)}`);
};

const runRealSoak = async () => {
  const serial = getAndroidSerial();
  if (apkPath) {
    adb(serial, ['install', '-r', apkPath]);
  }

  adb(serial, ['logcat', '-c']);
  adb(serial, ['shell', 'am', 'force-stop', appId]);
  adb(serial, ['shell', 'input', 'keyevent', '224']);
  adb(serial, ['shell', 'wm', 'dismiss-keyguard']);
  adb(serial, ['shell', 'input', 'keyevent', '82']);
  adb(serial, ['shell', 'am', 'start', '-n', activity]);
  await wait(8000);

  const { parsed, logcat } = await pollForResult(serial);
  if (outFile) {
    mkdirSync(path.dirname(outFile), { recursive: true });
    writeFileSync(outFile, JSON.stringify(parsed, null, 2), 'utf8');
  }

  process.stdout.write(`${JSON.stringify(parsed, null, 2)}\n`);
  if (parsed.status !== 'completed' || Number(parsed?.summary?.failureCount ?? 0) > 0) {
    throw new Error(`Device switch soak reported failures.\n${JSON.stringify(parsed, null, 2)}\n\n${logcat.slice(-8000)}`);
  }
};

if (target === 'mock') {
  runMockSoak();
} else if (target === 'real') {
  runRealSoak().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
} else {
  process.stderr.write(`Unsupported --target value: ${target}\n`);
  process.exit(1);
}
