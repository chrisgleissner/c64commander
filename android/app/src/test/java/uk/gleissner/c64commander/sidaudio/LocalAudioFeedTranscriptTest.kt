/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander.sidaudio

import java.io.ByteArrayOutputStream
import java.io.File
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import uk.gleissner.c64commander.PipelineClock

/**
 * The native half of `localSidTransitionContinuity.test.ts`.
 *
 * That test runs the real engine, scheduler and sink and records every call the sink makes to the
 * feed, with its time. Each recording is replayed here against the real [LocalAudioFeed], on
 * virtual time, into a track that drains at the sample rate, and what reached the speaker is
 * inspected: whether it ever ran dry between the tunes, and, for a crossfade, whether the outgoing
 * tune stayed under the incoming one for the whole fade without dipping towards silence.
 *
 * The outgoing tune is a steady 8000 and the incoming one a steady 12000, so during a crossfade a
 * sample is 8000·(1−x) + 12000·x: never below 8000. A fade that ran out of tail, or a gap, shows as
 * a sample below it.
 */
class LocalAudioFeedTranscriptTest {
  private val fixtures = File(System.getProperty("user.dir"), "src/test/fixtures/local-audio")

  private class VirtualClock : PipelineClock {
    var now = 0L

    override fun nanoTime(): Long = now

    override fun park(nanos: Long) {
      now += nanos
    }
  }

  /** A track that plays at the sample rate and records every gap in what it was given. */
  private class SpeakerOutput(private val clock: VirtualClock, private val rate: Int) : FeedOutput {
    val played = ByteArrayOutputStream()
    private var bufferedUntilNanos = 0L
    private var started = false
    var underrunMs = 0.0
    /** Frames offered before the last flush: everything from there on was heard. */
    var offeredAtLastFlush = 0
    private var heldFrames = 0L
    private var lastDrainNanos = 0L

    private fun drain() {
      val elapsed = clock.now - lastDrainNanos
      lastDrainNanos = clock.now
      heldFrames = (heldFrames - elapsed * rate / 1_000_000_000L).coerceAtLeast(0)
    }

    override fun offer(data: ByteArray, offset: Int, length: Int) {
      drain()
      val frames = length / 4
      if (started && clock.now > bufferedUntilNanos) underrunMs += (clock.now - bufferedUntilNanos) / 1e6
      started = true
      bufferedUntilNanos = maxOf(bufferedUntilNanos, clock.now) + frames * 1_000_000_000L / rate
      heldFrames += frames
      played.write(data, offset, length)
    }

    override fun flush() {
      drain()
      offeredAtLastFlush = played.size() / 4
      heldFrames = 0
      bufferedUntilNanos = clock.now
    }

    override fun pause() = Unit

    override fun resume() = Unit

    override fun setGain(gain: Double) = Unit

    override fun bufferedMs(): Double {
      drain()
      return heldFrames * 1000.0 / rate
    }

    override fun ringMs(): Double = bufferedMs()

    override fun underruns(): Int = 0

    fun leftChannel(): IntArray {
      val bytes = played.toByteArray()
      return IntArray(bytes.size / 4) { i -> ((bytes[i * 4].toInt() and 0xFF) or (bytes[i * 4 + 1].toInt() shl 8)).toShort().toInt() }
    }
  }

  private class Host(private val clock: VirtualClock, private val rate: Int) : FeedOutputHost {
    val outputs = mutableListOf<SpeakerOutput>()
    var current: SpeakerOutput? = null

    override fun open(settings: FeedTrackSettings): FeedOutput = SpeakerOutput(clock, rate).also {
      outputs.add(it)
      current = it
    }

    override fun isCurrent(output: FeedOutput): Boolean = current === output

    override fun close(output: FeedOutput) {
      if (current === output) current = null
    }
  }

  private class Replay(val host: Host, val fadeMs: Int, val rate: Int)

  private fun replay(name: String): Replay {
    val scenario = JSONObject(File(fixtures, "$name.json").readText())
    val rate = scenario.getInt("sampleRate")
    val clock = VirtualClock()
    val host = Host(clock, rate)
    val feed = LocalAudioFeed(host, clock) { _, _, _ -> }
    val transcript = scenario.getJSONArray("transcript")
    val endMs = transcript.getJSONObject(transcript.length() - 1).getLong("t") + 8000
    var next = 0
    var nowMs = 0L
    while (nowMs <= endMs) {
      while (next < transcript.length() && transcript.getJSONObject(next).getLong("t") <= nowMs) {
        apply(feed, transcript.getJSONObject(next), rate)
        next += 1
      }
      repeat(200) { if (feed.runOnce() > 0) return@repeat }
      nowMs += 5
      clock.now = nowMs * 1_000_000
    }
    return Replay(host, scenario.getInt("fadeMs"), rate)
  }

