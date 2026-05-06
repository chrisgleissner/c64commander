#!/usr/bin/env node

/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const APP_ID = process.env.APP_ID ?? "uk.gleissner.c64commander";
const DEVICE_ID = process.env.DEVICE_ID ?? "9B081FFAZ001WX";
const C64U_HOST = process.env.C64U_HOST ?? "c64u";
const DEVTOOLS_PORT = Number(process.env.DEVTOOLS_PORT ?? "9222");
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? "test-results/android-device";
const RESULT_PATH = path.join(OUTPUT_DIR, "pixel4-c64u-soak-results.json");
const SCREENSHOT_PATH = path.join(OUTPUT_DIR, "pixel4-c64u-soak-final.png");
const LOGCAT_PATH = path.join(OUTPUT_DIR, "pixel4-c64u-soak-logcat.txt");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const run = async (command, args, options = {}) => {
  const { stdout, stderr } = await execFileAsync(command, args, {
    timeout: options.timeoutMs ?? 30_000,
    maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024,
    encoding: options.encoding ?? "utf8",
  });
  return { stdout, stderr };
};

const adb = async (args, options = {}) => run("adb", ["-s", DEVICE_ID, ...args], options);

const shellQuote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;

const assertCondition = (condition, message, details = {}) => {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
};

const parseWebViewSocket = (procNetUnix) => {
  const match = procNetUnix.match(/@?(webview_devtools_remote_\d+)/);
  return match?.[1] ?? null;
};

const connectDevTools = async () => {
  const { stdout } = await adb(["shell", "cat", "/proc/net/unix"]);
  const socket = parseWebViewSocket(stdout);
  assertCondition(socket, "No Android WebView DevTools socket found");
  await adb(["forward", `tcp:${DEVTOOLS_PORT}`, `localabstract:${socket}`]);
  const pages = await fetch(`http://127.0.0.1:${DEVTOOLS_PORT}/json/list`).then((response) => response.json());
  const page = pages.find((candidate) => candidate.webSocketDebuggerUrl);
  assertCondition(page, "No debuggable WebView page found", { pages });
  const webSocket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    webSocket.addEventListener("open", resolve, { once: true });
    webSocket.addEventListener("error", reject, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  webSocket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    const waiter = pending.get(payload.id);
    if (!waiter) return;
    pending.delete(payload.id);
    if (payload.error) {
      waiter.reject(new Error(JSON.stringify(payload.error)));
    } else {
      waiter.resolve(payload.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      webSocket.send(JSON.stringify({ id, method, params }));
    });
  return {
    send,
    close: () => webSocket.close(),
  };
};

const evaluate = async (cdp, expression) => {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(JSON.stringify(result.exceptionDetails));
  }
  return result.result?.value;
};

const waitFor = async (predicate, options = {}) => {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const intervalMs = options.intervalMs ?? 250;
  const deadline = Date.now() + timeoutMs;
  let lastValue;
  while (Date.now() < deadline) {
    lastValue = await predicate();
    if (lastValue) return lastValue;
    await sleep(intervalMs);
  }
  throw new Error(options.message ?? `Timed out after ${timeoutMs}ms`);
};

const pageText = (cdp) => evaluate(cdp, "document.body.innerText");

const getControl = async (cdp, testId) =>
  evaluate(
    cdp,
    `(() => {
      const root = document.querySelector('[data-testid="${testId}"]');
      if (!root) return null;
      root.scrollIntoView({ block: 'center', inline: 'center' });
      const slider = root.querySelector('[role="slider"]');
      const target = slider ?? root;
      const rootRect = root.getBoundingClientRect();
      const rect = target.getBoundingClientRect();
      return {
        checked: root.getAttribute('aria-checked'),
        disabled: root.getAttribute('aria-disabled') ?? root.disabled ?? root.hasAttribute('disabled'),
        max: slider?.getAttribute('aria-valuemax') ?? null,
        min: slider?.getAttribute('aria-valuemin') ?? null,
        rootRect: { x: rootRect.x, y: rootRect.y, width: rootRect.width, height: rootRect.height },
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        text: root.innerText,
        value: slider?.getAttribute('aria-valuenow') ?? root.getAttribute('aria-valuenow') ?? null
      };
    })()`,
  );

const focusSlider = async (cdp, testId) =>
  evaluate(
    cdp,
    `(() => {
      const root = document.querySelector('[data-testid="${testId}"]');
      const slider = root?.querySelector('[role="slider"]');
      if (!root || !slider) return false;
      root.scrollIntoView({ block: 'center', inline: 'center' });
      slider.focus();
      return document.activeElement === slider;
    })()`,
  );

