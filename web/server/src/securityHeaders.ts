import type { IncomingMessage, ServerResponse } from "node:http";

// HARD27-008: `X-Forwarded-For` and `X-Forwarded-Proto` are only meaningful when
// a reverse proxy the operator controls sets them. The shipped Docker image binds
// 0.0.0.0:8064 directly, where any LAN client can send either header, so both are
// ignored unless WEB_TRUST_PROXY says a proxy is in front.
export const isForwardedHttps = (req: IncomingMessage, trustProxy: boolean): boolean => {
  if (!trustProxy) return false;
  const forwardedProto = req.headers["x-forwarded-proto"];
  return typeof forwardedProto === "string" && forwardedProto.split(",")[0].trim().toLowerCase() === "https";
};

export const getClientIp = (req: IncomingMessage, trustProxy: boolean) => {
  if (trustProxy) {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.trim()) {
      return forwarded.split(",")[0].trim();
    }
  }
  return req.socket.remoteAddress ?? "unknown";
};

export const applySecurityHeaders = (req: IncomingMessage, res: ServerResponse, trustProxy: boolean) => {
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self' data:",
  );

  if (isForwardedHttps(req, trustProxy)) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
};
