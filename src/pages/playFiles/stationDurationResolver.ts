/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * How SID Radio finds out how long a tune is, so it can drop the sound effects.
 *
 * There are two songlength stores in this app and they hold different tunes:
 *
 *  - the **ingested HVSC store**, populated when HVSC is installed, which is where the length of
 *    every HVSC tune lives;
 *  - the **file-based resolver**, which reads a `Songlengths.md5` or `.txt` sitting next to the
 *    media, and is what a user's own folder of SIDs has.
 *
 * Every station tune is an HVSC tune, and the station used to ask only the second one. It answered
 * null for every path, because there is no songlengths file next to an HVSC virtual path — and the
 * queue admits an unknown length rather than dropping a tune the songlengths cannot describe. The
 * result was a minimum-length rule that never rejected anything on a device with a complete HVSC:
 * measured on the Pixel 4, 46 of 47 queued tunes showed the 3:00 default and a one-second subsong
 * of `Commando.sid` was playing with the rule set to 15 s.
 *
 * So the HVSC store is asked first and the file-based resolver is the fallback, which also covers
 * a station tune the HVSC store happens not to know.
 */

/** Seconds, or null when this store cannot answer. */
export type StationDurationSource = (virtualPath: string, songNr: number) => Promise<number | null>;

export interface StationDurationResolverDeps {
  /** The ingested HVSC songlength store. Awaits its own readiness. */
  resolveHvscSeconds: StationDurationSource;
  /** Songlengths files discovered next to the media. */
  resolveFileSeconds: StationDurationSource;
}

/**
 * Build the station's duration lookup.
 *
 * Returns null only when neither store knows the tune, which the queue provider counts as an
 * unknown-length admission rather than a rejection.
 */
export const createStationDurationResolver =
  ({ resolveHvscSeconds, resolveFileSeconds }: StationDurationResolverDeps) =>
  async (virtualPath: string, songNr: number): Promise<number | null> => {
    const fromHvsc = await resolveHvscSeconds(virtualPath, songNr);
    if (fromHvsc !== null && fromHvsc !== undefined && Number.isFinite(fromHvsc)) return fromHvsc;
    const fromFile = await resolveFileSeconds(virtualPath, songNr);
    return fromFile !== null && fromFile !== undefined && Number.isFinite(fromFile) ? fromFile : null;
  };
