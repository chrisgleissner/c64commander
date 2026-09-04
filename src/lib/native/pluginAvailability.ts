/*
 * Capacitor registers a plugin by name, not by method, so `isPluginAvailable("FtpClient")` is true
 * on iOS even for a method the Swift `pluginMethods` array does not list. The only way to learn
 * that a specific method is absent is to call it and read the rejection.
 *
 * `tests/unit/ci/iosPluginMethodParity.test.ts` records which methods are missing on iOS. This is
 * the runtime counterpart: it lets a caller degrade deliberately instead of surfacing Capacitor's
 * raw `"FtpClient.cancelRead()" is not implemented on ios` to the user.
 */
const UNIMPLEMENTED_MESSAGE_PATTERN =
  /unimplemented|not implemented|no such method|method not found|is not a function/i;

/**
 * Whether a plugin call failed because this platform has no such native method, as opposed to
 * failing on its own terms. Capacitor reports this as an `UNIMPLEMENTED` code on iOS and as a
 * message on the web; a proxy that does not define the method at all raises a `TypeError`.
 */
export const isPluginMethodUnimplemented = (error: unknown): boolean => {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  if (typeof code === "string" && code.toUpperCase() === "UNIMPLEMENTED") return true;
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return UNIMPLEMENTED_MESSAGE_PATTERN.test(message);
};

/*
 * An unimplemented method stays unimplemented for the life of the process, so each one is latched
 * the first time it rejects. Without this a caller on a 5 s probe cadence writes one log entry
 * every 5 s for as long as the app runs, which is the pattern that has previously crowded a
 * 500-entry diagnostics log out.
 */
const unavailableMethods = new Set<string>();

export const isKnownUnavailable = (method: string): boolean => unavailableMethods.has(method);

/** Returns true the first time this method is recorded, so a caller can log exactly once. */
export const recordUnavailable = (method: string): boolean => {
  if (unavailableMethods.has(method)) return false;
  unavailableMethods.add(method);
  return true;
};

export const resetPluginAvailabilityForTests = () => {
  unavailableMethods.clear();
};
