// @vitest-environment node
import type { IncomingMessage, ServerResponse } from "node:http";

import { describe, expect, it, vi } from "vitest";

import { applySecurityHeaders, getClientIp } from "../../../web/server/src/securityHeaders";

const createRequest = (headers: IncomingMessage["headers"] = {}, remoteAddress?: string) =>
  ({
    headers,
    socket: {
      remoteAddress,
    },
  }) as IncomingMessage;

const createResponse = () =>
  ({
    setHeader: vi.fn(),
  }) as unknown as ServerResponse & { setHeader: ReturnType<typeof vi.fn> };

describe("securityHeaders", () => {
  it("prefers the first forwarded client IP when present", () => {
    const req = createRequest({ "x-forwarded-for": "198.51.100.12, 10.0.0.7" }, "10.0.0.7");

    expect(getClientIp(req)).toBe("198.51.100.12");
  });

  it("falls back to the socket address or unknown when no forwarded IP exists", () => {
    expect(getClientIp(createRequest({}, "10.0.0.7"))).toBe("10.0.0.7");
    expect(getClientIp(createRequest({}, undefined))).toBe("unknown");
  });

  it("applies the base security headers and HSTS for forwarded https requests", () => {
    const req = createRequest({ "x-forwarded-proto": "https, http" });
    const res = createResponse();

    applySecurityHeaders(req, res);

    expect(res.setHeader).toHaveBeenCalledWith("X-Frame-Options", "DENY");
    expect(res.setHeader).toHaveBeenCalledWith("X-Content-Type-Options", "nosniff");
    expect(res.setHeader).toHaveBeenCalledWith("Referrer-Policy", "strict-origin-when-cross-origin");
    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Security-Policy",
      "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self' data:",
    );
    expect(res.setHeader).toHaveBeenCalledWith("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  });

  it("omits HSTS when the forwarded protocol is absent or not https", () => {
    const nonHttpsResponse = createResponse();
    applySecurityHeaders(createRequest({ "x-forwarded-proto": "http" }), nonHttpsResponse);

    expect(nonHttpsResponse.setHeader).not.toHaveBeenCalledWith(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );

    const missingHeaderResponse = createResponse();
    applySecurityHeaders(createRequest({}), missingHeaderResponse);

    expect(missingHeaderResponse.setHeader).not.toHaveBeenCalledWith(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  });
});
