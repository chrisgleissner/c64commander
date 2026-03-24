/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { randomUUID } from "node:crypto";
import type { HarnessConfig } from "./config.js";
import type { LogEventInput } from "./logging.js";
import type { SharedRestRequest } from "./restRequest.js";
import { FtpClient } from "./ftpClient.js";
import {
  SAFE_CATEGORY_BLOCKLIST,
  SAFE_ITEM_BLOCKLIST,
  listCategories,
  pickNextValue,
  pickSafeItem,
} from "../scenarios/rest/index.js";

export type MatrixOpContext = {
  restRequest: SharedRestRequest;
  ftpClient?: FtpClient;
  log: (event: LogEventInput) => void;
  config: HarnessConfig;
};

export type MatrixOp = {
  id: string;
  protocol: "rest" | "ftp" | "mixed";
  requiresFtpSession: boolean;
  execute: (ctx: MatrixOpContext) => Promise<{ ok: boolean; latencyMs: number }>;
};

type SafeConfigTarget = {
  category: string;
  item: string;
  values: Array<string | number>;
  nextIndex: number;
};

const SMALL_UPLOAD_BUFFER = Buffer.alloc(1024, 0x43);
const LARGE_UPLOAD_BUFFER = Buffer.alloc(65536, 0x42);
let safeConfigTargetCache: SafeConfigTarget[] | null = null;

