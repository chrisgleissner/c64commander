import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { URL } from "node:url";
import { PassThrough, Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { Client as FtpClient } from "basic-ftp";
import { normalizePassword, safeCompare, sanitizeHost, isTrustedInsecureHost } from "./hostValidation.js";
import { applySecurityHeaders, getClientIp } from "./securityHeaders.js";
import { readBody, readJsonBody, writeJson, writeText } from "./httpIO.js";
import { createStaticAssetServer } from "./staticAssets.js";
import { createAuthState } from "./authState.js";
import { variant } from "./variant.generated.js";

type AppConfig = {
  networkPassword: string | null;
  defaultDeviceHost: string;
};

type ServerLogLevel = "info" | "warn" | "error";

type ServerLogEntry = {
  id: string;
  timestamp: string;
  level: ServerLogLevel;
  message: string;
  details?: Record<string, unknown>;
};

const COOKIE_NAME = "c64_session";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const SESSION_CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
const LOGIN_FAILURE_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_FAILURE_BLOCK_MS = 5 * 60 * 1000;
const LOGIN_FAILURE_MAX_ATTEMPTS = 5;
const MAX_SERVER_LOGS = 500;
const PORT = Number(process.env.PORT ?? "8064");
const HOST = process.env.HOST ?? "0.0.0.0";
const configDir = process.env.WEB_CONFIG_DIR ?? "/config";
const configPath = path.join(configDir, "web-config.json");
const distDir = process.env.WEB_DIST_DIR ? path.resolve(process.env.WEB_DIST_DIR) : path.resolve(process.cwd(), "dist");

const hopByHopHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

const serverLogs: ServerLogEntry[] = [];

const isSecureCookieEnabled = (() => {
  const explicit = (process.env.WEB_COOKIE_SECURE ?? "").trim().toLowerCase();
  if (explicit === "true" || explicit === "1") return true;
  if (explicit === "false" || explicit === "0") return false;
  return false;
})();

const allowRemoteFtpHosts = (() => {
  const value = (process.env.WEB_ALLOW_REMOTE_FTP_HOSTS ?? "").trim().toLowerCase();
  return value === "true" || value === "1";
})();

const allowRemoteRestHosts = (() => {
  const value = (process.env.WEB_ALLOW_REMOTE_REST_HOSTS ?? "").trim().toLowerCase();
  return value === "true" || value === "1";
})();

const appendServerLog = (entry: ServerLogEntry) => {
  serverLogs.unshift(entry);
  if (serverLogs.length > MAX_SERVER_LOGS) {
    serverLogs.length = MAX_SERVER_LOGS;
  }
};

const log = (level: ServerLogLevel, message: string, details?: Record<string, unknown>) => {
  const timestamp = new Date().toISOString();
  const payload = {
    timestamp,
    level,
    message,
    ...(details ?? {}),
  };
  appendServerLog({
    id: randomBytes(12).toString("hex"),
    timestamp,
    level,
    message,
    details,
  });
  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
};

const errorDetails = (error: unknown) => {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
      ...(process.env.NODE_ENV === "production" ? {} : { errorStack: error.stack }),
    };
  }
  return { errorMessage: String(error) };
};

const { loginHtml, serveStatic } = createStaticAssetServer({
  distDir,
  logError: (message, details) => log("error", message, details),
  errorDetails,
});

const {
  isLoginBlocked,
  recordFailedLogin,
  clearFailedLogins,
  isAuthenticated,
  issueSessionCookie,
  clearSessionCookie,
  cleanupExpiredSessions,
} = createAuthState({
  cookieName: COOKIE_NAME,
  sessionTtlMs: SESSION_TTL_MS,
  isSecureCookieEnabled,
  loginFailureWindowMs: LOGIN_FAILURE_WINDOW_MS,
  loginFailureBlockMs: LOGIN_FAILURE_BLOCK_MS,
  loginFailureMaxAttempts: LOGIN_FAILURE_MAX_ATTEMPTS,
});

const buildDefaultConfig = (): AppConfig => ({
  networkPassword: normalizePassword(process.env.C64U_NETWORK_PASSWORD) ?? null,
  defaultDeviceHost: sanitizeHost(process.env.C64U_DEVICE_HOST) ?? variant.runtime.endpoints.device_host ?? "c64u",
});

const isConfigPermissionError = (error: unknown) => {
  const direct = error as NodeJS.ErrnoException | undefined;
  const directCode = direct?.code;
  if (directCode === "EACCES" || directCode === "EPERM" || directCode === "EROFS") {
    return true;
  }
  const cause = (error as { cause?: unknown } | undefined)?.cause as NodeJS.ErrnoException | undefined;
  const causeCode = cause?.code;
  if (causeCode === "EACCES" || causeCode === "EPERM" || causeCode === "EROFS") {
    return true;
  }
  const message = (error as Error | undefined)?.message || "";
  return /\b(EACCES|EPERM|EROFS)\b/.test(message);
};

