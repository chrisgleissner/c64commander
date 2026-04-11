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
  const current = resolvePasswordForDevice(state, deviceId);
  if (current && !state.passwordsByDeviceId[deviceId]) {
    const nextState: PersistedPasswordState = {
      ...state,
      passwordsByDeviceId: {
        ...state.passwordsByDeviceId,
        [deviceId]: current,
      },
    };
    await persistPasswordState(nextState);
  }
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
  await getPassword();
};

export const resetStoredPasswordCache = () => {
  cachedPasswordState = null;
  passwordLoaded = false;
  passwordLoadPromise = null;
};
