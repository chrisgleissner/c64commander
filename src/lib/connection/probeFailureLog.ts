/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// Background probes repeat every few seconds while a device is away; logging each identical failure
// crowded everything else out of the log. Only a change of failure class per host is announced.
const lastFailureClassByHost = new Map<string, string>();

export const isNewProbeFailure = (deviceHost: string, failureClass: string): boolean => {
  if (lastFailureClassByHost.get(deviceHost) === failureClass) return false;
  lastFailureClassByHost.set(deviceHost, failureClass);
  return true;
};

export const noteProbeAnswered = (deviceHost: string) => {
  lastFailureClassByHost.delete(deviceHost);
};

export const clearProbeFailureLog = () => {
  lastFailureClassByHost.clear();
};