const loadConfig = async (): Promise<AppConfig> => {
  const defaultConfig = buildDefaultConfig();
  try {
    await fs.mkdir(configDir, { recursive: true });
  } catch (error) {
    if (isConfigPermissionError(error)) {
      log("warn", "Web config directory is not writable; using runtime defaults only", {
        configDir,
        configPath,
        ...errorDetails(error),
      });
      return defaultConfig;
    }
    throw error;
  }
  try {
    const raw = await fs.readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    const networkPassword = normalizePassword(parsed.networkPassword);
    const defaultDeviceHost = sanitizeHost(parsed.defaultDeviceHost) ?? defaultConfig.defaultDeviceHost;
    return { networkPassword, defaultDeviceHost };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      try {
        await saveConfig(defaultConfig);
      } catch (saveError) {
        if (!isConfigPermissionError(saveError)) {
          throw saveError;
        }
        log("warn", "Web config file missing and cannot be created; using runtime defaults only", {
          configPath,
          ...errorDetails(saveError),
        });
      }
      return defaultConfig;
    }
    if (isConfigPermissionError(error)) {
      log("warn", "Web config file is not readable; using runtime defaults only", {
        configPath,
        ...errorDetails(error),
      });
      return defaultConfig;
    }
    if (error instanceof SyntaxError) {
      log("warn", "Web config JSON is invalid; using runtime defaults only", {
        configPath,
        ...errorDetails(error),
      });
      return defaultConfig;
    }
    if (err.code !== "ENOENT") {
      log("error", "Failed to load web config", errorDetails(error));
      throw error;
    }
    return defaultConfig;
  }
};

const saveConfig = async (config: AppConfig): Promise<void> => {
  try {
    await fs.mkdir(configDir, { recursive: true });
    const payload = JSON.stringify(config, null, 2);
    await fs.writeFile(configPath, payload, "utf8");
  } catch (error) {
    throw new Error(`Failed to persist web config at ${configPath}: ${(error as Error)?.message || String(error)}`, {
      cause: error as Error,
    });
  }
};

const requiresLogin = (config: AppConfig) => Boolean(config.networkPassword);

const handleRestProxy = async (req: IncomingMessage, res: ServerResponse, config: AppConfig, requestUrl: URL) => {
  const targetHost = sanitizeHost(req.headers["x-c64u-host"]) ?? config.defaultDeviceHost;
  if (!allowRemoteRestHosts && !isTrustedInsecureHost(targetHost)) {
    writeJson(res, 403, {
      error: "REST host override is disabled for non-local targets",
    });
    return;
  }
  const proxiedPath = requestUrl.pathname.replace(/^\/api\/rest/, "") || "/";
  const target = new URL(`http://${targetHost}${proxiedPath}${requestUrl.search}`);
  const body = await readBody(req);
  const outgoingHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (!value) continue;
    const lower = key.toLowerCase();
    if (hopByHopHeaders.has(lower)) continue;
    if (lower === "x-c64u-host" || lower === "cookie") continue;
    outgoingHeaders[key] = Array.isArray(value) ? value.join(",") : value;
  }
  if (config.networkPassword) {
    outgoingHeaders["X-Password"] = config.networkPassword;
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers: outgoingHeaders,
      body: body.length > 0 ? body : undefined,
    });
  } catch (error) {
    log("error", "REST proxy upstream error", {
      targetHost,
      path: requestUrl.pathname,
      ...errorDetails(error),
    });
    writeJson(res, 502, { error: "REST proxy upstream request failed" });
    return;
  }

  for (const [key, value] of upstream.headers.entries()) {
    if (hopByHopHeaders.has(key.toLowerCase())) continue;
    res.setHeader(key, value);
  }
  res.statusCode = upstream.status;
  const responseBody = Buffer.from(await upstream.arrayBuffer());
  res.end(responseBody);
};

const collectStream = async (stream: PassThrough): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    stream.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });
};