  private fun apply(feed: LocalAudioFeed, e: JSONObject, rate: Int) {
    val serial = e.optInt("serial")
    when (e.getString("method")) {
      "openSession" ->
          feed.openSession(serial, FeedTrackSettings(e.getInt("sampleRate"), e.getInt("bufferMs"), e.getInt("maxRingMs"), e.getInt("trackBursts"), e.getInt("primeMs")))
      "setGain" -> feed.setGain(e.getDouble("gain"))
      "fadeIn" -> feed.fadeIn(serial, e.getLong("seq"), e.getInt("ms"))
      "fade" -> feed.fade(serial, e.getLong("seq"), e.getDouble("target"), e.getInt("ms"))
      "enqueuePcm" -> {
        val frames = e.getInt("frames")
        val value = e.getInt("value")
        val bytes = ByteArray(frames * 4)
        for (i in 0 until frames * 2) {
          bytes[i * 2] = (value and 0xFF).toByte()
          bytes[i * 2 + 1] = ((value shr 8) and 0xFF).toByte()
        }
        feed.enqueue(serial, e.getLong("seq"), Segment(LocalAudioFeed.bytesSource(bytes), 0, frames.toLong()))
      }
      "flush" -> feed.flush(serial, e.getLong("seq"))
      "pause" -> feed.pause(serial)
      "resume" -> feed.resume(serial)
      "beginTransition" -> feed.beginTransition(serial, e.getLong("seq"), e.getDouble("seconds"), e.optDouble("playOutDeclickSeconds", 0.0))
      "takeTail" -> feed.takeTail(serial, e.getLong("seq"), e.getInt("tailId"), e.getDouble("maxSeconds"))
      "adoptTail" -> feed.adoptTail(serial, e.getLong("seq"), e.getInt("tailId"), e.getDouble("seconds"))
      "release" -> feed.release(serial, e.getLong("seq"))
      "close" -> feed.close(serial)
      else -> throw IllegalArgumentException("Unknown recorded call ${e.getString("method")}")
    }
    assertTrue(rate > 0)
  }

  private fun assertSeamlessCrossfade(name: String) {
    val replay = replay(name)
    assertEquals("one track for both tunes", 1, replay.host.outputs.size)
    val speaker = replay.host.outputs.single()
    assertEquals("$name: the speaker never ran dry", 0.0, speaker.underrunMs, 0.0)
    val samples = speaker.leftChannel()
    val firstMixed = samples.indexOfFirst { it != 8000 && it != 0 && samples.indexOf(8000) >= 0 }
    assertTrue("$name: the incoming tune reached the speaker", samples.any { it == 12000 })
    val firstFull = samples.indexOfFirst { it == 12000 }
    val transition = samples.copyOfRange(samples.indexOf(8000), firstFull)
    assertTrue("$name: nothing between the tunes fell below the outgoing tune's level", transition.all { it >= 7990 })
    val rampFrames = firstFull - firstMixed
    val fadeFrames = replay.fadeMs * replay.rate / 1000
    assertTrue("$name: the two tunes overlapped for the whole fade ($rampFrames of $fadeFrames frames)", rampFrames >= fadeFrames * 0.95)
  }

  @Test fun `a 600 ms crossfade reaches the speaker as one continuous overlap`() = assertSeamlessCrossfade("crossfade-600")

  @Test fun `a 1500 ms crossfade reaches the speaker as one continuous overlap`() = assertSeamlessCrossfade("crossfade-1500")

  @Test fun `a 3000 ms crossfade reaches the speaker as one continuous overlap`() = assertSeamlessCrossfade("crossfade-3000")

  @Test fun `a 4000 ms crossfade reaches the speaker as one continuous overlap`() = assertSeamlessCrossfade("crossfade-4000")

  @Test fun `the outgoing tune covers a slow open and still fades under the next`() = assertSeamlessCrossfade("crossfade-1500-slow-open")

  @Test fun `crossfade Off keeps the outgoing tune sounding through a slow open then blends for 10 ms`() = assertSeamlessCrossfade("cut")

  @Test
  fun `crossfade Off at a tune's end plays the outgoing tune on to its songlength, then the next tune without a gap`() {
    val scenario = JSONObject(File(fixtures, "cut-play-out.json").readText()).getJSONArray("transcript")
    val transition = (0 until scenario.length()).map { scenario.getJSONObject(it) }.single { it.getString("method") == "beginTransition" }
    val replay = replay("cut-play-out")
    val speaker = replay.host.outputs.single()
    assertEquals("the speaker never ran dry", 0.0, speaker.underrunMs, 0.0)
    val heard = speaker.leftChannel().drop(speaker.offeredAtLastFlush)
    val firstOfNext = heard.indexOf(12000)
    assertEquals("the outgoing tune played on for what was left of it", (transition.getDouble("seconds") * replay.rate).toLong().toInt(), firstOfNext)
    val declick = replay.rate / 100
    assertTrue("full level up to the declick", heard.take(firstOfNext - declick).all { it == 8000 })
    val ramp = heard.subList(firstOfNext - declick, firstOfNext)
    assertTrue("the ramp falls to silence: ${ramp.first()}..${ramp.last()}", ramp.zipWithNext().all { (a, b) -> b <= a } && ramp.last() < 100)
    assertTrue("only the next tune after it, never both mixed", heard.drop(firstOfNext).all { it == 12000 })
  }
}
