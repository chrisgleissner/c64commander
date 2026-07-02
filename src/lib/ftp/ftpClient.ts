/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { PluginListenerHandle } from "@capacitor/core";
import { addErrorLog, buildErrorLogDetails } from "@/lib/logging";
import { decrementFtpInFlight, incrementFtpInFlight } from "@/lib/diagnostics/diagnosticsActivity";
import {
  FtpClient,
  type FtpEntry,
  type FtpListOptions,
  type FtpPingOptions,
  type FtpReadOptions,
  type FtpRecursiveFailure,
  type FtpRecursiveListOptions,
  type FtpWriteOptions,
} from "@/lib/native/ftpClient";
import { resolveNativeTraceContext } from "@/lib/native/nativeTraceContext";
import { getActiveAction, runWithImplicitAction } from "@/lib/tracing/actionTrace";
import { recordFtpOperation, recordTraceError } from "@/lib/tracing/traceSession";
import { withFtpInteraction, type InteractionIntent } from "@/lib/deviceInteraction/deviceInteractionManager";
import type { TraceActionContext } from "@/lib/tracing/types";
import { buildPayloadPreviewFromBase64, buildPayloadPreviewFromJson } from "@/lib/tracing/payloadPreview";

export type FtpListResult = {
  path: string;
  entries: FtpEntry[];
};

export type FtpRecursiveListResult = FtpListResult & {
  partialFailures: FtpRecursiveFailure[];
  // True when the native walk bailed early because the device's FTP data
  // channel timed out mid-walk - entries/partialFailures reflect only what
  // was gathered before the bail, not the full tree. See HARD9-078.
  timedOut: boolean;
};

export const FTP_CONNECT_TIMEOUT_MS = 1_500;

export type FtpReadProgress = { bytesRead: number; totalBytes: number };

// Read options plus optional progress reporting and cancellation. onProgress is
// driven by native "ftpReadProgress" events; signal cancels the in-flight read
// (closing the data stream) so a large/slow transfer can be aborted cleanly.
export type FtpReadInteractionOptions = FtpReadOptions & {
  onProgress?: (progress: FtpReadProgress) => void;
  signal?: AbortSignal;
};

let ftpReadRequestCounter = 0;

const withDefaultConnectTimeout = <T extends { connectTimeoutMs?: number }>(options: T): T => ({
  ...options,
  connectTimeoutMs: options.connectTimeoutMs ?? FTP_CONNECT_TIMEOUT_MS,
});

const executeFtpList = async (
  action: TraceActionContext,
  ftpOptions: FtpListOptions,
  normalizedPath: string,
  intent: InteractionIntent,
): Promise<FtpListResult> => {
  incrementFtpInFlight();
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  const requestPayload = {
    ...ftpOptions,
    path: normalizedPath,
  };
  try {
    const response = await withFtpInteraction(
      {
        action,
        operation: "list",
        path: normalizedPath,
        intent,
        host: ftpOptions.host,
        port: ftpOptions.port,
      },
      async () =>
        await FtpClient.listDirectory(
          withDefaultConnectTimeout({
            ...ftpOptions,
            path: normalizedPath,
          }),
        ),
    );
    const responsePayload = { entries: response.entries };
    recordFtpOperation(action, {
      operation: "list",
      command: "LIST",
      hostname: ftpOptions.host,
      port: ftpOptions.port,
      path: normalizedPath,
      durationMs: Math.max(
        0,
        Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt),
      ),
      result: "success",
      requestPayload,
      requestPayloadPreview: buildPayloadPreviewFromJson(requestPayload),
      responsePayload,
      responsePayloadPreview: buildPayloadPreviewFromJson(responsePayload),
      error: null,
    });
    return { path: normalizedPath, entries: response.entries };
  } catch (error) {
    const err = error as Error;
    addErrorLog(
      "FTP listing failed",
      buildErrorLogDetails(err, {
        host: ftpOptions.host,
        path: normalizedPath,
      }),
    );
    recordFtpOperation(action, {
      operation: "list",
      command: "LIST",
      hostname: ftpOptions.host,
      port: ftpOptions.port,
      path: normalizedPath,
      durationMs: Math.max(
        0,
        Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt),
      ),
      result: "failure",
      requestPayload,
      requestPayloadPreview: buildPayloadPreviewFromJson(requestPayload),
      error: err,
    });
    recordTraceError(action, err);
    throw error;
  } finally {
    decrementFtpInFlight();
  }
};

