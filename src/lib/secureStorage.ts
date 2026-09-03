/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog, buildErrorLogDetails } from "@/lib/logging";
import { describeValueShape, reportFallback } from "@/lib/diagnostics/fallbackReporter";
import { SecureStorage } from "@/lib/native/secureStorage";
import { getSelectedSavedDevice, setSavedDevicePasswordFlag, subscribeSavedDevices } from "@/lib/savedDevices/store";

const HAS_PASSWORD_KEY = "c64u_has_password";
// HARD27-001: web-platform-only bookkeeping for the devices whose passwords the
// single-password web server cannot hold. Never written on Android or iOS.
const WEB_ENVELOPE_KEY = "c64u_password_envelope";

type PersistedPasswordState = {
  version: 1;
  legacyDefaultPassword: string | null;
  passwordsByDeviceId: Record<string, string>;
};

let cachedPasswordState: PersistedPasswordState | null = null;
let passwordLoaded = false;
let passwordLoadPromise: Promise<PersistedPasswordState> | null = null;
let webServerPasswordNeedsRewrite = false;
let webDeviceSwitchSyncInstalled = false;
let lastSyncedWebDeviceId: string | null = null;

const DEFAULT_PASSWORD_STATE: PersistedPasswordState = {
  version: 1,
  legacyDefaultPassword: null,
  passwordsByDeviceId: {},
};

const parsePasswordState = (raw: string | null): PersistedPasswordState => {
  if (!raw) return DEFAULT_PASSWORD_STATE;
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedPasswordState> | null;
    if (
      parsed &&
      parsed.version === 1 &&
      parsed.passwordsByDeviceId &&
      typeof parsed.passwordsByDeviceId === "object"
    ) {
      return {
        version: 1,
        legacyDefaultPassword:
          typeof parsed.legacyDefaultPassword === "string" || parsed.legacyDefaultPassword === null
            ? parsed.legacyDefaultPassword
            : null,
        passwordsByDeviceId: Object.fromEntries(
          Object.entries(parsed.passwordsByDeviceId).filter(([, value]) => typeof value === "string"),
        ),
      };
    }
  } catch (error) {
    // A stored value that is not JSON is a password written before the envelope existed, so it is
    // still usable. Report the shape only: the value itself is the password.
    reportFallback("secureStorage.parsePasswordState", raw, { reason: describeValueShape(error) });
    return {
      version: 1,
      legacyDefaultPassword: raw,
      passwordsByDeviceId: {},
    };
  }
  return {
    version: 1,
    legacyDefaultPassword: raw,
    passwordsByDeviceId: {},
  };
};

const serializePasswordState = (state: PersistedPasswordState) => JSON.stringify(state);

const getSelectedDeviceId = () => getSelectedSavedDevice()?.id ?? null;

const resolvePasswordForDevice = (state: PersistedPasswordState, deviceId: string | null) => {
  if (deviceId && state.passwordsByDeviceId[deviceId]) {
    return state.passwordsByDeviceId[deviceId];
  }
  // HARD12-012: the legacy default password belongs to whichever device was
  // selected before per-device passwords existed. It may still be resolved
  // for that same currently-selected device (until migrateLegacyDefaultPassword
  // moves it into that device's own entry), but it must never be handed to an
  // explicitly-requested OTHER device — that would transmit device A's secret
  // to device B's host.
  if (deviceId && deviceId !== getSelectedDeviceId()) return null;
  return state.legacyDefaultPassword;
};

// HARD27-001: on the self-hosted web platform SecureStorage is the web server,
// which keeps exactly one plaintext password and uses it as the device
// X-Password header, the FTP password and the web login password. Writing the
// multi-device envelope there breaks all three and locks the user out once the
// session expires. On web the envelope therefore lives in localStorage and only
// the selected device's plaintext password is handed to the server.
const isWebServerMode = () => import.meta.env.VITE_WEB_PLATFORM === "1";

// Storage can be unavailable in a private-browsing context. That is not fatal:
// the selected device's password lives on the server, so only the other saved
// devices' entries are lost. The password itself is never logged.
const readWebEnvelope = (): string | null => {
  try {
    return localStorage.getItem(WEB_ENVELOPE_KEY);
  } catch (error) {
    addLog(
      "warn",
      "Failed to read the web password envelope; other saved devices' passwords are unavailable this session.",
      buildErrorLogDetails(error as Error, { storageKey: WEB_ENVELOPE_KEY }),
    );
    return null;
  }
};

const writeWebEnvelope = (state: PersistedPasswordState) => {
  try {
    localStorage.setItem(WEB_ENVELOPE_KEY, serializePasswordState(state));
  } catch (error) {
    addLog(
      "warn",
      "Failed to store the web password envelope; only the selected device's password will persist.",
      buildErrorLogDetails(error as Error, { storageKey: WEB_ENVELOPE_KEY }),
    );
  }
};

