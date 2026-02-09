/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

type DevModeEventDetail = { enabled: boolean };

const DEV_MODE_KEY = 'c64u_dev_mode_enabled';
const DEV_MODE_EVENT = 'c64u-dev-mode-change';

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