export const listFtpDirectory = async (
  options: FtpListOptions & { __c64uIntent?: InteractionIntent },
): Promise<FtpListResult> => {
  const { __c64uIntent, ...ftpOptions } = options;
  const normalizedPath = options.path && options.path !== "" ? options.path : "/";
  const intent = __c64uIntent ?? "user";

  // If there's an active user action, record FTP within that context
  const activeAction = getActiveAction();
  if (activeAction) {
    const optionsWithTrace = {
      ...ftpOptions,
      traceContext: resolveNativeTraceContext(activeAction),
    };
    return executeFtpList(activeAction, optionsWithTrace, normalizedPath, intent);
  }
  // Otherwise create an implicit system action for the FTP call
  return runWithImplicitAction("ftp.list", async (action) => {
    const optionsWithTrace = {
      ...ftpOptions,
      traceContext: resolveNativeTraceContext(action),
    };
    return executeFtpList(action, optionsWithTrace, normalizedPath, intent);
  });
};

const executeFtpRecursiveList = async (
  action: TraceActionContext,
  ftpOptions: FtpRecursiveListOptions,
  normalizedPath: string,
  intent: InteractionIntent,
): Promise<FtpRecursiveListResult> => {
  incrementFtpInFlight();
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  const requestPayload = {
    ...ftpOptions,
    path: normalizedPath,
  };
  try {
    const response = await withFtpInteraction(
      {
        action,
        operation: "list-recursive",
        path: normalizedPath,
        intent,
        host: ftpOptions.host,
        port: ftpOptions.port,
      },
      async () =>
        await FtpClient.listDirectoryRecursive(
          withDefaultConnectTimeout({
            ...ftpOptions,
            path: normalizedPath,
          }),
        ),
    );
    const responsePayload = {
      entries: response.entries,
      partialFailures: response.partialFailures ?? [],
      timedOut: response.timedOut ?? false,
    };
    recordFtpOperation(action, {
      operation: "list",
      command: "LIST-RECURSIVE",
      hostname: ftpOptions.host,
      port: ftpOptions.port,
      path: normalizedPath,
      durationMs: Math.max(
        0,
        Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt),
      ),
      result: "success",
      requestPayload,
      requestPayloadPreview: buildPayloadPreviewFromJson(requestPayload),
      responsePayload,
      responsePayloadPreview: buildPayloadPreviewFromJson(responsePayload),
      error: null,
    });
    return {
      path: normalizedPath,
      entries: response.entries,
      partialFailures: response.partialFailures ?? [],
      timedOut: response.timedOut ?? false,
    };
  } catch (error) {
    const err = error as Error;
    addErrorLog(
      "FTP recursive listing failed",
      buildErrorLogDetails(err, {
        host: ftpOptions.host,
        path: normalizedPath,
      }),
    );
    recordFtpOperation(action, {
      operation: "list",
      command: "LIST-RECURSIVE",
      hostname: ftpOptions.host,
      port: ftpOptions.port,
      path: normalizedPath,
      durationMs: Math.max(
        0,
        Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt),
      ),
      result: "failure",
      requestPayload,
      requestPayloadPreview: buildPayloadPreviewFromJson(requestPayload),
      error: err,
    });
    recordTraceError(action, err);
    throw error;
  } finally {
    decrementFtpInFlight();
  }
};

export const listFtpDirectoryRecursive = async (
  options: FtpRecursiveListOptions & { __c64uIntent?: InteractionIntent },
): Promise<FtpRecursiveListResult> => {
  const { __c64uIntent, ...ftpOptions } = options;
  const normalizedPath = options.path && options.path !== "" ? options.path : "/";
  const intent = __c64uIntent ?? "user";

  const activeAction = getActiveAction();
  if (activeAction) {
    const optionsWithTrace = {
      ...ftpOptions,
      traceContext: resolveNativeTraceContext(activeAction),
    };
    return executeFtpRecursiveList(activeAction, optionsWithTrace, normalizedPath, intent);
  }

  return runWithImplicitAction("ftp.list-recursive", async (action) => {
    const optionsWithTrace = {
      ...ftpOptions,
      traceContext: resolveNativeTraceContext(action),
    };
    return executeFtpRecursiveList(action, optionsWithTrace, normalizedPath, intent);
  });
};

