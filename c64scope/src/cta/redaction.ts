/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const SECRET_FIELD_PATTERNS =
  /(?:^|[_\-.])(password|passwd|secret|token|api[_\-.]?key|auth(?:orization)?|credential|private[_\-.]?key|access[_\-.]?token|refresh[_\-.]?token|pwd)(?:[_\-.]|$)/i;

const REDACTED = "[REDACTED]";

export function isSecretField(fieldName: string): boolean {
  const normalizedFieldName = fieldName.replaceAll(/([a-z0-9])([A-Z])/g, "$1_$2");
  return SECRET_FIELD_PATTERNS.test(normalizedFieldName);
}

export function redactValue(fieldName: string, value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  if (isSecretField(fieldName)) {
    return REDACTED;
  }
  return value;
}

export function redactSecretLiterals(value: string, secrets: readonly string[]): string {
  let result = value;
  for (const secret of secrets) {
    if (!secret) {
      continue;
    }
    const escaped = secret.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replaceAll(new RegExp(escaped, "g"), REDACTED);
  }
  return result;
}

function redactDeep(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === "string") {
    return redactSecretLiterals(value, secrets);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactDeep(entry, secrets));
  }
  if (value !== null && typeof value === "object") {
    return redactRecord(value as Record<string, unknown>, secrets);
  }
  return value;
}

export function redactRecord(
  record: Record<string, unknown>,
  secrets: readonly string[] = [],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (isSecretField(key)) {
      result[key] = REDACTED;
      continue;
    }
    result[key] = redactDeep(value, secrets);
  }
  return result;
}
