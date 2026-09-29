/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The HIL harnesses' only way to reach the phone: droidctl, run in process.
 *
 * AGENTS.md makes droidctl the interface for every device operation. It carries the explicit
 * target on every call and refuses to guess when several devices are attached, which a bare
 * `adb` invocation does not. droidctl/dist is a build artifact, so it is loaded lazily with a
 * message that names the build step.
 */

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const loadDroidctl = async () => {
  try {
    return await import(path.join(REPO, "droidctl", "dist", "server.js"));
  } catch (error) {
    throw new Error(
      `Unable to load droidctl; run "npm run droid:build" first. Underlying error: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
};

/**
 * Picks the target for `serial`, or the only physical device, or the only `9B0` Pixel — the same
 * preference `./build` applies — and refuses anything ambiguous.
 */
export const chooseTarget = (targets, serial) => {
  const online = targets.filter((target) => target.state === "device");
  if (serial) {
    const match = online.find((target) => target.serial === serial);
    if (!match)
      throw new Error(`device ${serial} is not attached (attached: ${online.map((t) => t.serial).join(", ")})`);
    return match;
  }
  const physical = online.filter((target) => !target.isEmulator);
  if (physical.length === 1) return physical[0];
  const pixels = physical.filter((target) => target.serial.startsWith("9B0"));
  if (pixels.length === 1) return pixels[0];
  if (online.length === 0) throw new Error("no Android device attached");
  if (physical.length === 0) {
    throw new Error(
      `only an emulator is attached (${online.map((t) => t.serial).join(", ")}); pass --serial to use it`,
    );
  }
  throw new Error(`several devices attached (${online.map((t) => t.serial).join(", ")}); pass --serial`);
};

export const createDroidDevice = async ({ serial, artifactRoot } = {}) => {
  const { createDroidctlServerRuntime } = await loadDroidctl();
  const runtime = createDroidctlServerRuntime(
    artifactRoot ? { artifactRoot } : { artifactRoot: path.join(REPO, "artifacts", "droidctl-runs") },
  );

  const call = async (name, args) => {
    const result = await runtime.toolRegistry.invoke(name, args);
    const envelope = JSON.parse(result.content[0].text);
    if (!envelope.ok) {
      throw new Error(`${name} failed [${envelope.error?.code}]: ${envelope.error?.message}`);
    }
    return envelope.data;
  };

  const { targets } = await call("droid_target.list_targets", {});
  const target = chooseTarget(targets, serial ?? process.env.ANDROID_SERIAL);
  const targetId = target.targetId;

  /** Runs an argument vector on the device and returns its stdout, like `adb shell` did. */
  const shell = async (argv, { timeoutMs } = {}) => {
    const data = await call("droid_device.run_shell", {
      targetId,
      command: argv,
      ...(timeoutMs ? { timeoutMs } : {}),
    });
    if (data.exitCode !== 0) {
      throw new Error(`"${argv.join(" ")}" exited ${data.exitCode}: ${String(data.stderr).trim()}`);
    }
    return data.stdout;
  };

  return {
    serial: target.serial,
    targetId,
    call,
    shell,
    describe: () => call("droid_target.describe_target", { targetId }),
    pressKey: (keycode, { longPress = false, repeat } = {}) =>
      call("droid_input.press_key", {
        targetId,
        keycode,
        ...(longPress ? { longPress } : {}),
        ...(repeat ? { repeat } : {}),
      }),
    tap: ({ x, y }) => call("droid_input.tap", { targetId, x: Number(x), y: Number(y) }),
    swipe: ({ x1, y1, x2, y2, durationMs }) =>
      call("droid_input.swipe", { targetId, x1, y1, x2, y2, ...(durationMs ? { durationMs } : {}) }),
    forwardWebview: (pkg, localPort) => call("droid_device.forward_webview", { targetId, package: pkg, localPort }),
  };
};