const handleFtpList = async (req: IncomingMessage, res: ServerResponse, config: AppConfig) => {
  const payload = await readJsonBody<{
    host?: string;
    port?: number;
    username?: string;
    password?: string;
    path?: string;
  }>(req);
  const requestedHost = sanitizeHost(payload.host) ?? config.defaultDeviceHost;
  if (!allowRemoteFtpHosts && requestedHost !== config.defaultDeviceHost) {
    writeJson(res, 403, { error: "FTP host override is disabled" });
    return;
  }
  const host = requestedHost;
  const ftp = new FtpClient();
  ftp.ftp.verbose = false;
  try {
    await ftp.access({
      host,
      port: Number(payload.port ?? 21),
      user: payload.username ?? "anonymous",
      password: config.networkPassword ?? payload.password ?? "",
      secure: false,
    });
    const entries = await ftp.list(payload.path ?? "/");
    writeJson(res, 200, {
      entries: entries.map((entry) => ({
        name: entry.name,
        path: `${payload.path ?? "/"}${(payload.path ?? "/").endsWith("/") ? "" : "/"}${entry.name}`,
        type: entry.type === 1 ? "file" : "dir",
        size: entry.size,
        modifiedAt: entry.modifiedAt ? entry.modifiedAt.toISOString() : null,
      })),
    });
  } catch (error) {
    log("error", "FTP list failed", {
      host,
      path: payload.path ?? "/",
      ...errorDetails(error),
    });
    writeJson(res, 502, { error: "FTP list failed" });
  } finally {
    try {
      ftp.close();
    } catch (error) {
      log("warn", "FTP close failed after list", errorDetails(error));
    }
  }
};

const handleFtpRead = async (req: IncomingMessage, res: ServerResponse, config: AppConfig) => {
  const payload = await readJsonBody<{
    host?: string;
    port?: number;
    username?: string;
    password?: string;
    path?: string;
  }>(req);
  if (!payload.path) {
    writeJson(res, 400, { error: "Missing FTP path" });
    return;
  }
  const requestedHost = sanitizeHost(payload.host) ?? config.defaultDeviceHost;
  if (!allowRemoteFtpHosts && requestedHost !== config.defaultDeviceHost) {
    writeJson(res, 403, { error: "FTP host override is disabled" });
    return;
  }
  const host = requestedHost;
  const ftp = new FtpClient();
  ftp.ftp.verbose = false;
  const stream = new PassThrough();
  try {
    await ftp.access({
      host,
      port: Number(payload.port ?? 21),
      user: payload.username ?? "anonymous",
      password: config.networkPassword ?? payload.password ?? "",
      secure: false,
    });
    const collectPromise = collectStream(stream);
    await ftp.downloadTo(stream, payload.path);
    stream.end();
    const data = await collectPromise;
    writeJson(res, 200, {
      data: data.toString("base64"),
      sizeBytes: data.byteLength,
    });
  } catch (error) {
    log("error", "FTP read failed", {
      host,
      path: payload.path,
      ...errorDetails(error),
    });
    writeJson(res, 502, { error: "FTP read failed" });
  } finally {
    try {
      ftp.close();
    } catch (error) {
      log("warn", "FTP close failed after read", errorDetails(error));
    }
  }
};

const handleFtpWrite = async (req: IncomingMessage, res: ServerResponse, config: AppConfig) => {
  const payload = await readJsonBody<{
    host?: string;
    port?: number;
    username?: string;
    password?: string;
    path?: string;
    data?: string;
  }>(req);
  if (!payload.path) {
    writeJson(res, 400, { error: "Missing FTP path" });
    return;
  }
  if (typeof payload.data !== "string") {
    writeJson(res, 400, { error: "Missing FTP data" });
    return;
  }
  const requestedHost = sanitizeHost(payload.host) ?? config.defaultDeviceHost;
  if (!allowRemoteFtpHosts && requestedHost !== config.defaultDeviceHost) {
    writeJson(res, 403, { error: "FTP host override is disabled" });
    return;
  }
  const host = requestedHost;
  const ftp = new FtpClient();
  ftp.ftp.verbose = false;
  try {
    await ftp.access({
      host,
      port: Number(payload.port ?? 21),
      user: payload.username ?? "anonymous",
      password: config.networkPassword ?? payload.password ?? "",
      secure: false,
    });
    const data = Buffer.from(payload.data, "base64");
    await ftp.uploadFrom(Readable.from(data), payload.path);
    writeJson(res, 200, { sizeBytes: data.byteLength });
  } catch (error) {
    log("error", "FTP write failed", {
      host,
      path: payload.path,
      ...errorDetails(error),
    });
    writeJson(res, 502, { error: "FTP write failed" });
  } finally {
    try {
      ftp.close();
    } catch (error) {
      log("warn", "FTP close failed after write", errorDetails(error));
    }
  }
};