// The server value wins for the selected device because it is what the server
// actually sends. A server upgraded from before this fix still holds the
// envelope itself; parsing it back recovers the per-device passwords and flags
// the state for a one-time rewrite in primeStoredPassword.
const mergeWebServerPassword = (serverValue: string | null): PersistedPasswordState => {
  const local = parsePasswordState(readWebEnvelope());
  if (!serverValue) return local;
  const remote = parsePasswordState(serverValue);
  if (Object.keys(remote.passwordsByDeviceId).length > 0) {
    webServerPasswordNeedsRewrite = true;
    return {
      version: 1,
      legacyDefaultPassword: local.legacyDefaultPassword ?? remote.legacyDefaultPassword,
      passwordsByDeviceId: { ...local.passwordsByDeviceId, ...remote.passwordsByDeviceId },
    };
  }
  const deviceId = getSelectedDeviceId();
  if (!deviceId) return { ...local, legacyDefaultPassword: serverValue };
  return {
    version: 1,
    legacyDefaultPassword: local.legacyDefaultPassword,
    passwordsByDeviceId: { ...local.passwordsByDeviceId, [deviceId]: serverValue },
  };
};

const writePasswordStateToStorage = async (state: PersistedPasswordState, hasAnyPassword: boolean) => {
  if (isWebServerMode()) {
    writeWebEnvelope(state);
    webServerPasswordNeedsRewrite = false;
    const selectedPassword = resolvePasswordForDevice(state, getSelectedDeviceId());
    if (selectedPassword) {
      await SecureStorage.setPassword({ value: selectedPassword });
    } else {
      await SecureStorage.clearPassword();
    }
    return;
  }
  if (hasAnyPassword) {
    await SecureStorage.setPassword({ value: serializePasswordState(state) });
  } else {
    await SecureStorage.clearPassword();
  }
};

// HARD27-001: the web server holds one password for one device, so selecting a
// different saved device must re-send that device's password. Installed once
// from primeStoredPassword rather than at import time.
const installWebDeviceSwitchSync = () => {
  if (webDeviceSwitchSyncInstalled || !isWebServerMode()) return;
  webDeviceSwitchSyncInstalled = true;
  lastSyncedWebDeviceId = getSelectedDeviceId();
  subscribeSavedDevices(() => {
    const deviceId = getSelectedDeviceId();
    if (deviceId === lastSyncedWebDeviceId) return;
    lastSyncedWebDeviceId = deviceId;
    if (!cachedPasswordState) return;
    // A failed re-send leaves the previous device's password on the server,
    // which surfaces as the device auth challenge on the next REST call rather
    // than as a silent success. The next explicit write retries.
    void writePasswordStateToStorage(cachedPasswordState, true).catch((error: unknown) => {
      addLog(
        "warn",
        "Failed to send the newly selected device's password to the web server.",
        buildErrorLogDetails(error as Error, { deviceId }),
      );
    });
  });
};

const loadPasswordState = async (): Promise<PersistedPasswordState> => {
  if (passwordLoaded && cachedPasswordState) return cachedPasswordState;
  if (!passwordLoadPromise) {
    passwordLoadPromise = SecureStorage.getPassword()
      .then(({ value }) =>
        isWebServerMode() ? mergeWebServerPassword(value ?? null) : parsePasswordState(value ?? null),
      )
      .finally(() => {
        passwordLoadPromise = null;
      });
  }
  const state = await passwordLoadPromise;
  cachedPasswordState = state;
  passwordLoaded = true;
  return state;
};

const persistPasswordState = async (state: PersistedPasswordState) => {
  cachedPasswordState = state;
  passwordLoaded = true;
  const hasAnyPassword = Boolean(
    state.legacyDefaultPassword ||
    Object.keys(state.passwordsByDeviceId).some((deviceId) => state.passwordsByDeviceId[deviceId]),
  );
  setHasPasswordFlag(hasAnyPassword);
  await writePasswordStateToStorage(state, true);
};

export const hasStoredPasswordFlag = () => localStorage.getItem(HAS_PASSWORD_KEY) === "1";

const setHasPasswordFlag = (value: boolean) => {
  if (value) {
    localStorage.setItem(HAS_PASSWORD_KEY, "1");
  } else {
    localStorage.removeItem(HAS_PASSWORD_KEY);
  }
};

export const getCachedPassword = () => {
  if (!passwordLoaded || !cachedPasswordState) return null;
  return resolvePasswordForDevice(cachedPasswordState, getSelectedDeviceId());
};

export const getPasswordForDevice = async (deviceId: string): Promise<string | null> => {
  if (!hasStoredPasswordFlag()) {
    setSavedDevicePasswordFlag(deviceId, false);
    return null;
  }
  const state = await loadPasswordState();
  // HARD12-012: do NOT silently migrate the legacy password into the
  // requested device's entry. The legacy password belongs to the device that
  // was selected when it was stored; copying it into a different device's
  // entry transmits device A's secret to host B. The one-time bootstrap
  // migration runs from migrateLegacyDefaultPassword() during startup and
  // is keyed on the device selected at upgrade time.
  const current = resolvePasswordForDevice(state, deviceId);
  setSavedDevicePasswordFlag(deviceId, Boolean(current));
  return current;
};

