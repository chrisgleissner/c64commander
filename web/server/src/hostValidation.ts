import net from "node:net";
import { timingSafeEqual } from "node:crypto";

const isPrivateIpv4 = (hostname: string) => {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!match) return false;
  const octets = match.slice(1).map((value) => Number(value));
  if (octets.some((value) => Number.isNaN(value) || value < 0 || value > 255))
    return false;
  if (octets[0] === 10) return true;
  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
  if (octets[0] === 192 && octets[1] === 168) return true;
  if (octets[0] === 127) return true;
  if (octets[0] === 169 && octets[1] === 254) return true;
  return false;
};

const isPrivateIpv6 = (hostname: string) => {
  const value = hostname.trim().toLowerCase();
  if (!value.includes(":")) return false;
  if (value === "::1") return true;

  const firstSegment = value.split(":")[0];
  if (!firstSegment) return false;
  const firstHextet = Number.parseInt(firstSegment, 16);
  if (Number.isNaN(firstHextet)) return false;

  if ((firstHextet & 0xffc0) === 0xfe80) return true;
  if ((firstHextet & 0xfe00) === 0xfc00) return true;
  return false;
};

export const isTrustedInsecureHost = (hostValue: string) => {
  const lower = hostValue.trim().toLowerCase();
  if (!lower) return false;
  if (lower === "c64u" || lower === "localhost") return true;
  if (lower === "127.0.0.1") return true;
  if (lower.endsWith(".local")) return true;

  if (lower.startsWith("[")) {
    const closingBracketIndex = lower.indexOf("]");
    if (closingBracketIndex > 0) {
      const ipv6Host = lower.slice(1, closingBracketIndex);
      return isPrivateIpv6(ipv6Host);
    }
  }

  const hostWithoutPort =
    lower.includes(":") && lower.indexOf(":") === lower.lastIndexOf(":")
      ? lower.split(":")[0]
      : lower;
  return isPrivateIpv4(hostWithoutPort) || isPrivateIpv6(hostWithoutPort);
};

export const normalizePassword = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const sanitizeHost = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return null;
  if (/[\s/\\?#@]/.test(trimmed)) return null;

  if (net.isIP(trimmed)) return trimmed;

  const isValidHostname = (hostname: string) => {
    if (hostname.length > 253) return false;
    const labels = hostname.split(".");
    return labels.every((label) =>
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label),
    );
  };

  const parsePort = (portValue: string) => {
    const port = Number(portValue);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    return port;
  };

  if (trimmed.startsWith("[")) {
    const closingBracketIndex = trimmed.indexOf("]");
    if (closingBracketIndex <= 1) return null;
    const hostPart = trimmed.slice(1, closingBracketIndex);
    if (net.isIP(hostPart) !== 6) return null;
    const remainder = trimmed.slice(closingBracketIndex + 1);
    if (!remainder) return `[${hostPart}]`;
    const portMatch = /^:(\d{1,5})$/.exec(remainder);
    if (!portMatch) return null;
    const port = parsePort(portMatch[1]);
    if (port === null) return null;
    return `[${hostPart}]:${port}`;
  }

  if (trimmed.includes(":")) {
    if (trimmed.indexOf(":") !== trimmed.lastIndexOf(":")) {
      return null;
    }
    const maybeHostPort = /^([^:]+):(\d{1,5})$/.exec(trimmed);
    if (!maybeHostPort) return null;
    const hostPart = maybeHostPort[1];
    const port = parsePort(maybeHostPort[2]);
    if (port === null) return null;
    if (!net.isIP(hostPart) && !isValidHostname(hostPart)) return null;
    return `${hostPart}:${port}`;
  }

  if (isValidHostname(trimmed)) return trimmed;
  return null;
};

export const safeCompare = (left: string, right: string): boolean => {
  const leftBuf = Buffer.from(left);
  const rightBuf = Buffer.from(right);
  if (leftBuf.length !== rightBuf.length) return false;
  return timingSafeEqual(leftBuf, rightBuf);
};
