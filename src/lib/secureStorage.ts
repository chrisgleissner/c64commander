import { SecureStorage } from '@/lib/native/secureStorage';

const HAS_PASSWORD_KEY = 'c64u_has_password';

let cachedPassword: string | null = null;
let passwordLoaded = false;
let passwordLoadPromise: Promise<string | null> | null = null;

export const hasStoredPasswordFlag = () => localStorage.getItem(HAS_PASSWORD_KEY) === '1';

const setHasPasswordFlag = (value: boolean) => {
  if (value) {
    localStorage.setItem(HAS_PASSWORD_KEY, '1');
  } else {
    localStorage.removeItem(HAS_PASSWORD_KEY);
  }
};

const setCachedPassword = (value: string | null) => {
  cachedPassword = value;
  passwordLoaded = true;
};

export const getCachedPassword = () => (passwordLoaded ? cachedPassword : null);

export const setPassword = async (value: string): Promise<void> => {
  setHasPasswordFlag(true);
  setCachedPassword(value);
  await SecureStorage.setPassword({ value });
};

export const getPassword = async (): Promise<string | null> => {
  if (!hasStoredPasswordFlag()) {
    setCachedPassword(null);
    return null;
  }
  if (passwordLoaded) return cachedPassword;
  if (!passwordLoadPromise) {
    passwordLoadPromise = SecureStorage.getPassword()
      .then(({ value }) => value ?? null)
      .finally(() => {
        passwordLoadPromise = null;
      });
  }
  const value = await passwordLoadPromise;
  setCachedPassword(value);
  return value;
};

export const clearPassword = async (): Promise<void> => {
  setHasPasswordFlag(false);
  setCachedPassword(null);
  await SecureStorage.clearPassword();
};

export const primeStoredPassword = async (): Promise<void> => {
  if (passwordLoaded) return;
  if (!hasStoredPasswordFlag()) {
    setCachedPassword(null);
    return;
  }
  await getPassword();
};

export const resetStoredPasswordCache = () => {
  cachedPassword = null;
  passwordLoaded = false;
  passwordLoadPromise = null;
};