export function buildMatrixOperations(): Map<string, MatrixOp> {
  const operations = new Map<string, MatrixOp>();

  const add = (operation: MatrixOp) => operations.set(operation.id, operation);

  add(restOperation("rest.read-version", async ({ restRequest }) => {
    const response = await restRequest({ method: "GET", url: "/v1/version" });
    return { ok: response.status === 200, latencyMs: response.latencyMs };
  }));
  add(restOperation("rest.read-configs", async ({ restRequest }) => {
    const response = await restRequest({ method: "GET", url: "/v1/configs" });
    return { ok: response.status === 200, latencyMs: response.latencyMs };
  }));
  add(restOperation("rest.read-drives", async ({ restRequest }) => {
    const response = await restRequest({ method: "GET", url: "/v1/drives" });
    return { ok: response.status === 200, latencyMs: response.latencyMs };
  }));
  add(restOperation("rest.read-burst", async ({ restRequest }) => {
    const start = Date.now();
    const responses = await Promise.all([
      restRequest({ method: "GET", url: "/v1/version" }),
      restRequest({ method: "GET", url: "/v1/configs" }),
      restRequest({ method: "GET", url: "/v1/drives" }),
    ]);
    return { ok: responses.every((response) => response.status === 200), latencyMs: Date.now() - start };
  }));
  add(restOperation("rest.write-config", async (ctx) => {
    const target = await nextSafeConfigTarget(ctx);
    if (!target) {
      return { ok: false, latencyMs: 0 };
    }
    const value = target.values[target.nextIndex % target.values.length];
    target.nextIndex = (target.nextIndex + 1) % target.values.length;
    const response = await ctx.restRequest({
      method: "PUT",
      url: `/v1/configs/${encodeURIComponent(target.category)}/${encodeURIComponent(target.item)}`,
      params: { value },
    });
    return { ok: response.status === 200, latencyMs: response.latencyMs };
  }));

  add(ftpOperation("ftp.control-only", async ({ ftpClient }) => {
    const start = Date.now();
    const responses = await Promise.all([ftpClient!.pwd(), ftpClient!.sendCommand("NOOP"), ftpClient!.mlst()]);
    return { ok: responses.every((response) => response.response.code < 400), latencyMs: Date.now() - start };
  }));
  add(ftpOperation("ftp.dir-list", async ({ ftpClient }) => {
    const response = await ftpClient!.list("/");
    return { ok: response.result.response.code < 400, latencyMs: response.result.latencyMs };
  }));
  add(ftpOperation("ftp.dir-mlsd", async ({ ftpClient }) => {
    const response = await ftpClient!.mlsd("/");
    return { ok: response.result.response.code < 400, latencyMs: response.result.latencyMs };
  }));
  add(ftpOperation("ftp.small-upload", async ({ ftpClient, config }) => uploadFile(ftpClient!, config, SMALL_UPLOAD_BUFFER)));
  add(ftpOperation("ftp.small-roundtrip", async ({ ftpClient, config }) => roundTripFile(ftpClient!, config, SMALL_UPLOAD_BUFFER)));
  add(ftpOperation("ftp.large-upload", async ({ ftpClient, config }) => uploadFile(ftpClient!, config, LARGE_UPLOAD_BUFFER)));
  add(ftpOperation("ftp.large-roundtrip", async ({ ftpClient, config }) => roundTripFile(ftpClient!, config, LARGE_UPLOAD_BUFFER)));

  add(mixedOperation("mixed.read-and-list", async ({ restRequest, ftpClient }) => {
    const start = Date.now();
    const [restResponse, ftpResponse] = await Promise.all([
      restRequest({ method: "GET", url: "/v1/version" }),
      ftpClient!.list("/"),
    ]);
    return { ok: restResponse.status === 200 && ftpResponse.result.response.code < 400, latencyMs: Date.now() - start };
  }));
  add(mixedOperation("mixed.read-and-stor", async ({ restRequest, ftpClient, config }) => {
    const start = Date.now();
    const [restResponse, ftpResponse] = await Promise.all([
      restRequest({ method: "GET", url: "/v1/configs" }),
      uploadFile(ftpClient!, config, SMALL_UPLOAD_BUFFER),
    ]);
    return { ok: restResponse.status === 200 && ftpResponse.ok, latencyMs: Date.now() - start };
  }));
  add(mixedOperation("mixed.write-and-list", async (ctx) => {
    const start = Date.now();
    const target = await nextSafeConfigTarget(ctx);
    if (!target) {
      return { ok: false, latencyMs: 0 };
    }
    const value = target.values[target.nextIndex % target.values.length];
    target.nextIndex = (target.nextIndex + 1) % target.values.length;
    const [restResponse, ftpResponse] = await Promise.all([
      ctx.restRequest({
        method: "PUT",
        url: `/v1/configs/${encodeURIComponent(target.category)}/${encodeURIComponent(target.item)}`,
        params: { value },
      }),
      ctx.ftpClient!.list("/"),
    ]);
    return {
      ok: restResponse.status === 200 && ftpResponse.result.response.code < 400,
      latencyMs: Date.now() - start,
    };
  }));
  add(mixedOperation("mixed.burst-and-stor", async ({ restRequest, ftpClient, config }) => {
    const start = Date.now();
    for (let index = 0; index < 3; index += 1) {
      const response = await restRequest({ method: "GET", url: "/v1/version" });
      if (response.status !== 200) {
        return { ok: false, latencyMs: Date.now() - start };
      }
    }
    const ftpResponse = await uploadFile(ftpClient!, config, LARGE_UPLOAD_BUFFER);
    return { ok: ftpResponse.ok, latencyMs: Date.now() - start };
  }));

  return operations;
}

function restOperation(id: string, operation: (ctx: MatrixOpContext) => Promise<{ ok: boolean; latencyMs: number }>): MatrixOp {
  return {
    id,
    protocol: "rest",
    requiresFtpSession: false,
    execute: (ctx) => safelyExecute(id, ctx, operation),
  };
}

function ftpOperation(id: string, operation: (ctx: MatrixOpContext) => Promise<{ ok: boolean; latencyMs: number }>): MatrixOp {
  return {
    id,
    protocol: "ftp",
    requiresFtpSession: true,
    execute: (ctx) => safelyExecute(id, ctx, operation),
  };
}

function mixedOperation(id: string, operation: (ctx: MatrixOpContext) => Promise<{ ok: boolean; latencyMs: number }>): MatrixOp {
  return {
    id,
    protocol: "mixed",
    requiresFtpSession: true,
    execute: (ctx) => safelyExecute(id, ctx, operation),
  };
}

