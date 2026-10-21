/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export const SID_RADIO_QUEUE_LIMIT_KEY = "c64u_sid_radio_queue_limit";
export const DEFAULT_SID_RADIO_QUEUE_LIMIT = 200;
export const MIN_SID_RADIO_QUEUE_LIMIT = 20;
export const MAX_SID_RADIO_QUEUE_LIMIT = 1000;

const normalizeRadioQueueLimit = (value: number) =>
  Number.isFinite(value)
    ? Math.min(MAX_SID_RADIO_QUEUE_LIMIT, Math.max(MIN_SID_RADIO_QUEUE_LIMIT, Math.round(value)))
    : DEFAULT_SID_RADIO_QUEUE_LIMIT;

/** The current tune, lookahead and recent history share this limit; explicit user additions survive. */
export const loadSidRadioQueueLimit = () => {
  const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(SID_RADIO_QUEUE_LIMIT_KEY);
  return normalizeRadioQueueLimit(raw ? Number(raw) : DEFAULT_SID_RADIO_QUEUE_LIMIT);
};

export const saveSidRadioQueueLimit = (value: number) => {
  if (typeof localStorage === "undefined") return;
  const normalized = normalizeRadioQueueLimit(value);
  localStorage.setItem(SID_RADIO_QUEUE_LIMIT_KEY, String(normalized));
  window.dispatchEvent(
    new CustomEvent("c64u-app-settings-updated", {
      detail: { key: SID_RADIO_QUEUE_LIMIT_KEY, value: normalized },
    }),
  );
};
