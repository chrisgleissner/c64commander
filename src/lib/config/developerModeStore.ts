export type DeviceMode = 'REAL_DEVICE' | 'MOCK_DEVICE';

type DevModeEventDetail = { enabled: boolean };
type DeviceModeEventDetail = { mode: DeviceMode };

const DEV_MODE_KEY = 'c64u_dev_mode_enabled';
const DEVICE_MODE_KEY = 'c64u_device_mode';
const REAL_BASE_URL_KEY = 'c64u_real_base_url';
const REAL_DEVICE_HOST_KEY = 'c64u_real_device_host';
const REAL_FTP_PORT_KEY = 'c64u_real_ftp_port';
const MOCK_BASE_URL_KEY = 'c64u_mock_base_url';

const DEV_MODE_EVENT = 'c64u-dev-mode-change';
const DEVICE_MODE_EVENT = 'c64u-device-mode-change';

export const getDeveloperModeEnabled = () => localStorage.getItem(DEV_MODE_KEY) === '1';

export const setDeveloperModeEnabled = (enabled: boolean) => {
  localStorage.setItem(DEV_MODE_KEY, enabled ? '1' : '0');
  window.dispatchEvent(
    new CustomEvent<DevModeEventDetail>(DEV_MODE_EVENT, { detail: { enabled } }),
  );
};

export const subscribeDeveloperMode = (listener: (detail: DevModeEventDetail) => void) => {
  const handler = (event: Event) => {
    listener((event as CustomEvent<DevModeEventDetail>).detail);
  };
  window.addEventListener(DEV_MODE_EVENT, handler as EventListener);
  return () => window.removeEventListener(DEV_MODE_EVENT, handler as EventListener);
};

export const getDeviceMode = (): DeviceMode => {
  const stored = localStorage.getItem(DEVICE_MODE_KEY);
  return stored === 'MOCK_DEVICE' ? 'MOCK_DEVICE' : 'REAL_DEVICE';
};

export const setDeviceMode = (mode: DeviceMode) => {
  localStorage.setItem(DEVICE_MODE_KEY, mode);
  window.dispatchEvent(
    new CustomEvent<DeviceModeEventDetail>(DEVICE_MODE_EVENT, { detail: { mode } }),
  );
};

export const subscribeDeviceMode = (listener: (detail: DeviceModeEventDetail) => void) => {
  const handler = (event: Event) => {
    listener((event as CustomEvent<DeviceModeEventDetail>).detail);
  };
  window.addEventListener(DEVICE_MODE_EVENT, handler as EventListener);
  return () => window.removeEventListener(DEVICE_MODE_EVENT, handler as EventListener);
};

export const getStoredRealBaseUrl = () => localStorage.getItem(REAL_BASE_URL_KEY);

export const setStoredRealBaseUrl = (baseUrl: string) => {
  localStorage.setItem(REAL_BASE_URL_KEY, baseUrl);
};

export const getStoredRealDeviceHost = () => localStorage.getItem(REAL_DEVICE_HOST_KEY);

export const setStoredRealDeviceHost = (host: string) => {
  localStorage.setItem(REAL_DEVICE_HOST_KEY, host);
};

export const clearStoredRealDeviceHost = () => {
  localStorage.removeItem(REAL_DEVICE_HOST_KEY);
};

export const getStoredRealFtpPort = () => localStorage.getItem(REAL_FTP_PORT_KEY);

export const setStoredRealFtpPort = (port: number) => {
  localStorage.setItem(REAL_FTP_PORT_KEY, String(port));
};

export const clearStoredRealFtpPort = () => {
  localStorage.removeItem(REAL_FTP_PORT_KEY);
};

export const getStoredMockBaseUrl = () => localStorage.getItem(MOCK_BASE_URL_KEY);

export const setStoredMockBaseUrl = (baseUrl: string) => {
  localStorage.setItem(MOCK_BASE_URL_KEY, baseUrl);
};

export const clearStoredMockBaseUrl = () => {
  localStorage.removeItem(MOCK_BASE_URL_KEY);
};
