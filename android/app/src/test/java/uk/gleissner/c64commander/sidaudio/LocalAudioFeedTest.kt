/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander.sidaudio

import java.io.ByteArrayOutputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import uk.gleissner.c64commander.PipelineClock

class LocalAudioFeedTest {
  private val rate = 48000

  private class VirtualClock : PipelineClock {
    var now = 0L

    override fun nanoTime(): Long = now

    override fun park(nanos: Long) {
      now += nanos
    }
  }

  /** A track that drains at the sample rate on virtual time, and remembers every sample written. */
  private class FakeOutput(private val clock: VirtualClock, private val rate: Int) : FeedOutput {
    val written = ByteArrayOutputStream()
    var writtenFrames = 0L
    private var consumedAtResume = 0L
    private var resumedAtNanos = clock.now
    var paused = false
    var flushes = 0
    var lastGain = -1.0
    var offers = 0

    private fun consumed(): Long {
      if (paused) return consumedAtResume
      val drained = consumedAtResume + (clock.now - resumedAtNanos) * rate / 1_000_000_000L
      return minOf(writtenFrames, drained)
    }

    override fun offer(data: ByteArray, offset: Int, length: Int) {
      val consumedNow = consumed()
      consumedAtResume = consumedNow
      resumedAtNanos = clock.now
      written.write(data, offset, length)
      writtenFrames += length / 4
      offers += 1
    }

    override fun flush() {
      flushes += 1
      consumedAtResume = writtenFrames
      resumedAtNanos = clock.now
    }

    override fun pause() {
      consumedAtResume = consumed()
      paused = true
    }

    override fun resume() {
      paused = false
      resumedAtNanos = clock.now
    }

    override fun setGain(gain: Double) {
      lastGain = gain
    }

    override fun bufferedMs(): Double = (writtenFrames - consumed()) * 1000.0 / rate

    override fun underruns(): Int = 0

    fun samples(): ShortArray {
      val bytes = written.toByteArray()
      return ShortArray(bytes.size / 2) { i -> ((bytes[i * 2].toInt() and 0xFF) or (bytes[i * 2 + 1].toInt() shl 8)).toShort() }
    }
  }

  private class FakeHost(private val clock: VirtualClock, private val rate: Int) : FeedOutputHost {
    val opened = mutableListOf<FakeOutput>()
    var current: FakeOutput? = null
    var failNextOpens = 0
    val closed = mutableListOf<FakeOutput>()

    override fun open(settings: FeedTrackSettings): FeedOutput {
      if (failNextOpens > 0) {
        failNextOpens -= 1
        throw IllegalStateException("the platform refused the track")
      }
      val output = FakeOutput(clock, rate)
      opened.add(output)
      current = output
      return output
    }

    override fun isCurrent(output: FeedOutput): Boolean = current === output

    override fun close(output: FeedOutput) {
      closed.add(output as FakeOutput)
      if (current === output) current = null
    }
  }

  private val clock = VirtualClock()
  private val host = FakeHost(clock, rate)
  private val logged = mutableListOf<String>()
  private val feed = LocalAudioFeed(host, clock) { _, message, _ -> logged.add(message) }
  private val settings = FeedTrackSettings(rate, 15000, 20000, 16, 600)

  private fun pcm(frames: Int, value: Int, right: Int = value): ByteArray {
    val out = ByteArray(frames * 4)
    for (i in 0 until frames) {
      out[i * 4] = (value and 0xFF).toByte()
      out[i * 4 + 1] = ((value shr 8) and 0xFF).toByte()
      out[i * 4 + 2] = (right and 0xFF).toByte()
      out[i * 4 + 3] = ((right shr 8) and 0xFF).toByte()
    }
    return out
  }

  private fun segment(frames: Int, value: Int) = Segment(LocalAudioFeed.bytesSource(pcm(frames, value)), 0, frames.toLong())

  /** Run the feeder until it has nothing more to do right now, advancing virtual time as it parks. */
  private fun pump(maxPasses: Int = 10_000) {
    repeat(maxPasses) {
      val park = feed.runOnce()
      if (park > 0) return
    }
  }

  private fun advance(ms: Long, step: Long = 10) {
    var left = ms
    while (left > 0) {
      clock.now += step * 1_000_000
      left -= step
      feed.runOnce()
    }
  }

