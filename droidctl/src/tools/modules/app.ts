/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { ToolExecutionError, ToolValidationError } from "../errors.js";
import {
  defineExecute,
  delay,
  expectSuccess,
  packageField,
  packageSchema,
  resolveTarget,
  shellQuote,
  targetIdField,
  targetIdSchema,
} from "../common.js";
import { defineToolModule } from "../types.js";

const installSchema = z
  .object({
    targetId: targetIdSchema,
    package: packageSchema,
    apkPath: z.string().min(1),
    reinstall: z.boolean().optional(),
    allowDowngrade: z.boolean().optional(),
    grantPermissions: z.boolean().optional(),
    allowTestPackages: z.boolean().optional(),
  })
  .strict();

const packageOnlySchema = z.object({ targetId: targetIdSchema, package: packageSchema }).strict();

const uninstallSchema = z
  .object({ targetId: targetIdSchema, package: packageSchema, tolerateMissing: z.boolean().optional() })
  .strict();

const startAppSchema = z
  .object({
    targetId: targetIdSchema,
    package: packageSchema,
    activity: z.string().min(1).optional(),
    waitForResume: z.boolean().optional(),
    resumeTimeoutMs: z.number().int().positive().optional(),
    viaLauncherIntent: z.boolean().optional(),
  })
  .strict();

const clearSchema = z.object({ targetId: targetIdSchema, package: packageSchema, confirm: z.literal(true) }).strict();

const writeFileSchema = z
  .object({
    targetId: targetIdSchema,
    package: packageSchema,
    relativePath: z.string().min(1),
    content: z.string(),
  })
  .strict();

const readFileSchema = z
  .object({
    targetId: targetIdSchema,
    package: packageSchema,
    relativePath: z.string().min(1),
    maxBytes: z.number().int().positive().optional(),
  })
  .strict();

/** run-as only reaches the app's own sandbox; a path that leaves files/ is rejected before the call. */
export function resolveAppFilePath(relativePath: string): string {
  const normalized = relativePath.replace(/^\/+/, "");
  if (normalized.length === 0 || normalized.split("/").some((segment) => segment === ".." || segment === ".")) {
    throw new ToolValidationError(
      `relativePath ${JSON.stringify(relativePath)} must stay inside the application's files/ directory.`,
      { details: { relativePath } },
    );
  }
  return normalized.startsWith("files/") ? normalized : `files/${normalized}`;
}

/**
 * Budgets are in bytes, and a plain string slice counts UTF-16 units, so it
 * overshoots on multi-byte text. Cutting the buffer instead can split a
 * character, so the cut is moved back to the last boundary at or under the cap.
 */
export function truncateUtf8(payload: Buffer, maxBytes: number): Buffer {
  if (payload.length <= maxBytes) {
    return payload;
  }
  let end = maxBytes;
  while (end > 0 && (payload[end]! & 0xc0) === 0x80) {
    end -= 1;
  }
  return payload.subarray(0, end);
}

function detectRunAsRefusal(stdout: string, stderr: string): string | null {
  const combined = `${stdout}\n${stderr}`;
  const refusal = /run-as:.*|Package '[^']+' is not debuggable|Could not set capabilities|unknown package/i.exec(
    combined,
  );
  return refusal ? refusal[0].trim() : null;
}

