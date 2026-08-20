/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Content Explorer capability D — Audio Mirror controller.
 *
 * Ties the platform receiver → AudioBatcher → AudioMirrorPlayer and drives the
 * device stream start/stop. Kept as a plain class (deps injected) so the state
 * machine is unit tested without React or a real socket/AudioContext.
 */

import { addLog } from "@/lib/logging";
import { foreignSenders, stopForeignSenders } from "./foreignSenderGuard";
import { AUDIO_SAMPLE_RATE, AudioBatcher, bytesToInt16LE, parseAudioPacket } from "./audioStream";
import { loadStreamNetworkBufferMs } from "@/lib/config/appSettings";
import { AudioPlaybackBuffer } from "./audioPlaybackBuffer";
import { AudioMirrorPlayer } from "./audioPlayer";
import { NativeAudioSink } from "./audioNativeSink";
import { createStreamReceiver, type StreamReceiver, type StreamReceiverOptions } from "./streamReceiver";
import { StreamArrivalWatchdog } from "./streamArrivalWatchdog";

export type AudioMirrorState = "off" | "connecting" | "live" | "error";

/** Coalesce audio health broadcasts to ~10 Hz (state/error transitions bypass this). */
export const AUDIO_SNAPSHOT_EMIT_INTERVAL_MS = 100;

export interface AudioMirrorSnapshot {
  state: AudioMirrorState;
  droppedPackets: number;
  chunks: number;
  error: string | null;
  /** The route the current stream actually uses (Wi‑Fi only when requested + available). */
  route: "wifi" | "ethernet";
}

/** Live audio-pipeline signals for the governor + telemetry (read on the low-rate tick). */
export interface AudioMirrorSignals {
  /** Active player buffer depth ahead of the audio clock (ms). */
  audioBufferMs: number;
  /**
   * The active player's nominal operating buffer depth (ms) when it isn't the WebAudio baseline —
   * i.e. the native AudioTrack's capacity, so the governor can scale its health thresholds to a
   * low-latency sink. Undefined for the WebAudio player (governor uses its default thresholds).
   */
  audioNominalBufferMs?: number;
  /** Cumulative player underruns (output ran dry). */
  audioUnderruns: number;
  /** Cumulative audio packets whose loss was concealed. */
  audioConcealed: number;
  /** Cumulative audio packets detected lost. */
  audioLostPackets: number;
}

export interface AudioMirrorDeps {
  createReceiver?: (options: StreamReceiverOptions) => StreamReceiver;
  createPlayer?: () => AudioMirrorPlayer;
  /**
   * Native low-latency audio: when provided AND the sink opens, PCM plays through the native
   * AudioTrack (replacing the WebAudio player's ~80 ms lead-in). All jitter buffering, concealment
   * and stats stay in TypeScript — only playback is native. Falls back to {@link createPlayer} if the
   * sink can't open (e.g. non-native platform). The session supplies this only when the setting is on.
   */
  createNativeSink?: (sampleRate: number) => NativeAudioSink | null;
  startStream: (name: "audio", destination: string, options?: { wifi?: boolean }) => Promise<unknown>;
  stopStream: (name: "audio") => Promise<unknown>;
  /** The device the user selected — any other sender on the group is uninvited. */
  expectedSenderHost?: () => string | null;
  /** Ask ONE specific machine (by host/IP) to stop streaming. */
  stopStreamAt?: (host: string, name: "audio" | "video") => Promise<unknown>;
  onChange: (snapshot: AudioMirrorSnapshot) => void;
  /** Broadcast each decoded audio batch (interleaved Int16) — the ~32 ms player cadence. */
  renderAudio?: (samples: Int16Array) => void;
  /**
   * Per-packet (~4 ms) interleaved-Int16 feed with each packet's wire-arrival timestamp —
   * for the A/V sync analyzer. Finer-grained than {@link renderAudio} so the tone onset is
   * located to a single packet (not quantised to a 32 ms batch), and wire-stamped so the
   * measured audio↔video offset is independent of downstream buffering.
   */
  renderAudioForAnalysis?: (samples: Int16Array, arrivalMs: number) => void;
  /** Jitter/network buffer depth (ms) for the player path; defaults to the app setting. */
  networkBufferMs?: number;
}