  @Test
  fun `writes a session's segments in sequence order even when they arrive out of order`() {
    feed.openSession(1, settings)
    feed.enqueue(1, 2, segment(100, 2000))
    feed.enqueue(1, 1, segment(100, 1000))
    feed.enqueue(1, 3, segment(100, 3000))
    pump()
    val samples = host.current!!.samples()
    assertEquals(600, samples.size)
    assertEquals(1000, samples[0].toInt())
    assertEquals(2000, samples[200].toInt())
    assertEquals(3000, samples[400].toInt())
  }

  @Test
  fun `waits for a missing segment, then skips it once the gap has outlasted its bound`() {
    feed.openSession(1, settings)
    feed.enqueue(1, 2, segment(100, 2000))
    pump()
    assertEquals(0L, host.opened.firstOrNull()?.writtenFrames ?: 0L)
    advance(2100)
    assertEquals(100L, host.current!!.writtenFrames)
    assertTrue(logged.any { it.contains("never arrived") })
    assertEquals(1, feed.stats(1)!!.missingSegments)
  }

  @Test
  fun `a segment that carried nothing moves the order on at once`() {
    feed.openSession(1, settings)
    feed.enqueue(1, 2, segment(100, 2000))
    feed.enqueue(1, 1, null)
    pump()
    assertEquals(100L, host.current!!.writtenFrames)
  }

  @Test
  fun `stops writing at the high-water mark and continues as the track drains`() {
    feed.openSession(1, settings)
    var seq = 1L
    repeat(40) { feed.enqueue(1, seq++, segment(rate / 2, 500)) }
    pump()
    val output = host.current!!
    assertTrue(output.bufferedMs() >= LocalAudioFeed.HIGH_WATER_MS)
    assertTrue(output.bufferedMs() < LocalAudioFeed.HIGH_WATER_MS + 100)
    val before = output.writtenFrames
    advance(2000)
    assertTrue(output.writtenFrames > before)
    assertTrue(output.bufferedMs() < LocalAudioFeed.HIGH_WATER_MS + 100)
  }

  @Test
  fun `a flush drops what is queued, here and in the track, and ignores late arrivals it covered`() {
    feed.openSession(1, settings)
    feed.enqueue(1, 1, segment(1000, 100))
    pump()
    feed.enqueue(1, 3, segment(1000, 300))
    feed.flush(1, 3)
    feed.enqueue(1, 2, segment(1000, 200))
    feed.enqueue(1, 4, segment(1000, 400))
    pump()
    val output = host.current!!
    assertEquals(1, output.flushes)
    val samples = output.samples()
    assertEquals(4000, samples.size)
    assertEquals(400, samples.last().toInt())
    assertEquals(1000L, feed.stats(1)!!.writtenFrames)
  }

  @Test
  fun `the clock is what was written less what the track still holds`() {
    feed.openSession(1, settings)
    feed.enqueue(1, 1, segment(rate, 100))
    pump()
    assertEquals(0L, feed.stats(1)!!.playedFrames)
    advance(500)
    val played = feed.stats(1)!!.playedFrames
    assertTrue("played $played", played in (rate / 2 - 1000)..(rate / 2 + 1000))
  }

  @Test
  fun `holds the track on pause and lets it continue from the same sample on resume`() {
    feed.openSession(1, settings)
    feed.enqueue(1, 1, segment(rate, 100))
    pump()
    advance(200)
    feed.pause(1)
    pump()
    val held = feed.stats(1)!!.playedFrames
    advance(1000)
    assertEquals(held, feed.stats(1)!!.playedFrames)
    assertTrue(host.current!!.paused)
    feed.resume(1)
    advance(200)
    assertTrue(feed.stats(1)!!.playedFrames > held)
  }

  @Test
  fun `the newest session to write takes the track, and the older one goes quiet`() {
    feed.openSession(1, settings)
    feed.enqueue(1, 1, segment(1000, 111))
    pump()
    feed.openSession(2, settings)
    feed.enqueue(2, 1, segment(1000, 222))
    feed.enqueue(1, 2, segment(1000, 999))
    pump()
    val samples = host.current!!.samples()
    assertEquals(4000, samples.size)
    assertTrue(samples.none { it.toInt() == 999 })
    assertTrue(feed.stats(1)!!.superseded)
    assertTrue(feed.stats(2)!!.active)
    assertEquals(1, host.opened.size)
  }

  @Test
  fun `a superseded session cannot flush or close the track its successor is playing`() {
    feed.openSession(1, settings)
    feed.enqueue(1, 1, segment(1000, 111))
    pump()
    feed.openSession(2, settings)
    feed.enqueue(2, 1, segment(1000, 222))
    pump()
    feed.flush(1, 10)
    feed.close(1)
    pump()
    assertEquals(0, host.current!!.flushes)
    assertTrue(host.closed.isEmpty())
    feed.close(2)
    pump()
    assertEquals(1, host.closed.size)
  }