export const appModule = defineToolModule({
  domain: "droid_app",
  summary: "Install, remove, launch, stop and configure the application under test.",
  tools: [
    {
      name: "droid_app.install_app",
      description:
        "Install an APK and verify with pm list packages that the named package is present afterwards. A signature " +
        "mismatch (INSTALL_FAILED_UPDATE_INCOMPATIBLE) is reported with the uninstall-first remedy.",
      inputSchema: {
        type: "object",
        properties: {
          targetId: targetIdField,
          package: packageField,
          apkPath: { type: "string", description: "Path to the APK on this machine." },
          reinstall: { type: "boolean", description: "Pass -r. Default true." },
          allowDowngrade: { type: "boolean", description: "Pass -d." },
          grantPermissions: { type: "boolean", description: "Pass -g." },
          allowTestPackages: { type: "boolean", description: "Pass -t." },
        },
        required: ["targetId", "package", "apkPath"],
        additionalProperties: false,
      },
      argsSchema: installSchema,
      execute: defineExecute(installSchema, async (args, ctx) => {
        const handle = await resolveTarget(ctx, args.targetId);
        let apkBytes: Buffer;
        try {
          apkBytes = await readFile(args.apkPath);
        } catch (error) {
          throw new ToolExecutionError(
            `APK not found at ${args.apkPath}: ${error instanceof Error ? error.message : String(error)}`,
            { details: { apkPath: args.apkPath } },
          );
        }

        const install = await handle.transport.installPackage(handle.target, args.apkPath, {
          ...(args.reinstall === undefined ? {} : { reinstall: args.reinstall }),
          ...(args.allowDowngrade === undefined ? {} : { allowDowngrade: args.allowDowngrade }),
          ...(args.grantPermissions === undefined ? {} : { grantPermissions: args.grantPermissions }),
          ...(args.allowTestPackages === undefined ? {} : { allowTestPackages: args.allowTestPackages }),
        });

        const output = `${install.stdout}\n${install.stderr}`;
        if (install.signatureMismatch) {
          throw new ToolExecutionError(
            `Install of ${args.package} was refused as INSTALL_FAILED_UPDATE_INCOMPATIBLE: the installed copy was ` +
              `signed with a different key. Call droid_app.uninstall_app for ${args.package} first, then install again.`,
            { details: { package: args.package, stdout: install.stdout, stderr: install.stderr } },
          );
        }
        if (!install.installed) {
          throw new ToolExecutionError(`Install of ${args.apkPath} failed: ${output.trim()}`, {
            details: { exitCode: install.exitCode, stdout: install.stdout, stderr: install.stderr },
          });
        }

        const verify = await handle.transport.exec(handle.target, ["pm", "list", "packages", args.package]);
        if (!verify.stdout.split(/\r?\n/).some((line) => line.trim() === `package:${args.package}`)) {
          throw new ToolExecutionError(
            `adb reported a successful install but pm list packages does not show ${args.package}.`,
            { details: { package: args.package, stdout: verify.stdout } },
          );
        }

        return {
          installed: true,
          package: args.package,
          apkSha256: createHash("sha256").update(apkBytes).digest("hex"),
        };
      }),
    },
    {
      name: "droid_app.uninstall_app",
      description: "Uninstall a package. With tolerateMissing, a package that was not installed is not an error.",
      inputSchema: {
        type: "object",
        properties: {
          targetId: targetIdField,
          package: packageField,
          tolerateMissing: { type: "boolean", description: "Treat an absent package as success." },
        },
        required: ["targetId", "package"],
        additionalProperties: false,
      },
      argsSchema: uninstallSchema,
      execute: defineExecute(uninstallSchema, async (args, ctx) => {
        const handle = await resolveTarget(ctx, args.targetId);
        const result = await handle.transport.exec(handle.target, ["pm", "uninstall", args.package]);
        const output = `${result.stdout}\n${result.stderr}`;
        if (/Success/.test(output)) {
          return { uninstalled: true, package: args.package };
        }
        if (args.tolerateMissing && /not installed|Unknown package|DELETE_FAILED_INTERNAL_ERROR/i.test(output)) {
          return { uninstalled: false, package: args.package, tolerated: true };
        }
        throw new ToolExecutionError(`Uninstall of ${args.package} failed: ${output.trim()}`, {
          details: { package: args.package, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr },
        });
      }),
    },
    {
      name: "droid_app.start_app",
      description:
        "Launch the application, by explicit activity with am start -W, or through the launcher intent. Returns the " +
        "resumed activity and, when am start reported it, the measured total start time.",
      inputSchema: {
        type: "object",
        properties: {
          targetId: targetIdField,
          package: packageField,
          activity: { type: "string", description: "Activity name, e.g. .MainActivity. Default .MainActivity." },
          waitForResume: { type: "boolean", description: "Poll dumpsys until the package is the resumed activity." },
          resumeTimeoutMs: { type: "number", description: "Deadline for that poll in milliseconds. Default 15000." },
          viaLauncherIntent: {
            type: "boolean",
            description: "Use monkey with the LAUNCHER category instead of am start.",
          },
        },
        required: ["targetId", "package"],
        additionalProperties: false,
      },
      argsSchema: startAppSchema,
      execute: defineExecute(startAppSchema, async (args, ctx) => {
        const handle = await resolveTarget(ctx, args.targetId);
        let totalTimeMs: number | null = null;

        if (args.viaLauncherIntent) {
          const result = await handle.transport.exec(handle.target, [
            "monkey",
            "-p",
            args.package,
            "-c",
            "android.intent.category.LAUNCHER",
            "1",
          ]);
          expectSuccess(result, `monkey launch of ${args.package}`);
        } else {
          const activity = args.activity ?? ".MainActivity";
          const result = await handle.transport.exec(handle.target, [
            "am",
            "start",
            "-W",
            "-n",
            `${args.package}/${activity}`,
          ]);
          expectSuccess(result, `am start of ${args.package}/${activity}`);
          if (/Error:/.test(result.stdout)) {
            throw new ToolExecutionError(`am start reported an error: ${result.stdout.trim()}`, {
              details: { package: args.package, activity, stdout: result.stdout },
            });
          }
          const total = /TotalTime:\s*(\d+)/.exec(result.stdout);
          totalTimeMs = total ? Number(total[1]) : null;
        }

        /*
         * `am start -W` returns when the activity is launched, which on a WebView
         * app precedes the window actually resuming, so a single read races a
         * cold start.
         */
        const deadline = Date.now() + (args.waitForResume ? (args.resumeTimeoutMs ?? 15_000) : 0);
        let resumedActivity: string | null = null;
        for (;;) {
          const activities = await handle.transport.exec(handle.target, ["dumpsys", "activity", "activities"]);
          resumedActivity =
            /(?:ResumedActivity|mResumedActivity)[^\n]*?([A-Za-z0-9_.]+\/[A-Za-z0-9_.$]+)/.exec(
              activities.stdout,
            )?.[1] ?? null;
          if (resumedActivity?.startsWith(`${args.package}/`) || Date.now() >= deadline) {
            break;
          }
          await delay(250);
        }

        if (args.waitForResume && (resumedActivity === null || !resumedActivity.startsWith(`${args.package}/`))) {
          throw new ToolExecutionError(
            `${args.package} is not the resumed activity after launch (resumed: ${resumedActivity ?? "none"}).`,
            { details: { package: args.package, resumedActivity } },
          );
        }

        return { launched: true, package: args.package, resumedActivity, totalTimeMs };
      }),
    },
    {
      name: "droid_app.stop_app",
      description: "Force-stop the application.",
      inputSchema: {
        type: "object",
        properties: { targetId: targetIdField, package: packageField },
        required: ["targetId", "package"],
        additionalProperties: false,
      },
      argsSchema: packageOnlySchema,
      execute: defineExecute(packageOnlySchema, async (args, ctx) => {
        const handle = await resolveTarget(ctx, args.targetId);
        const result = await handle.transport.exec(handle.target, ["am", "force-stop", args.package]);
        expectSuccess(result, `am force-stop of ${args.package}`);
        return { stopped: true, package: args.package };
      }),
    },
    {
      name: "droid_app.clear_app_data",
      description:
        "Clear the application's data with pm clear. Requires confirm: true, because it is the only tool here that " +
        "destroys state on a device somebody else may be using.",
      inputSchema: {
        type: "object",
        properties: {
          targetId: targetIdField,
          package: packageField,
          confirm: {
            type: "boolean",
            enum: [true],
            description: "Must be true. Second explicit act before data loss.",
          },
        },
        required: ["targetId", "package", "confirm"],
        additionalProperties: false,
      },
      argsSchema: clearSchema,
      execute: defineExecute(clearSchema, async (args, ctx) => {
        const handle = await resolveTarget(ctx, args.targetId);
        const result = await handle.transport.exec(handle.target, ["pm", "clear", args.package]);
        if (!/Success/.test(`${result.stdout}\n${result.stderr}`)) {
          throw new ToolExecutionError(
            `pm clear of ${args.package} failed: ${`${result.stdout} ${result.stderr}`.trim()}`,
            {
              details: {
                package: args.package,
                exitCode: result.exitCode,
                stdout: result.stdout,
                stderr: result.stderr,
              },
            },
          );
        }
        return { cleared: true, package: args.package };
      }),
    },
    {
      name: "droid_app.write_app_file",
      description:
        "Write a file into the application's private files/ directory through run-as. This is how the app is " +
        "configured before launch. A run-as refusal on a non-debuggable build is reported rather than read as success.",
      inputSchema: {
        type: "object",
        properties: {
          targetId: targetIdField,
          package: packageField,
          relativePath: { type: "string", description: "Path under the app's files/ directory. May not escape it." },
          content: { type: "string", description: "File content, sent on stdin." },
        },
        required: ["targetId", "package", "relativePath", "content"],
        additionalProperties: false,
      },
      argsSchema: writeFileSchema,
      execute: defineExecute(writeFileSchema, async (args, ctx) => {
        const handle = await resolveTarget(ctx, args.targetId);
        const target = resolveAppFilePath(args.relativePath);
        const directory = target.includes("/") ? target.slice(0, target.lastIndexOf("/")) : "files";
        const result = await handle.transport.exec(
          handle.target,
          ["run-as", args.package, "sh", "-c", `mkdir -p ${shellQuote(directory)} && cat > ${shellQuote(target)}`],
          { stdin: args.content },
        );

        const refusal = detectRunAsRefusal(result.stdout, result.stderr);
        if (refusal || result.exitCode !== 0) {
          throw new ToolExecutionError(
            `run-as write to ${args.package}:${target} failed: ${refusal ?? (result.stderr.trim() || "non-zero exit")}`,
            { details: { package: args.package, path: target, exitCode: result.exitCode, stderr: result.stderr } },
          );
        }

        return { bytesWritten: Buffer.byteLength(args.content, "utf8"), path: target, package: args.package };
      }),
    },
    {
      name: "droid_app.read_app_file",
      description: "Read a file back out of the application's private files/ directory through run-as.",
      inputSchema: {
        type: "object",
        properties: {
          targetId: targetIdField,
          package: packageField,
          relativePath: { type: "string", description: "Path under the app's files/ directory. May not escape it." },
          maxBytes: { type: "number", description: "Truncate the returned content to this many bytes." },
        },
        required: ["targetId", "package", "relativePath"],
        additionalProperties: false,
      },
      argsSchema: readFileSchema,
      execute: defineExecute(readFileSchema, async (args, ctx) => {
        const handle = await resolveTarget(ctx, args.targetId);
        const target = resolveAppFilePath(args.relativePath);
        const result = await handle.transport.exec(handle.target, [
          "run-as",
          args.package,
          "sh",
          "-c",
          `cat ${shellQuote(target)}`,
        ]);

        const refusal = detectRunAsRefusal(result.stdout, result.stderr);
        if (refusal || result.exitCode !== 0) {
          throw new ToolExecutionError(
            `run-as read of ${args.package}:${target} failed: ${refusal ?? (result.stderr.trim() || "non-zero exit")}`,
            { details: { package: args.package, path: target, exitCode: result.exitCode, stderr: result.stderr } },
          );
        }

        const full = Buffer.from(result.stdout, "utf8");
        const clipped = args.maxBytes === undefined ? full : truncateUtf8(full, args.maxBytes);
        return {
          content: clipped.toString("utf8"),
          bytes: clipped.length,
          totalBytes: full.length,
          truncated: clipped.length < full.length,
          path: target,
        };
      }),
    },
  ],
});