export class AudioMirrorController {
  private receiver: StreamReceiver | null = null;
  private player: AudioMirrorPlayer | null = null;
  /** Native low-latency sink; when set the plugin's receive thread feeds the AudioTrack directly. */
  private nativeSink: NativeAudioSink | null = null;
  /** Uninvited senders already acted on, so the guard asks each machine once per session. */
  private readonly foreignHandled = new Set<string>();
  /** Seq-gap loss counter for the native path (which has no JS playback buffer to count drops). */
  private nativeLostPackets = 0;
  private nativeLastSeq: number | null = null;
  /** Last socket-level packet count seen from the native sink, for the arrival watchdog's poll. */
  private lastSeenArrivalPackets = -1;
  /** Notices that the multicast audio stopped arriving; a bound socket reports nothing when it does. */
  private readonly arrivalWatchdog = new StreamArrivalWatchdog({
    now: () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
    pollArrival: () => this.nativeArrivalAdvanced(),
    onStale: (silentMs) => this.reportStreamWentSilent(silentMs),
  });
  private batcher = new AudioBatcher();
  private playbackBuffer: AudioPlaybackBuffer | null = null;
  private snapshot: AudioMirrorSnapshot = {
    state: "off",
    droppedPackets: 0,
    chunks: 0,
    error: null,
    route: "ethernet",
  };

  constructor(private readonly deps: AudioMirrorDeps) {}

  getSnapshot(): AudioMirrorSnapshot {
    return this.snapshot;
  }

  /**
   * Current audio-pipeline signals for the governor + telemetry. Cheap reads only (no allocation):
   * the player's buffer depth / underrun count and the jitter buffer's concealment stats.
   */
  getSignals(): AudioMirrorSignals {
    // The buffer-depth/underrun headroom signal comes from whichever player is live — the native
    // AudioTrack when it is, else the WebAudio player. The governor needs a real signal from the
    // active sink or it would peg video to the floor (a video-only mirror already handles that).
    // Another machine streaming into our multicast group is not a subtle fault — it doubles the
    // arrival rate and interleaves two sequence spaces — but nothing in the receive path looks
    // wrong, because every packet arrives in order from each sender. Catch it by origin IP.
    void this.evictForeignSenders();
    const nativeStats = this.nativeSink?.getStats();
    return {
      audioBufferMs: nativeStats?.bufferedMs ?? this.player?.bufferedMs ?? 0,
      // Only the native sink reports a nominal depth; WebAudio leaves it undefined (default thresholds).
      audioNominalBufferMs: this.nativeSink?.bufferCapacityMs,
      audioUnderruns: nativeStats?.underruns ?? this.player?.underrunCount ?? 0,
      // Both counters come from the NATIVE side when native is playing, because JS no longer sees the
      // packets: the plugin stopped emitting them once it owned playback, so `nativeLostPackets` —
      // which is counted here from those events — is structurally zero on the shipping path. The
      // "Dropped pkts" readout was therefore always 0, which is exactly the number that would have
      // explained the crackling: Wi-Fi loses about 3% of the audio while Live View video is also
      // streaming, because the two multicast streams share the air.
      audioConcealed: this.nativeSink
        ? Math.round(nativeStats?.concealedMs ?? 0)
        : (this.playbackBuffer?.stats.concealed ?? 0),
      audioLostPackets: this.nativeSink
        ? (nativeStats?.arrival?.lostPackets ?? this.nativeLostPackets)
        : (this.playbackBuffer?.stats.packetsLost ?? 0),
    };
  }

  private lastEmitMs = -Infinity;

  private update(patch: Partial<AudioMirrorSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    // Throttle the React broadcast like the video path: the chunk/dropped snapshot changes ~31/s but
    // state/error transitions must not be delayed. getSnapshot() stays current for the session tick.
    const important = patch.state !== undefined || patch.error !== undefined;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (important || now - this.lastEmitMs >= AUDIO_SNAPSHOT_EMIT_INTERVAL_MS) {
      this.lastEmitMs = now;
      this.deps.onChange(this.snapshot);
    }
  }

  /** True while the current audio stream is delivered over Wi‑Fi (firmware wifi=true). */
  isOnWifi(): boolean {
    return this.snapshot.route === "wifi" && (this.snapshot.state === "connecting" || this.snapshot.state === "live");
  }