  @Test
  fun `a track with different settings is replaced, one with the same settings is inherited`() {
    feed.openSession(1, settings)
    feed.enqueue(1, 1, segment(100, 1))
    pump()
    feed.openSession(2, settings.copy(primeMs = 900))
    feed.enqueue(2, 1, segment(100, 2))
    pump()
    assertEquals(1, host.opened.size)
    feed.openSession(3, settings.copy(sampleRate = 44100))
    feed.enqueue(3, 1, segment(100, 3))
    pump()
    assertEquals(2, host.opened.size)
  }

  @Test
  fun `the listener's level survives the track being re-opened`() {
    feed.setGain(0.25)
    feed.openSession(1, settings)
    feed.enqueue(1, 1, segment(100, 1))
    pump()
    assertEquals(0.25, host.current!!.lastGain, 1e-9)
    feed.openSession(2, settings.copy(sampleRate = 44100))
    feed.enqueue(2, 1, segment(100, 1))
    pump()
    assertEquals(0.25, host.current!!.lastGain, 1e-9)
    feed.setGain(4.0)
    pump()
    assertEquals(1.0, host.current!!.lastGain, 1e-9)
  }

  @Test
  fun `fades in from silence over the incoming tune's own audio`() {
    feed.openSession(1, settings)
    feed.fadeIn(1, 100)
    feed.enqueue(1, 1, segment(rate / 5, 10000))
    pump()
    val left = host.current!!.samples().filterIndexed { i, _ -> i % 2 == 0 }
    assertTrue(left[0] < 300)
    assertTrue(left[rate / 20] in 4000..6000)
    assertEquals(10000, left[rate / 10 + 10].toInt())
    assertEquals(10000, left.last().toInt())
  }

  @Test
  fun `a zero-length fade is an immediate level change`() {
    feed.openSession(1, settings)
    feed.fade(1, 0.5, 0)
    feed.enqueue(1, 1, segment(100, 10000))
    pump()
    assertTrue(host.current!!.samples().all { it.toInt() == 5000 })
  }

  @Test
  fun `crossfade - the outgoing tune plays on at full level until the incoming one has audio, then fades under it`() {
    feed.openSession(1, settings)
    feed.enqueue(1, 1, segment(rate * 2, 8000))
    pump()
    advance(100)
    feed.beginTransition(1, 4.0)
    feed.openSession(2, settings)
    feed.takeTail(1, 7, 4.0)
    feed.release(1)
    feed.adoptTail(2, 7, 0.5)
    feed.fadeIn(2, 500)
    advance(300)
    val output = host.current!!
    assertTrue(output.flushes >= 1)
    val tailOnly = output.samples()
    assertTrue(tailOnly.isNotEmpty())
    assertTrue(tailOnly.takeLast(100).all { it.toInt() == 8000 })
    val before = tailOnly.size
    feed.enqueue(2, 1, segment(rate, 4000))
    advance(1000)
    val mixed = output.samples().drop(before).filterIndexed { i, _ -> i % 2 == 0 }
    assertTrue("starts with the outgoing tune near full level", mixed.first() in 7800..8100)
    val half = mixed[rate / 4]
    assertTrue("halfway through both fades the sum is about half of each: $half", half in 5500..6500)
    assertEquals(4000, mixed[rate / 2 + 100].toInt())
  }

  @Test
  fun `crossfade - the recovered tail begins at the playhead, never at audio already heard`() {
    feed.openSession(1, settings)
    var seq = 1L
    for (i in 0 until 20) feed.enqueue(1, seq++, segment(rate / 10, 100 + i))
    pump()
    advance(1000)
    val played = feed.stats(1)!!.playedFrames
    feed.beginTransition(1, 4.0)
    pump()
    val output = host.current!!
    assertEquals(1, output.flushes)
    val firstRecovered = output.samples()[rate * 2 * 2].toInt()
    val playingSlice = 100 + (played / (rate / 10)).toInt()
    assertTrue("recovery resumed at $firstRecovered, the playhead was in $playingSlice", firstRecovered == playingSlice)
  }

  @Test
  fun `crossfade - clamps rather than wraps when both tunes peak together`() {
    feed.openSession(1, settings)
    feed.enqueue(1, 1, segment(rate, 30000))
    pump()
    feed.beginTransition(1, 2.0)
    feed.openSession(2, settings)
    feed.takeTail(1, 1, 2.0)
    feed.release(1)
    feed.adoptTail(2, 1, 1.0)
    feed.enqueue(2, 1, segment(rate / 10, 30000))
    advance(400)
    assertTrue(host.current!!.samples().all { it.toInt() >= 0 })
    assertTrue(host.current!!.samples().any { it.toInt() == 32767 })
  }

