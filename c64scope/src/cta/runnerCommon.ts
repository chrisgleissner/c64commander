/*
 * C64 Commander - C64 Scope
 * Copyright (C) 2026 Christian Gleissner
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Shared runner infrastructure for CTA gate runners:
 * app package, flag parsing, git SHA, device capture helpers, scroll helpers.
 */

import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { DroidmindClient } from "../validation/droidmindClient.js";
import { redactSecretLiterals } from "./redaction.js";
import { type Bounds, centerY, delay, isVisible } from "./uiHelpers.js";

const execFileAsync = promisify(execFile);

export const APP_PACKAGE = "uk.gleissner.c64commander";

export function readFlagValue(args: readonly string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

export async function gitSha(workspaceRoot: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--short=12", "HEAD"], { cwd: workspaceRoot });
    return stdout.trim();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to resolve Git SHA: ${message}`);
  }
}

export async function captureState(
  client: DroidmindClient,
  serial: string,
  artifactDir: string,
  stepId: string,
  secrets: readonly string[] = [],
): Promise<string> {
  const xml = await client.captureUiHierarchy(serial);
  const redactedXml = redactUiHierarchySecrets(xml, secrets);
  await writeFile(path.join(artifactDir, "hierarchies", `${stepId}.xml`), redactedXml, "utf-8");
  await client.screenshotToFile(serial, path.join(artifactDir, "screenshots", `${stepId}.png`));
  return redactedXml;
}

export function redactUiHierarchySecrets(xml: string, secrets: readonly string[] = []): string {
  return redactSecretLiterals(xml, secrets);
}

// Scroll to top: swipe finger DOWN (content moves up) several times to reach the top.
export async function scrollToTop(client: DroidmindClient, serial: string, count = 4): Promise<void> {
  for (let i = 0; i < count; i++) {
    await client.swipe(serial, 540, 650, 540, 1700, 250);
    await delay(250);
  }
  await delay(500);
}

// Scroll DOWN until the finder returns a visible element (no safe-zone constraint).
// Used by gate3-5 style runners that don't worry about nav-bar overlap.
export async function scrollUntilVisible(
  client: DroidmindClient,
  serial: string,
  artifactDir: string,
  stepPrefix: string,
  settleMs: number,
  finder: (xml: string) => Bounds | null,
  maxScrollAttempts = 8,
  secrets: readonly string[] = [],
): Promise<{ xml: string; bounds: Bounds } | null> {
  for (let i = 0; i < maxScrollAttempts; i++) {
    const xml = await client.captureUiHierarchy(serial);
    const redactedXml = redactUiHierarchySecrets(xml, secrets);
    await writeFile(path.join(artifactDir, "hierarchies", `${stepPrefix}-scroll-${i}.xml`), redactedXml, "utf-8");
    const bounds = finder(redactedXml);
    if (bounds) return { xml: redactedXml, bounds };
    await client.scrollDown(serial);
    await delay(settleMs / 2);
  }
  return null;
}

// Scroll DOWN until the finder returns a visible element whose center is above safeTapMaxY.
// Used by gate6-7 style runners to avoid tapping behind the Android navigation bar.
export async function scrollUntilInSafeZone(
  client: DroidmindClient,
  serial: string,
  artifactDir: string,
  stepPrefix: string,
  settleMs: number,
  safeTapMaxY: number,
  finder: (xml: string) => Bounds | null,
  maxScrollAttempts = 14,
  secrets: readonly string[] = [],
): Promise<{ xml: string; bounds: Bounds } | null> {
  for (let i = 0; i < maxScrollAttempts; i++) {
    const xml = await client.captureUiHierarchy(serial);
    const redactedXml = redactUiHierarchySecrets(xml, secrets);
    await writeFile(path.join(artifactDir, "hierarchies", `${stepPrefix}-scroll-${i}.xml`), redactedXml, "utf-8");
    const bounds = finder(redactedXml);
    if (bounds && isVisible(bounds) && centerY(bounds) <= safeTapMaxY) return { xml: redactedXml, bounds };
    await client.scrollDown(serial);
    await delay(settleMs / 2);
  }
  return null;
}
