/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander.sidaudio

import android.os.Process
import android.util.Log
import java.util.TreeMap
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.locks.LockSupport
import uk.gleissner.c64commander.PipelineClock

/** How the track behind the feed is opened; equal settings (ignoring [primeMs]) share one track. */
internal data class FeedTrackSettings(
    val sampleRate: Int,
    val bufferMs: Int,
    val maxRingMs: Int,
    val trackBursts: Int,
    val primeMs: Int,
) {
  fun sameTrack(other: FeedTrackSettings): Boolean =
      sampleRate == other.sampleRate &&
          bufferMs == other.bufferMs &&
          maxRingMs == other.maxRingMs &&
          trackBursts == other.trackBursts
}

/** The slice of `AudioPipeline` the feed drives. */
internal interface FeedOutput {
  fun offer(data: ByteArray, offset: Int, length: Int)

  fun flush()

  fun pause()

  fun resume()

  /** The listener's level, 0..1, applied by the pipeline as samples leave its ring. */
  fun setGain(gain: Double)

  /** Everything queued ahead of the speaker: the pipeline's ring and the track's own buffer. */
  fun bufferedMs(): Double

  /** The ring alone: what a [flush] discards. The track's own buffer always plays out. */
  fun ringMs(): Double

  /** [flush] and say how many frames at [rate] it discarded; the pipeline does both in one step. */
  fun flushRing(rate: Int): Long {
    val frames = (ringMs() * rate / 1000).toLong()
    flush()
    return frames
  }

  fun underruns(): Int
}

/** Opens and closes the shared track. The A/V mirror can replace it at any time ([isCurrent]). */
internal interface FeedOutputHost {
  fun open(settings: FeedTrackSettings): FeedOutput

  fun isCurrent(output: FeedOutput): Boolean

  fun close(output: FeedOutput)
}

/** Where a segment's samples come from: a [PcmBuffer] or bytes uploaded from JavaScript. */
internal fun interface SegmentSource {
  fun read(startFrame: Long, dst: ByteArray, dstOffset: Int, count: Int): Int
}

internal class Segment(
    val source: SegmentSource,
    var startFrame: Long,
    var frames: Long,
    /** Already written once and recovered for a transition: never faded or mixed a second time. */
    val processed: Boolean = false,
)

/** What the web layer reads to drive its clock, its chunk completions and its watchdogs. */
internal data class FeedSessionStats(
    val serial: Int,
    val writtenFrames: Long,
    val playedFrames: Long,
    val bufferedMs: Double,
    val queuedFrames: Long,
    val underruns: Int,
    val silentSeconds: Double,
    val silentFault: Boolean,
    val reopens: Int,
    val active: Boolean,
    val superseded: Boolean,
    val missingSegments: Int,
    val outputOpen: Boolean,
    val openFailures: Int,
)

/**
 * The native half of on-device SID playback: everything that used to be done to the samples in
 * JavaScript, now done next to the speaker for every renderer.
 *
 * A *session* is one tune's sink (the web layer builds one per tune). The feed keeps each session's
 * queue in sequence order, writes the newest session that has audio into the shared
 * `AudioPipeline` with backpressure, and handles the crossfade between two sessions: recovering
 * what the outgoing tune had queued but not played, playing it on while the next tune opens, and
 * mixing it under the incoming tune with a falling ramp while the incoming tune fades in. A tune that
 * ends by itself with the crossfade off is played out to its songlength instead, ahead of the next. It also
 * watches for a flat signal and for a track that has stopped consuming.
 *
 * All state belongs to one feeder thread. Commands arrive through a lock-free inbox from the
 * Capacitor plugin thread and the WebView's message thread, so neither ever waits on the feed, and
 * stats are published as immutable snapshots. Segments carry a per-session sequence number, so data
 * and control may travel on different channels without being reordered.
 */
