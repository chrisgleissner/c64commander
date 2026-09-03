import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

type SessionRecord = {
  token: string;
  createdAtMs: number;
  expiresAtMs: number;
};

type LoginAttemptRecord = {
  failures: number;
  firstFailureAtMs: number;
  blockedUntilMs: number;
};

const parseCookies = (headerValue: string | undefined): Record<string, string> => {
  if (!headerValue) return {};
  return headerValue.split(";").reduce<Record<string, string>>((acc, pair) => {
    const idx = pair.indexOf("=");
    if (idx < 0) return acc;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (key) acc[key] = decodeURIComponent(value);
    return acc;
  }, {});
};

export const createAuthState = (options: {
  cookieName: string;
  sessionTtlMs: number;
  // null means "decide per request from the trusted forwarded protocol"; a
  // boolean is the operator's explicit WEB_COOKIE_SECURE answer.
  isSecureCookieEnabled: boolean | null;
  loginFailureWindowMs: number;
  loginFailureBlockMs: number;
  loginFailureMaxAttempts: number;
  loginFailureGlobalMaxAttempts: number;
}) => {
  const {
    cookieName,
    sessionTtlMs,
    isSecureCookieEnabled,
    loginFailureWindowMs,
    loginFailureBlockMs,
    loginFailureMaxAttempts,
    loginFailureGlobalMaxAttempts,
  } = options;

  const sessions = new Map<string, SessionRecord>();
  const loginAttempts = new Map<string, LoginAttemptRecord>();
  // HARD27-008: a per-key limiter cannot stop a client that varies its key. When
  // WEB_TRUST_PROXY is on, X-Forwarded-For is one such key, so a budget across
  // all keys backs the per-key one up.
  let globalAttempts: LoginAttemptRecord = { failures: 0, firstFailureAtMs: 0, blockedUntilMs: 0 };

  const isGloballyBlocked = () => {
    const now = Date.now();
    if (globalAttempts.blockedUntilMs > now) return true;
    if (globalAttempts.failures > 0 && now - globalAttempts.firstFailureAtMs > loginFailureWindowMs) {
      globalAttempts = { failures: 0, firstFailureAtMs: 0, blockedUntilMs: 0 };
    }
    return false;
  };

  const isLoginBlocked = (clientIp: string) => {
    if (isGloballyBlocked()) return true;
    const attempt = loginAttempts.get(clientIp);
    if (!attempt) return false;
    if (attempt.blockedUntilMs > Date.now()) return true;
    if (Date.now() - attempt.firstFailureAtMs > loginFailureWindowMs) {
      loginAttempts.delete(clientIp);
    }
    return false;
  };

  const recordFailedLogin = (clientIp: string) => {
    const now = Date.now();
    if (globalAttempts.failures === 0 || now - globalAttempts.firstFailureAtMs > loginFailureWindowMs) {
      globalAttempts = { failures: 1, firstFailureAtMs: now, blockedUntilMs: 0 };
    } else {
      globalAttempts.failures += 1;
      if (globalAttempts.failures >= loginFailureGlobalMaxAttempts) {
        globalAttempts.blockedUntilMs = now + loginFailureBlockMs;
      }
    }
    const existing = loginAttempts.get(clientIp);
    if (!existing || now - existing.firstFailureAtMs > loginFailureWindowMs) {
      loginAttempts.set(clientIp, {
        failures: 1,
        firstFailureAtMs: now,
        blockedUntilMs: 0,
      });
      return;
    }
    existing.failures += 1;
    if (existing.failures >= loginFailureMaxAttempts) {
      existing.blockedUntilMs = now + loginFailureBlockMs;
    }
    loginAttempts.set(clientIp, existing);
  };

  // A correct password proves the caller is not the brute-forcer the budget is
  // there to stop, so it releases the global budget too. Otherwise a spoofing
  // attacker could lock the operator out for the block period.
  const clearFailedLogins = (clientIp: string) => {
    loginAttempts.delete(clientIp);
    globalAttempts = { failures: 0, firstFailureAtMs: 0, blockedUntilMs: 0 };
  };

  const isAuthenticated = (req: IncomingMessage): boolean => {
    const token = parseCookies(req.headers.cookie)[cookieName];
    if (!token) return false;
    const session = sessions.get(token);
    if (!session) return false;
    if (session.expiresAtMs < Date.now()) {
      sessions.delete(token);
      return false;
    }
    return true;
  };

  const issueSessionCookie = (res: ServerResponse, forwardedHttps = false) => {
    const token = randomBytes(24).toString("base64url");
    const createdAtMs = Date.now();
    const session: SessionRecord = {
      token,
      createdAtMs,
      expiresAtMs: createdAtMs + sessionTtlMs,
    };
    sessions.set(token, session);
    const securePart = (isSecureCookieEnabled ?? forwardedHttps) ? "; Secure" : "";
    res.setHeader(
      "Set-Cookie",
      `${cookieName}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(sessionTtlMs / 1000)}${securePart}`,
    );
  };

  const clearSessionCookie = (req: IncomingMessage, res: ServerResponse, forwardedHttps = false) => {
    const token = parseCookies(req.headers.cookie)[cookieName];
    if (token) {
      sessions.delete(token);
    }
    const securePart = (isSecureCookieEnabled ?? forwardedHttps) ? "; Secure" : "";
    res.setHeader("Set-Cookie", `${cookieName}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${securePart}`);
  };

  const cleanupExpiredSessions = () => {
    const now = Date.now();
    for (const [token, session] of sessions.entries()) {
      if (session.expiresAtMs < now) sessions.delete(token);
    }
  };

  return {
    isLoginBlocked,
    recordFailedLogin,
    clearFailedLogins,
    isAuthenticated,
    issueSessionCookie,
    clearSessionCookie,
    cleanupExpiredSessions,
  };
};
