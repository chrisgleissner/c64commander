/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { readFile, unlink } from "node:fs/promises";
import { z } from "zod";
import { assertMp4Signature, assertPngSignature, sanitizeArtifactName } from "../../artifacts.js";
import { describeTarget } from "../../deviceInfo.js";
import { createReviewPng } from "../../png.js";
import type { ResolvedTargetHandle } from "../../transport/registry.js";
import { ToolExecutionError } from "../errors.js";
import { defineExecute, delay, resolveTarget, runRootSchema, targetIdSchema } from "../common.js";
import { defineToolModule, type ToolExecutionContext } from "../types.js";

export const UI_DUMP_DEVICE_PATH = "/sdcard/Download/droidctl-ui.xml";
export const UI_HIERARCHY_ATTEMPTS = 3;
export const UI_HIERARCHY_SETTLE_TIMEOUT_MS = 1_500;
export const UI_HIERARCHY_SETTLE_POLL_MS = 100;
export const UI_HIERARCHY_CALL_TIMEOUT_MS = 30_000;
export const SCREENSHOT_DEVICE_PATH = "/data/local/tmp/droidctl-screencap.png";
export const RECORDING_DEFAULT_TIME_LIMIT_SEC = 180;
export const RECORDING_DEFAULT_BIT_RATE = 6_000_000;
export const LOGCAT_MAX_BYTES = 32 * 1024 * 1024;

const screenshotSchema = z
  .object({
    targetId: targetIdSchema,
    name: z.string().min(1).describe("Artifact base name."),
    reviewWidth: z.number().int().positive().describe("Review width in pixels. Default 480.").optional(),
    maxDimension: z
      .number()
      .int()
      .positive()
      .describe("Hard cap on either review dimension. Default 1999.")
      .optional(),
    runRoot: runRootSchema,
  })
  .strict();

const uiHierarchySchema = z
  .object({
    targetId: targetIdSchema,
    name: z.string().min(1).describe("Artifact base name. Default ui-hierarchy.").optional(),
    settleTimeoutMs: z
      .number()
      .int()
      .positive()
      .describe("How long to wait for the dump file to stop growing.")
      .optional(),
    attempts: z.number().int().positive().describe("Whole-capture attempts before falling back. Default 3.").optional(),
    runRoot: runRootSchema,
  })
  .strict();

const startRecordingSchema = z
  .object({
    targetId: targetIdSchema,
    name: z.string().min(1).describe("Artifact base name for the MP4."),
    timeLimitSec: z.number().int().positive().describe("screenrecord --time-limit. Default 180.").optional(),
    bitRate: z.number().int().positive().describe("screenrecord --bit-rate. Default 6000000.").optional(),
    size: z
      .string()
      .regex(/^\d+x\d+$/)
      .describe("screenrecord --size, as WIDTHxHEIGHT.")
      .optional(),
    runRoot: runRootSchema,
  })
  .strict();

const stopRecordingSchema = z
  .object({
    targetId: targetIdSchema,
    recordingId: z.string().min(1).describe("Handle returned by droid_capture.start_recording."),
  })
  .strict();

const logcatSchema = z
  .object({
    targetId: targetIdSchema,
    mode: z.enum(["dump", "clear"]).describe("clear runs logcat -c; dump runs logcat -d."),
    name: z.string().min(1).describe("Artifact base name for the log. Default logcat.").optional(),
    lines: z.number().int().positive().describe("logcat -t.").optional(),
    format: z.enum(["raw", "brief", "time", "threadtime", "long"]).describe("logcat -v.").optional(),
    package: z.string().min(1).describe("Resolve this package's pid and pass --pid.").optional(),
    tags: z.array(z.string().min(1)).describe("Each becomes -s TAG:I.").optional(),
    filters: z.array(z.string().min(1)).describe("Server-side regular expressions.").optional(),
    requireRuntimeContent: z
      .boolean()
      .describe("Fail when the capture contains no runtime content at all. Default false.")
      .optional(),
    maxBytes: z.number().int().positive().describe("Cap on the captured buffer. Default 32 MiB.").optional(),
    runRoot: runRootSchema,
  })
  .strict();

