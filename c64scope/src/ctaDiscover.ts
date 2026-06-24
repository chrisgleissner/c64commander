/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolvePreferredPhysicalTestDeviceSerial } from "./deviceRegistry.js";
import { runCtaCensus } from "./cta/ctaCensus.js";
import { DroidmindClient } from "./validation/droidmindClient.js";
import { resolveWorkspaceRoot, timestampId } from "./fullAppCoverageExecutor.js";

const APP_PACKAGE = "uk.gleissner.c64commander";
const START_APP_SETTLE_MS = 2500;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface DiscoverArgs {
  serial?: string;
  route?: string;
  overlay?: string;
  scrollContainerId?: string;
  maxScrolls?: number;
  startApp: boolean;
}

function readFlagValue(args: readonly string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

export function parseDiscoverArgs(args: readonly string[]): DiscoverArgs {
  const maxScrollsRaw = readFlagValue(args, "max-scrolls");
  const parsedMaxScrolls = maxScrollsRaw ? Number.parseInt(maxScrollsRaw, 10) : undefined;
  if (parsedMaxScrolls !== undefined && (!Number.isInteger(parsedMaxScrolls) || parsedMaxScrolls < 0)) {
    throw new Error(`Invalid --max-scrolls value '${maxScrollsRaw}'.`);
  }

  return {
    serial: readFlagValue(args, "serial") ?? process.env["ANDROID_SERIAL"],
    route: readFlagValue(args, "route"),
    overlay: readFlagValue(args, "overlay"),
    scrollContainerId: readFlagValue(args, "scroll-container"),
    maxScrolls: parsedMaxScrolls,
    startApp: args.includes("--start-app"),
  };
}

export async function main(): Promise<void> {
  const options = parseDiscoverArgs(process.argv.slice(2));
  const serial = options.serial ?? (await resolvePreferredPhysicalTestDeviceSerial());
  const runId = `cta-discover-${timestampId()}`;
  const artifactRoot = path.join(resolveWorkspaceRoot(), "c64scope", "artifacts", "cta-discover", runId);
  const client = new DroidmindClient();

  try {
    if (options.startApp) {
      await client.startApp(serial, APP_PACKAGE);
      await delay(START_APP_SETTLE_MS);
    }
    const result = await runCtaCensus(client, serial, {
      route: options.route,
      overlay: options.overlay,
      scrollContainerId: options.scrollContainerId,
      maxScrolls: options.maxScrolls,
      targetPackage: APP_PACKAGE,
    });
    const payload = {
      runId,
      serial,
      route: options.route ?? null,
      overlay: options.overlay ?? null,
      scrollContainerId: options.scrollContainerId ?? null,
      ...result,
    };
    await mkdir(artifactRoot, { recursive: true });
    const jsonPath = path.join(artifactRoot, "cta-discover.json");
    await writeFile(jsonPath, JSON.stringify(payload, null, 2), "utf-8");
    console.log(`CTA discovery written: ${jsonPath}`);
    console.log(`Discovered ${result.discovered.length} controls; stopReason=${result.stopReason}`);
  } finally {
    await client.close();
  }
}

function isDirectExecution(metaUrl: string): boolean {
  const entry = process.argv[1];
  return Boolean(entry) && pathToFileURL(entry!).href === metaUrl;
}

if (isDirectExecution(import.meta.url)) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
