/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { ResolvedTarget, TargetInfo, Transport } from "./transport/types.js";

export interface ScreenGeometry {
  readonly width: number | null;
  readonly height: number | null;
  readonly density: number | null;
  readonly dpr: number | null;
}

export interface TargetDescription {
  readonly targetId: string;
  readonly transport: string;
  readonly serial: string;
  readonly model: string | null;
  readonly apiLevel: number | null;
  readonly release: string | null;
  readonly hardware: string | null;
  readonly productName: string | null;
  readonly characteristics: string | null;
  readonly screen: ScreenGeometry;
  readonly sizeOverride: string | null;
  readonly densityOverride: number | null;
}

const GETPROP_KEYS = [
  "ro.product.model",
  "ro.product.name",
  "ro.hardware",
  "ro.build.version.release",
  "ro.build.version.sdk",
  "ro.build.characteristics",
] as const;

export function parseGetpropDump(stdout: string): Map<string, string> {
  const properties = new Map<string, string>();
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^\[([^\]]+)\]:\s*\[(.*)\]$/.exec(line.trim());
    if (match) {
      properties.set(match[1]!, match[2]!);
    }
  }
  return properties;
}

export function parseWmSize(stdout: string): { physical: string | null; override: string | null } {
  return {
    physical: /Physical size:\s*(\S+)/.exec(stdout)?.[1] ?? null,
    override: /Override size:\s*(\S+)/.exec(stdout)?.[1] ?? null,
  };
}

export function parseWmDensity(stdout: string): { physical: number | null; override: number | null } {
  const physical = /Physical density:\s*(\d+)/.exec(stdout)?.[1];
  const override = /Override density:\s*(\d+)/.exec(stdout)?.[1];
  return {
    physical: physical ? Number(physical) : null,
    override: override ? Number(override) : null,
  };
}

function parseDimensions(value: string | null): { width: number | null; height: number | null } {
  const match = value ? /^(\d+)x(\d+)$/.exec(value) : null;
  return match ? { width: Number(match[1]), height: Number(match[2]) } : { width: null, height: null };
}

export async function describeTarget(
  transport: Transport,
  target: ResolvedTarget,
  info: TargetInfo,
): Promise<TargetDescription> {
  const [props, size, density] = await Promise.all([
    transport.exec(target, ["getprop"], { timeoutMs: 15_000 }),
    transport.exec(target, ["wm", "size"], { timeoutMs: 15_000 }),
    transport.exec(target, ["wm", "density"], { timeoutMs: 15_000 }),
  ]);

  const properties = parseGetpropDump(props.stdout);
  const sizes = parseWmSize(size.stdout);
  const densities = parseWmDensity(density.stdout);
  const effective = parseDimensions(sizes.override ?? sizes.physical);
  const effectiveDensity = densities.override ?? densities.physical;
  const sdk = properties.get("ro.build.version.sdk");

  return {
    targetId: target.targetId,
    transport: target.transport,
    serial: target.serial,
    model: properties.get("ro.product.model") ?? info.model,
    apiLevel: sdk ? Number(sdk) : info.apiLevel,
    release: properties.get("ro.build.version.release") ?? null,
    hardware: properties.get("ro.hardware") ?? null,
    productName: properties.get("ro.product.name") ?? null,
    characteristics: properties.get("ro.build.characteristics") ?? null,
    screen: {
      width: effective.width,
      height: effective.height,
      density: effectiveDensity,
      dpr: effectiveDensity === null ? null : effectiveDensity / 160,
    },
    sizeOverride: sizes.override,
    densityOverride: densities.override,
  };
}

export { GETPROP_KEYS };