const pressSliderKey = async (cdp, key) => {
  const keyCodes = {
    End: 35,
    Home: 36,
  };
  const keyCode = keyCodes[key];
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    code: key,
    key,
    windowsVirtualKeyCode: keyCode,
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    code: key,
    key,
    windowsVirtualKeyCode: keyCode,
  });
};

const dragSliderToFraction = async (cdp, testId, fraction) => {
  const before = await getControl(cdp, testId);
  assertCondition(before, `Missing slider ${testId}`);
  assertCondition(before.disabled !== "true" && before.disabled !== true, `Slider ${testId} is disabled`, before);
  const min = Number(before.min ?? 0);
  const max = Number(before.max ?? 1);
  assertCondition(max > min, `Slider ${testId} has no usable range`, before);
  const expected = Math.round(min + (max - min) * fraction);
  const focused = await focusSlider(cdp, testId);
  assertCondition(focused, `Slider ${testId} could not receive focus`, before);
  await pressSliderKey(cdp, fraction >= 0.5 ? "End" : "Home");
  const changed = await waitFor(
    async () => {
      const current = await getControl(cdp, testId);
      return current && Number(current.value) === expected ? current : null;
    },
    { timeoutMs: 5_000, message: `Slider ${testId} did not converge to ${expected}` },
  );
  return { before, after: changed, expected };
};

const toggleCheckbox = async (cdp, testId) => {
  const before = await getControl(cdp, testId);
  assertCondition(before, `Missing checkbox ${testId}`);
  assertCondition(before.disabled !== "true" && before.disabled !== true, `Checkbox ${testId} is disabled`, before);
  await evaluate(cdp, `document.querySelector('[data-testid="${testId}"]')?.click()`);
  const after = await waitFor(
    async () => {
      const current = await getControl(cdp, testId);
      return current && current.checked !== before.checked ? current : null;
    },
    { timeoutMs: 5_000, message: `Checkbox ${testId} did not toggle` },
  );
  return { before, after };
};

const tapButton = async (cdp, testId) => {
  const control = await getControl(cdp, testId);
  assertCondition(control, `Missing button ${testId}`);
  await evaluate(cdp, `document.querySelector('[data-testid="${testId}"]')?.click()`);
  return control;
};

const readHostInfo = async () => {
  const response = await fetch(`http://${C64U_HOST}/v1/info`, { signal: AbortSignal.timeout(5_000) });
  assertCondition(response.ok, `Host ${C64U_HOST} /v1/info returned HTTP ${response.status}`);
  return response.json();
};

const dismissAndroidCompatibilityDialog = async () => {
  const dump = await adb([
    "shell",
    "uiautomator dump /sdcard/c64u-window.xml >/dev/null && cat /sdcard/c64u-window.xml",
  ]);
  if (!dump.stdout.includes("Android app compatibility")) return false;
  if (dump.stdout.includes("Don&apos;t show again") || dump.stdout.includes("Don't show again")) {
    await adb(["shell", "input", "tap", "730", "1715"]);
  } else {
    await adb(["shell", "input", "tap", "520", "1715"]);
  }
  await sleep(750);
  return true;
};

const resetAppForRealSmokeRun = async () => {
  const payload = JSON.stringify({
    debugLogging: true,
    featureFlags: { hvsc_enabled: true },
    host: C64U_HOST,
    readOnly: false,
    target: "real",
  });
  await adb(["shell", "am", "force-stop", APP_ID]);
  await adb(["shell", "pm", "clear", APP_ID]);
  const writeCommand = `run-as ${APP_ID} sh -c ${shellQuote(
    `mkdir -p files && printf %s ${shellQuote(payload)} > files/c64u-smoke.json`,
  )}`;
  await adb(["shell", writeCommand]);
};