async function safelyExecute(
  id: string,
  ctx: MatrixOpContext,
  operation: (ctx: MatrixOpContext) => Promise<{ ok: boolean; latencyMs: number }>,
): Promise<{ ok: boolean; latencyMs: number }> {
  try {
    return await operation(ctx);
  } catch (error) {
    ctx.log({
      kind: "matrix-op",
      op: id,
      status: "error",
      details: { message: String(error) },
    });
    return { ok: false, latencyMs: 0 };
  }
}

async function nextSafeConfigTarget(ctx: MatrixOpContext): Promise<SafeConfigTarget | null> {
  if (safeConfigTargetCache) {
    return safeConfigTargetCache[0] ?? null;
  }

  const targets: SafeConfigTarget[] = [];
  const categories = await listCategories(ctx.restRequest);
  for (const category of categories) {
    if (SAFE_CATEGORY_BLOCKLIST.some((blocked) => category.toLowerCase().includes(blocked))) {
      continue;
    }
    const response = await ctx.restRequest({ method: "GET", url: `/v1/configs/${encodeURIComponent(category)}` });
    if (response.status !== 200 || typeof response.data !== "object" || response.data === null) {
      continue;
    }
    const categoryObject = (response.data as Record<string, unknown>)[category];
    if (!categoryObject || typeof categoryObject !== "object") {
      continue;
    }
    const item = pickSafeItem(categoryObject as Record<string, unknown>);
    if (!item || SAFE_ITEM_BLOCKLIST.some((blocked) => item.toLowerCase().includes(blocked))) {
      continue;
    }
    const detail = await ctx.restRequest({
      method: "GET",
      url: `/v1/configs/${encodeURIComponent(category)}/${encodeURIComponent(item)}`,
    });
    if (detail.status !== 200 || typeof detail.data !== "object" || detail.data === null) {
      continue;
    }
    const categoryDetail = (detail.data as Record<string, unknown>)[category] as Record<string, unknown> | undefined;
    const entry = categoryDetail ? (categoryDetail[item] as Record<string, unknown> | undefined) : undefined;
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const current = entry.current ?? entry.value;
    const next = pickNextValue(entry, current);
    const values: Array<string | number> = [];
    if (next !== undefined) {
      values.push(next);
    }
    if (Array.isArray(entry.values)) {
      for (const value of entry.values) {
        if ((typeof value === "string" || typeof value === "number") && !values.includes(value) && value !== current) {
          values.push(value);
        }
      }
    }
    if (values.length > 0) {
      targets.push({ category, item, values: values.slice(0, 3), nextIndex: 0 });
    }
  }
  safeConfigTargetCache = targets;
  return safeConfigTargetCache[0] ?? null;
}

async function uploadFile(ftpClient: FtpClient, config: HarnessConfig, data: Buffer): Promise<{ ok: boolean; latencyMs: number }> {
  const fileName = matrixProbeFileName(data.length);
  await ftpClient.cwd(config.scratch.ftpDir).catch(async () => {
    await ftpClient.mkd(config.scratch.ftpDir);
    await ftpClient.cwd(config.scratch.ftpDir);
  });
  const response = await ftpClient.stor(fileName, data);
  return { ok: response.response.code < 400, latencyMs: response.latencyMs };
}

async function roundTripFile(ftpClient: FtpClient, config: HarnessConfig, data: Buffer): Promise<{ ok: boolean; latencyMs: number }> {
  const fileName = matrixProbeFileName(data.length);
  const start = Date.now();
  const upload = await uploadFile(ftpClient, config, data);
  if (!upload.ok) {
    return { ok: false, latencyMs: upload.latencyMs };
  }
  const download = await ftpClient.retr(fileName);
  const remove = await ftpClient.dele(fileName);
  return {
    ok: download.result.response.code < 400 && remove.response.code < 400 && download.data.length === data.length,
    latencyMs: Date.now() - start,
  };
}

function matrixProbeFileName(size: number): string {
  return `matrix-${size}-${randomUUID().slice(0, 8)}.bin`;
}