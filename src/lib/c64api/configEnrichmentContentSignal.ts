/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

type ConfigEnrichmentContentListener = () => void;

const listeners = new Set<ConfigEnrichmentContentListener>();

/** Announces that the cached per-item config metadata changed, so a row that read the cache earlier can read it again. */
export const subscribeConfigEnrichmentContent = (listener: ConfigEnrichmentContentListener): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const notifyConfigEnrichmentContent = (): void => {
  listeners.forEach((listener) => listener());
};
