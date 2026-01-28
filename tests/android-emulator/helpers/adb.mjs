import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const adbExec = async (deviceId, args, options = {}) => {
  const finalArgs = deviceId ? ['-s', deviceId, ...args] : args;
  const { stdout, stderr } = await execFileAsync('adb', finalArgs, options);
  return { stdout: stdout?.toString() ?? '', stderr: stderr?.toString() ?? '' };
};

export const adbExecRaw = async (deviceId, args, options = {}) => {
  const finalArgs = deviceId ? ['-s', deviceId, ...args] : args;
  const { stdout, stderr } = await execFileAsync('adb', finalArgs, { ...options, encoding: 'buffer' });
  return { stdout, stderr: stderr?.toString() ?? '' };
};

export const adbShell = async (deviceId, command, options = {}) => {
  return adbExec(deviceId, ['shell', command], options);
};

export const adbShellInput = async (deviceId, command, input) =>
  new Promise((resolve, reject) => {
    const args = deviceId ? ['-s', deviceId, 'shell', command] : ['shell', command];
    const proc = spawn('adb', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr || `adb shell failed with code ${code}`));
    });
    if (input) {
      proc.stdin.write(input);
    }
    proc.stdin.end();
  });

export const adbInstall = async (deviceId, apkPath) => {
  return adbExec(deviceId, ['install', '-r', apkPath]);
};

export const adbForceStop = async (deviceId, appId) => {
  return adbShell(deviceId, `am force-stop ${appId}`);
};

export const adbClearApp = async (deviceId, appId) => {
  return adbShell(deviceId, `pm clear ${appId}`);
};

export const adbStartActivity = async (deviceId, activity) => {
  return adbShell(deviceId, `am start -n ${activity}`);
};

export const adbTap = async (deviceId, x, y) => {
  return adbShell(deviceId, `input tap ${Math.round(x)} ${Math.round(y)}`);
};

export const adbKeyEvent = async (deviceId, keyCode) => {
  return adbShell(deviceId, `input keyevent ${keyCode}`);
};

export const adbPull = async (deviceId, remotePath, localPath) => {
  return adbExec(deviceId, ['pull', remotePath, localPath]);
};

export const adbRemove = async (deviceId, remotePath) => {
  return adbShell(deviceId, `rm -f ${remotePath}`);
};

export const adbScreenRecord = async (deviceId, remotePath, seconds = 45) => {
  return adbShell(deviceId, `screenrecord --time-limit ${seconds} ${remotePath}`);
};

export const adbScreenCap = async (deviceId, localPath) => {
  const { stdout } = await adbExecRaw(deviceId, ['exec-out', 'screencap', '-p']);
  await fs.promises.writeFile(localPath, stdout);
};