const executeFtpRead = async (
  action: TraceActionContext,
  ftpOptions: FtpReadInteractionOptions,
  path: string,
  intent: InteractionIntent,
): Promise<{ data: string; sizeBytes?: number }> => {
  // onProgress/signal are JS-side concerns and must not cross the native bridge
  // or land in the (serialized) trace payload.
  const { onProgress, signal, ...nativeReadOptions } = ftpOptions;
  // A caller can abort a queued read before the native call is even
  // attempted (e.g. cancelling a bulk import). Without this, the
  // cancelRead() fired below races an INDEPENDENT native bridge call
  // against readFile()'s own bridge call with no ordering guarantee - if
  // readFile() wins that race, the full transfer runs anyway despite
  // already being cancelled. See HARD9-083.
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
  const requestId =
    nativeReadOptions.requestId ?? (onProgress || signal ? `ftp-read-${(ftpReadRequestCounter += 1)}` : undefined);

  incrementFtpInFlight();
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  const requestPayload = { ...nativeReadOptions, path };

  let progressListener: PluginListenerHandle | undefined;
  let abortListener: (() => void) | undefined;
  try {
    if (requestId && onProgress) {
      progressListener = await FtpClient.addListener("ftpReadProgress", (event) => {
        if (event.requestId !== requestId) return;
        onProgress({ bytesRead: event.bytesRead, totalBytes: event.totalBytes });
      });
    }
    if (requestId && signal) {
      const requestCancel = () => {
        void FtpClient.cancelRead({ requestId }).catch((error) => {
          addErrorLog(
            "FTP cancelRead failed",
            buildErrorLogDetails(error as Error, {
              host: ftpOptions.host,
              path,
              requestId,
            }),
          );
        });
      };
      if (signal.aborted) {
        requestCancel();
      } else {
        abortListener = requestCancel;
        signal.addEventListener("abort", requestCancel, { once: true });
      }
    }
    const response = await withFtpInteraction(
      {
        action,
        operation: "read",
        path,
        intent,
        host: ftpOptions.host,
        port: ftpOptions.port,
      },
      async () => await FtpClient.readFile(withDefaultConnectTimeout({ ...nativeReadOptions, path, requestId })),
    );
    const responsePayload = {
      data: response.data,
      sizeBytes: response.sizeBytes,
    };
    recordFtpOperation(action, {
      operation: "read",
      command: "RETR",
      hostname: ftpOptions.host,
      port: ftpOptions.port,
      path,
      durationMs: Math.max(
        0,
        Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt),
      ),
      result: "success",
      requestPayload,
      requestPayloadPreview: buildPayloadPreviewFromJson(requestPayload),
      responsePayload,
      responsePayloadPreview: buildPayloadPreviewFromBase64(response.data),
      error: null,
    });
    return response;
  } catch (error) {
    const err = error as Error;
    addErrorLog(
      "FTP file read failed",
      buildErrorLogDetails(err, {
        host: ftpOptions.host,
        path,
      }),
    );
    recordFtpOperation(action, {
      operation: "read",
      command: "RETR",
      hostname: ftpOptions.host,
      port: ftpOptions.port,
      path,
      durationMs: Math.max(
        0,
        Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt),
      ),
      result: "failure",
      requestPayload,
      requestPayloadPreview: buildPayloadPreviewFromJson(requestPayload),
      error: err,
    });
    recordTraceError(action, err);
    throw error;
  } finally {
    if (abortListener && signal) {
      signal.removeEventListener("abort", abortListener);
    }
    if (progressListener) {
      try {
        await progressListener.remove();
      } catch (error) {
        addErrorLog(
          "FTP progress listener cleanup failed",
          buildErrorLogDetails(error as Error, {
            host: ftpOptions.host,
            path,
          }),
        );
      }
    }
    decrementFtpInFlight();
  }
};