  /**
   * @param options.wifi request Wi‑Fi delivery (audio-only). Falls back to
   *   Ethernet automatically if the transport has no Wi‑Fi address or the device
   *   rejects the Wi‑Fi start (no silent firmware fallback — PR #732).
   */
  async start(options?: { wifi?: boolean }): Promise<void> {
    if (this.snapshot.state === "connecting" || this.snapshot.state === "live") return;
    this.batcher.reset();
    this.nativeLostPackets = 0;
    this.nativeLastSeq = null;
    this.update({ state: "connecting", error: null, droppedPackets: 0, chunks: 0, route: "ethernet" });

    // Prefer the native low-latency sink when offered: the plugin's receive thread feeds the
    // AudioTrack directly, so JS drives NO playback (no bridge traffic, no jitter buffer). Fall back
    // to the WebAudio player (+ its jitter/reorder/conceal buffer) if the sink can't open (non-native
    // platform, or plugin/AudioTrack failure) so audio always has a path.
    const sink = this.deps.createNativeSink?.(AUDIO_SAMPLE_RATE) ?? null;
    const useNative = sink !== null && (await sink.open());
    if (useNative) {
      this.nativeSink = sink;
    } else {
      // The jitter/network buffer reorders + delays for the player, and conceals losses so a dropped
      // packet fades instead of clicking (see AudioPlaybackBuffer). Its timeline is the source of
      // truth for the dropped-packet health counter (WebAudio path only).
      const buffer = new AudioPlaybackBuffer({
        delayMs: this.deps.networkBufferMs ?? loadStreamNetworkBufferMs(),
        emit: (body) => {
          const batch = this.batcher.pushBody(body);
          if (batch) {
            this.player?.playChunk(batch);
            this.update({
              chunks: this.player?.scheduledChunks ?? this.snapshot.chunks + 1,
              droppedPackets: buffer.stats.packetsLost,
            });
          }
        },
      });
      this.playbackBuffer = buffer;
      const player = (this.deps.createPlayer ?? (() => new AudioMirrorPlayer()))();
      const ok = await player.start();
      if (!ok) {
        this.update({ state: "error", error: "Audio playback is unavailable in this environment." });
        return;
      }
      this.player = player;
    }

    const receiver = (this.deps.createReceiver ?? createStreamReceiver)({ name: "audio" });
    this.receiver = receiver;

    receiver.onStateChange((connection) => {
      if (connection === "open") {
        this.update({ state: "live" });
        this.lastSeenArrivalPackets = -1;
        this.arrivalWatchdog.start();
      } else if (connection === "error") {
        this.arrivalWatchdog.stop();
        this.update({ state: "error", error: "Lost the audio stream connection." });
      } else if (connection === "closed" && this.snapshot.state !== "off") {
        this.arrivalWatchdog.stop();
        this.update({ state: "off" });
      }
    });

    receiver.onDatagram((bytes, arrivalMs) => {
      const parsed = parseAudioPacket(bytes);
      if (!parsed) return;
      this.arrivalWatchdog.noteArrival();
      // Analyzer feed: RAW per-packet stream (fine-grained, wire-stamped) — measurement integrity.
      // Runs on BOTH paths; the native path plays in the plugin, so JS does only this + loss counting.
      const samples = bytesToInt16LE(parsed.body);
      this.deps.renderAudioForAnalysis?.(samples, arrivalMs);
      if (this.nativeSink) {
        // Native plays this datagram in the plugin; here JS only tracks seq gaps for the health counter.
        if (this.nativeLastSeq !== null) {
          const gap = (parsed.seq - this.nativeLastSeq - 1) & 0xffff;
          if (gap > 0 && gap < 0x8000) this.nativeLostPackets += gap;
        }
        this.nativeLastSeq = parsed.seq;
        this.update({ droppedPackets: this.nativeLostPackets });
        return;
      }
      this.deps.renderAudio?.(samples);
      // Player feed: reorder + delay + loss-conceal, then batch → play.
      this.playbackBuffer?.push(parsed.seq, parsed.body, arrivalMs);
    });

    try {
      await receiver.ready?.(); // native binds a UDP socket first, learning its destination
      // Wi‑Fi audio (PR #732): relay a UNICAST stream to the phone's own address.
      // The firmware fails (no silent Ethernet fallback) if it has no Wi‑Fi, so
      // retry over Ethernet ourselves. Only the native transport exposes a
      // wifiDestination; elsewhere Wi‑Fi is not possible → Ethernet.
      const wifiDestination = options?.wifi ? receiver.wifiDestination : undefined;
      if (wifiDestination) {
        try {
          await this.deps.startStream("audio", wifiDestination, { wifi: true });
          this.update({ route: "wifi" });
        } catch (wifiError) {
          addLog("info", "Audio Mirror: Wi‑Fi stream unavailable; using Ethernet", {
            error: (wifiError as Error)?.message ?? String(wifiError),
          });
          // Tear down the failed Wi‑Fi attempt before starting the Ethernet one,
          // so the device never has two overlapping audio:start requests in
          // flight (it streams a single audio stream at a time).
          try {
            await this.deps.stopStream("audio");
          } catch (stopError) {
            addLog("debug", "Audio Mirror: stop after failed Wi‑Fi start (ignored)", {
              error: (stopError as Error)?.message ?? String(stopError),
            });
          }
          await this.deps.startStream("audio", receiver.destination);
          this.update({ route: "ethernet" });
        }
      } else {
        await this.deps.startStream("audio", receiver.destination);
        this.update({ route: "ethernet" });
      }
    } catch (error) {
      addLog("warn", "Audio Mirror: device stream start failed", {
        error: (error as Error)?.message ?? String(error),
      });
      await this.stop();
      this.update({ state: "error", error: "Could not tell the device to start streaming audio." });
    }
  }

