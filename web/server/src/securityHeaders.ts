import type { IncomingMessage, ServerResponse } from "node:http";

export const getClientIp = (req: IncomingMessage) => {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress ?? "unknown";
};

export const applySecurityHeaders = (
  req: IncomingMessage,
  res: ServerResponse,
) => {
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self' data:",
  );

  const forwardedProto = req.headers["x-forwarded-proto"];
  const isForwardedHttps =
    typeof forwardedProto === "string" &&
    forwardedProto.split(",")[0].trim().toLowerCase() === "https";
  if (isForwardedHttps) {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  }
};
