/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * HARD16-004: a same-host device identity flip (firmware upgrade, or a
 * different unit behind the same hostname) changes the config-enrichment
 * namespace without bumping the connection routing epoch — so mounted Home
 * controls that resolved their option domains against the OLD identity would
 * keep showing them. This lightweight signal lets `C64API` announce the flip
 * and `useDeviceConfigOptionDomains` re-seed + re-interrogate against the new
 * identity.
 */
type ConfigEnrichmentNamespaceChangeListener = () => void;

const listeners = new Set<ConfigEnrichmentNamespaceChangeListener>();

export const subscribeConfigEnrichmentNamespaceChange = (
  listener: ConfigEnrichmentNamespaceChangeListener,
): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const notifyConfigEnrichmentNamespaceChange = (): void => {
  listeners.forEach((listener) => listener());
};