export async function captureScreenshotBytes(handle: ResolvedTargetHandle): Promise<Buffer> {
  const direct = await handle.transport.exec(handle.target, ["screencap", "-p"], {
    encoding: "buffer",
    timeoutMs: 30_000,
  });
  if (direct.exitCode === 0 && direct.stdoutBytes.length > 0) {
    return direct.stdoutBytes;
  }

  // A busy device returns nothing from exec-out; the three-step file route still
  // works, so it is the fallback rather than an error.
  await handle.transport.exec(handle.target, ["screencap", "-p", SCREENSHOT_DEVICE_PATH], { timeoutMs: 30_000 });
  const bytes = await handle.transport.pullBinary(handle.target, SCREENSHOT_DEVICE_PATH);
  await handle.transport.exec(handle.target, ["rm", "-f", SCREENSHOT_DEVICE_PATH]);
  return bytes;
}

async function waitForDumpToSettle(handle: ResolvedTargetHandle, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let previousSize: number | null = null;

  while (Date.now() < deadline) {
    const result = await handle.transport.exec(
      handle.target,
      ["sh", "-c", `if [ -f ${UI_DUMP_DEVICE_PATH} ]; then wc -c < ${UI_DUMP_DEVICE_PATH}; else echo 0; fi`],
      { timeoutMs: UI_HIERARCHY_CALL_TIMEOUT_MS },
    );
    const size = Number.parseInt(result.stdout.trim(), 10);
    if (Number.isFinite(size) && size > 0 && previousSize === size) {
      return;
    }
    previousSize = Number.isFinite(size) ? size : null;
    await delay(UI_HIERARCHY_SETTLE_POLL_MS);
  }

  throw new ToolExecutionError(`Timed out waiting for a stable UI hierarchy dump at ${UI_DUMP_DEVICE_PATH}.`, {
    code: "timeout",
    details: { path: UI_DUMP_DEVICE_PATH, timeoutMs },
  });
}

/**
 * Retry, settle-poll and a per-call deadline, because a wedged `uiautomator dump`
 * once blocked a gate runner for over five minutes (INFRA-003). Every caller gets
 * this by using the tool, instead of each reimplementing it.
 */
export async function captureUiHierarchy(
  handle: ResolvedTargetHandle,
  options: { attempts?: number; settleTimeoutMs?: number } = {},
): Promise<{ xml: string; attempts: number; via: "file" | "tty" }> {
  const attempts = options.attempts ?? UI_HIERARCHY_ATTEMPTS;
  const settleTimeoutMs = options.settleTimeoutMs ?? UI_HIERARCHY_SETTLE_TIMEOUT_MS;
  let lastOutput = "";
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await handle.transport.exec(handle.target, ["rm", "-f", UI_DUMP_DEVICE_PATH], {
        timeoutMs: UI_HIERARCHY_CALL_TIMEOUT_MS,
      });
      await handle.transport.exec(handle.target, ["uiautomator", "dump", UI_DUMP_DEVICE_PATH], {
        timeoutMs: UI_HIERARCHY_CALL_TIMEOUT_MS,
      });
      await waitForDumpToSettle(handle, settleTimeoutMs);
      const read = await handle.transport.exec(handle.target, ["cat", UI_DUMP_DEVICE_PATH], {
        timeoutMs: UI_HIERARCHY_CALL_TIMEOUT_MS,
      });
      if (read.stdout.includes("<hierarchy")) {
        return { xml: read.stdout, attempts: attempt, via: "file" };
      }
      lastOutput = read.stdout;
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) {
      await delay(500);
    }
  }

  // Fallback for a device with no writable /sdcard: dump to the terminal and drop
  // uiautomator's trailing banner line.
  try {
    const tty = await handle.transport.exec(handle.target, ["uiautomator", "dump", "/dev/tty"], {
      timeoutMs: UI_HIERARCHY_CALL_TIMEOUT_MS,
    });
    const stripped = tty.stdout.replace(/UI hierchary dumped to:.*$/ms, "").trim();
    if (stripped.includes("<hierarchy")) {
      return { xml: stripped, attempts, via: "tty" };
    }
    lastOutput = stripped;
  } catch (error) {
    lastError = error;
  }

  throw new ToolExecutionError(
    `UI hierarchy capture produced no <hierarchy root after ${attempts} attempts` +
      `${lastError ? `: ${lastError instanceof Error ? lastError.message : String(lastError)}` : ""} ` +
      `(bytes=${lastOutput.length}, excerpt=${JSON.stringify(lastOutput.slice(0, 160))}).`,
    { details: { attempts, bytes: lastOutput.length } },
  );
}

