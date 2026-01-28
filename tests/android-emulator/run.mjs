import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installApk, waitForBoot, getDeviceModel } from './helpers/device.mjs';
import { writeSmokeConfig, waitForSmokeState, readSmokeStatus } from './helpers/smokeConfig.mjs';
import { createEvidenceManager } from './helpers/evidence.mjs';
import { startExternalMockServer } from './helpers/mockC64Server.mjs';
import { tapTab, tapConnectivityIndicator } from './helpers/ui.mjs';
import { sleep, sanitizeSegment } from './helpers/utils.mjs';
import { adbForceStop, adbClearApp, adbStartActivity } from './helpers/adb.mjs';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const parseArgs = () => {
  const args = process.argv.slice(2);
  const parsed = {
    target: 'mock',
    host: undefined,
    emulatorId: undefined,
    apkPath: undefined,
    deviceType: undefined,
    appId: 'uk.gleissner.c64commander',
    mainActivity: 'uk.gleissner.c64commander/.MainActivity',
    evidenceRoot: path.join(ROOT_DIR, 'test-results', 'evidence', 'android-emulator'),
    spec: undefined,
    grep: undefined,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--c64u-target') parsed.target = args[++i];
    else if (arg === '--c64u-host') parsed.host = args[++i];
    else if (arg === '--emulator-id') parsed.emulatorId = args[++i];
    else if (arg === '--apk-path') parsed.apkPath = args[++i];
    else if (arg === '--device-type') parsed.deviceType = args[++i];
    else if (arg === '--app-id') parsed.appId = args[++i];
    else if (arg === '--main-activity') parsed.mainActivity = args[++i];
    else if (arg === '--evidence-root') parsed.evidenceRoot = args[++i];
    else if (arg === '--spec') parsed.spec = args[++i];
    else if (arg === '--grep') parsed.grep = args[++i];
  }

  return parsed;
};

