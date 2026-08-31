/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { stat } from "node:fs/promises";
import { z } from "zod";
import { describeTarget } from "../../deviceInfo.js";
import type { ResolvedTargetHandle } from "../../transport/registry.js";
import { ToolExecutionError } from "../errors.js";
import {
  defineExecute,
  delay,
  packageField,
  packageSchema,
  resolveTarget,
  targetIdField,
  targetIdSchema,
} from "../common.js";
import { defineToolModule } from "../types.js";

const ANIMATION_SCALES = ["window_animation_scale", "transition_animation_scale", "animator_duration_scale"] as const;

const prepareSchema = z
  .object({
    targetId: targetIdSchema,
    waitForBoot: z.boolean().optional(),
    dismissKeyguard: z.boolean().optional(),
    stayOn: z.enum(["usb", "false"]).optional(),
    disableAnimations: z.boolean().optional(),
    requireNativeGeometry: z.boolean().optional(),
    timeoutMs: z.number().int().positive().optional(),
  })
  .strict();

const runShellSchema = z
  .object({
    targetId: targetIdSchema,
    command: z.array(z.string()).min(1),
    timeoutMs: z.number().int().positive().optional(),
    maxBytes: z.number().int().positive().optional(),
    stdin: z.string().optional(),
  })
  .strict();

const forwardSchema = z
  .object({
    targetId: targetIdSchema,
    package: packageSchema,
    localPort: z.number().int().min(1).max(65535),
    replaceExisting: z.boolean().optional(),
  })
  .strict();

const pushSchema = z
  .object({ targetId: targetIdSchema, localPath: z.string().min(1), remotePath: z.string().min(1) })
  .strict();

const pullSchema = z
  .object({ targetId: targetIdSchema, remotePath: z.string().min(1), localPath: z.string().min(1) })
  .strict();

export function parseWebviewSockets(procNetUnix: string, pids: readonly string[]): string[] {
  const sockets = new Set<string>();
  for (const line of procNetUnix.split(/\r?\n/)) {
    const match = /@?(webview_devtools_remote_(\d+))\s*$/.exec(line.trim());
    if (match && pids.includes(match[2]!)) {
      sockets.add(match[1]!);
    }
  }
  return [...sockets];
}

/**
 * Both application ids can be installed at once and both open a DevTools socket;
 * taking the first one attaches to the wrong application, whose audio track may
 * still be running. pidof first, /proc/net/unix when pidof is ambiguous.
 */
export async function resolveWebviewSocket(handle: ResolvedTargetHandle, appPackage: string): Promise<string> {
  const pidof = await handle.transport.exec(handle.target, ["pidof", appPackage]);
  const pids = pidof.stdout
    .trim()
    .split(/\s+/)
    .filter((value) => /^\d+$/.test(value));

  if (pids.length === 0) {
    throw new ToolExecutionError(`${appPackage} is not running, so it has no WebView DevTools socket.`, {
      details: { package: appPackage },
    });
  }
  if (pids.length === 1) {
    return `webview_devtools_remote_${pids[0]}`;
  }

  const unix = await handle.transport.exec(handle.target, ["cat", "/proc/net/unix"]);
  const sockets = parseWebviewSockets(unix.stdout, pids);
  if (sockets.length === 1) {
    return sockets[0]!;
  }
  throw new ToolExecutionError(
    `${appPackage} resolved to ${pids.length} pids and ${sockets.length} DevTools sockets; refusing to guess.`,
    { details: { package: appPackage, pids, sockets } },
  );
}