export function countNodes(xml: string): number {
  return (xml.match(/<node\s/g) ?? []).length;
}

/**
 * The display rectangle is the root node's bounds. Taking the maximum over every
 * node would grow the screen to fit a node scrolled off it, which is exactly the
 * node an on-screen check has to reject.
 */
export function screenFromHierarchy(xml: string): { width: number; height: number } | null {
  const root = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(xml);
  if (!root) {
    return null;
  }
  const width = Number(root[3]);
  const height = Number(root[4]);
  return width > 0 && height > 0 ? { width, height } : null;
}

export async function writeScreenshot(
  ctx: ToolExecutionContext,
  handle: ResolvedTargetHandle,
  tool: string,
  name: string,
  options: { reviewWidth?: number; maxDimension?: number; runRoot?: string } = {},
): Promise<Record<string, unknown>> {
  const safeName = sanitizeArtifactName(name);
  const bytes = await captureScreenshotBytes(handle);
  try {
    assertPngSignature(bytes, `${safeName}.png`);
  } catch (error) {
    throw new ToolExecutionError(error instanceof Error ? error.message : String(error), {
      details: { targetId: handle.target.targetId, bytes: bytes.length },
    });
  }

  let review: ReturnType<typeof createReviewPng>;
  try {
    review = createReviewPng(bytes, options);
  } catch (error) {
    throw new ToolExecutionError(
      `Captured PNG for ${safeName} could not be decoded: ${error instanceof Error ? error.message : String(error)}`,
      { details: { targetId: handle.target.targetId, bytes: bytes.length } },
    );
  }
  const raw = ctx.artifacts.write(tool, handle.target.targetId, "raw", `${safeName}.png`, bytes, options.runRoot);
  const reviewEntry = ctx.artifacts.write(
    tool,
    handle.target.targetId,
    "review",
    `${safeName}-review.png`,
    review.bytes,
    options.runRoot,
  );

  return {
    rawPath: raw.path,
    reviewPath: reviewEntry.path,
    raw: review.raw,
    review: review.review,
  };
}

