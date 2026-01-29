import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { adbExecRaw, adbShell, adbPull } from './adb.mjs';
import { sanitizeSegment, nowIso } from './utils.mjs';
import { startLogcatCapture, clearLogcat } from './logcat.mjs';

const VIDEO_REMOTE_PATH = '/sdcard/c64u-smoke-video.mp4';

const parseRoutingEvents = (content) => {
  const events = [];
  const lines = content.split(/\r?\n/);

  const extractJson = (line, token) => {
    const idx = line.indexOf(token);
    if (idx === -1) return null;
    const fragment = line.slice(idx + token.length);
    const match = fragment.match(/\{.*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  };

  for (const line of lines) {
    const http = extractJson(line, 'C64U_HTTP_NATIVE');
    if (http) {
      events.push({
        event: 'request',
        method: http.method ?? 'GET',
        url: http.url ?? null,
        path: http.path ?? null,
        source: 'native',
      });
    }
    const routing = extractJson(line, 'C64U_ROUTING_UPDATED');
    if (routing) {
      events.push({
        event: 'routing',
        baseUrl: routing.baseUrl ?? null,
        deviceHost: routing.deviceHost ?? null,
        mode: routing.mode ?? null,
      });
    }
    const mutation = extractJson(line, 'C64U_SMOKE_MUTATION_BLOCKED');
    if (mutation) {
      events.push({
        event: 'mutation-blocked',
        method: mutation.method ?? null,
        path: mutation.path ?? null,
        url: mutation.url ?? null,
      });
    }
  }

  return events;
};

export const createEvidenceManager = ({
  evidenceRoot,
  testName,
  deviceType,
  deviceId,
  appId,
  emulatorId,
  apkPath,
  target,
  host,
  specFile,
  testTitle,
}) => {
  const safeTestName = sanitizeSegment(testName);
  const safeDeviceType = sanitizeSegment(deviceType);
  const evidenceDir = path.join(evidenceRoot, safeTestName, safeDeviceType);
  const screenshotsDir = path.join(evidenceDir, 'screenshots');
  const logcatPath = path.join(evidenceDir, 'logcat.txt');
  const videoPath = path.join(evidenceDir, 'video.mp4');
  let screenshotIndex = 1;
  let logcat = null;
  let videoProc = null;
  let startedAt = nowIso();

  const ensureDirs = async () => {
    await fs.promises.mkdir(screenshotsDir, { recursive: true });
  };

  const captureScreenshot = async (label) => {
    await ensureDirs();
    const step = String(screenshotIndex).padStart(2, '0');
    const safeLabel = sanitizeSegment(label);
    const fileName = `${step}-${safeLabel || 'step'}.png`;
    const filePath = path.join(screenshotsDir, fileName);
    const { stdout } = await adbExecRaw(deviceId, ['exec-out', 'screencap', '-p']);
    await fs.promises.writeFile(filePath, stdout);
    screenshotIndex += 1;
  };

  const startLogcat = async () => {
    await ensureDirs();
    await clearLogcat(deviceId);
    logcat = startLogcatCapture(deviceId, logcatPath);
  };

  const stopLogcat = async () => {
    if (logcat) {
      await logcat.stop();
      logcat = null;
    }
  };

  const startVideo = async () => {
    await ensureDirs();
    await adbShell(deviceId, `rm -f ${VIDEO_REMOTE_PATH}`).catch(() => {});
    videoProc = spawn('adb', ['-s', deviceId, 'shell', 'screenrecord', '--time-limit', '90', VIDEO_REMOTE_PATH]);
  };

  const stopVideo = async () => {
    if (videoProc) {
      await adbShell(deviceId, 'pkill -INT screenrecord').catch(() => {});
      await new Promise((resolve) => videoProc.on('close', resolve));
      videoProc = null;
    }
    await adbPull(deviceId, VIDEO_REMOTE_PATH, videoPath).catch(() => {});
  };

  const writeRequestRouting = async () => {
    await ensureDirs();
    let content = '';
    try {
      content = await fs.promises.readFile(logcatPath, 'utf8');
    } catch {
      content = '';
    }
    const events = parseRoutingEvents(content);
    await fs.promises.writeFile(path.join(evidenceDir, 'request-routing.json'), JSON.stringify(events, null, 2), 'utf8');
    return events;
  };

  const writeErrorContext = async ({ status, expected, retryable, component, error }) => {
    await ensureDirs();
    const lines = [
      `Status: ${status}`,
      `Expected: ${expected || 'n/a'}`,
      `Retryable: ${retryable ? 'yes' : 'no'}`,
      `Project: android-emulator` ,
      `Component: ${component || 'smoke-runner'}`,
    ];

    if (error) {
      lines.push('', 'Error:', error.stack || error.message || String(error));
    }

    await fs.promises.writeFile(path.join(evidenceDir, 'error-context.md'), lines.join('\n'), 'utf8');
  };

  const writeMeta = async ({ status, durationMs, smokeStatus }) => {
    const meta = {
      testName: safeTestName,
      deviceType: safeDeviceType,
      target,
      host,
      appId,
      emulatorId,
      apkPath,
      deviceId,
      specFile,
      testTitle,
      status,
      startedAt,
      finishedAt: nowIso(),
      durationMs,
      smokeStatus,
    };

    await ensureDirs();
    await fs.promises.writeFile(path.join(evidenceDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
  };

  return {
    evidenceDir,
    logcatPath,
    startLogcat,
    stopLogcat,
    startVideo,
    stopVideo,
    captureScreenshot,
    writeRequestRouting,
    writeErrorContext,
    writeMeta,
    start: async () => {
      startedAt = nowIso();
      await ensureDirs();
    },
  };
};