const main = async () => {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const startedAt = new Date().toISOString();
  const hostInfo = await readHostInfo();

  await resetAppForRealSmokeRun();
  await adb(["shell", "am", "start", "-n", `${APP_ID}/.MainActivity`]);
  await sleep(1_000);
  await dismissAndroidCompatibilityDialog();
  await adb(["logcat", "-c"]);
  await sleep(1_000);
  const cdp = await connectDevTools();
  const evidence = {
    appId: APP_ID,
    c64uHost: C64U_HOST,
    deviceId: DEVICE_ID,
    hostInfo,
    startedAt,
    steps: [],
  };

  try {
    await waitFor(async () => {
      const text = await pageText(cdp);
      return text.includes("C64U") && text.includes("HEALTHY") && text.includes("c64u") ? text : null;
    });
    const initialText = await pageText(cdp);
    assertCondition(!initialText.includes("DEMO ACTIVE"), "App fell back to demo mode", { initialText });
    evidence.steps.push({ name: "initial-online-health", status: "passed" });

    const cpuSlider = await getControl(cdp, "home-cpu-speed-slider");
    evidence.steps.push({
      name: "home-cpu-speed-slider-capability",
      status: cpuSlider?.disabled === "true" ? "blocked-by-c64u-firmware-single-option" : "available",
      value: cpuSlider?.value,
      max: cpuSlider?.max,
      min: cpuSlider?.min,
    });

    const sliderResults = [];
    for (const fraction of [1, 0, 1, 0, 1, 0]) {
      sliderResults.push(await dragSliderToFraction(cdp, "home-led-intensity-slider", fraction));
    }
    const originalSliderValue = Number(sliderResults[0].before.value);
    evidence.steps.push({
      name: "repeated-slider-soak-home-led-intensity",
      iterations: sliderResults.length,
      status: "passed",
      finalValue: (await getControl(cdp, "home-led-intensity-slider")).value,
      originalValue: String(originalSliderValue),
    });

    const checkboxResults = [];
    for (let index = 0; index < 8; index += 1) {
      checkboxResults.push(await toggleCheckbox(cdp, "home-video-scanlines"));
    }
    evidence.steps.push({
      name: "repeated-checkbox-soak-home-video-scanlines",
      iterations: checkboxResults.length,
      status: "passed",
      finalChecked: (await getControl(cdp, "home-video-scanlines")).checked,
      originalChecked: checkboxResults[0].before.checked,
    });

    for (let index = 0; index < 5; index += 1) {
      await tapButton(cdp, "tab-config");
      await waitFor(async () => ((await pageText(cdp)).includes("Config") ? true : null));
      await tapButton(cdp, "tab-home");
      await waitFor(async () => ((await pageText(cdp)).includes("HEALTHY") ? true : null));
    }
    evidence.steps.push({ name: "navigation-buttons-under-device-load", iterations: 10, status: "passed" });

    await waitFor(async () => {
      const text = await pageText(cdp);
      return text.includes("C64U") && text.includes("HEALTHY") && text.includes("c64u") ? text : null;
    });
    const finalText = await pageText(cdp);
    assertCondition(!finalText.includes("No categories available"), "Config categories were lost after soak", {
      finalText,
    });
    evidence.steps.push({ name: "final-online-health-and-config-present", status: "passed" });

    const logcat = await adb(["logcat", "-d"], { timeoutMs: 30_000, maxBuffer: 32 * 1024 * 1024 });
    await writeFile(LOGCAT_PATH, logcat.stdout);
    const nativeC64uRequests = logcat.stdout
      .split("\n")
      .filter((line) => line.includes("C64U_HTTP") && line.includes(`http://${C64U_HOST}`));
    const failures = logcat.stdout
      .split("\n")
      .filter((line) => /C64U_HTTP_FAILURE|C64U_HOME_CPU_SPEED_SLIDER_REST_FAILED|Host unreachable/i.test(line));
    assertCondition(
      nativeC64uRequests.length > 0,
      "No native Capacitor/WebView requests to c64u were observed in logcat",
    );
    assertCondition(nativeC64uRequests.length < 200, "Native request count exceeded the HIL soak safety budget", {
      nativeC64uRequestCount: nativeC64uRequests.length,
    });
    assertCondition(failures.length === 0, "Native logcat contained C64U HTTP failures", { failures });
    evidence.nativeC64uRequestCount = nativeC64uRequests.length;

    await adb(["exec-out", "screencap", "-p"], { encoding: "buffer" }).then(({ stdout }) =>
      writeFile(SCREENSHOT_PATH, stdout),
    );
    evidence.completedAt = new Date().toISOString();
    evidence.result = "PASS";
    evidence.artifacts = { logcat: LOGCAT_PATH, screenshot: SCREENSHOT_PATH };
    await writeFile(RESULT_PATH, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(JSON.stringify(evidence, null, 2));
  } catch (error) {
    evidence.completedAt = new Date().toISOString();
    evidence.result = "FAIL";
    evidence.error = {
      message: error instanceof Error ? error.message : String(error),
      details: error instanceof Error ? error.details : undefined,
    };
    await writeFile(RESULT_PATH, `${JSON.stringify(evidence, null, 2)}\n`);
    throw error;
  } finally {
    cdp.close();
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