  /**
   * Ask any machine that is streaming into our audio group uninvited to stop.
   *
   * Each offender is asked once per session: the stop is a request to a device that may be busy or
   * unreachable, and retrying it every 250 ms tick would be a flood, not a fix.
   */
  private async evictForeignSenders(): Promise<void> {
    const senders = this.nativeSink?.senders ?? [];
    if (senders.length < 2) return;
    const pending = foreignSenders(senders, this.deps.expectedSenderHost?.() ?? null).filter(
      (host) => !this.foreignHandled.has(host),
    );
    if (pending.length === 0) return;
    pending.forEach((host) => this.foreignHandled.add(host));
    await stopForeignSenders({
      senders: pending,
      expectedHost: null, // already filtered
      stopStreamAt: (host, name) => this.deps.stopStreamAt?.(host, name) ?? Promise.resolve(),
    });
  }

  /**
   * True when the plugin's socket-level packet count has moved since the last poll.
   *
   * On the shipping native path the plugin owns playback and stops emitting datagrams to JS, so
   * `onDatagram` never fires and there is nothing per-packet to stamp — this counter is the only
   * evidence left that audio is still arriving.
   */
  private nativeArrivalAdvanced(): boolean {
    const packets = this.nativeSink?.getStats()?.arrival?.packets;
    if (typeof packets !== "number") return false;
    const previous = this.lastSeenArrivalPackets;
    this.lastSeenArrivalPackets = packets;
    // A counter that went BACKWARDS was reset or wrapped, not stalled — the plugin rebinding its
    // socket restarts it from zero — so it counts as arrival rather than as silence.
    //
    // No regression test accompanies this, deliberately: the baseline is re-tracked on every poll,
    // so a reset costs exactly one missed stamp and the next poll sees an increase again. One
    // second of a silence budget of eight cannot starve the watchdog, and a test asserting "still
    // live" passes with or without this line. The line stays because it states the intent, not
    // because it changes a reachable outcome.
    if (packets < previous) return true;
    return packets > previous;
  }

  /**
   * The stream went quiet while the mirror still believed it was live.
   *
   * Reported as an error rather than switched off silently: silence under a control that still reads
   * "Listening" sends the user to look at the C64's volume, the cable and the device rather than at
   * the network, which is where the fault actually is.
   */
  private reportStreamWentSilent(silentMs: number): void {
    if (this.snapshot.state !== "live") return;
    addLog("warn", "Audio Mirror: no audio arrived for long enough to call the stream lost", {
      silentMs: Math.round(silentMs),
    });
    this.update({ state: "error", error: "The audio stream stopped arriving." });
  }

  async stop(): Promise<void> {
    this.arrivalWatchdog.stop();
    try {
      await this.deps.stopStream("audio");
    } catch (error) {
      addLog("debug", "Audio Mirror: device stream stop failed (ignored)", {
        error: (error as Error)?.message ?? String(error),
      });
    }
    this.receiver?.close();
    this.receiver = null;
    // Flush any buffered tail so no packets are stranded, then release the player/sink.
    this.playbackBuffer?.drainAll();
    this.playbackBuffer = null;
    await this.player?.stop();
    this.player = null;
    await this.nativeSink?.close();
    this.nativeSink = null;
    this.batcher.reset();
    this.update({ state: "off", error: null });
  }
}