export const startWebServer = async () => {
  let config = await loadConfig();
  cleanupExpiredSessions();
  const cleanupTimer = setInterval(() => {
    cleanupExpiredSessions();
  }, SESSION_CLEANUP_INTERVAL_MS);

  const server = http.createServer(async (req, res) => {
    try {
      applySecurityHeaders(req, res);
      const method = (req.method ?? "GET").toUpperCase();
      const requestUrl = new URL(req.url ?? "/", "http://localhost");
      const pathname = requestUrl.pathname;

      if (pathname === "/healthz") {
        writeJson(res, 200, { ok: true });
        return;
      }

      if (pathname === "/auth/status") {
        writeJson(res, 200, {
          requiresLogin: requiresLogin(config),
          authenticated: isAuthenticated(req),
        });
        return;
      }

      if (pathname === "/auth/login") {
        if (method !== "POST") {
          writeJson(res, 405, { error: "Method not allowed" });
          return;
        }
        const clientIp = getClientIp(req);
        if (isLoginBlocked(clientIp)) {
          writeJson(res, 429, {
            error: "Too many failed login attempts. Try again later.",
          });
          return;
        }
        const payload = await readJsonBody<{ password?: string }>(req);
        const candidate = payload.password ?? "";
        const expected = config.networkPassword;
        if (!expected || !safeCompare(candidate, expected)) {
          recordFailedLogin(clientIp);
          writeJson(res, 401, { error: "Invalid password" });
          return;
        }
        clearFailedLogins(clientIp);
        issueSessionCookie(res);
        writeJson(res, 200, { ok: true });
        return;
      }

      if (pathname === "/auth/logout") {
        clearSessionCookie(req, res);
        writeJson(res, 200, { ok: true });
        return;
      }

      const needsAuth = requiresLogin(config);
      const authenticated = isAuthenticated(req);
      const isPublicLoginPage = pathname === "/login";

      if (needsAuth && !authenticated) {
        if (isPublicLoginPage) {
          writeText(res, 200, loginHtml(), "text/html; charset=utf-8");
          return;
        }
        writeJson(res, 401, { error: "Authentication required" });
        return;
      }

      if (pathname === "/api/secure-storage/password") {
        if (method === "GET") {
          writeJson(res, 200, { value: config.networkPassword });
          return;
        }
        if (method === "PUT") {
          const payload = await readJsonBody<{ value?: string }>(req);
          const password = normalizePassword(payload.value);
          config = { ...config, networkPassword: password };
          await saveConfig(config);
          if (password && !authenticated) {
            issueSessionCookie(res);
          }
          writeJson(res, 200, { ok: true, hasPassword: Boolean(password) });
          return;
        }
        if (method === "DELETE") {
          config = { ...config, networkPassword: null };
          await saveConfig(config);
          clearSessionCookie(req, res);
          writeJson(res, 200, { ok: true });
          return;
        }
        writeJson(res, 405, { error: "Method not allowed" });
        return;
      }

      if (pathname === "/api/diagnostics/server-logs") {
        if (method !== "GET") {
          writeJson(res, 405, { error: "Method not allowed" });
          return;
        }
        writeJson(res, 200, { logs: serverLogs });
        return;
      }

      if (pathname.startsWith("/api/rest/")) {
        await handleRestProxy(req, res, config, requestUrl);
        return;
      }

      if (pathname === "/api/ftp/list") {
        if (method !== "POST") {
          writeJson(res, 405, { error: "Method not allowed" });
          return;
        }
        await handleFtpList(req, res, config);
        return;
      }

      if (pathname === "/api/ftp/read") {
        if (method !== "POST") {
          writeJson(res, 405, { error: "Method not allowed" });
          return;
        }
        await handleFtpRead(req, res, config);
        return;
      }

      if (pathname === "/api/ftp/write") {
        if (method !== "POST") {
          writeJson(res, 405, { error: "Method not allowed" });
          return;
        }
        await handleFtpWrite(req, res, config);
        return;
      }

      if (pathname === "/login") {
        res.writeHead(302, { Location: "/" });
        res.end();
        return;
      }

      await serveStatic(res, pathname);
    } catch (error) {
      log("error", "Unhandled web server error", errorDetails(error));
      writeJson(res, 500, { error: "Internal server error" });
    }
  });

  server.once("close", () => {
    clearInterval(cleanupTimer);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, HOST, () => resolve());
  });

  log("info", "C64 Commander web server running", {
    host: HOST,
    port: PORT,
    secureCookies: isSecureCookieEnabled,
    allowRemoteFtpHosts,
  });
  return server;
};

const isDirectRun = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry) === path.resolve(fileURLToPath(import.meta.url));
})();

if (isDirectRun) {
  void startWebServer().catch((error) => {
    log("error", "Failed to start web server", errorDetails(error));
    process.exit(1);
  });
}