internal class LocalAudioFeed(
    private val host: FeedOutputHost,
    private val clock: PipelineClock = PipelineClock.SYSTEM,
    private val log: FeedLog = FeedLog.ANDROID,
) {
  fun interface FeedLog {
    fun log(level: Int, message: String, error: Throwable?)

    companion object {
      val ANDROID = FeedLog { level, message, error -> Log.println(level, TAG, message + (error?.let { "\n" + Log.getStackTraceString(it) } ?: "")) }
    }
  }

  private class Fade(val to: Double, val perFrame: Double)

  /** [playsOut]: the rest of a tune that ends on its own, played whole before the successor's audio, not mixed. */
  private class Tail(val segments: ArrayDeque<Segment>, var frames: Long, val playsOut: Boolean = false) {
    var frame = 0L
  }

  /**
   * One step of a session's stream, in sequence order: audio, or a command that has to take effect
   * at exactly that point in the audio (a flush, a fade, a crossfade hand-over).
   */
  private sealed interface Entry {
    class Audio(val segment: Segment) : Entry

    /** Nothing usable arrived for this sequence number; the order moves on. */
    object Empty : Entry

    /** [run] returns false to be retried: it is waiting for something another session produces. */
    class Command(val name: String, val run: (Session) -> Boolean) : Entry
  }

  private class Session(val serial: Int, val settings: FeedTrackSettings) {
    val queue = ArrayDeque<Segment>()
    /** Arrivals ahead of [nextSeq], and a command at [nextSeq] that is still waiting. */
    val pending = TreeMap<Long, Entry>()
    var nextSeq = 1L
    var gapSinceNanos: Long? = null
    var fadeGain = 1.0
    var fade: Fade? = null
    var tail: Tail? = null
    var transitioning = false
    /** The transition was a play-out: what is queued is the rest of the tune, ending on a declick. */
    var playingOut = false
    var closed = false
    var writtenFrames = 0L
    val history = ArrayDeque<ByteArray>()
    var historyFrames = 0L
    var silentSeconds = 0.0
    var sourceSilentSeconds = 0.0
    var lastWriteNanos = 0L
    var missing = 0
    @Volatile var stats: FeedSessionStats? = null

    fun hasWork(): Boolean = queue.isNotEmpty() || tail != null

    fun queuedFrames(): Long = queue.sumOf { it.frames } + pending.values.sumOf { (it as? Entry.Audio)?.segment?.frames ?: 0 }
  }

  private val inbox = ConcurrentLinkedQueue<() -> Unit>()
  private val sessions = LinkedHashMap<Int, Session>()
  private val tails = HashMap<Int, Tail>()
  private var activeSerial = 0
  private var output: FeedOutput? = null
  private var outputSettings: FeedTrackSettings? = null
  private var paused = false
  /** Kept here rather than only in the track, so a track the feed re-opens starts at the same level. */
  private var masterGain = 1.0
  private var pendingTransitionFlush = false
  private var reopens = 0
  private var openFailures = 0
  private var nextOpenAttemptNanos = 0L
  private var depthStalledSinceNanos: Long? = null
  private var lastDepthMs = Double.MAX_VALUE
  private var lastDepthPollNanos = 0L
  private val scratch = ByteArray(SLICE_FRAMES * BYTES_PER_FRAME)
  private val tailScratch = ByteArray(SLICE_FRAMES * BYTES_PER_FRAME)

  @Volatile private var running = false
  @Volatile private var thread: Thread? = null

  fun start() {
    if (thread != null) return
    running = true
    thread =
        Thread(
                {
                  Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO)
                  while (running) {
                    val park =
                        try {
                          runOnce()
                        } catch (error: Exception) {
                          // One bad command or buffer must not take the app down with the thread.
                          log.log(Log.ERROR, "Local audio: the feed failed a pass; carrying on", error)
                          FAILED_PASS_NANOS
                        }
                    if (park > 0 && inbox.isEmpty()) clock.park(park)
                  }
                },
                "c64u-local-feed",
            )
            .apply {
              isDaemon = true
              start()
            }
  }

  fun stop() {
    running = false
    thread?.let { LockSupport.unpark(it) }
    thread?.join(STOP_JOIN_MS)
    thread = null
  }

  private fun post(command: () -> Unit) {
    inbox.add(command)
    thread?.let { LockSupport.unpark(it) }
  }

  // ── commands (any thread) ──────────────────────────────────────────────────────────────────────

  fun openSession(serial: Int, settings: FeedTrackSettings) = post {
    if (sessions.containsKey(serial)) return@post
    val session = Session(serial, settings)
    sessions[serial] = session
    publish(session)
  }

  /** Add one segment; [segment] null records that [seq] carried nothing, so the order moves on. */
  fun enqueue(serial: Int, seq: Long, segment: Segment?) = post {
    val session = sessions[serial] ?: return@post
    if (session.closed || seq < session.nextSeq || session.pending.containsKey(seq)) return@post
    if (segment == null) session.missing += 1
    session.pending[seq] = segment?.takeIf { it.frames > 0 }?.let { Entry.Audio(it) } ?: Entry.Empty
    drainPending(session)
    publish(session)
  }

  /** Queue a command at [seq] in [serial]'s stream; it runs once everything before it has. */
  private fun ordered(serial: Int, seq: Long, name: String, run: (Session) -> Boolean) = post {
    val session = sessions[serial] ?: return@post
    if (session.closed || seq < session.nextSeq || session.pending.containsKey(seq)) return@post
    session.pending[seq] = Entry.Command(name, run)
    drainPending(session)
    publish(session)
  }

  /**
   * Discard everything [serial] was sent before [seq], at once, and flush the track if it is this
   * session's. Audio sent after the flush is kept whichever channel brought it, and in whatever
   * order it arrived. Earlier audio that has not arrived yet is not waited for.
   */
  fun flush(serial: Int, seq: Long) = post {
    val session = sessions[serial] ?: return@post
    if (session.closed || seq < session.nextSeq) return@post
    session.pending.headMap(seq, false).clear()
    session.nextSeq = seq
    session.pending[seq] =
        Entry.Command("flush") {
          it.queue.clear()
          if (it.tail?.playsOut == true) it.tail = null
          it.history.clear()
          it.historyFrames = 0
          it.writtenFrames = 0
          if (!isSuperseded(it) && it.serial == activeSerial) output?.flush()
          true
        }
    drainPending(session)
    publish(session)
  }

  fun pause(serial: Int) = post {
    val session = sessions[serial] ?: return@post
    if (isSuperseded(session)) return@post
    paused = true
    output?.pause()
  }

  fun resume(serial: Int) = post {
    val session = sessions[serial] ?: return@post
    if (isSuperseded(session)) return@post
    paused = false
    output?.resume()
  }

  /** Move this session's crossfade gain to [target] over [ms] of its own audio, from [seq] on. */
  fun fade(serial: Int, seq: Long, target: Double, ms: Int) =
      ordered(serial, seq, "fade") {
        setFade(it, target, ms)
        true
      }

  /** Start this session from silence at [seq] and raise it to unity over [ms] of its own audio. */
  fun fadeIn(serial: Int, seq: Long, ms: Int) =
      ordered(serial, seq, "fade-in") {
        if (ms > 0) setFade(it, 0.0, 0)
        setFade(it, 1.0, ms)
        true
      }

  /** The listener's level for on-device playback; survives the track being re-opened. */
  fun setGain(gain: Double) = post {
    masterGain = if (gain.isFinite()) gain.coerceIn(0.0, 1.0) else 1.0
    output?.setGain(masterGain)
  }

  fun resetSilence(serial: Int) = post {
    sessions[serial]?.let {
      it.silentSeconds = 0.0
      it.sourceSilentSeconds = 0.0
      publish(it)
    }
  }

  /**
   * Begin a track change: recover what this session had queued in the track but not yet played, and
   * keep playing it a fraction of a second at a time while the next tune opens. The track is flushed
   * with whichever write comes next, so the incoming tune is never queued behind seconds of this one.
   *
   * With [playOutDeclickSeconds] above zero the tune is ending by itself: [seconds] is what is left of
   * it from the playhead. The queue is cut there and ramps to silence over that declick, and the
   * successor plays it whole before its own audio instead of mixing it under that audio.
   */
  fun beginTransition(serial: Int, seq: Long, seconds: Double, playOutDeclickSeconds: Double = 0.0) =
      ordered(serial, seq, "transition") { session ->
        startTransition(session, seconds, playOutDeclickSeconds)
        true
      }

  private fun startTransition(session: Session, seconds: Double, playOutDeclickSeconds: Double) {
    if (session.closed || session.transitioning) return
    session.transitioning = true
    session.playingOut = playOutDeclickSeconds > 0
    val rate = session.settings.sampleRate
    // The ring, not the track: what the track holds still plays, and recovering it too would play it twice.
    // Flushed now and counted in the same step: read first and flushed later, a block the player wrote
    // in between was heard twice, a click at the start of every crossfade.
    val active = session.serial == activeSerial
    val depthFrames = if (active) output?.flushRing(rate) ?: 0L else 0L
    // A play-out is measured from the playhead, and the audio still in the track plays before the queue.
    val heldByTrack = if (active && session.playingOut) ((output?.bufferedMs() ?: 0.0) * rate / 1000).toLong() else 0L
    val wanted = ((seconds * rate).toLong() - heldByTrack).coerceAtLeast(0)
    var unplayed = minOf(session.historyFrames, depthFrames)
    val recovered = ArrayDeque<Segment>()
    while (unplayed > 0 && session.history.isNotEmpty()) {
      val slice = session.history.removeLast()
      val frames = slice.size / BYTES_PER_FRAME.toLong()
      val take = minOf(frames, unplayed)
      val skip = frames - take
      recovered.addFirst(Segment(bytesSource(slice), skip, take, processed = true))
      unplayed -= take
    }
    var kept = 0L
    val capped = ArrayDeque<Segment>()
    for (segment in recovered) {
      if (kept >= wanted) break
      val take = minOf(segment.frames, wanted - kept)
      capped.addLast(Segment(segment.source, segment.startFrame, take, processed = true))
      kept += take
    }
    // Cut short, the recovered audio no longer reaches the queue's first segment, so playing on into
    // the queue would jump ahead in the tune.
    if (kept < recovered.sumOf { it.frames }) session.queue.clear()
    for (segment in capped.reversed()) session.queue.addFirst(segment)
    if (session.playingOut) endPlayOut(session.queue, wanted, (playOutDeclickSeconds * rate).toLong())
    session.history.clear()
    session.historyFrames = 0
    pendingTransitionFlush = !active || output == null
    publish(session)
  }

  /** Cut [queue] to [frames] and ramp its last [declickFrames] to silence, so the tune ends without a step. */
  private fun endPlayOut(queue: ArrayDeque<Segment>, frames: Long, declickFrames: Long) {
    var left = frames
    val kept = ArrayDeque<Segment>()
    while (queue.isNotEmpty() && left > 0) {
      val segment = queue.removeFirst()
      val take = minOf(segment.frames, left)
      kept.addLast(Segment(segment.source, segment.startFrame, take, segment.processed))
      left -= take
    }
    queue.clear()
    val total = frames - left
    val ramp = minOf(declickFrames, total).toInt()
    if (ramp <= 0) {
      queue.addAll(kept)
      return
    }
    val bytes = ByteArray(ramp * BYTES_PER_FRAME)
    var skip = total - ramp
    var filled = 0
    for (segment in kept) {
      val before = minOf(segment.frames, skip)
      if (before > 0) queue.addLast(Segment(segment.source, segment.startFrame, before, segment.processed))
      skip -= before
      val rest = segment.frames - before
      if (rest > 0) filled += segment.source.read(segment.startFrame + before, bytes, filled * BYTES_PER_FRAME, rest.toInt())
    }
    for (i in 0 until filled) scaleFrame(bytes, i * BYTES_PER_FRAME, (filled - i - 1).toDouble() / ramp)
    queue.addLast(Segment(bytesSource(bytes), 0, filled.toLong(), processed = true))
  }

  /** Hand what [serial] has queued, at most [maxSeconds] of it, to a tail a successor can adopt. */
  fun takeTail(serial: Int, seq: Long, tailId: Int, maxSeconds: Double) =
      ordered(serial, seq, "take tail") { session ->
        handOverTail(session, tailId, maxSeconds)
        true
      }

  private fun handOverTail(session: Session, tailId: Int, maxSeconds: Double) {
    val maxFrames = (maxSeconds * session.settings.sampleRate).toLong()
    val segments = ArrayDeque<Segment>()
    var frames = 0L
    while (session.queue.isNotEmpty() && frames < maxFrames) {
      val segment = session.queue.removeFirst()
      val take = minOf(segment.frames, maxFrames - frames)
      segments.addLast(Segment(segment.source, segment.startFrame, take, segment.processed))
      frames += take
    }
    session.queue.clear()
    tails[tailId] = Tail(segments, frames, playsOut = session.playingOut)
    publish(session)
  }

  /**
   * Sum the tail under [serial]'s own audio from [seq] on, fading it away across [seconds] of that
   * audio. The outgoing session hands the tail over in its own stream, so it may not exist yet: the
   * command then waits, holding back this session's audio, for at most the gap timeout. A tail that
   * plays out is not mixed: it is played whole, ahead of this session's audio.
   */
  fun adoptTail(serial: Int, seq: Long, tailId: Int, seconds: Double) =
      ordered(serial, seq, "adopt tail") { session ->
        val tail = tails.remove(tailId) ?: return@ordered false
        val available = tail.segments.sumOf { it.frames }
        if (tail.playsOut) {
          if (available > 0L) session.tail = tail
          return@ordered true
        }
        val fadeFrames = minOf(available, (seconds * session.settings.sampleRate).toLong())
        if (available > 0L && fadeFrames > 0) session.tail = Tail(tail.segments, fadeFrames)
        true
      }

  /**
   * Stop feeding without touching the track, at [seq]: the successor writes straight onto the end
   * of it. Ordered, because a hand-over of the tail just before it may still be waiting for audio.
   */
  fun release(serial: Int, seq: Long) =
      ordered(serial, seq, "release") { session ->
        sessions.remove(session.serial)
        session.closed = true
        true
      }

  /** Tear the session down, and the track with it when this session is the one writing to it. */
  fun close(serial: Int) = post {
    val session = sessions.remove(serial) ?: return@post
    session.closed = true
    if (session.serial != activeSerial) return@post
    output?.let {
      it.flush()
      host.close(it)
    }
    output = null
    outputSettings = null
    paused = false
  }

  /** Forget every session and tail, after the web page that owned them has gone. */
  fun reset() = post {
    sessions.clear()
    tails.clear()
    activeSerial = 0
    output?.let { if (host.isCurrent(it)) host.close(it) }
    output = null
    outputSettings = null
    paused = false
    pendingTransitionFlush = false
  }

  fun stats(serial: Int): FeedSessionStats? = statsBySerial[serial]

  private val statsBySerial = java.util.concurrent.ConcurrentHashMap<Int, FeedSessionStats>()

  // ── feeder thread ──────────────────────────────────────────────────────────────────────────────

  /** One pass of the feeder loop; returns how long to park. Visible to tests, which run it on virtual time. */
  internal fun runOnce(): Long {
    while (true) inbox.poll()?.invoke() ?: break
    checkPendingGaps()
    checkOutputStillOurs()
    val session = nextWriter() ?: return idle()
    val current = ensureOutput(session) ?: return OPEN_RETRY_NANOS
    claim(session)
    if (paused) return PAUSED_NANOS
    // Before the depth check: the track may still hold seconds of the outgoing tune, and it is this
    // flush that lets the transition write anything at all.
    if (pendingTransitionFlush) {
      pendingTransitionFlush = false
      // This is a continuation hand-off, not a seek.  Keep effect delay/filter history while
      // dropping the queued ring, just as the active transition path above does.
      current.flushRing(session.settings.sampleRate)
    }
    val inTransition = session.transitioning || (session.tail != null && session.queue.isEmpty())
    val highWater = if (inTransition) TRANSITION_HIGH_WATER_MS else HIGH_WATER_MS
    // Never with the ring itself near empty, however deep the track is. A transition's flush leaves the
    // ring empty with the track still full; parked then, the player ran dry within 8 ms and wrote a burst
    // of silence into the middle of the outgoing tune.
    if (current.bufferedMs() >= highWater && current.ringMs() >= RING_FLOOR_MS) {
      publish(session)
      return FULL_NANOS
    }
    val frames = buildSlice(session)
    if (frames <= 0) return 0
    current.offer(scratch, 0, frames * BYTES_PER_FRAME)
    afterWrite(session, frames)
    return 0
  }

  private fun nextWriter(): Session? {
    while (true) {
      val candidate = sessions.values.filter { !it.closed && it.hasWork() }.maxByOrNull { it.serial } ?: return null
      if (!isSuperseded(candidate)) return candidate
      candidate.queue.clear()
      candidate.tail = null
      publish(candidate)
    }
  }

  private fun isSuperseded(session: Session): Boolean = session.serial < activeSerial

  private fun claim(session: Session) {
    if (session.serial <= activeSerial) return
    activeSerial = session.serial
    for (other in sessions.values) {
      if (other.serial < activeSerial) {
        other.queue.clear()
        other.tail = null
        publish(other)
      }
    }
  }

  private fun ensureOutput(session: Session): FeedOutput? {
    val existing = output
    val settings = outputSettings
    if (existing != null && settings != null && settings.sameTrack(session.settings)) return existing
    if (clock.nanoTime() < nextOpenAttemptNanos) return null
    existing?.let {
      it.flush()
      host.close(it)
    }
    output = null
    outputSettings = null
    return try {
      val opened = host.open(session.settings)
      opened.setGain(masterGain)
      // A pause that came while no track was open still holds.
      if (paused) opened.pause()
      output = opened
      outputSettings = session.settings
      opened
    } catch (error: Exception) {
      openFailures += 1
      nextOpenAttemptNanos = clock.nanoTime() + OPEN_RETRY_NANOS
      log.log(Log.WARN, "Local audio: the track could not be opened (attempt $openFailures)", error)
      publish(session)
      null
    }
  }

  /** The mirror opened the track for itself: stop writing into it until a newer tune claims it. */
  private fun checkOutputStillOurs() {
    val current = output ?: return
    if (host.isCurrent(current)) return
    log.log(Log.INFO, "Local audio: the track was taken over by another player", null)
    output = null
    outputSettings = null
    paused = false
    for (session in sessions.values) {
      if (session.serial <= activeSerial) {
        session.queue.clear()
        session.tail = null
        session.closed = true
        publish(session)
      }
    }
  }

  private fun drainPending(session: Session) {
    var progressed = false
    while (true) {
      val head = session.pending.firstEntry() ?: break
      if (head.key != session.nextSeq) break
      when (val entry = head.value) {
        is Entry.Audio -> session.queue.addLast(entry.segment)
        is Entry.Empty -> Unit
        is Entry.Command -> if (!entry.run(session)) break
      }
      session.pending.pollFirstEntry()
      session.nextSeq += 1
      progressed = true
    }
    // The timer measures how long the stream has been held up by its head, so any progress restarts it.
    session.gapSinceNanos =
        when {
          session.pending.isEmpty() -> null
          progressed || session.gapSinceNanos == null -> clock.nanoTime()
          else -> session.gapSinceNanos
        }
  }

  /** A sequence number that never arrives must not hold up everything after it for ever. */
  private fun checkPendingGaps() {
    val now = clock.nanoTime()
    for (session in sessions.values) {
      val since = session.gapSinceNanos ?: continue
      if (session.pending.isEmpty() || now - since < GAP_TIMEOUT_NANOS) continue
      val next = session.pending.firstKey()
      if (next == session.nextSeq) {
        // A command at the head still waiting (a crossfade tail that never came): give up on it.
        val stuck = checkNotNull(session.pending.pollFirstEntry()) {
          "Local audio pending head vanished while recovering session ${session.serial} gap"
        }.value
        log.log(Log.WARN, "Local audio: ${(stuck as? Entry.Command)?.name ?: "entry"} ${session.nextSeq} waited too long; dropping it", null)
        session.nextSeq += 1
      } else {
        log.log(Log.WARN, "Local audio: segments ${session.nextSeq}..${next - 1} never arrived; skipping them", null)
        session.missing += (next - session.nextSeq).toInt()
        session.nextSeq = next
      }
      session.gapSinceNanos = null
      drainPending(session)
      publish(session)
    }
  }

  private fun setFade(session: Session, target: Double, ms: Int) {
    val to = target.coerceIn(0.0, 1.0)
    if (ms <= 0) {
      session.fade = null
      session.fadeGain = to
      return
    }
    session.fade = Fade(to, (to - session.fadeGain) * 1000.0 / ms / session.settings.sampleRate)
  }

  /** Whether the last slice [buildSlice] built was [session]'s own audio, which is what its clock counts. */
  private var sliceIsOwnAudio = true

  /** Fill [scratch] with the next slice for [session]; returns its frames. */
  private fun buildSlice(session: Session): Int {
    val playingOut = session.tail?.takeIf { it.playsOut }
    sliceIsOwnAudio = playingOut == null
    if (playingOut != null) return readPlayOut(session, playingOut)
    val head = session.queue.firstOrNull()
    if (head != null) {
      val want = minOf(SLICE_FRAMES.toLong(), head.frames).toInt()
      val got = head.source.read(head.startFrame, scratch, 0, want)
      if (got <= 0) {
        session.queue.removeFirst()
        return 0
      }
      head.startFrame += got
      head.frames -= got
      if (head.frames <= 0) session.queue.removeFirst()
      session.sourceSilentSeconds = observeSilentSeconds(session.sourceSilentSeconds, scratch, got, session.settings.sampleRate)
      if (!head.processed) {
        applyFade(session, got)
        mixTail(session, got, ownAudio = true)
      }
      return got
    }
    val tailFrames = (session.settings.sampleRate / TAIL_SLICES_PER_SECOND).coerceIn(1, SLICE_FRAMES)
    java.util.Arrays.fill(scratch, 0, tailFrames * BYTES_PER_FRAME, 0)
    return mixTail(session, tailFrames, ownAudio = false)
  }

  /** The predecessor's play-out, as it is: it was cut and declicked when that tune's transition began. */
  private fun readPlayOut(session: Session, tail: Tail): Int {
    var filled = 0
    while (filled < SLICE_FRAMES && tail.segments.isNotEmpty()) {
      val segment = tail.segments.first()
      val want = minOf((SLICE_FRAMES - filled).toLong(), segment.frames).toInt()
      val got = segment.source.read(segment.startFrame, scratch, filled * BYTES_PER_FRAME, want)
      segment.startFrame += got
      segment.frames -= got
      if (got <= 0 || segment.frames <= 0) tail.segments.removeFirst()
      filled += got.coerceAtLeast(0)
    }
    if (tail.segments.isEmpty()) session.tail = null
    return filled
  }

  private fun applyFade(session: Session, frames: Int) {
    val fade = session.fade
    if (fade == null && session.fadeGain >= 1.0) return
    var gain = session.fadeGain
    for (i in 0 until frames) {
      if (fade != null) {
        gain += fade.perFrame
        gain = if (fade.perFrame >= 0) minOf(gain, fade.to) else maxOf(gain, fade.to)
      }
      scaleFrame(scratch, i * BYTES_PER_FRAME, gain)
    }
    session.fadeGain = gain
    if (fade != null && (if (fade.perFrame >= 0) gain >= fade.to else gain <= fade.to)) session.fade = null
  }

  /**
   * Sum the outgoing tune into the slice, in place. The ramp only advances on the incoming tune's own
   * audio: while it has nothing of its own the outgoing tune plays on at its own level, so the two
   * never meet in a gap. Returns the frames that carried tail audio.
   */
  private fun mixTail(session: Session, frames: Int, ownAudio: Boolean): Int {
    val tail = session.tail ?: return 0
    var mixed = 0
    while (mixed < frames) {
      if (tail.segments.isEmpty() || tail.frame >= tail.frames) {
        session.tail = null
        break
      }
      if (ownAudio && tail.frame == 0L) {
        // Played on at full level while the incoming tune had nothing, the tail may be shorter now
        // than the fade it was given; ramp over what is left, so it ends at silence, not part-way.
        tail.frames = minOf(tail.frames, tail.segments.sumOf { it.frames })
        if (tail.frames <= 0) {
          session.tail = null
          break
        }
      }
      val segment = tail.segments.first()
      val room = if (ownAudio) minOf(frames - mixed, (tail.frames - tail.frame).toInt()) else frames - mixed
      val want = minOf(room.toLong(), segment.frames).toInt()
      val got = segment.source.read(segment.startFrame, tailScratch, 0, want)
      if (got <= 0) {
        tail.segments.removeFirst()
        continue
      }
      for (i in 0 until got) {
        val gain = if (ownAudio || tail.frame > 0) 1.0 - tail.frame.toDouble() / tail.frames else 1.0
        val at = (mixed + i) * BYTES_PER_FRAME
        val from = i * BYTES_PER_FRAME
        for (channel in 0 until 2) {
          val offset = channel * 2
          val sum = readS16(scratch, at + offset) + readS16(tailScratch, from + offset) * gain
          writeS16(scratch, at + offset, sum)
        }
        if (ownAudio) tail.frame += 1
      }
      segment.startFrame += got
      segment.frames -= got
      if (segment.frames <= 0) tail.segments.removeFirst()
      mixed += got
    }
    if (tail.segments.isEmpty() || tail.frame >= tail.frames) session.tail = null
    return mixed
  }

  private fun afterWrite(session: Session, frames: Int) {
    val now = clock.nanoTime()
    session.lastWriteNanos = now
    if (sliceIsOwnAudio) session.writtenFrames += frames
    val copy = scratch.copyOf(frames * BYTES_PER_FRAME)
    session.history.addLast(copy)
    session.historyFrames += frames
    val keep = TAIL_HISTORY_SECONDS * session.settings.sampleRate
    while (session.history.size > 1 && session.historyFrames - session.history.first().size / BYTES_PER_FRAME >= keep) {
      session.historyFrames -= session.history.removeFirst().size / BYTES_PER_FRAME
    }
    observeSilence(session, copy, frames)
    depthStalledSinceNanos = null
    lastDepthMs = Double.MAX_VALUE
    publish(session)
  }

  private fun observeSilence(session: Session, slice: ByteArray, frames: Int) {
    session.silentSeconds = observeSilentSeconds(session.silentSeconds, slice, frames, session.settings.sampleRate)
  }

  /** The run of silence so far, extended by this slice or ended by it. */
  private fun observeSilentSeconds(runSeconds: Double, slice: ByteArray, frames: Int, sampleRate: Int): Double {
    var lo = Int.MAX_VALUE
    var hi = Int.MIN_VALUE
    // Music settles the question within a few samples, so the scan stops as soon as it is answered.
    for (i in 0 until frames * 2) {
      val v = readS16(slice, i * 2)
      if (v < lo) lo = v
      if (v > hi) hi = v
      if (hi - lo >= SILENCE_PEAK_TO_PEAK) break
    }
    return if (frames > 0 && hi - lo >= SILENCE_PEAK_TO_PEAK) 0.0 else runSeconds + frames.toDouble() / sampleRate
  }

  /** Nothing to write. Watch for a track that holds audio and has stopped playing it. */
  private fun idle(): Long {
    val session = sessions[activeSerial]
    val current = output
    if (session == null || current == null || paused) return IDLE_NANOS
    val now = clock.nanoTime()
    if (now - lastDepthPollNanos < DEPTH_POLL_NANOS) return IDLE_NANOS
    lastDepthPollNanos = now
    publish(session)
    // The ring, not the track: with nothing to play the pipeline keeps the track full of silence, so
    // the track's depth holds steady on a healthy, idle track.
    val depth = current.ringMs()
    val quiet = now - session.lastWriteNanos >= WRITE_QUIET_NANOS
    if (!quiet || depth <= 0) {
      depthStalledSinceNanos = null
      lastDepthMs = depth
      return IDLE_NANOS
    }
    val draining = depth < lastDepthMs - DEPTH_PROGRESS_EPSILON_MS
    lastDepthMs = depth
    if (draining) {
      depthStalledSinceNanos = null
      return IDLE_NANOS
    }
    val stalledSince = depthStalledSinceNanos ?: now.also { depthStalledSinceNanos = it }
    if (now - stalledSince < STALL_GRACE_NANOS) return IDLE_NANOS
    log.log(Log.WARN, "Local audio: the track stopped consuming with ${depth.toInt()} ms queued; re-opening", null)
    depthStalledSinceNanos = null
    session.writtenFrames = playedFrames(session, current)
    reopens += 1
    host.close(current)
    output = null
    outputSettings = null
    publish(session)
    return IDLE_NANOS
  }

  private fun playedFrames(session: Session, current: FeedOutput?): Long {
    if (current == null || session.serial != activeSerial) return session.writtenFrames
    val queued = (current.bufferedMs() * session.settings.sampleRate / 1000).toLong()
    return (session.writtenFrames - queued).coerceAtLeast(0)
  }

  private fun publish(session: Session) {
    val current = output
    val active = session.serial == activeSerial && current != null
    val buffered = if (active) current.bufferedMs() else 0.0
    val queuedSec = buffered / 1000
    val stats =
        FeedSessionStats(
            serial = session.serial,
            writtenFrames = session.writtenFrames,
            playedFrames = playedFrames(session, current),
            bufferedMs = buffered,
            queuedFrames = session.queuedFrames(),
            underruns = if (active) current.underruns() else 0,
            silentSeconds = session.silentSeconds,
            silentFault =
                session.silentSeconds - queuedSec >= SILENCE_TOLERANCE_SECONDS &&
                    session.sourceSilentSeconds < SILENCE_TOLERANCE_SECONDS,
            reopens = reopens,
            active = active,
            superseded = isSuperseded(session) || session.closed,
            missingSegments = session.missing,
            outputOpen = current != null,
            openFailures = openFailures,
        )
    session.stats = stats
    statsBySerial[session.serial] = stats
    if (statsBySerial.size > MAX_STATS_ENTRIES) {
      val stale = statsBySerial.keys.filter { !sessions.containsKey(it) }.sorted()
      for (key in stale.take(statsBySerial.size - MAX_STATS_ENTRIES)) statsBySerial.remove(key)
    }
  }

  companion object {
    private const val TAG = "LocalAudioFeed"
    const val BYTES_PER_FRAME = 4
    /** 50 ms at 48 kHz. Per-write cost here is a memcpy, so slices are short to keep fades responsive. */
    const val SLICE_FRAMES = 2400
    const val TAIL_SLICES_PER_SECOND = 20
    /** Below the depth at which the pipeline trims its own backlog, so nothing written is discarded. */
    const val HIGH_WATER_MS = 12_000.0
    /** After a pass that threw, so a fault that repeats cannot spin the thread. */
    const val FAILED_PASS_NANOS = 50_000_000L
    /** How shallow the track is kept during a track change, so the incoming tune is not queued behind. */
    const val TRANSITION_HIGH_WATER_MS = 250.0
    /** The ring is kept at least this deep whenever there is audio for it, so the player never starves. */
    const val RING_FLOOR_MS = 60.0
    /** Deeper than [HIGH_WATER_MS], or recovering the unplayed audio would run off the end of it. */
    const val TAIL_HISTORY_SECONDS = 14
    const val SILENCE_PEAK_TO_PEAK = 64
    const val SILENCE_TOLERANCE_SECONDS = 12.0
    private const val MAX_STATS_ENTRIES = 32
    private const val IDLE_NANOS = 20_000_000L
    private const val FULL_NANOS = 20_000_000L
    private const val PAUSED_NANOS = 20_000_000L
    private const val OPEN_RETRY_NANOS = 250_000_000L
    private const val GAP_TIMEOUT_NANOS = 2_000_000_000L
    private const val DEPTH_POLL_NANOS = 500_000_000L
    private const val WRITE_QUIET_NANOS = 1_000_000_000L
    private const val STALL_GRACE_NANOS = 4_000_000_000L
    private const val DEPTH_PROGRESS_EPSILON_MS = 20.0
    private const val STOP_JOIN_MS = 500L

    fun bytesSource(bytes: ByteArray, offsetBytes: Int = 0): SegmentSource = SegmentSource { start, dst, dstOffset, count ->
      val available = ((bytes.size - offsetBytes) / BYTES_PER_FRAME - start).coerceAtLeast(0).coerceAtMost(count.toLong()).toInt()
      System.arraycopy(bytes, offsetBytes + (start * BYTES_PER_FRAME).toInt(), dst, dstOffset, available * BYTES_PER_FRAME)
      available
    }

    fun bufferSource(buffer: PcmBuffer): SegmentSource = SegmentSource { start, dst, dstOffset, count ->
      buffer.read(start, dst, dstOffset, count)
    }

    private fun readS16(buffer: ByteArray, at: Int): Int =
        ((buffer[at].toInt() and 0xFF) or (buffer[at + 1].toInt() shl 8)).toShort().toInt()

    private fun writeS16(buffer: ByteArray, at: Int, value: Double) {
      val v = value.toInt().coerceIn(-32768, 32767)
      buffer[at] = (v and 0xFF).toByte()
      buffer[at + 1] = ((v shr 8) and 0xFF).toByte()
    }

    private fun scaleFrame(buffer: ByteArray, at: Int, gain: Double) {
      writeS16(buffer, at, readS16(buffer, at) * gain)
      writeS16(buffer, at + 2, readS16(buffer, at + 2) * gain)
    }
  }
}
