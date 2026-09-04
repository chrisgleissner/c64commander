import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { URL } from "node:url";
import { PassThrough, Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { Client as FtpClient } from "basic-ftp";
import {
  normalizePassword,
  isPasswordEnvelope,
  safeCompare,
  sanitizeHost,
  isConfiguredDeviceHost,
} from "./hostValidation.js";
import { createLanHostPolicy } from "./hostPolicy.js";
import { applySecurityHeaders, getClientIp, isForwardedHttps } from "./securityHeaders.js";
import {
  FILE_BODY_LIMIT_BYTES,
  FILE_BYTES_LIMIT,
  PayloadTooLargeError,
  readBody,
  readJsonBody,
  writeJson,
  writeText,
} from "./httpIO.js";
import { createStaticAssetServer } from "./staticAssets.js";
import { createAuthState } from "./authState.js";
import { variant } from "./variant.generated.js";
import { createStreamBridge, DEFAULT_STREAM_VIDEO_PORT, DEFAULT_STREAM_AUDIO_PORT } from "./streamBridge.js";

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
// The budget across every key, so a client that varies its forwarded address
// cannot escape the per-key limiter. Generous enough that several people on the
// LAN can each mistype their password.
const LOGIN_FAILURE_GLOBAL_MAX_ATTEMPTS = 30;
const MAX_SERVER_LOGS = 500;
// HARD27-017: the browser sends no timeout of its own, so the proxy bounds the
// upstream request itself. Fifteen seconds is above the app's own REST timeouts
// and well below the minutes an unanswered TCP connection can survive.
const DEFAULT_REST_PROXY_TIMEOUT_MS = 15_000;
const REST_PROXY_TIMEOUT_MS = (() => {
  const configured = Number((process.env.WEB_REST_PROXY_TIMEOUT_MS ?? "").trim());
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_REST_PROXY_TIMEOUT_MS;
})();
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

// HARD27-008: one switch governs every behaviour that depends on a reverse proxy
// being in front — whether X-Forwarded-For keys the login limiter, whether
// X-Forwarded-Proto can produce HSTS, and whether the session cookie may be
// marked Secure.
const trustProxy = (() => {
  const value = (process.env.WEB_TRUST_PROXY ?? "").trim().toLowerCase();
  return value === "true" || value === "1";
})();

// null defers the decision to the forwarded protocol of each request; an
// explicit WEB_COOKIE_SECURE still wins in either direction.
const isSecureCookieEnabled = (() => {
  const explicit = (process.env.WEB_COOKIE_SECURE ?? "").trim().toLowerCase();
  if (explicit === "true" || explicit === "1") return true;
  if (explicit === "false" || explicit === "0") return false;
  return trustProxy ? null : false;
})();

const allowRemoteFtpHosts = (() => {
  const value = (process.env.WEB_ALLOW_REMOTE_FTP_HOSTS ?? "").trim().toLowerCase();
  return value === "true" || value === "1";
})();

const allowRemoteRestHosts = (() => {
  const value = (process.env.WEB_ALLOW_REMOTE_REST_HOSTS ?? "").trim().toLowerCase();
  return value === "true" || value === "1";
})();

// HARD27-030: "on my LAN" is decided by resolving the requested name, so a
// device saved as `u64`, `ultimate64` or `c64u.lan` is proxied like any private
// IP literal. The two WEB_ALLOW_REMOTE_* switches stay as the explicit opt-in
// for a target outside that range.
const lanHostPolicy = createLanHostPolicy({});

// A gate the server closed itself, told apart from the device's own 401/403 so
// the app redirects to the login page instead of asking for the device password
// (HARD27-029, HARD27-030).
const GATE_HEADER = "X-C64Commander-Gate";

const writeGateError = (
  res: ServerResponse,
  status: number,
  gate: "session-expired" | "host-policy",
  payload: Record<string, unknown>,
) => {
  res.setHeader(GATE_HEADER, gate);
  if (gate === "session-expired") {
    res.setHeader("WWW-Authenticate", 'c64commander-session realm="C64 Commander"');
  }
  writeJson(res, status, payload);
};

// A/V mirror stream bridge. Disabled unless WEB_STREAM_BRIDGE is truthy, so the default
// deployment opens no extra UDP ports. When on, the device streams VIC video / audio to
// these UDP ports and the bridge relays them to the browser over WebSocket.
const streamBridgeEnabled = (() => {
  const value = (process.env.WEB_STREAM_BRIDGE ?? "").trim().toLowerCase();
  return value === "true" || value === "1";
})();
const streamVideoPort = Number(process.env.WEB_STREAM_VIDEO_PORT ?? DEFAULT_STREAM_VIDEO_PORT);
const streamAudioPort = Number(process.env.WEB_STREAM_AUDIO_PORT ?? DEFAULT_STREAM_AUDIO_PORT);

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
  loginFailureGlobalMaxAttempts: LOGIN_FAILURE_GLOBAL_MAX_ATTEMPTS,
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
    await restrictConfigPermissions();
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

// HARD27-015: the config file holds the network password in plaintext and lands
// on a bind-mounted volume, so it must not be world-readable. The mode argument
// only applies when the file is created, so an existing file is chmod-ed too.
const CONFIG_FILE_MODE = 0o600;

const restrictConfigPermissions = async (): Promise<void> => {
  try {
    await fs.chmod(configPath, CONFIG_FILE_MODE);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return;
    log("warn", "Could not restrict web config file permissions", {
      configPath,
      ...errorDetails(error),
    });
  }
};

const saveConfig = async (config: AppConfig): Promise<void> => {
  try {
    await fs.mkdir(configDir, { recursive: true });
    const payload = JSON.stringify(config, null, 2);
    await fs.writeFile(configPath, payload, { encoding: "utf8", mode: CONFIG_FILE_MODE });
    await restrictConfigPermissions();
  } catch (error) {
    throw new Error(`Failed to persist web config at ${configPath}: ${(error as Error)?.message || String(error)}`, {
      cause: error as Error,
    });
  }
};

const requiresLogin = (config: AppConfig) => Boolean(config.networkPassword);

const handleRestProxy = async (req: IncomingMessage, res: ServerResponse, config: AppConfig, requestUrl: URL) => {
  const targetHost = sanitizeHost(req.headers["x-c64u-host"]) ?? config.defaultDeviceHost;
  const isConfiguredDevice = isConfiguredDeviceHost(targetHost, config.defaultDeviceHost);
  if (!allowRemoteRestHosts && !isConfiguredDevice && !(await lanHostPolicy.isLanHost(targetHost))) {
    writeGateError(res, 403, "host-policy", {
      error: "REST host override is disabled for non-local targets",
    });
    return;
  }
  const proxiedPath = requestUrl.pathname.replace(/^\/api\/rest/, "") || "/";
  const target = new URL(`http://${targetHost}${proxiedPath}${requestUrl.search}`);
  const body = await readBody(req, FILE_BODY_LIMIT_BYTES);
  const outgoingHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (!value) continue;
    const lower = key.toLowerCase();
    if (hopByHopHeaders.has(lower)) continue;
    if (lower === "x-c64u-host" || lower === "cookie") continue;
    outgoingHeaders[key] = Array.isArray(value) ? value.join(",") : value;
  }
  // HARD27-016: the configured password authenticates the configured device and
  // nothing else, so another LAN host must supply its own. The client's header
  // arrives lower-cased and is dropped before the injected one is added, or
  // fetch() combines the two into one comma-joined value.
  if (isConfiguredDevice && config.networkPassword) {
    delete outgoingHeaders["x-password"];
    outgoingHeaders["X-Password"] = config.networkPassword;
  }

  let upstream: Response;
  try {
    // HARD27-017: without a signal the upstream socket stays open until the
    // device answers or the OS tears it down. A wedged device plus browser
    // retries then accumulates sockets and their buffered bodies here.
    upstream = await fetch(target, {
      method: req.method,
      headers: outgoingHeaders,
      body: body.length > 0 ? body : undefined,
      signal: AbortSignal.timeout(REST_PROXY_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = (error as Error | undefined)?.name === "TimeoutError";
    log("error", timedOut ? "REST proxy upstream timed out" : "REST proxy upstream error", {
      targetHost,
      path: requestUrl.pathname,
      timeoutMs: timedOut ? REST_PROXY_TIMEOUT_MS : undefined,
      ...errorDetails(error),
    });
    if (timedOut) {
      writeJson(res, 504, { error: "REST proxy upstream timed out" });
      return;
    }
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

// HARD27-009: the whole remote file was collected in memory and then
// base64-encoded into one response, so a large file on the Ultimate's SD card
// held roughly three times its size in the heap. The transfer is aborted as soon
// as it crosses the same 32 MiB the Android FTP plugin enforces.
const collectStream = async (stream: PassThrough, limitBytes = FILE_BYTES_LIMIT): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  let total = 0;
  return new Promise((resolve, reject) => {
    stream.on("data", (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > limitBytes) {
        chunks.length = 0;
        stream.destroy(new PayloadTooLargeError(limitBytes));
        return;
      }
      chunks.push(buffer);
    });
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });
};

// HARD27-016 on the FTP paths: the configured password authenticates the
// configured device and nothing else. The LAN host policy admits any
// private-range host, so a request that names a different one must carry that
// device's own password instead of being handed the server's.
const ftpPasswordFor = (host: string, config: AppConfig, supplied: string | undefined): string => {
  const configured = isConfiguredDeviceHost(host, config.defaultDeviceHost) ? config.networkPassword : null;
  return configured ?? supplied ?? "";
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
  if (
    !allowRemoteFtpHosts &&
    !isConfiguredDeviceHost(requestedHost, config.defaultDeviceHost) &&
    !(await lanHostPolicy.isLanHost(requestedHost))
  ) {
    writeGateError(res, 403, "host-policy", { error: "FTP host override is disabled for non-local targets" });
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
      password: ftpPasswordFor(host, config, payload.password),
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
  if (
    !allowRemoteFtpHosts &&
    !isConfiguredDeviceHost(requestedHost, config.defaultDeviceHost) &&
    !(await lanHostPolicy.isLanHost(requestedHost))
  ) {
    writeGateError(res, 403, "host-policy", { error: "FTP host override is disabled for non-local targets" });
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
      password: ftpPasswordFor(host, config, payload.password),
      secure: false,
    });
    // The collector aborts the stream once the file crosses the size limit, so
    // downloadTo rejects too. Settling the collector first makes that abort the
    // reported cause, and keeps its rejection from going unhandled.
    let collectError: unknown = null;
    const collectPromise = collectStream(stream).catch((error: unknown) => {
      collectError = error;
      return Buffer.alloc(0);
    });
    try {
      await ftp.downloadTo(stream, payload.path);
      stream.end();
    } catch (downloadError) {
      await collectPromise;
      throw collectError ?? downloadError;
    }
    const data = await collectPromise;
    if (collectError) throw collectError;
    writeJson(res, 200, {
      data: data.toString("base64"),
      sizeBytes: data.byteLength,
    });
  } catch (error) {
    const tooLarge = error instanceof PayloadTooLargeError;
    log(tooLarge ? "warn" : "error", tooLarge ? "FTP read exceeded the size limit" : "FTP read failed", {
      host,
      path: payload.path,
      limitBytes: tooLarge ? FILE_BYTES_LIMIT : undefined,
      ...errorDetails(error),
    });
    if (tooLarge) {
      writeJson(res, 413, { error: `File exceeds the ${FILE_BYTES_LIMIT}-byte read limit` });
    } else {
      writeJson(res, 502, { error: "FTP read failed" });
    }
  } finally {
    try {
      ftp.close();
    } catch (error) {
      log("warn", "FTP close failed after read", errorDetails(error));
    }
  }
};

const handleFtpPing = async (req: IncomingMessage, res: ServerResponse, config: AppConfig) => {
  const payload = await readJsonBody<{
    host?: string;
    port?: number;
    username?: string;
    password?: string;
  }>(req);
  const requestedHost = sanitizeHost(payload.host) ?? config.defaultDeviceHost;
  if (
    !allowRemoteFtpHosts &&
    !isConfiguredDeviceHost(requestedHost, config.defaultDeviceHost) &&
    !(await lanHostPolicy.isLanHost(requestedHost))
  ) {
    writeGateError(res, 403, "host-policy", { error: "FTP host override is disabled for non-local targets" });
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
      password: ftpPasswordFor(host, config, payload.password),
      secure: false,
    });
    await ftp.send("NOOP");
    writeJson(res, 200, { ok: true });
  } catch (error) {
    log("error", "FTP ping failed", {
      host,
      ...errorDetails(error),
    });
    writeJson(res, 502, { error: "FTP ping failed" });
  } finally {
    try {
      ftp.close();
    } catch (error) {
      log("warn", "FTP close failed after ping", errorDetails(error));
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
  }>(req, FILE_BODY_LIMIT_BYTES);
  if (!payload.path) {
    writeJson(res, 400, { error: "Missing FTP path" });
    return;
  }
  if (typeof payload.data !== "string") {
    writeJson(res, 400, { error: "Missing FTP data" });
    return;
  }
  const requestedHost = sanitizeHost(payload.host) ?? config.defaultDeviceHost;
  if (
    !allowRemoteFtpHosts &&
    !isConfiguredDeviceHost(requestedHost, config.defaultDeviceHost) &&
    !(await lanHostPolicy.isLanHost(requestedHost))
  ) {
    writeGateError(res, 403, "host-policy", { error: "FTP host override is disabled for non-local targets" });
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
      password: ftpPasswordFor(host, config, payload.password),
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
      applySecurityHeaders(req, res, trustProxy);
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
        const clientIp = getClientIp(req, trustProxy);
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
        issueSessionCookie(res, isForwardedHttps(req, trustProxy));
        writeJson(res, 200, { ok: true });
        return;
      }

      if (pathname === "/auth/logout") {
        clearSessionCookie(req, res, isForwardedHttps(req, trustProxy));
        writeJson(res, 200, { ok: true });
        return;
      }

      const needsAuth = requiresLogin(config);
      const authenticated = isAuthenticated(req);
      const isPublicLoginPage = pathname === "/login";

      if (needsAuth && !authenticated) {
        // HARD27-029: the documented entry point is the root, and a session
        // expires after a day or when the container restarts. A browser
        // navigation is answered with the login page wherever it lands, so the
        // user sees a password field instead of a JSON error page. Everything
        // else - the app's own fetches - gets a 401 the client can tell apart
        // from the device asking for its network password.
        const acceptsHtml = (req.headers.accept ?? "").toLowerCase().includes("text/html");
        if (isPublicLoginPage || (method === "GET" && acceptsHtml)) {
          writeText(res, 200, loginHtml(), "text/html; charset=utf-8");
          return;
        }
        writeGateError(res, 401, "session-expired", { error: "Authentication required" });
        return;
      }

      if (pathname === "/api/secure-storage/password") {
        if (method === "GET") {
          writeJson(res, 200, { value: config.networkPassword });
          return;
        }
        if (method === "PUT") {
          const payload = await readJsonBody<{ value?: string }>(req);
          if (isPasswordEnvelope(payload.value)) {
            writeJson(res, 400, {
              error: "Expected the device password as plain text, not the app's per-device password envelope",
            });
            return;
          }
          const password = normalizePassword(payload.value);
          config = { ...config, networkPassword: password };
          await saveConfig(config);
          if (password && !authenticated) {
            issueSessionCookie(res, isForwardedHttps(req, trustProxy));
          }
          writeJson(res, 200, { ok: true, hasPassword: Boolean(password) });
          return;
        }
        if (method === "DELETE") {
          config = { ...config, networkPassword: null };
          await saveConfig(config);
          clearSessionCookie(req, res, isForwardedHttps(req, trustProxy));
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

      if (pathname === "/api/ftp/ping") {
        if (method !== "POST") {
          writeJson(res, 405, { error: "Method not allowed" });
          return;
        }
        await handleFtpPing(req, res, config);
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
      if (error instanceof PayloadTooLargeError) {
        log("warn", "Rejected an oversized request body", {
          path: req.url,
          limitBytes: error.limitBytes,
        });
        if (!res.headersSent) {
          // The request body is still arriving. Close the connection once the
          // 413 has been flushed so the client stops sending, rather than
          // letting the rest of the body drain through the socket.
          res.setHeader("Connection", "close");
          res.once("finish", () => req.socket?.destroySoon());
          writeJson(res, 413, { error: "Request body too large" });
        }
        return;
      }
      log("error", "Unhandled web server error", errorDetails(error));
      writeJson(res, 500, { error: "Internal server error" });
    }
  });

  const streamBridge = streamBridgeEnabled
    ? createStreamBridge({
        videoPort: streamVideoPort,
        audioPort: streamAudioPort,
        // The server log sink has no "debug" level; keep the bridge's per-connection
        // debug chatter out and forward only info/warn/error.
        log: (level, message, details) => {
          if (level !== "debug") log(level, message, details);
        },
      })
    : null;

  if (streamBridge) {
    // Only claim WebSocket upgrades on the two stream paths; everything else is destroyed
    // (the app has no other WebSocket endpoints).
    server.on("upgrade", (req, socket, _head) => {
      const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
      // Respect the same login gate as the REST/FTP proxy: an unauthenticated client cannot
      // open a mirror stream. Browsers send the session cookie on same-origin WS handshakes.
      if (requiresLogin(config) && !isAuthenticated(req)) {
        // end() flushes the response before closing (destroy() could drop it).
        socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        return;
      }
      if (!streamBridge.handleUpgrade(req, socket, pathname)) {
        socket.destroy();
      }
    });
  }

  server.once("close", () => {
    clearInterval(cleanupTimer);
    void streamBridge?.close();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, HOST, () => resolve());
  });

  if (streamBridge) {
    // A UDP bind conflict must degrade the mirror, never take down the whole web server.
    try {
      await streamBridge.start();
    } catch (error) {
      log("warn", "A/V mirror stream bridge failed to start (mirror disabled)", errorDetails(error));
    }
  }

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