export const deviceModule = defineToolModule({
  domain: "droid_device",
  summary: "Device readiness, raw shell access, port forwarding and file transfer.",
  tools: [
    {
      name: "droid_device.prepare_device",
      description:
        "Bring a device to a state a test can run against: booted, unlocked, awake, optionally with animations off, " +
        "and report the resumed activity, focused window and any wm size or wm density override.",
      inputSchema: {
        type: "object",
        properties: {
          targetId: targetIdField,
          waitForBoot: { type: "boolean", description: "Poll sys.boot_completed. Default true." },
          dismissKeyguard: { type: "boolean", description: "Run wm dismiss-keyguard. Default true." },
          stayOn: { type: "string", enum: ["usb", "false"], description: "svc power stayon setting." },
          disableAnimations: { type: "boolean", description: "Set the three global animation scales to 0." },
          requireNativeGeometry: {
            type: "boolean",
            description:
              "Fail when wm size or wm density reports an override. A leftover small-screen override fails input and " +
              "clarity checks with no code fault at all.",
          },
          timeoutMs: { type: "number", description: "Deadline for the boot wait. Default 120000." },
        },
        required: ["targetId"],
        additionalProperties: false,
      },
      argsSchema: prepareSchema,
      execute: defineExecute(prepareSchema, async (args, ctx) => {
        const handle = await resolveTarget(ctx, args.targetId);
        const timeoutMs = args.timeoutMs ?? 120_000;

        let bootCompleted = false;
        if (args.waitForBoot !== false) {
          const deadline = Date.now() + timeoutMs;
          while (Date.now() < deadline) {
            const probe = await handle.transport.exec(handle.target, ["getprop", "sys.boot_completed"]);
            if (probe.stdout.trim() === "1") {
              bootCompleted = true;
              break;
            }
            await delay(1_000);
          }
          if (!bootCompleted) {
            throw new ToolExecutionError(`${args.targetId} did not report sys.boot_completed within ${timeoutMs} ms.`, {
              code: "timeout",
              details: { targetId: args.targetId, timeoutMs },
            });
          }
        } else {
          const probe = await handle.transport.exec(handle.target, ["getprop", "sys.boot_completed"]);
          bootCompleted = probe.stdout.trim() === "1";
        }

        if (args.dismissKeyguard !== false) {
          await handle.transport.exec(handle.target, ["wm", "dismiss-keyguard"]);
        }
        if (args.stayOn) {
          await handle.transport.exec(handle.target, ["svc", "power", "stayon", args.stayOn]);
        }

        const animationScales: Record<string, string> = {};
        if (args.disableAnimations) {
          for (const setting of ANIMATION_SCALES) {
            await handle.transport.exec(handle.target, ["settings", "put", "global", setting, "0"]);
          }
        }
        for (const setting of ANIMATION_SCALES) {
          const read = await handle.transport.exec(handle.target, ["settings", "get", "global", setting]);
          animationScales[setting] = read.stdout.trim();
        }

        const policy = await handle.transport.exec(handle.target, ["dumpsys", "window", "policy"]);
        const keyguardShowing = /mShowing=true|isKeyguardShowing=true|KeyguardShowing=true/.test(policy.stdout);

        const windows = await handle.transport.exec(handle.target, ["dumpsys", "window"]);
        const focusedWindow = /mCurrentFocus=[^\s]*\s+[^\s]+\s+([^\s}]+)/.exec(windows.stdout)?.[1] ?? null;

        const activities = await handle.transport.exec(handle.target, ["dumpsys", "activity", "activities"]);
        const resumedActivity =
          /(?:ResumedActivity|mResumedActivity)[^\n]*?([A-Za-z0-9_.]+\/[A-Za-z0-9_.$]+)/.exec(activities.stdout)?.[1] ??
          null;

        const description = await describeTarget(handle.transport, handle.target, handle.info);
        if (args.requireNativeGeometry && (description.sizeOverride || description.densityOverride)) {
          throw new ToolExecutionError(
            `${args.targetId} is running under a display override (size=${description.sizeOverride ?? "none"}, ` +
              `density=${description.densityOverride ?? "none"}). Run "wm size reset" and "wm density reset", relaunch ` +
              "the application and re-create any port forward before measuring.",
            { details: { sizeOverride: description.sizeOverride, densityOverride: description.densityOverride } },
          );
        }

        return {
          bootCompleted,
          keyguardShowing,
          stayOn: args.stayOn ?? null,
          sizeOverride: description.sizeOverride,
          densityOverride: description.densityOverride,
          resumedActivity,
          focusedWindow,
          animationScales,
        };
      }),
    },
    {
      name: "droid_device.run_shell",
      description:
        "Run an arbitrary command on the device. command is an argument array, so no shell line is built by " +
        "concatenation. The escape hatch for operations that have no typed tool, not a substitute for the typed ones.",
      inputSchema: {
        type: "object",
        properties: {
          targetId: targetIdField,
          command: { type: "array", items: { type: "string" }, description: "Argument vector, not a shell string." },
          timeoutMs: { type: "number", description: "Per-call deadline. Default 30000." },
          maxBytes: { type: "number", description: "Cap on captured stdout." },
          stdin: { type: "string", description: "Sent to the command's standard input." },
        },
        required: ["targetId", "command"],
        additionalProperties: false,
      },
      argsSchema: runShellSchema,
      execute: defineExecute(runShellSchema, async (args, ctx) => {
        const handle = await resolveTarget(ctx, args.targetId);
        const result = await handle.transport.exec(handle.target, args.command, {
          ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs }),
          ...(args.maxBytes === undefined ? {} : { maxBytes: args.maxBytes }),
          ...(args.stdin === undefined ? {} : { stdin: args.stdin }),
        });
        return {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          truncated: result.truncated,
        };
      }),
    },
    {
      name: "droid_device.forward_webview",
      description:
        "Forward a local TCP port to the named application's WebView DevTools socket. The package is required because " +
        "two application ids can be installed at once and both open a socket. Every rebuild invalidates the forward.",
      inputSchema: {
        type: "object",
        properties: {
          targetId: targetIdField,
          package: packageField,
          localPort: { type: "number", description: "Local TCP port to bind." },
          replaceExisting: {
            type: "boolean",
            description: "Remove an existing forward on that port first. Default true.",
          },
        },
        required: ["targetId", "package", "localPort"],
        additionalProperties: false,
      },
      argsSchema: forwardSchema,
      execute: defineExecute(forwardSchema, async (args, ctx) => {
        const handle = await resolveTarget(ctx, args.targetId);
        const socket = await resolveWebviewSocket(handle, args.package);
        if (args.replaceExisting !== false) {
          await handle.transport.removeForward(handle.target, args.localPort);
        }
        await handle.transport.forwardPort(handle.target, args.localPort, `localabstract:${socket}`);
        const pid = /_(\d+)$/.exec(socket)?.[1] ?? null;
        return { localPort: args.localPort, socket, pid, package: args.package };
      }),
    },
    {
      name: "droid_device.push_file",
      description: "Copy a local file onto the device.",
      inputSchema: {
        type: "object",
        properties: {
          targetId: targetIdField,
          localPath: { type: "string" },
          remotePath: { type: "string" },
        },
        required: ["targetId", "localPath", "remotePath"],
        additionalProperties: false,
      },
      argsSchema: pushSchema,
      execute: defineExecute(pushSchema, async (args, ctx) => {
        const handle = await resolveTarget(ctx, args.targetId);
        try {
          await stat(args.localPath);
        } catch {
          throw new ToolExecutionError(`Nothing to push: ${args.localPath} does not exist.`, {
            details: { localPath: args.localPath },
          });
        }
        const bytes = await handle.transport.pushFile(handle.target, args.localPath, args.remotePath);
        return { bytes, remotePath: args.remotePath };
      }),
    },
    {
      name: "droid_device.pull_file",
      description: "Copy a file off the device to a local path.",
      inputSchema: {
        type: "object",
        properties: {
          targetId: targetIdField,
          remotePath: { type: "string" },
          localPath: { type: "string" },
        },
        required: ["targetId", "remotePath", "localPath"],
        additionalProperties: false,
      },
      argsSchema: pullSchema,
      execute: defineExecute(pullSchema, async (args, ctx) => {
        const handle = await resolveTarget(ctx, args.targetId);
        const bytes = await handle.transport.pullFile(handle.target, args.remotePath, args.localPath);
        return { bytes, localPath: args.localPath };
      }),
    },
  ],
});
