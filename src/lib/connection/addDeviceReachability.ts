/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { isAuthRequiredError } from "@/lib/c64api/transportErrors";
import { probeDeviceReachability } from "@/lib/connection/connectionManager";
import { startDeviceDiscovery } from "@/lib/deviceDiscovery/discoveryManager";
import { addLog } from "@/lib/logging";

/**
 * Reachability verdict for a device the user is about to save.
 * - `reachable`: the host answered `/v1/info` — safe to save.
 * - `needs-password`: the host answered with 401/403 — reachable, the password flow
 *   handles auth, so saving is allowed.
 * - `unreachable`: no answer. When the user typed a hostname that does not resolve,
 *   `suggestedAddress` carries the IP the device was actually found at on the LAN, so
 *   the UI can calmly steer the user to it instead of silently failing.
 */
export type NewDeviceReachability =
  | { status: "reachable" }
  | { status: "needs-password" }
  | { status: "unreachable"; suggestedAddress: string | null; suggestedHostname: string | null };

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** A bare IPv4 literal needs no hostname→IP rescue (it IS an address). */
export const isLikelyIpAddress = (host: string): boolean => IPV4.test(host.trim());

export type EvaluateNewDeviceReachabilityDeps = {
  probe: typeof probeDeviceReachability;
  discover: typeof startDeviceDiscovery;
};

const defaultDeps: EvaluateNewDeviceReachabilityDeps = {
  probe: probeDeviceReachability,
  discover: startDeviceDiscovery,
};

/**
 * Decide whether a device can be saved, and — when an entered hostname is unreachable —
 * try to find the same device by IP on the LAN so the UI can suggest the working address.
 * Discovery is best-effort (a no-op on web / when the native scan is unsupported); failure
 * to scan simply yields a plain "unreachable" verdict with no suggestion.
 */
export const evaluateNewDeviceReachability = async (
  input: { host: string; deviceHost: string; password?: string | null },
  deps: EvaluateNewDeviceReachabilityDeps = defaultDeps,
): Promise<NewDeviceReachability> => {
  const probe = await deps.probe({ deviceHost: input.deviceHost, password: input.password ?? null });
  if (probe.ok) return { status: "reachable" };
  if (isAuthRequiredError(probe.error)) return { status: "needs-password" };

  // Genuinely unreachable. If the user typed a hostname (not an IP), the most common
  // cause is name resolution — look for the device on the LAN and suggest its IP.
  if (isLikelyIpAddress(input.host)) {
    return { status: "unreachable", suggestedAddress: null, suggestedHostname: null };
  }

  const wantedHostname = input.host.trim().toLowerCase();
  try {
    const result = await deps.discover({ trigger: "settings", includeLanScan: true });
    const candidates = result.candidates ?? [];
    // Prefer an exact hostname match; otherwise, if the scan saw exactly one Ultimate,
    // it is almost certainly the device the user is trying to reach.
    const match =
      candidates.find((candidate) => (candidate.hostname ?? "").trim().toLowerCase() === wantedHostname) ??
      (candidates.length === 1 ? candidates[0] : null);
    if (match?.address) {
      return { status: "unreachable", suggestedAddress: match.address, suggestedHostname: match.hostname ?? null };
    }
  } catch (error) {
    // Discovery is best-effort (a no-op on web); fall through to a plain unreachable verdict.
    addLog("debug", "Reachability IP-rescue discovery failed", {
      host: input.host,
      error: error instanceof Error ? error.message : String(error ?? "unknown error"),
    });
  }
  return { status: "unreachable", suggestedAddress: null, suggestedHostname: null };
};