export const readFtpFile = async (
  options: FtpReadInteractionOptions & { __c64uIntent?: InteractionIntent },
): Promise<{ data: string; sizeBytes?: number }> => {
  const { __c64uIntent, ...ftpOptions } = options;
  const intent = __c64uIntent ?? "user";

  // If there's an active user action, record FTP within that context
  const activeAction = getActiveAction();
  if (activeAction) {
    const optionsWithTrace = {
      ...ftpOptions,
      traceContext: resolveNativeTraceContext(activeAction),
    };
    return executeFtpRead(activeAction, optionsWithTrace, options.path, intent);
  }
  // Otherwise create an implicit system action for the FTP call
  return runWithImplicitAction("ftp.read", async (action) => {
    const optionsWithTrace = {
      ...ftpOptions,
      traceContext: resolveNativeTraceContext(action),
    };
    return executeFtpRead(action, optionsWithTrace, options.path, intent);
  });
};

const executeFtpWrite = async (
  action: TraceActionContext,
  ftpOptions: FtpWriteOptions,
  path: string,
  intent: InteractionIntent,
): Promise<{ sizeBytes: number }> => {
  incrementFtpInFlight();
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  const requestPayload = { ...ftpOptions, path };
  try {
    const response = await withFtpInteraction(
      {
        action,
        operation: "write",
        path,
        intent,
        host: ftpOptions.host,
        port: ftpOptions.port,
      },
      async () => await FtpClient.writeFile(withDefaultConnectTimeout({ ...ftpOptions, path })),
    );
    const responsePayload = { sizeBytes: response.sizeBytes };
    recordFtpOperation(action, {
      operation: "write",
      command: "STOR",
      hostname: ftpOptions.host,
      port: ftpOptions.port,
      path,
      durationMs: Math.max(
        0,
        Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt),
      ),
      result: "success",
      requestPayload,
      requestPayloadPreview: buildPayloadPreviewFromBase64(ftpOptions.data),
      responsePayload,
      responsePayloadPreview: buildPayloadPreviewFromJson(responsePayload),
      error: null,
    });
    return response;
  } catch (error) {
    const err = error as Error;
    addErrorLog(
      "FTP file write failed",
      buildErrorLogDetails(err, {
        host: ftpOptions.host,
        path,
      }),
    );
    recordFtpOperation(action, {
      operation: "write",
      command: "STOR",
      hostname: ftpOptions.host,
      port: ftpOptions.port,
      path,
      durationMs: Math.max(
        0,
        Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt),
      ),
      result: "failure",
      requestPayload,
      requestPayloadPreview: buildPayloadPreviewFromBase64(ftpOptions.data),
      error: err,
    });
    recordTraceError(action, err);
    throw error;
  } finally {
    decrementFtpInFlight();
  }
};

export const writeFtpFile = async (
  options: FtpWriteOptions & { __c64uIntent?: InteractionIntent },
): Promise<{ sizeBytes: number }> => {
  const { __c64uIntent, ...ftpOptions } = options;
  const intent = __c64uIntent ?? "user";

  const activeAction = getActiveAction();
  if (activeAction) {
    const optionsWithTrace = {
      ...ftpOptions,
      traceContext: resolveNativeTraceContext(activeAction),
    };
    return executeFtpWrite(activeAction, optionsWithTrace, options.path, intent);
  }

  return runWithImplicitAction("ftp.write", async (action) => {
    const optionsWithTrace = {
      ...ftpOptions,
      traceContext: resolveNativeTraceContext(action),
    };
    return executeFtpWrite(action, optionsWithTrace, options.path, intent);
  });
};

export const pingFtp = async (
  options: FtpPingOptions & { __c64uIntent?: InteractionIntent },
): Promise<{ ok: boolean }> => {
  const { __c64uIntent, ...ftpOptions } = options;
  // The sole production caller (health-check engine) always supplies a concrete intent;
  // fall back to "system" (a probe-style intent) rather than an invalid value so the
  // device-interaction scheduler classifies a bare ping correctly.
  const intent: InteractionIntent = __c64uIntent ?? "system";

  return runWithImplicitAction("ftp.ping", async (action) => {
    incrementFtpInFlight();
    try {
      return await withFtpInteraction(
        {
          action,
          operation: "ping",
          path: "/",
          intent,
          host: ftpOptions.host,
          port: ftpOptions.port,
        },
        async () =>
          await FtpClient.pingFtp(
            withDefaultConnectTimeout({
              ...ftpOptions,
              traceContext: resolveNativeTraceContext(action),
            }),
          ),
      );
    } catch (error) {
      addErrorLog("FTP ping failed", buildErrorLogDetails(error as Error, { host: ftpOptions.host }));
      throw error;
    } finally {
      decrementFtpInFlight();
    }
  });
};
