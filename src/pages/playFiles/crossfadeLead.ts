/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { loadPlaybackCrossfadeMs } from "@/lib/config/appSettings";

/**
 * How much earlier than its crossfade the next tune is started. It covers the delays measured on a Pixel 4:
 * the clock starts 0.4 s (1.4 s on a cold worker) after a tune's first audio, resolving and opening the next
 * tune takes 0.4-0.8 s, and the due time fires up to 0.4 s late. With 1.5 s a cold-start crossfade was cut short.
 */
export const CROSSFADE_START_MARGIN_MS = 2500;

/**
 * How long before a tune's songlength the next one is started on the phone.
 *
 * The outgoing tune must still be sounding when the next one starts: a crossfade fades it out under the
 * incoming one, and a cut ramps it out over a declick. A tune played from its whole-tune pre-render has
 * no audio past its songlength, and advancing at the songlength left nothing to fade or ramp: the first
 * tune stopped on a step, and with a crossfade the next one faded in from silence. Never more than half
 * the tune, so a short tune is still heard.
 */
export const crossfadeLeadMs = (durationMs: number, onPhone: boolean, crossfadeMs = loadPlaybackCrossfadeMs()) =>
  onPhone ? Math.min(Math.max(0, crossfadeMs) + CROSSFADE_START_MARGIN_MS, durationMs / 2) : 0;

/** Milliseconds from now until the next tune is due, `elapsedMs` into a tune of `durationMs`. */
export const autoAdvanceDelayMs = (durationMs: number, elapsedMs: number, onPhone: boolean) =>
  Math.max(0, durationMs - elapsedMs - crossfadeLeadMs(durationMs, onPhone));

/**
 * The new due time when an advance made early must wait for the tune's real end, or null when it may go ahead:
 * the end has come, or it was already deferred once. Deferring only once keeps a stalled playhead, which moves
 * the end further away on every reconciliation, from postponing the advance for ever.
 */
export const deferralToTuneEndMs = (alreadyDeferred: boolean, nowMs: number, endsAtMs: number) =>
  alreadyDeferred || endsAtMs <= nowMs ? null : endsAtMs;
