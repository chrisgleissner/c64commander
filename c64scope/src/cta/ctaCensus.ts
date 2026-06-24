/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { runScrollCensus, type CensusResult, type ScrollDriver } from "./census.js";
import type { AgenticController } from "./controller.js";
import { fingerprintKeysFromHierarchy, type RuntimeFingerprintOptions } from "./runtimeFingerprint.js";

export interface CtaCensusOptions extends RuntimeFingerprintOptions {
  maxScrolls?: number;
}

export function createCtaScrollDriver(
  controller: AgenticController,
  serial: string,
  options: CtaCensusOptions = {},
): ScrollDriver {
  return {
    maxScrolls: options.maxScrolls ?? 20,
    async capture(): Promise<string[]> {
      const xml = await controller.captureUiHierarchy(serial);
      return fingerprintKeysFromHierarchy(xml, options);
    },
    async scroll(): Promise<{ atEnd: boolean }> {
      return controller.scrollDown(serial);
    },
  };
}

export async function runCtaCensus(
  controller: AgenticController,
  serial: string,
  options: CtaCensusOptions = {},
): Promise<CensusResult> {
  return runScrollCensus(createCtaScrollDriver(controller, serial, options));
}
