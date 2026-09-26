/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// Accessors that only report where the client points; error handlers still need them after a switch.
const UNGUARDED_ACCESSORS = new Set<PropertyKey>(["getDeviceHost", "getBaseUrl", "getPassword"]);

/**
 * Wrap an object whose methods talk to "the connected device" so every call first checks that the device is
 * still the one the operation started on. The API client is shared and retargeted by a device switch, so a
 * multi-step operation that outlives the switch would otherwise finish its writes on the other device.
 */
export const bindCallsToDevice = <T extends object>(
  target: T,
  startHost: string,
  currentHost: () => string,
  operation: string,
): T =>
  new Proxy(target, {
    get(object, property, receiver) {
      const value = Reflect.get(object, property, receiver);
      if (typeof value !== "function" || UNGUARDED_ACCESSORS.has(property)) return value;
      return (...args: unknown[]) => {
        const host = currentHost();
        if (host !== startHost) {
          throw new Error(
            `The connected device changed from ${startHost} to ${host} while ${operation}; nothing more was sent.`,
          );
        }
        return value.apply(object, args);
      };
    },
  });
