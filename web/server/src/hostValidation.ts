import net from "node:net";
import { timingSafeEqual } from "node:crypto";

export const isPrivateIpv4 = (hostname: string) => {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!match) return false;
  const octets = match.slice(1).map((value) => Number(value));
  if (octets.some((value) => Number.isNaN(value) || value < 0 || value > 255)) return false;
  if (octets[0] === 10) return true;
  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
  if (octets[0] === 192 && octets[1] === 168) return true;
  if (octets[0] === 127) return true;
  if (octets[0] === 169 && octets[1] === 254) return true;
  return false;
};

export const isPrivateIpv6 = (hostname: string) => {
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

export const isPrivateIpAddress = (address: string) => {
  const value = address.trim().toLowerCase();
  return isPrivateIpv4(value) || isPrivateIpv6(value);
};

// The bare hostname of a `host`, `host:port` or `[v6]:port` value.
export const getHostnameFromHostValue = (hostValue: string): string | null => {
  const lower = hostValue.trim().toLowerCase();
  if (!lower) return null;
  if (lower.startsWith("[")) {
    const closingBracketIndex = lower.indexOf("]");
    return closingBracketIndex > 1 ? lower.slice(1, closingBracketIndex) : null;
  }
  if (lower.includes(":") && lower.indexOf(":") === lower.lastIndexOf(":")) {
    return lower.split(":")[0] || null;
  }
  return lower;
};

export const isTrustedInsecureHost = (hostValue: string) => {
  const hostname = getHostnameFromHostValue(hostValue);
  if (!hostname) return false;
  if (hostname === "c64u" || hostname === "localhost") return true;
  if (hostname.endsWith(".local")) return true;
  return isPrivateIpAddress(hostname);
};

export const normalizePassword = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

// HARD27-001: the app stores per-device passwords as a JSON envelope, while
// this server keeps one plaintext password that it uses as the device
// X-Password header, the FTP password and the web login password. Storing the
// envelope breaks all three and locks the user out of the login page, so the
// envelope is rejected at the boundary rather than accepted and misused.
export const isPasswordEnvelope = (value: unknown): boolean => {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{")) return false;
  try {
    const parsed = JSON.parse(trimmed) as { version?: unknown; passwordsByDeviceId?: unknown } | null;
    return Boolean(
      parsed &&
      typeof parsed === "object" &&
      parsed.version === 1 &&
      typeof parsed.passwordsByDeviceId === "object" &&
      parsed.passwordsByDeviceId !== null,
    );
  } catch {
    // Not JSON: an ordinary password that happens to start with a brace.
    return false;
  }
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
    return labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
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

// HARD27-016: the configured password belongs to the configured device only, so
// the REST proxy has to tell that device apart from any other LAN host before
// attaching it. A missing port means the HTTP default: `c64u` and `c64u:80` are
// the same device.
export const isConfiguredDeviceHost = (candidate: string, configured: string): boolean => {
  const split = (value: string): { host: string; port: number } | null => {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) return null;
    if (trimmed.startsWith("[")) {
      const closingBracketIndex = trimmed.indexOf("]");
      if (closingBracketIndex <= 1) return null;
      const host = trimmed.slice(1, closingBracketIndex);
      const remainder = trimmed.slice(closingBracketIndex + 1);
      if (!remainder) return { host, port: 80 };
      const portMatch = /^:(\d{1,5})$/.exec(remainder);
      return portMatch ? { host, port: Number(portMatch[1]) } : null;
    }
    if (trimmed.includes(":") && trimmed.indexOf(":") === trimmed.lastIndexOf(":")) {
      const hostPort = /^([^:]+):(\d{1,5})$/.exec(trimmed);
      if (hostPort) return { host: hostPort[1], port: Number(hostPort[2]) };
    }
    return { host: trimmed, port: 80 };
  };

  const left = split(candidate);
  const right = split(configured);
  if (!left || !right) return false;
  return left.host === right.host && left.port === right.port;
};
