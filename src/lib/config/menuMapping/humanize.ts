/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Acronym-preserving humanizer for the REST-only / fallback area ONLY.
 *
 * Mapped items take their label from the menu YAML (the label authority), so this
 * is reached only for live REST items that have no menu label (advanced/unknown/
 * future items). It is deliberately conservative: it preserves known acronyms and
 * exact firmware tokens and otherwise leaves the string close to its REST form,
 * because options/values contain acronyms, addresses, filenames and exact firmware
 * strings that must not be case-folded.
 */

/** Tokens preserved verbatim (case-insensitive match → canonical form). */
const ACRONYMS = [
  "C64U",
  "C64",
  "U64",
  "U2",
  "SID",
  "UltiSID",
  "ROM",
  "RAM",
  "REU",
  "IEC",
  "DMA",
  "FTP",
  "SNTP",
  "IP",
  "DNS",
  "DHCP",
  "ACIA",
  "DTR",
  "RTS",
  "CTS",
  "DCD",
  "DSR",
  "GEOS",
  "GCR",
  "HDMI",
  "RGB",
  "CVBS",
  "SVideo",
  "TCP_NODELAY",
  "SNTP",
  "NMI",
  "MHz",
  "kHz",
  "Hz",
  "dB",
];

const ACRONYM_BY_LOWER = new Map(ACRONYMS.map((a) => [a.toLowerCase(), a]));

/**
 * Humanize a REST item name for display in the fallback area. Already-meaningful
 * firmware strings (mixed-case, punctuation, digits) are largely preserved; the
 * humanizer only canonicalizes the case of recognized acronym tokens and otherwise
 * returns the firmware string intact so addresses/filenames/exact values survive.
 */
export const humanizeRestName = (name: string): string => {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) return trimmed;
  return trimmed
    .split(/(\s+)/)
    .map((token) => {
      if (/^\s+$/.test(token)) return token;
      // Strip a single trailing punctuation for the acronym lookup, then restore it.
      const match = token.match(/^([^\s]*?)([:.,)]*)$/);
      const core = match ? match[1] : token;
      const tail = match ? match[2] : "";
      const canonical = ACRONYM_BY_LOWER.get(core.toLowerCase());
      return (canonical ?? core) + tail;
    })
    .join("");
};

/** The preserved acronym set, exported for the drift/casing tests. */
export const PRESERVED_ACRONYMS: readonly string[] = ACRONYMS;
