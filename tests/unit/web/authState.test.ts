// @vitest-environment node
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createAuthState } from "../../../web/server/src/authState";

const createRequest = (cookie?: string) =>
  ({
    headers: {
      cookie,
    },
  }) as IncomingMessage;

const createResponse = () =>
  ({
    setHeader: vi.fn(),
  }) as unknown as ServerResponse & { setHeader: ReturnType<typeof vi.fn> };

const createSubject = (overrides: Partial<Parameters<typeof createAuthState>[0]> = {}) =>
  createAuthState({
    cookieName: "c64u_session",
    sessionTtlMs: 60_000,
    isSecureCookieEnabled: true,
    loginFailureWindowMs: 10_000,
    loginFailureBlockMs: 5_000,
    loginFailureMaxAttempts: 3,
    loginFailureGlobalMaxAttempts: 6,
    loginFailureGlobalBudgetEnabled: false,
    ...overrides,
  });

const extractCookieValue = (response: ReturnType<typeof createResponse>) => {
  const cookieHeader = vi.mocked(response.setHeader).mock.calls.find(([name]) => name === "Set-Cookie")?.[1];
  expect(typeof cookieHeader).toBe("string");
  const [pair] = String(cookieHeader).split(";");
  const [, encodedValue] = pair.split("=");
  return decodeURIComponent(encodedValue);
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("authState", () => {
  // HARD27-008: the budget across all keys exists for the one configuration
  // where a client picks its own key. Everywhere else the key is the socket
  // address, and a budget there would let one LAN client lock every other
  // client out of the login page for the block period. A blocked request is
  // answered before the password is compared, so the correct password that is
  // supposed to release the budget never reaches `clearFailedLogins`.
  it("does not apply the global attempt budget when no forwarded address is trusted", () => {
    const authState = createSubject({ loginFailureGlobalBudgetEnabled: false });

    for (let index = 0; index < 20; index += 1) {
      authState.recordFailedLogin(`198.51.100.${index}`);
    }

    expect(authState.isLoginBlocked("203.0.113.9")).toBe(false);
  });

  it("applies the global attempt budget when a forwarded address is trusted", () => {
    const authState = createSubject({ loginFailureGlobalBudgetEnabled: true });

    for (let index = 0; index < 6; index += 1) {
      authState.recordFailedLogin(`198.51.100.${index}`);
    }

    expect(authState.isLoginBlocked("203.0.113.9")).toBe(true);
  });

  it("issues secure session cookies, authenticates requests, and clears sessions", () => {
    const authState = createSubject();
    const response = createResponse();

    authState.issueSessionCookie(response);

    expect(response.setHeader).toHaveBeenCalledWith("Set-Cookie", expect.stringContaining("c64u_session="));
    expect(response.setHeader).toHaveBeenCalledWith("Set-Cookie", expect.stringContaining("; Secure"));

    const token = extractCookieValue(response);
    const request = createRequest(`c64u_session=${encodeURIComponent(token)}`);
    expect(authState.isAuthenticated(request)).toBe(true);

    const clearResponse = createResponse();
    authState.clearSessionCookie(request, clearResponse);

    expect(authState.isAuthenticated(request)).toBe(false);
    expect(clearResponse.setHeader).toHaveBeenCalledWith(
      "Set-Cookie",
      "c64u_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0; Secure",
    );
  });

  it("expires sessions on authentication checks and cleanup", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T00:00:00Z"));

    const authState = createSubject();
    const response = createResponse();
    authState.issueSessionCookie(response);
    const token = extractCookieValue(response);
    const request = createRequest(`c64u_session=${encodeURIComponent(token)}`);

    expect(authState.isAuthenticated(request)).toBe(true);

    vi.setSystemTime(new Date("2026-03-15T00:01:01Z"));
    expect(authState.isAuthenticated(request)).toBe(false);

    const secondResponse = createResponse();
    authState.issueSessionCookie(secondResponse);
    const secondToken = extractCookieValue(secondResponse);
    const secondRequest = createRequest(`c64u_session=${encodeURIComponent(secondToken)}`);

    vi.setSystemTime(new Date("2026-03-15T00:02:02Z"));
    authState.cleanupExpiredSessions();

    expect(authState.isAuthenticated(secondRequest)).toBe(false);
  });

  it("blocks repeated failed logins until the block window expires or failures are cleared", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T00:00:00Z"));

    const authState = createSubject();

    expect(authState.isLoginBlocked("203.0.113.7")).toBe(false);

    authState.recordFailedLogin("203.0.113.7");
    authState.recordFailedLogin("203.0.113.7");
    expect(authState.isLoginBlocked("203.0.113.7")).toBe(false);

    authState.recordFailedLogin("203.0.113.7");
    expect(authState.isLoginBlocked("203.0.113.7")).toBe(true);

    vi.setSystemTime(new Date("2026-03-15T00:00:06Z"));
    expect(authState.isLoginBlocked("203.0.113.7")).toBe(false);

    authState.recordFailedLogin("203.0.113.7");
    authState.clearFailedLogins("203.0.113.7");
    expect(authState.isLoginBlocked("203.0.113.7")).toBe(false);
  });

  it("resets stale login-failure windows before counting new attempts", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T00:00:00Z"));

    const authState = createSubject();
    authState.recordFailedLogin("198.51.100.9");
    authState.recordFailedLogin("198.51.100.9");

    vi.setSystemTime(new Date("2026-03-15T00:00:11Z"));
    expect(authState.isLoginBlocked("198.51.100.9")).toBe(false);

    authState.recordFailedLogin("198.51.100.9");

    expect(authState.isLoginBlocked("198.51.100.9")).toBe(false);

    authState.recordFailedLogin("198.51.100.9");
    authState.recordFailedLogin("198.51.100.9");
    expect(authState.isLoginBlocked("198.51.100.9")).toBe(true);
  });
});
