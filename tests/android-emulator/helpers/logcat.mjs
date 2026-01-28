import fs from 'node:fs';
import { spawn } from 'node:child_process';

const FILTER_REGEX = /(C64U_|Capacitor\/Console)/;

export const startLogcatCapture = (deviceId, outputPath) => {
  const stream = fs.createWriteStream(outputPath, { flags: 'w' });
  const proc = spawn('adb', ['-s', deviceId, 'logcat', '-v', 'time'], { stdio: ['ignore', 'pipe', 'pipe'] });

  const writeLine = (line) => {
    if (FILTER_REGEX.test(line)) {
      stream.write(`${line}\n`);
    }
  };

  let buffer = '';
  proc.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    let idx = buffer.indexOf('\n');
    while (idx !== -1) {
      const line = buffer.slice(0, idx).trimEnd();
      buffer = buffer.slice(idx + 1);
      if (line) writeLine(line);
      idx = buffer.indexOf('\n');
    }
  });

  proc.stderr.on('data', () => {});

  const stop = async () => {
    proc.kill('SIGTERM');
    await new Promise((resolve) => proc.on('close', resolve));
    stream.end();
  };

  return { proc, stop };
};

export const clearLogcat = async (deviceId) => {
  await new Promise((resolve, reject) => {
    const proc = spawn('adb', ['-s', deviceId, 'logcat', '-c']);
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error('Failed to clear logcat'))));
  });
};