export const captureModule = defineToolModule({
  domain: "droid_capture",
  summary: "Screenshots, UI hierarchy dumps, screen recordings and logcat.",
  tools: [
    {
      name: "droid_capture.screenshot",
      description:
        "Capture a PNG screenshot and write both a raw copy and a 480 px review copy. The PNG signature is checked at " +
        "capture time, so a zero-byte capture fails here rather than at evidence validation later.",
      argsSchema: screenshotSchema,
      execute: defineExecute(screenshotSchema, async (args, ctx) => {
        const handle = await resolveTarget(ctx, args.targetId);
        return writeScreenshot(ctx, handle, "droid_capture.screenshot", args.name, {
          ...(args.reviewWidth === undefined ? {} : { reviewWidth: args.reviewWidth }),
          ...(args.maxDimension === undefined ? {} : { maxDimension: args.maxDimension }),
          ...(args.runRoot === undefined ? {} : { runRoot: args.runRoot }),
        });
      }),
    },
    {
      name: "droid_capture.ui_hierarchy",
      description:
        "Capture the uiautomator hierarchy, with the settle poll, retry budget and per-call deadline that a wedged " +
        "dump requires. Falls back to dumping to /dev/tty when the device has no writable /sdcard.",
      argsSchema: uiHierarchySchema,
      execute: defineExecute(uiHierarchySchema, async (args, ctx) => {
        const handle = await resolveTarget(ctx, args.targetId);
        const capture = await captureUiHierarchy(handle, {
          ...(args.attempts === undefined ? {} : { attempts: args.attempts }),
          ...(args.settleTimeoutMs === undefined ? {} : { settleTimeoutMs: args.settleTimeoutMs }),
        });
        const entry = ctx.artifacts.write(
          "droid_capture.ui_hierarchy",
          handle.target.targetId,
          "hierarchies",
          `${sanitizeArtifactName(args.name ?? "ui-hierarchy")}.xml`,
          capture.xml,
          args.runRoot,
        );
        return {
          xmlPath: entry.path,
          nodeCount: countNodes(capture.xml),
          attempts: capture.attempts,
          via: capture.via,
          screen: screenFromHierarchy(capture.xml),
        };
      }),
    },
    {
      name: "droid_capture.start_recording",
      description:
        "Start screenrecord detached and return a handle. The time limit is returned so a caller can tell a recording " +
        "that outlived its limit from one that stopped early.",
      argsSchema: startRecordingSchema,
      execute: defineExecute(startRecordingSchema, async (args, ctx) => {
        const handle = await resolveTarget(ctx, args.targetId);
        const safeName = sanitizeArtifactName(args.name);
        const devicePath = `/sdcard/droidctl-${safeName}.mp4`;
        const timeLimitSec = args.timeLimitSec ?? RECORDING_DEFAULT_TIME_LIMIT_SEC;
        await handle.transport.exec(handle.target, ["rm", "-f", devicePath]);

        const argv = [
          "screenrecord",
          "--bit-rate",
          String(args.bitRate ?? RECORDING_DEFAULT_BIT_RATE),
          "--time-limit",
          String(timeLimitSec),
          ...(args.size ? ["--size", args.size] : []),
          devicePath,
        ];
        const recordingId = ctx.recordings.nextId();
        ctx.recordings.put({
          recordingId,
          targetId: handle.target.targetId,
          name: safeName,
          devicePath,
          timeLimitSec,
          startedAt: new Date().toISOString(),
          ...(args.runRoot === undefined ? {} : { runRoot: args.runRoot }),
          process: handle.transport.spawnShell(handle.target, argv),
        });

        return { recordingId, devicePath, timeLimitSec, targetId: handle.target.targetId };
      }),
    },
    {
      name: "droid_capture.stop_recording",
      description:
        "Stop a recording, pull the MP4 and delete it from the device. The ftyp box is checked on pull. A recording " +
        "whose file is missing at stop time is reported as a failed result with the paths, not as an exception.",
      argsSchema: stopRecordingSchema,
      execute: defineExecute(stopRecordingSchema, async (args, ctx) => {
        const handle = await resolveTarget(ctx, args.targetId);
        const recording = ctx.recordings.get(args.recordingId);
        if (!recording) {
          throw new ToolExecutionError(`Unknown recordingId ${args.recordingId}.`, {
            details: { recordingId: args.recordingId, known: ctx.recordings.ids() },
          });
        }
        if (recording.targetId !== handle.target.targetId) {
          throw new ToolExecutionError(
            `Recording ${args.recordingId} belongs to ${recording.targetId}, not to ${handle.target.targetId}.`,
            { details: { recordingId: args.recordingId, owner: recording.targetId } },
          );
        }

        // A graceful stop must let screenrecord flush the MP4; how the backend
        // delivers that is its own business.
        const stopped = await recording.process.stop("graceful");
        ctx.recordings.delete(args.recordingId);
        await delay(500);

        const localPath = ctx.artifacts.pathFor("video", `${recording.name}.mp4`, recording.runRoot);
        let bytes: number;
        try {
          bytes = await handle.transport.pullFile(handle.target, recording.devicePath, localPath);
        } catch (error) {
          return {
            stopped: true,
            pulled: false,
            recordingId: args.recordingId,
            devicePath: recording.devicePath,
            localPath,
            stderr: stopped.stderr,
            exitCode: stopped.code,
            timedOut: stopped.timedOut === true,
            reason: error instanceof Error ? error.message : String(error),
          };
        }

        const payload = await readFile(localPath);
        if (payload.length === 0) {
          await unlink(localPath).catch(() => undefined);
          return {
            stopped: true,
            pulled: false,
            recordingId: args.recordingId,
            devicePath: recording.devicePath,
            localPath,
            stderr: stopped.stderr,
            exitCode: stopped.code,
            timedOut: stopped.timedOut === true,
            reason: `screenrecord wrote no data: ${stopped.stderr.trim() || "no stderr from the recorder"}`,
          };
        }
        try {
          assertMp4Signature(payload, localPath);
        } catch (error) {
          await unlink(localPath).catch(() => undefined);
          throw new ToolExecutionError(error instanceof Error ? error.message : String(error), {
            details: { localPath, devicePath: recording.devicePath, bytes },
          });
        }

        ctx.artifacts.record("droid_capture.stop_recording", handle.target.targetId, "video", localPath, bytes);
        await handle.transport.exec(handle.target, ["rm", "-f", recording.devicePath]);
        return { stopped: true, pulled: true, recordingId: args.recordingId, localPath, bytes, stderr: stopped.stderr };
      }),
    },
    {
      name: "droid_capture.logcat",
      description:
        "Clear the log buffer, or dump it with optional line, format, package and tag filters. Regular expressions in " +
        "filters are applied here and reported as matchedCount plus the matching lines; the full log is still written.",
      argsSchema: logcatSchema,
      execute: defineExecute(logcatSchema, async (args, ctx) => {
        const handle = await resolveTarget(ctx, args.targetId);

        if (args.mode === "clear") {
          const cleared = await handle.transport.exec(handle.target, ["logcat", "-c"], { timeoutMs: 30_000 });
          if (cleared.exitCode !== 0) {
            throw new ToolExecutionError(`logcat -c failed: ${cleared.stderr.trim()}`, {
              details: { exitCode: cleared.exitCode, stderr: cleared.stderr },
            });
          }
          return { cleared: true };
        }

        let pid: string | null = null;
        if (args.package) {
          const pidof = await handle.transport.exec(handle.target, ["pidof", args.package]);
          pid =
            pidof.stdout
              .trim()
              .split(/\s+/)
              .find((value) => /^\d+$/.test(value)) ?? null;
        }

        const argv = [
          "logcat",
          "-d",
          ...(args.lines ? ["-t", String(args.lines)] : []),
          ...(args.format ? ["-v", args.format] : []),
          ...(pid ? ["--pid", pid] : []),
          ...(args.tags ?? []).flatMap((tag) => ["-s", `${tag}:I`]),
        ];
        const maxBytes = args.maxBytes ?? LOGCAT_MAX_BYTES;
        const dump = await handle.transport.exec(handle.target, argv, { timeoutMs: 60_000, maxBytes });
        if (dump.exitCode !== 0) {
          throw new ToolExecutionError(`logcat -d failed: ${dump.stderr.trim()}`, {
            details: { exitCode: dump.exitCode, stderr: dump.stderr },
          });
        }
        if (dump.truncated) {
          throw new ToolExecutionError(`logcat output exceeded the ${maxBytes} byte cap; narrow the filters.`, {
            details: { maxBytes },
          });
        }

        const lines = dump.stdout.split(/\r?\n/).filter((line) => line.length > 0);
        if (args.requireRuntimeContent) {
          const hasRuntime =
            args.package && !pid ? lines.some((line) => line.includes(args.package!)) : lines.length > 0;
          if (!hasRuntime) {
            throw new ToolExecutionError(
              `logcat capture contained no runtime content (pid=${pid ?? "unresolved"}, bytes=${dump.stdout.length}).`,
              { details: { pid, bytes: dump.stdout.length, package: args.package ?? null } },
            );
          }
        }

        const patterns = (args.filters ?? []).map((pattern) => new RegExp(pattern));
        const matches = patterns.length === 0 ? [] : lines.filter((line) => patterns.some((p) => p.test(line)));
        const entry = ctx.artifacts.write(
          "droid_capture.logcat",
          handle.target.targetId,
          "logs/logcat",
          `${sanitizeArtifactName(args.name ?? "logcat")}.log`,
          dump.stdout,
          args.runRoot,
        );

        return { logPath: entry.path, lineCount: lines.length, matchedCount: matches.length, matches, pid };
      }),
    },
  ],
});
