/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog, type LogLevel } from "@/lib/logging";
import { classifyError } from "@/lib/tracing/failureTaxonomy";
import { getActiveAction } from "@/lib/tracing/actionTrace";
import { getPlaybackTraceSnapshot } from "@/pages/playFiles/playbackTraceStore";

type LoggerDetails = Record<string, unknown>;

type LoggerOptions = {
  details?: LoggerDetails;
  component?: string;
  includeConsole?: boolean;
};

type ConsoleBridgeOptions = {
  enabled?: boolean;
};

type BridgeState = {
  installed: boolean;
  originalInfo?: typeof console.info;
  originalWarn?: typeof console.warn;
  originalError?: typeof console.error;
};

const bridgeState: BridgeState = {
  installed: false,
};

let inConsoleForwarding = false;

const normalizeError = (error: unknown) => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  if (typeof error === "string") {
    return {
      name: "Error",
      message: error,
      stack: null,
    };
  }
  return null;
};

const buildContextDetails = (component?: string): LoggerDetails => {
  const activeAction = getActiveAction();
  const playback = getPlaybackTraceSnapshot();
  const lifecycleState =
    typeof document === "undefined"
      ? "unknown"
      : document.hidden
        ? "background"
        : document.hasFocus()
          ? "foreground"
          : "unknown";
  return {
    correlationId: activeAction?.correlationId ?? null,
    origin: activeAction?.origin ?? null,
    actionName: activeAction?.name ?? null,
    component: component ?? activeAction?.componentName ?? null,
    lifecycleState: playback ? lifecycleState : null,
    sourceKind: playback?.sourceKind ?? null,
    localAccessMode: playback?.localAccessMode ?? null,
    trackInstanceId: playback?.trackInstanceId ?? null,
    playlistItemId: playback?.playlistItemId ?? null,
  };
};

const toLogDetails = (details: LoggerDetails = {}, component?: string) => {
  const context = buildContextDetails(component);
  const merged = {
    ...context,
    ...details,
  };

  if ("error" in merged) {
    const normalized = normalizeError(merged.error);
    merged.error = normalized ?? merged.error;
  }

  return merged;
};

const writeLog = (level: LogLevel, message: string, options: LoggerOptions = {}) => {
  const details = toLogDetails(options.details, options.component);
  addLog(level, message, details);
  if (options.includeConsole === false) return;
  if (level === "warn") {
    console.warn(message, details);
    return;
  }
  if (level === "error") {
    console.error(message, details);
    return;
  }
  if (level === "info") {
    console.info(message, details);
    return;
  }
  console.debug(message, details);
};

export const logger = {
  debug: (message: string, options?: LoggerOptions) => writeLog("debug", message, options),
  info: (message: string, options?: LoggerOptions) => writeLog("info", message, options),
  warn: (message: string, options?: LoggerOptions) => writeLog("warn", message, options),
  error: (message: string, options?: LoggerOptions) => writeLog("error", message, options),
};

const normalizeConsoleMessage = (args: unknown[]) => {
  if (!args.length) return "";
  const first = args[0];
  if (typeof first === "undefined") return "";
  if (typeof first === "string") return first;
  if (first instanceof Error) return first.message;
  if (first !== null && typeof first === "object") {
    try {
      return JSON.stringify(first);
    } catch (error) {
      // We can't log from inside the logger without risking recursion, so we
      // mark the fallback string so downstream consumers can tell serialization
      // failed rather than treating the String(value) result as canonical.
      return `[unserializable: ${(error as Error)?.message ?? "stringify failed"}] ${String(first)}`;
    }
  }
  return String(first);
};

const normalizeConsoleDetails = (args: unknown[]) => {
  if (args.length <= 1) return {};
  const next = args.slice(1);
  const mapped = next.map((value) => {
    if (value instanceof Error) {
      return { error: normalizeError(value) };
    }
    return value;
  });
  return {
    args: mapped,
  };
};

const normalizeConsoleForwardArgs = (args: unknown[]) => {
  if (!args.length) return [""];
  return [normalizeConsoleMessage(args), ...args.slice(1)];
};