const listSpecs = async (specDir) => {
  const entries = await fs.promises.readdir(specDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.spec.mjs'))
    .map((entry) => path.join(specDir, entry.name));
};

const loadSpecs = async (specDir, filter) => {
  const files = await listSpecs(specDir);
  const selected = filter ? files.filter((file) => file.includes(filter)) : files;
  const specs = [];
  for (const file of selected) {
    const mod = await import(pathToFileURL(file).href);
    if (!mod.spec) {
      throw new Error(`Spec missing export 'spec': ${file}`);
    }
    specs.push({ file, ...mod.spec });
  }
  return specs;
};

const ensureApkPath = (apkPath) => {
  if (apkPath && fs.existsSync(apkPath)) return apkPath;
  const candidate = path.join(ROOT_DIR, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
  if (fs.existsSync(candidate)) return candidate;
  return null;
};

const shouldIncludeTest = (testName, grep) => {
  if (!grep) return true;
  return testName.toLowerCase().includes(grep.toLowerCase());
};

const run = async () => {
  const options = parseArgs();

  if (options.host === 'auto') {
    options.host = undefined;
  }

  if (options.target !== 'mock' && options.target !== 'real') {
    throw new Error(`Invalid --c64u-target: ${options.target}`);
  }

  const apkPath = ensureApkPath(options.apkPath);
  if (!apkPath) {
    throw new Error('APK not found. Provide --apk-path or build debug APK.');
  }

  if (!options.emulatorId) {
    throw new Error('Missing --emulator-id. Provide emulator ID from adb devices.');
  }

  console.log(`Android emulator smoke: target=${options.target} host=${options.host ?? 'auto'} emulator=${options.emulatorId}`);
  await waitForBoot(options.emulatorId);
  console.log('Emulator booted. Installing APK...');
  await installApk(options.emulatorId, apkPath);
  console.log('APK installed.');

  let mockServer = null;
  let effectiveHost = options.host;
  if (options.target === 'real' && (!effectiveHost || effectiveHost === 'auto')) {
    mockServer = await startExternalMockServer();
    effectiveHost = mockServer.hostForEmulator;
    console.log(`External mock server started: ${mockServer.baseUrl} (emulator host ${effectiveHost})`);
  }

  const deviceType = options.deviceType ?? await getDeviceModel(options.emulatorId);
  const specs = await loadSpecs(path.join(ROOT_DIR, 'tests', 'android-emulator', 'specs'), options.spec);
  const failures = [];

  for (const spec of specs) {
    if (!spec.tests?.length) {
      continue;
    }

    if (Array.isArray(spec.targets) && !spec.targets.includes(options.target)) {
      continue;
    }

    for (const test of spec.tests) {
      if (Array.isArray(test.targets) && !test.targets.includes(options.target)) {
        continue;
      }
      const testId = sanitizeSegment(`${spec.id}--${test.id}--${options.target}`);
      if (!shouldIncludeTest(testId, options.grep)) {
        continue;
      }

      console.log(`\n==> Running ${testId}`);

      const evidence = createEvidenceManager({
        evidenceRoot: options.evidenceRoot,
        testName: testId,
        deviceType,
        deviceId: options.emulatorId,
        appId: options.appId,
        emulatorId: options.emulatorId,
        apkPath,
        target: options.target,
        host: effectiveHost ?? 'C64U',
        specFile: spec.file,
        testTitle: test.title ?? test.id,
      });

      const startedAt = Date.now();
      let status = 'passed';
      let error = null;
      let smokeStatus = '';

      const ctx = {
        deviceId: options.emulatorId,
        appId: options.appId,
        mainActivity: options.mainActivity,
        target: options.target,
        host: effectiveHost ?? 'C64U',
        evidence,
        tapTab: (label) => tapTab(options.emulatorId, label),
        tapConnectivityIndicator: () => tapConnectivityIndicator(options.emulatorId),
        sleep,
        capture: (label) => evidence.captureScreenshot(label),
        startFreshApp: async () => {
          await adbForceStop(options.emulatorId, options.appId).catch(() => {});
          await adbClearApp(options.emulatorId, options.appId);
          await writeSmokeConfig(options.emulatorId, options.appId, {
            target: options.target,
            host: effectiveHost ?? undefined,
            readOnly: true,
            debugLogging: true,
          });
          await adbStartActivity(options.emulatorId, options.mainActivity);
          await sleep(3000);
        },
        waitForSmokeState: async (state, timeoutSeconds) => {
          const payload = await waitForSmokeState(options.emulatorId, options.appId, state, timeoutSeconds);
          smokeStatus = payload;
          return payload;
        },
        readSmokeStatus: async () => readSmokeStatus(options.emulatorId, options.appId),
      };

      await evidence.start();
      await evidence.startLogcat();
      await evidence.startVideo();

      try {
        await test.run(ctx);
        console.log(`==> Passed ${testId}`);
      } catch (err) {
        status = 'failed';
        error = err;
        console.error(`==> Failed ${testId}: ${error?.message ?? 'unknown error'}`);
      } finally {
        try {
          await evidence.captureScreenshot('final');
        } catch {
          // ignore screenshot errors
        }
        await evidence.stopVideo();
        await evidence.stopLogcat();
        const events = await evidence.writeRequestRouting();

        const mutating = events.filter((event) => {
          if (event.event === 'mutation-blocked') return true;
          if (event.event !== 'request') return false;
          return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(event.method).toUpperCase());
        });
        if (mutating.length) {
          status = 'failed';
          if (!error) {
            error = new Error('Smoke run observed mutating requests.');
          }
        }

        if (!smokeStatus) {
          smokeStatus = await readSmokeStatus(options.emulatorId, options.appId).catch(() => '');
        }

        await evidence.writeErrorContext({
          status,
          expected: test.expected,
          retryable: test.retryable,
          component: spec.title ?? spec.id,
          error,
        });

        let parsedSmokeStatus = null;
        if (smokeStatus) {
          try {
            parsedSmokeStatus = JSON.parse(smokeStatus);
          } catch {
            parsedSmokeStatus = { raw: smokeStatus };
          }
        }

        await evidence.writeMeta({
          status,
          durationMs: Date.now() - startedAt,
          smokeStatus: parsedSmokeStatus,
        });
      }

      if (status !== 'passed') {
        failures.push(`${testId}: ${error?.message ?? 'failed'}`);
      }
    }
  }

  await mockServer?.close?.().catch(() => {});

  if (failures.length) {
    throw new Error(`Android emulator smoke tests failed:\n${failures.join('\n')}`);
  }
};

run().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