  @Test
  fun `crossfade - a spent tail writes no silence of its own`() {
    feed.openSession(1, settings)
    feed.enqueue(1, 1, segment(rate / 10, 5000))
    pump()
    feed.beginTransition(1, 1.0)
    feed.openSession(2, settings)
    feed.takeTail(1, 1, 1.0)
    feed.release(1)
    feed.adoptTail(2, 1, 1.0)
    advance(2000)
    val samples = host.current!!.samples()
    assertTrue(samples.takeLast(20).all { it.toInt() == 5000 })
  }

  @Test
  fun `judges silence by what has reached the speaker, not by what is still queued`() {
    feed.openSession(1, settings)
    var seq = 1L
    repeat(26) { feed.enqueue(1, seq++, segment(rate / 2, 0)) }
    pump()
    assertTrue(feed.stats(1)!!.silentSeconds >= 12.0)
    assertFalse(feed.stats(1)!!.silentFault)
    advance(13_000, step = 50)
    assertTrue(feed.stats(1)!!.silentFault)
    feed.resetSilence(1)
    pump()
    assertEquals(0.0, feed.stats(1)!!.silentSeconds, 1e-9)
  }

  @Test
  fun `re-opens a track that stops consuming, and says so through the stats`() {
    feed.openSession(1, settings)
    feed.enqueue(1, 1, segment(rate * 2, 100))
    pump()
    host.current!!.pause()
    advance(7000, step = 100)
    assertEquals(1, feed.stats(1)!!.reopens)
    assertTrue(logged.any { it.contains("stopped consuming") })
  }

  @Test
  fun `leaves a draining track alone`() {
    feed.openSession(1, settings)
    feed.enqueue(1, 1, segment(rate * 8, 100))
    pump()
    advance(7000, step = 100)
    assertEquals(0, feed.stats(1)!!.reopens)
  }

  @Test
  fun `tries the open again after a failure rather than staying silent`() {
    host.failNextOpens = 1
    feed.openSession(1, settings)
    feed.enqueue(1, 1, segment(100, 1))
    pump()
    assertTrue(host.opened.isEmpty())
    assertEquals(1, feed.stats(1)!!.openFailures)
    advance(300)
    assertEquals(100L, host.current!!.writtenFrames)
  }

  @Test
  fun `stops writing into a track another player has taken over`() {
    feed.openSession(1, settings)
    feed.enqueue(1, 1, segment(1000, 1))
    pump()
    val ours = host.current!!
    host.current = FakeOutput(clock, rate)
    feed.enqueue(1, 2, segment(1000, 2))
    pump()
    assertEquals(1000L, ours.writtenFrames)
    assertEquals(0L, host.current!!.writtenFrames)
    feed.openSession(2, settings)
    feed.enqueue(2, 1, segment(1000, 3))
    pump()
    assertEquals(2, host.opened.size)
  }

  @Test
  fun `reads native buffers in place, from any start frame`() {
    val store = PcmStore()
    val buffer = store.create(rate, retained = true, blockFrames = 64)
    buffer.appendBytes(pcm(200, 7), 0, 800)
    feed.openSession(1, settings)
    feed.enqueue(1, 1, Segment(LocalAudioFeed.bufferSource(buffer), 150, 50))
    pump()
    assertEquals(50L, host.current!!.writtenFrames)
  }

  @Test
  fun `reset forgets every session`() {
    feed.openSession(1, settings)
    feed.enqueue(1, 1, segment(100, 1))
    pump()
    feed.reset()
    feed.openSession(1, settings)
    feed.enqueue(1, 1, segment(100, 2))
    pump()
    assertEquals(2, host.opened.size)
    assertEquals(100L, host.current!!.writtenFrames)
  }

  @Test
  fun `a running feed thread drains its inbox and stops cleanly`() {
    val realHost = FakeHost(clock, rate)
    val threaded = LocalAudioFeed(realHost)
    threaded.start()
    threaded.openSession(1, settings)
    threaded.enqueue(1, 1, segment(100, 1))
    val deadline = System.currentTimeMillis() + 5000
    while (realHost.current?.writtenFrames != 100L && System.currentTimeMillis() < deadline) Thread.sleep(5)
    threaded.stop()
    assertEquals(100L, realHost.current!!.writtenFrames)
  }
}