// Real Capacitor Filesystem plugin rejection messages don't reliably end with
// the benign phrase - e.g. "...does not exist." (trailing period) or "...
// already exists, cannot be overwritten." (trailing clause) - so an anchored
// end-of-string pattern silently never matched either shape and every benign
// file/dir existence race flooded Diagnostics as a full error (observed:
// thousands of "deleteFile failed" / mkdir "already exists" entries during
// HVSC metadata hydration). Match the phrase anywhere in the message.
const BENIGN_EXISTENCE_PHRASE_PATTERN =
  /does not exist|directory exists|not found|no such file|already exists|eexist|enoent/i;

// ...but a bare existence phrase like "not found" / "already exists" is generic:
// on its own it would also swallow real non-filesystem errors (e.g. "User
// already exists in DB", "Key not found in keystore", "Resource not found:
// <url>"). So only treat it as a benign filesystem race when the SAME message
// ALSO references a filesystem entity/operation (Kilo review, PR #303).
const FILESYSTEM_CONTEXT_PATTERN =
  /\bfile\b|\bdirectory\b|deletefile|mkdir|readfile|writefile|readdir|rmdir|\bstat\b|no such file|enoent|eexist/i;

const isPlainObjectMessageShape = (value: unknown) =>
  !!value && typeof value === "object" && typeof (value as { message?: unknown }).message === "string";

const isBenignFilesystemErrorObject = (value: unknown) => {
  if (!isPlainObjectMessageShape(value)) return false;
  const message = (value as { message: string }).message.trim();
  return FILESYSTEM_CONTEXT_PATTERN.test(message) && BENIGN_EXISTENCE_PHRASE_PATTERN.test(message);
};

const shouldSuppressConsoleErrorForwarding = (args: unknown[]) => {
  if (!args.length) return false;
  const first = args[0];
  const classification = classifyError(first);
  if (classification.failureClass === "user-cancellation") return true;
  // Suppress the lone known-benign Capacitor Filesystem plugin rejection shapes
  // (file/dir existence races) that callers already handle internally.
  if (args.length === 1 && isBenignFilesystemErrorObject(first)) return true;
  return false;
};

export const installConsoleDiagnosticsBridge = (options: ConsoleBridgeOptions = {}) => {
  if (bridgeState.installed) {
    return () => {
      // no-op if already installed globally
    };
  }

  const enabled = options.enabled ?? true;
  if (!enabled) {
    return () => {
      // explicitly disabled
    };
  }

  bridgeState.installed = true;
  bridgeState.originalInfo = console.info.bind(console);
  bridgeState.originalWarn = console.warn.bind(console);
  bridgeState.originalError = console.error.bind(console);

  console.info = (...args: unknown[]) => {
    bridgeState.originalInfo?.(...normalizeConsoleForwardArgs(args));
  };

  console.warn = (...args: unknown[]) => {
    bridgeState.originalWarn?.(...args);
    if (inConsoleForwarding) return;
    inConsoleForwarding = true;
    try {
      logger.warn(normalizeConsoleMessage(args), {
        details: normalizeConsoleDetails(args),
        component: "console",
        includeConsole: false,
      });
    } finally {
      inConsoleForwarding = false;
    }
  };

  console.error = (...args: unknown[]) => {
    bridgeState.originalError?.(...args);
    if (shouldSuppressConsoleErrorForwarding(args)) return;
    if (inConsoleForwarding) return;
    inConsoleForwarding = true;
    try {
      logger.error(normalizeConsoleMessage(args), {
        details: normalizeConsoleDetails(args),
        component: "console",
        includeConsole: false,
      });
    } finally {
      inConsoleForwarding = false;
    }
  };

  return () => {
    if (!bridgeState.installed) return;
    if (bridgeState.originalWarn) {
      console.warn = bridgeState.originalWarn;
    }
    if (bridgeState.originalInfo) {
      console.info = bridgeState.originalInfo;
    }
    if (bridgeState.originalError) {
      console.error = bridgeState.originalError;
    }
    bridgeState.installed = false;
    bridgeState.originalInfo = undefined;
    bridgeState.originalWarn = undefined;
    bridgeState.originalError = undefined;
  };
};
