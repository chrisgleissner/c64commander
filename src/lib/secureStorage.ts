/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { SecureStorage } from "@/lib/native/secureStorage";
import { getSelectedSavedDevice, setSavedDevicePasswordFlag } from "@/lib/savedDevices/store";

const HAS_PASSWORD_KEY = "c64u_has_password";

type PersistedPasswordState = {
  version: 1;
  legacyDefaultPassword: string | null;
  passwordsByDeviceId: Record<string, string>;
};

let cachedPasswordState: PersistedPasswordState | null = null;
let passwordLoaded = false;
let passwordLoadPromise: Promise<PersistedPasswordState> | null = null;

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
  } catch {
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

const loadPasswordState = async (): Promise<PersistedPasswordState> => {
  if (passwordLoaded && cachedPasswordState) return cachedPasswordState;
  if (!passwordLoadPromise) {
    passwordLoadPromise = SecureStorage.getPassword()
      .then(({ value }) => parsePasswordState(value ?? null))
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
  await SecureStorage.setPassword({ value: serializePasswordState(state) });
};

export const hasStoredPasswordFlag = () => localStorage.getItem(HAS_PASSWORD_KEY) === "1";

const setHasPasswordFlag = (value: boolean) => {
  if (value) {
    localStorage.setItem(HAS_PASSWORD_KEY, "1");
  } else {
    localStorage.removeItem(HAS_PASSWORD_KEY);
  }
};

const setCachedPassword = (value: string | null) => {
  const deviceId = getSelectedDeviceId();
  cachedPasswordState = {
    version: 1,
    legacyDefaultPassword: deviceId ? (cachedPasswordState?.legacyDefaultPassword ?? null) : value,
    passwordsByDeviceId:
      deviceId && value
        ? { ...(cachedPasswordState?.passwordsByDeviceId ?? {}), [deviceId]: value }
        : (cachedPasswordState?.passwordsByDeviceId ?? {}),
  };
  passwordLoaded = true;
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
  if (hasAnyPassword) {
    await SecureStorage.setPassword({ value: serializePasswordState(nextState) });
  } else {
    await SecureStorage.clearPassword();
  }
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
    await SecureStorage.setPassword({ value: serializePasswordState(cachedPasswordState) });
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
  await SecureStorage.clearPassword();
};

export const primeStoredPassword = async (): Promise<void> => {
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
};