export const setPasswordForDevice = async (deviceId: string, value: string): Promise<void> => {
  const state = await loadPasswordState();
  const nextState: PersistedPasswordState = {
    version: 1,
    legacyDefaultPassword: state.legacyDefaultPassword,
    passwordsByDeviceId: {
      ...state.passwordsByDeviceId,
      [deviceId]: value,
    },
  };
  await persistPasswordState(nextState);
  setSavedDevicePasswordFlag(deviceId, true);
};

export const clearPasswordForDevice = async (deviceId: string): Promise<void> => {
  const state = await loadPasswordState();
  const nextPasswordsByDeviceId = { ...state.passwordsByDeviceId };
  delete nextPasswordsByDeviceId[deviceId];
  const nextState: PersistedPasswordState = {
    version: 1,
    legacyDefaultPassword: state.legacyDefaultPassword,
    passwordsByDeviceId: nextPasswordsByDeviceId,
  };
  const hasAnyPassword = Boolean(
    nextState.legacyDefaultPassword ||
    Object.keys(nextState.passwordsByDeviceId).some((key) => nextState.passwordsByDeviceId[key]),
  );
  cachedPasswordState = nextState;
  passwordLoaded = true;
  setHasPasswordFlag(hasAnyPassword);
  await writePasswordStateToStorage(nextState, hasAnyPassword);
  setSavedDevicePasswordFlag(deviceId, false);
};

export const setPassword = async (value: string): Promise<void> => {
  const deviceId = getSelectedDeviceId();
  if (!deviceId) {
    setHasPasswordFlag(true);
    cachedPasswordState = {
      version: 1,
      legacyDefaultPassword: value,
      passwordsByDeviceId: cachedPasswordState?.passwordsByDeviceId ?? {},
    };
    passwordLoaded = true;
    await writePasswordStateToStorage(cachedPasswordState, true);
    return;
  }
  await setPasswordForDevice(deviceId, value);
};

export const getPassword = async (): Promise<string | null> => {
  const deviceId = getSelectedDeviceId();
  if (!hasStoredPasswordFlag()) {
    cachedPasswordState = DEFAULT_PASSWORD_STATE;
    passwordLoaded = true;
    return null;
  }
  if (deviceId) {
    return getPasswordForDevice(deviceId);
  }
  const state = await loadPasswordState();
  return state.legacyDefaultPassword;
};

export const clearPassword = async (): Promise<void> => {
  const deviceId = getSelectedDeviceId();
  if (deviceId) {
    await clearPasswordForDevice(deviceId);
    return;
  }
  setHasPasswordFlag(false);
  cachedPasswordState = DEFAULT_PASSWORD_STATE;
  passwordLoaded = true;
  await writePasswordStateToStorage(DEFAULT_PASSWORD_STATE, false);
};

export const primeStoredPassword = async (): Promise<void> => {
  installWebDeviceSwitchSync();
  if (passwordLoaded) return;
  if (!hasStoredPasswordFlag()) {
    cachedPasswordState = DEFAULT_PASSWORD_STATE;
    passwordLoaded = true;
    return;
  }
  // HARD12-012: once-only migration of the legacy default password into the
  // currently-selected device's entry. Idempotent: subsequent invocations are
  // no-ops because the legacy field is cleared after the first successful run.
  await migrateLegacyDefaultPassword();
  await getPassword();
  // HARD27-001: a web deployment upgraded from before this fix still has the
  // JSON envelope stored as the server's single password, which fails the
  // device X-Password header, FTP and the login page. Rewrite it once as the
  // selected device's plaintext password.
  if (webServerPasswordNeedsRewrite && cachedPasswordState) {
    await persistPasswordState(cachedPasswordState);
  }
};

// HARD12-012: when a legacy default password exists in storage, move it into
// the currently-selected device's entry exactly once and clear the legacy
// field. Must be idempotent and must not overwrite an existing per-device
// entry (that would clobber the device's own password with the legacy one).
export const migrateLegacyDefaultPassword = async (): Promise<void> => {
  const state = await loadPasswordState();
  if (!state.legacyDefaultPassword) return;
  const deviceId = getSelectedDeviceId();
  if (!deviceId) return;
  if (state.passwordsByDeviceId[deviceId]) {
    // Device already has its own entry — keep it, drop the legacy field so the
    // cross-device bleed cannot recur. The legacy password is abandoned; the
    // user must re-enter it for the originally-selected device if needed.
    await persistPasswordState({
      version: 1,
      legacyDefaultPassword: null,
      passwordsByDeviceId: state.passwordsByDeviceId,
    });
    return;
  }
  await persistPasswordState({
    version: 1,
    legacyDefaultPassword: null,
    passwordsByDeviceId: {
      ...state.passwordsByDeviceId,
      [deviceId]: state.legacyDefaultPassword,
    },
  });
};

export const resetStoredPasswordCache = () => {
  cachedPasswordState = null;
  passwordLoaded = false;
  passwordLoadPromise = null;
  webServerPasswordNeedsRewrite = false;
  lastSyncedWebDeviceId = null;
};
