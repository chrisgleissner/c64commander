/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from "@/lib/logging";

/**
 * Stop any machine that is streaming into our multicast group uninvited.
 *
 * The mirror's groups are multicast and every Ultimate defaults to the same ones, so a second
 * machine left streaming — from an earlier session, another phone, or an app that was killed before
 * it could stop the old one — sends into the exact group this app is listening on. The device does
 * not stop on its own: it keeps streaming until something asks it to.
 *
 * What that sounds like is the reason this exists. Measured on the wire with two Ultimates sending
 * at once: 500 packets/s instead of 250, 383,702 PCM bytes/s instead of 191,939, and two independent
 * 16-bit sequence counters interleaved. Every packet arrives, in order, with zero loss *from each
 * sender's point of view* — so nothing in the receive path looks wrong — while the AudioTrack sits
 * permanently full, refuses roughly half of what it is handed, and the listener hears a rough,
 * patchy stream at the wrong pitch. The underrun count stays at zero throughout, because the buffer
 * is over-full rather than dry.
 *
 * Origin IP is used rather than sequence analysis: it names the offender, which is what lets the app
 * go and stop it instead of merely reporting that something is wrong.
 */
export interface ForeignSenderDeps {
  /** Distinct source IPs the native receiver has seen on the audio group. */
  readonly senders: readonly string[];
  /** The device the user actually selected — everything else is uninvited. */
  readonly expectedHost: string | null;
  /** Ask one specific machine to stop streaming. */
  readonly stopStreamAt: (host: string, name: "audio" | "video") => Promise<unknown>;
}

/** Strip any port and normalise, so `192.168.1.15:80` and `192.168.1.15` compare equal. */
const hostOnly = (value: string): string => {
  const trimmed = value.trim();
  const lastColon = trimmed.lastIndexOf(":");
  // Leave IPv6 (multiple colons) alone; only strip a trailing :port from a host/IPv4.
  if (lastColon > 0 && trimmed.indexOf(":") === lastColon) return trimmed.slice(0, lastColon);
  return trimmed;
};

/** Senders that are not the selected device. */
export const foreignSenders = (senders: readonly string[], expectedHost: string | null): string[] => {
  const expected = expectedHost ? hostOnly(expectedHost) : null;
  return senders.map(hostOnly).filter((ip) => ip.length > 0 && ip !== expected);
};

/** What one eviction pass achieved: the machines that obeyed, and the ones still streaming. */
export interface ForeignSenderOutcome {
  readonly stopped: string[];
  readonly failed: string[];
}

/**
 * Ask every uninvited sender to stop, and report what was found.
 *
 * Best-effort by design: a machine that cannot be reached, or that refuses the request, is logged
 * and reported in `failed` rather than retried, because the point is to rescue the stream we are
 * listening to, not to guarantee anything about a device the user may not even own.
 */
export const stopForeignSenders = async (deps: ForeignSenderDeps): Promise<ForeignSenderOutcome> => {
  const foreign = foreignSenders(deps.senders, deps.expectedHost);
  if (foreign.length === 0) return { stopped: [], failed: [] };

  addLog("warn", "Live View: another machine is streaming into our audio group; asking it to stop", {
    service: "streams",
    foreign,
    expected: deps.expectedHost,
    detail:
      "Two senders on one multicast group arrive interleaved at double the expected rate, which is " +
      "heard as rough, patchy audio at the wrong pitch even though no packets are lost.",
  });

  const stopped: string[] = [];
  const failed: string[] = [];
  for (const host of foreign) {
    try {
      await deps.stopStreamAt(host, "audio");
      stopped.push(host);
    } catch (error) {
      failed.push(host);
      addLog("warn", "Live View: could not stop the uninvited sender", {
        service: "streams",
        host,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { stopped, failed };
};

/**
 * A sentence naming the machines still streaming after the eviction, for the Live View card.
 *
 * The user is the only one who can act: the app has already asked and been refused or ignored, and
 * that other machine may not even be theirs to control from here.
 */
export const describeUnstoppedForeignSenders = (failed: readonly string[]): string | null => {
  if (failed.length === 0) return null;
  const list = failed.join(", ");
  return failed.length === 1
    ? `Another Ultimate at ${list} is also streaming into this group; stop it on that machine.`
    : `Other Ultimates at ${list} are also streaming into this group; stop them on those machines.`;
};
