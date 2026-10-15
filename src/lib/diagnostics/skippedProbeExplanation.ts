/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

const RUN_FULL_CHECK = "To check it, open the status badge and choose Run health check.";
const INCLUDE_IN_FULL_CHECK = "To include it, open the status badge and choose Run health check.";

/**
 * Plain-language explanations for the reasons the health check engine records on a skipped probe. The
 * recorded reason stays technical, because logs and the diagnostics export need it; people see these.
 */
const EXPLANATIONS: ReadonlyArray<{ pattern: RegExp; explanation: string }> = [
  {
    pattern: /^Skipped: switch-device-dialog does not probe Telnet/,
    explanation: `Not checked here, so this list doesn't open extra connections to your C64. ${RUN_FULL_CHECK}`,
  },
  {
    pattern: /^Skipped: .+ does not probe Telnet/,
    explanation: `Not checked by the automatic check, so it doesn't open extra connections to your C64. ${RUN_FULL_CHECK}`,
  },
  {
    pattern: /^Skipped: switch-device-dialog health check is read-only$/,
    explanation: `Not checked here, because this check changes a setting briefly and puts it back. ${INCLUDE_IN_FULL_CHECK}`,
  },
  {
    pattern: /^Skipped: .+ health check is read-only$/,
    explanation: `Not checked by the automatic check, because this check changes a setting briefly and puts it back. ${INCLUDE_IN_FULL_CHECK}`,
  },
  {
    pattern: /^Skipped: lightweight background connectivity probe$/,
    explanation: `Not checked by the quick automatic check, which only confirms that your C64 answers. ${RUN_FULL_CHECK}`,
  },
  {
    pattern: /^Skipped: REST probe failed$/,
    explanation: "Not checked, because your C64 did not answer the first check (REST). This check needs that answer.",
  },
  {
    pattern: /^Superseded by a newer health check run$/,
    explanation: "Not finished, because a newer health check started.",
  },
  {
    pattern: /device not ready for (requests|ftp|telnet)/i,
    explanation: "Not checked, because the app was still connecting to your C64.",
  },
  {
    pattern: /^(Raster register unavailable|Unsupported: )/,
    explanation: "Not checked, because your C64 did not report where it is drawing the screen.",
  },
  {
    pattern: /^No suitable config roundtrip target available$/,
    explanation: "Not checked, because your C64 has no setting this check can safely change and put back.",
  },
  {
    pattern: /^Pulse revert skipped: /,
    explanation:
      "Not finished, because something else changed the same setting during the check. That change was kept.",
  },
  {
    pattern: /^Telnet server busy/,
    explanation:
      "Not checked, because your C64 already has as many Telnet connections open as it allows. It does answer.",
  },
];

/** Why a probe was skipped, for a reader who does not know the engine. Unknown reasons are passed through. */
export const explainSkippedProbe = (reason: string | null | undefined): string | null => {
  const trimmed = reason?.trim();
  if (!trimmed) return null;
  return EXPLANATIONS.find(({ pattern }) => pattern.test(trimmed))?.explanation ?? trimmed;
};

const PROBE_DISPLAY_NAMES: Record<string, string> = {
  REST: "REST",
  FTP: "FTP",
  TELNET: "Telnet",
  CONFIG: "Config",
  RASTER: "Raster",
  JIFFY: "Jiffy",
};

export const probeDisplayName = (probe: string) => PROBE_DISPLAY_NAMES[probe.toUpperCase()] ?? probe;
