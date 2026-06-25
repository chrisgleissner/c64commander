/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface CtaIssueRecord {
  route: string;
  source: string;
  severity: string;
  message: string;
  stack?: string;
}

export interface CtaIssueSignature {
  source: string;
  route: string;
  message: string;
  topFrames: string[];
}

function normalizeMessage(message: string): string {
  return message
    .replaceAll(/https?:\/\/\S+/g, "URL")
    .replaceAll(/0x[0-9a-f]+/gi, "0x#")
    .replaceAll(/\b\d{3,}\b/g, "#")
    .replaceAll(/[\s\t]+/g, " ")
    .trim();
}

function extractFrames(stack?: string): string[] {
  if (!stack) {
    return [];
  }
  return stack
    .split("\n")
    .map((line) => line.trim().replace(/^at\s+/, ""))
    .filter(Boolean)
    .slice(0, 5);
}

function hashString(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function buildIssueSignature(issue: CtaIssueRecord): CtaIssueSignature {
  return {
    source: issue.source || issue.severity,
    route: issue.route,
    message: normalizeMessage(issue.message),
    topFrames: extractFrames(issue.stack),
  };
}

export function buildIssueGroupId(signature: CtaIssueSignature): string {
  const frame = signature.topFrames[0] || "unknown";
  const signatureKey = `${signature.source}|${signature.route}|${signature.message}|${signature.topFrames.join("|")}`;
  const hash = hashString(signatureKey).slice(0, 8);
  return `${signature.source}@${signature.route}@${frame}-${hash}`.replace(/[^a-z0-9@._/-]+/gi, "-").slice(0, 128);
}
