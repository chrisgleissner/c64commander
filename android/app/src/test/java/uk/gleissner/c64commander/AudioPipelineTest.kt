/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.media.AudioTrack
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.ArgumentMatchers.any
import org.mockito.ArgumentMatchers.anyInt
import org.mockito.Mockito.mock
import org.mockito.Mockito.`when`
import org.robolectric.RobolectricTestRunner

/**
 * The crackling gate.
 *
 * "Does it crackle" is not a judgement to leave to a listener, so it is expressed here as a number:
 * the **milliseconds of audio per second that the listener did not hear as sent** — silence the
 * pipeline had to invent because nothing had arrived, plus PCM it had to throw away because it could
 * not be played in time. On a Pixel 4 against a c64u the shipped pipeline scored roughly 40 ms/s
 * concealed and 30 ms/s discarded, which is what the user hears.
 *
 * The input is not invented. `StreamArrivalMonitor` on the phone measured the mirror's audio arriving
 * with a mean gap of 4.05 ms but a **maximum of 118.7 ms**, in clumps of up to **29 packets**, while
 * the identical stream sampled on the wire from a wired host arrived every 4.00 ms (p99 4.14 ms) with
 * no clumping and no loss. So the burst pattern replayed below is the real Wi-Fi delivery pattern,
 * and a pipeline that survives it survives the rig.
 *
 * The speaker is modelled as what an `AudioTrack` actually is: a bounded buffer drained at exactly
 * the sample rate, whose blocking write returns only as the DAC makes room. That is what paces the
 * pipeline in production, so it has to be what paces it here.
 */
@RunWith(RobolectricTestRunner::class)
class AudioPipelineTest {
  private val sampleRate = 47983
  private val bytesPerFrame = 4

  private val TONE_AMPLITUDE = 12000

  /** One mirror datagram's worth of PCM: 192 stereo frames = 4.00 ms. */
  private val packetFrames = 192
  private val packet = ByteArray(packetFrames * bytesPerFrame) { (it % 251).toByte() }

  /**
   * A stand-in for the speaker: a buffer of [capacityFrames] drained at the sample rate.
   *
   * `write` blocks while the buffer is full, exactly as `WRITE_BLOCKING` does, which is what gives
   * the pipeline its pacing. Nothing here models the *content* — the pipeline's job is to keep the
   * speaker fed, and whether it managed that is the only thing under test.
   */
  private class FakeSpeaker(
      private val sampleRate: Int,
      /** Keep what was played, so a test can ask what the listener actually heard. */
      private val record: Boolean = false,
  ) {
    /**
     * Set from the buffer size the pipeline actually asks for.
     *
     * It used to be passed in independently, and the mismatch mattered: the pipeline primed its ring
     * for the buffer it believed the speaker had, the fake then swallowed three times that, and the
     * cushion started life empty. A speaker model that does not hold what it was asked to hold tests
     * a pipeline nobody ships.
     */
    @Volatile private var capacityFrames = 1
    val track: AudioTrack = mock(AudioTrack::class.java)
    val played = java.io.ByteArrayOutputStream()
    @Volatile private var startedAtNanos = 0L
    @Volatile private var framesWritten = 0L
    @Volatile var underruns = 0
      private set

    private fun framesPlayed(): Long {
      if (startedAtNanos == 0L) return 0
      val elapsed = System.nanoTime() - startedAtNanos
      val played = elapsed * sampleRate / 1_000_000_000L
      return minOf(played, framesWritten)
    }

    /** Hand this to the pipeline: it records the requested buffer size and returns the mock track. */
    val factory: (Int, Int) -> AudioTrack = { _, bufferBytes ->
      capacityFrames = maxOf(1, bufferBytes / 4)
      track
    }

    init {
      `when`(track.bufferSizeInFrames).thenAnswer { capacityFrames }
      `when`(track.sampleRate).thenReturn(sampleRate)
      `when`(track.channelCount).thenReturn(2)
      `when`(track.play()).thenAnswer {
        startedAtNanos = System.nanoTime()
        null
      }
      `when`(track.playbackHeadPosition).thenAnswer { framesPlayed().toInt() }
      `when`(track.underrunCount).thenAnswer { underruns }
      `when`(track.write(any(ByteArray::class.java), anyInt(), anyInt(), anyInt())).thenAnswer { call ->
        val data = call.getArgument<ByteArray>(0)
        val offset = call.getArgument<Int>(1)
        val length = call.getArgument<Int>(2)
        val frames = length / 4
        while (startedAtNanos != 0L && framesWritten - framesPlayed() + frames > capacityFrames) {
          Thread.sleep(1)
        }
        // The buffer ran dry before this write arrived: the DAC pulled silence, which is precisely
        // what AudioTrack reports as an underrun.
        if (startedAtNanos != 0L && framesWritten <= framesPlayed()) underruns++
        framesWritten += frames
        if (record) synchronized(played) { played.write(data, offset, length) }
        length
      }
    }
  }

  /**
   * Replay a bursty arrival pattern and report the defect rate over the settled tail of the run.
   *
   * The tail is what matters: any pipeline concedes something while it is priming, and judging it on
   * the first second would grade the startup transient instead of the steady state the listener
   * actually spends the tune in.
   */
  private fun runBurstyFeed(
      targetLatencyMs: Int,
      seconds: Int,
      stallEveryMs: Int,
      stallMs: Int,
  ): Defects {
    val speaker = FakeSpeaker(sampleRate)
    val pipeline = AudioPipeline(sampleRate, targetLatencyMs, trackFactory = speaker.factory)
    try {
      pipeline.start()
      val settleAt = System.nanoTime() + 2_000_000_000L
      val endAt = System.nanoTime() + seconds * 1_000_000_000L
      var baseline: AudioPipeline.Stats? = null
      var baselineAtNanos = 0L
      var owedNanos = 0L
      var sinceStallNanos = 0L
      var nextPacketAtNanos = System.nanoTime()

      while (System.nanoTime() < endAt) {
        if (baseline == null && System.nanoTime() >= settleAt) {
          baseline = pipeline.stats()
          baselineAtNanos = System.nanoTime()
        }
        val now = System.nanoTime()
        if (now < nextPacketAtNanos) {
          Thread.sleep(1)
          continue
        }
        // The stall: nothing for `stallMs`, then everything that was owed, back to back. Wi-Fi
        // power-save holds multicast at the access point and releases it in one clump like this.
        if (sinceStallNanos >= stallEveryMs * 1_000_000L) {
          sinceStallNanos = 0
          Thread.sleep(stallMs.toLong())
          owedNanos += stallMs * 1_000_000L
          val owedPackets = (owedNanos / (packetFrames * 1_000_000_000L / sampleRate)).toInt()
          repeat(owedPackets) { pipeline.offer(packet, 0, packet.size) }
          owedNanos = 0
          nextPacketAtNanos = System.nanoTime()
          continue
        }
        pipeline.offer(packet, 0, packet.size)
        val step = packetFrames * 1_000_000_000L / sampleRate
        nextPacketAtNanos += step
        sinceStallNanos += step
      }

      val start = baseline ?: pipeline.stats()
      val end = pipeline.stats()
      val elapsedS = (System.nanoTime() - maxOf(baselineAtNanos, 1L)) / 1_000_000_000.0
      return Defects(
          concealedMsPerSecond = (end.concealedMs - start.concealedMs) / elapsedS,
          droppedMsPerSecond =
              ((end.droppedBytes - start.droppedBytes) / bytesPerFrame.toDouble() / sampleRate * 1000.0) / elapsedS,
          underruns = end.underruns - start.underruns,
          bufferedMs = end.bufferedMs,
          driftCorrection = end.driftCorrection,
      )
    } finally {
      pipeline.close()
    }
  }

  /** Feed one packet every 4 ms with a periodic stall-then-clump, as Wi-Fi actually delivers it. */
  private fun feedBursty(pipeline: AudioPipeline, seconds: Int, stallEveryMs: Int, stallMs: Int) {
    val endAt = System.nanoTime() + seconds * 1_000_000_000L
    val stepNanos = packetFrames * 1_000_000_000L / sampleRate
    var next = System.nanoTime()
    var sinceStall = 0L
    while (System.nanoTime() < endAt) {
      if (System.nanoTime() < next) {
        Thread.sleep(1)
        continue
      }
      if (sinceStall >= stallEveryMs * 1_000_000L) {
        sinceStall = 0
        Thread.sleep(stallMs.toLong())
        repeat((stallMs * 1_000_000L / stepNanos).toInt()) { pipeline.offer(packet, 0, packet.size) }
        next = System.nanoTime()
        continue
      }
      pipeline.offer(packet, 0, packet.size)
      next += stepNanos
      sinceStall += stepNanos
    }
  }

  /** Feed evenly, optionally at a rate that does not match what the speaker drains. */
  private fun feedEven(pipeline: AudioPipeline, seconds: Int, rateMultiplier: Double) {
    val endAt = System.nanoTime() + seconds * 1_000_000_000L
    val stepNanos = (packetFrames * 1_000_000_000L / sampleRate / rateMultiplier).toLong()
    var next = System.nanoTime()
    while (System.nanoTime() < endAt) {
      if (System.nanoTime() < next) {
        Thread.sleep(1)
        continue
      }
      pipeline.offer(packet, 0, packet.size)
      next += stepNanos
    }
  }

  /** Feed a continuous stereo sine at the source rate, in real time. */
  private fun feedTone(pipeline: AudioPipeline, hz: Double, seconds: Int) {
    val endAt = System.nanoTime() + seconds * 1_000_000_000L
    val stepNanos = packetFrames * 1_000_000_000L / sampleRate
    val buf = ByteArray(packetFrames * bytesPerFrame)
    var phase = 0.0
    val advance = 2 * Math.PI * hz / sampleRate
    var next = System.nanoTime()
    while (System.nanoTime() < endAt) {
      if (System.nanoTime() < next) {
        Thread.sleep(1)
        continue
      }
      for (f in 0 until packetFrames) {
        val v = (Math.sin(phase) * TONE_AMPLITUDE).toInt()
        val o = f * bytesPerFrame
        buf[o] = (v and 0xFF).toByte()
        buf[o + 1] = ((v shr 8) and 0xFF).toByte()
        buf[o + 2] = buf[o]
        buf[o + 3] = buf[o + 1]
        phase += advance
        if (phase > 2 * Math.PI) phase -= 2 * Math.PI
      }
      pipeline.offer(buf, 0, buf.size)
      next += stepNanos
    }
  }

  /** De-interleave one channel of S16LE stereo, skipping the priming silence at the start. */
  private fun channel(pcm: ByteArray, index: Int): DoubleArray {
    val frames = pcm.size / bytesPerFrame
    val skip = frames / 4 // the first quarter can contain the pipeline's prime + startup transient
    val out = DoubleArray(frames - skip)
    for (f in skip until frames) {
      val o = f * bytesPerFrame + index * 2
      out[f - skip] = ((pcm[o].toInt() and 0xFF) or (pcm[o + 1].toInt() shl 8)).toShort().toDouble()
    }
    return out
  }

  private fun rms(samples: DoubleArray): Double {
    var sum = 0.0
    for (s in samples) sum += s * s
    return Math.sqrt(sum / samples.size)
  }

  /**
   * The strongest single frequency in the signal, found by scanning a Goertzel filter around the
   * expected tone. Cheap, needs no FFT dependency, and it is the measurement that catches a resampler
   * running at the wrong ratio — which sounds like the whole tune being slightly out of tune.
   */
  private fun dominantFrequency(samples: DoubleArray, rate: Int, near: Double): Double {
    var bestHz = 0.0
    var bestPower = -1.0
    var hz = near - 30.0
    while (hz <= near + 30.0) {
      val power = goertzel(samples, rate, hz)
      if (power > bestPower) {
        bestPower = power
        bestHz = hz
      }
      hz += 0.25
    }
    return bestHz
  }

  private fun goertzel(samples: DoubleArray, rate: Int, hz: Double): Double {
    val w = 2.0 * Math.PI * hz / rate
    val coeff = 2.0 * Math.cos(w)
    var s1 = 0.0
    var s2 = 0.0
    for (x in samples) {
      val s0 = x + coeff * s1 - s2
      s2 = s1
      s1 = s0
    }
    return s1 * s1 + s2 * s2 - coeff * s1 * s2
  }

  private data class Defects(
      val concealedMsPerSecond: Double,
      val droppedMsPerSecond: Double,
      val underruns: Int,
      val bufferedMs: Double,
      val driftCorrection: Double,
  ) {
    /** Milliseconds of audio per second the listener did not hear as sent. */
    val defectMsPerSecond: Double
      get() = concealedMsPerSecond + droppedMsPerSecond
  }

  @Test
  fun anEvenStreamPlaysWithoutDefects() {
    // The control. With no burstiness there is nothing to absorb, so any defect here would mean the
    // pipeline itself is broken rather than the link.
    val defects = runBurstyFeed(targetLatencyMs = 60, seconds = 5, stallEveryMs = 100_000, stallMs = 0)
    assertTrue("even stream should not conceal or drop, got $defects", defects.defectMsPerSecond < 1.0)
    assertEquals("even stream should not underrun, got $defects", 0, defects.underruns)
    // And it must play at true speed while it is doing so. The wide recovery authority exists for
    // getting back to target; a stream that is already there must not be detuned at all, which is
    // what the deadband is for.
    assertEquals("a settled stream was played off-speed", 1.0, defects.driftCorrection, 0.0011)
  }

  @Test
  fun theMeasuredWiFiBurstPatternPlaysCleanlyOnceSettled() {
    // The gate. This is the pattern the Pixel 4 actually receives: ~120 ms of nothing, then the whole
    // clump at once. The shipped pipeline scored ~40 ms/s concealed and ~30 ms/s discarded against it
    // — audible, continuous crackling — because its cushion was a fixed 20 ms and the trim threw away
    // the depth each burst handed it.
    val defects = runBurstyFeed(targetLatencyMs = 60, seconds = 8, stallEveryMs = 500, stallMs = 120)
    assertTrue(
        "bursty stream still breaking up after settling: $defects",
        defects.defectMsPerSecond < 1.0,
    )
  }

  @Test
  fun latencyStaysBoundedWhileAbsorbingBursts() {
    // Absorbing a burst must not turn into unbounded latency: a pipeline that simply never discarded
    // anything would pass the gate above and drift permanently behind the picture.
    val defects = runBurstyFeed(targetLatencyMs = 60, seconds = 8, stallEveryMs = 500, stallMs = 120)
    assertTrue("output latency ran away: $defects", defects.bufferedMs < 400.0)
  }

  @Test
  fun theCushionGrowsToFitABurstyLinkAndStaysBoundedByTheCap() {
    // The adaptive mechanism itself. A link the app was never told about — this one delivers ~120 ms
    // clumps — has to be discovered from the only evidence available, which is having had to conceal.
    // Without this the cushion would stay at whatever the setting guessed and every burst would cost
    // the listener a hole.
    val speaker = FakeSpeaker(sampleRate)
    val pipeline = AudioPipeline(sampleRate, 60, sampleRate, 0, speaker.factory)
    try {
      pipeline.start()
      val initialTarget = pipeline.stats().targetJitterMs
      feedBursty(pipeline, seconds = 5, stallEveryMs = 400, stallMs = 120)
      val grown = pipeline.stats().targetJitterMs
      assertTrue(
          "cushion did not adapt to a bursty link: $initialTarget -> $grown ms",
          grown > initialTarget + 20.0,
      )
      assertTrue("cushion grew past its cap: $grown ms", grown <= 330.0)
    } finally {
      pipeline.close()
    }
  }

  @Test
  fun theConverterGivesBackLatencyItDoesNotNeed_boundedToAnInaudibleAmount() {
    // The C64's 47983 Hz and the phone's DAC are independent clocks, and a mirror that has just
    // absorbed a burst is holding latency it no longer needs. The converter's job is to bleed both
    // off continuously — a fraction of a percent at a time, so nobody hears it — rather than letting
    // them accumulate until something has to be discarded in one audible lump.
    val speaker = FakeSpeaker(sampleRate)
    val pipeline = AudioPipeline(sampleRate, 60, sampleRate, 0, speaker.factory)
    try {
      // Start it deep, as a burst would: 250 ms in the ring against a 40 ms target.
      repeat(62) { pipeline.offer(packet, 0, packet.size) }
      pipeline.start()
      feedEven(pipeline, seconds = 3, rateMultiplier = 1.0)
      val stats = pipeline.stats()
      assertTrue(
          "converter did not speed up while over-buffered: ${stats.driftCorrection}",
          stats.driftCorrection > 1.0,
      )
      // 0.5% is the widest the pipeline may go, and only while it is far from target. Amended from
      // 0.1% deliberately: a whisper cannot hand back the 241 ms that absorbing one Wi-Fi burst cost
      // on hardware — it would have taken twenty-five minutes — and a listener would rather have a
      // few tens of seconds at eight cents flat than a permanent lip-sync error.
      assertTrue(
          "correction exceeded the recovery bound: ${stats.driftCorrection}",
          stats.driftCorrection <= 1.0055,
      )
      assertTrue("a healthy over-buffered stream should not conceal: $stats", stats.concealedMs < 30.0)
    } finally {
      pipeline.close()
    }
  }

  @Test
  fun theConverterSlowsDownWhenTheCushionIsRunningThin() {
    // The other direction, and the one that matters for crackling: when the ring is shallower than the
    // target, playing at exactly nominal rate spends the last of the cushion and the next gap is a
    // hole. Easing off buys the time for the cushion to refill.
    val speaker = FakeSpeaker(sampleRate)
    val pipeline = AudioPipeline(sampleRate, 60, sampleRate, 0, speaker.factory)
    try {
      pipeline.start()
      // Prime just enough to start, then feed slower than the speaker drains so the ring thins out.
      repeat(12) { pipeline.offer(packet, 0, packet.size) }
      feedEven(pipeline, seconds = 3, rateMultiplier = 0.97)
      val stats = pipeline.stats()
      assertTrue(
          "converter did not ease off while running thin: ${stats.driftCorrection}",
          stats.driftCorrection < 1.0,
      )
      assertTrue(
          "correction exceeded the recovery bound: ${stats.driftCorrection}",
          stats.driftCorrection >= 0.9945,
      )
    } finally {
      pipeline.close()
    }
  }

  @Test
  fun resamplingToTheDeviceRateKeepsThePitchAndTheWaveform() {
    // The track now runs at the DEVICE's rate rather than the stream's, which is what buys back the
    // fast mixer — but it means the pipeline resamples, and a resampler is exactly the kind of thing
    // that can silently detune the music, swap the channels or clip it. A 1 kHz tone in must come out
    // as a 1 kHz tone, at the same level, on both channels.
    val toneHz = 1000.0
    val outputRate = 48000
    val speaker = FakeSpeaker(outputRate, record = true)
    val pipeline = AudioPipeline(sampleRate, 120, outputRate, 240, speaker.factory)
    try {
      pipeline.start()
      feedTone(pipeline, toneHz, seconds = 3)
      val pcm = synchronized(speaker.played) { speaker.played.toByteArray() }
      assertTrue("nothing reached the speaker", pcm.size > outputRate) // > ~0.25 s of stereo
      val left = channel(pcm, 0)
      val right = channel(pcm, 1)
      val measured = dominantFrequency(left, outputRate, toneHz)
      assertEquals("resampled tone changed pitch", toneHz, measured, 2.0)
      val rms = rms(left)
      assertEquals("resampled tone changed level", TONE_AMPLITUDE.toDouble() / Math.sqrt(2.0), rms, 900.0)
      assertEquals("channels diverged through the resampler", rms, rms(right), 200.0)
    } finally {
      pipeline.close()
    }
  }

  @Test
  fun aConcealedPacketDoesNotLeaveAClick() {
    // Wi-Fi multicast is unacknowledged, so ~2% of the mirror's audio simply never arrives and the
    // only question is what replaces it. A click is a step in the waveform, so that is what this
    // measures: the largest sample-to-sample jump in what reached the speaker, against the largest
    // jump the tone itself contains. Splicing across a hole in a 440 Hz sine leaves a step many times
    // the signal's own slope, and that step is the tick a listener hears.
    val outputRate = sampleRate
    val speaker = FakeSpeaker(outputRate, record = true)
    val pipeline = AudioPipeline(sampleRate, 120, outputRate, 0, speaker.factory)
    try {
      pipeline.start()
      val hz = 440.0
      var phase = 0.0
      val advance = 2 * Math.PI * hz / sampleRate
      val buf = ByteArray(packetFrames * bytesPerFrame)
      fun fillPacket() {
        for (f in 0 until packetFrames) {
          val v = (Math.sin(phase) * TONE_AMPLITUDE).toInt()
          val o = f * bytesPerFrame
          buf[o] = (v and 0xFF).toByte()
          buf[o + 1] = ((v shr 8) and 0xFF).toByte()
          buf[o + 2] = buf[o]
          buf[o + 3] = buf[o + 1]
          phase += advance
        }
      }
      val stepNanos = packetFrames * 1_000_000_000L / sampleRate
      var next = System.nanoTime()
      val endAt = System.nanoTime() + 4_000_000_000L
      var index = 0
      while (System.nanoTime() < endAt) {
        if (System.nanoTime() < next) {
          Thread.sleep(1)
          continue
        }
        fillPacket()
        // Every 25th packet never arrives: the phase advances (the C64 kept playing) but the audio
        // does not, which is exactly what a dropped datagram looks like.
        if (index % 25 == 24) {
          pipeline.concealLostPackets(packetFrames)
        } else {
          pipeline.offer(buf, 0, buf.size)
        }
        index++
        next += stepNanos
      }
      val pcm = synchronized(speaker.played) { speaker.played.toByteArray() }
      val left = channel(pcm, 0)
      assertTrue("nothing reached the speaker", left.size > sampleRate / 2)
      var worstStep = 0.0
      for (i in 1 until left.size) {
        val step = Math.abs(left[i] - left[i - 1])
        if (step > worstStep) worstStep = step
      }
      // The tone's own steepest slope, i.e. the largest step that is legitimately part of the signal.
      val signalSlope = TONE_AMPLITUDE * advance
      assertTrue(
          "concealment left a step of $worstStep against a signal slope of $signalSlope — that is a click",
          worstStep < signalSlope * 4,
      )
    } finally {
      pipeline.close()
    }
  }

  @Test
  fun aFullRingCountsWhatItRefusesRatherThanLosingItSilently() {
    // No player is started, so nothing drains: every offer past capacity must show up as dropped.
    // Audio that vanishes without being counted is why a breaking-up stream could report itself
    // healthy.
    val speaker = FakeSpeaker(sampleRate)
    val pipeline = AudioPipeline(sampleRate, 60, sampleRate, 0, speaker.factory)
    try {
      repeat(2000) { pipeline.offer(packet, 0, packet.size) }
      val stats = pipeline.stats()
      assertTrue("expected refused audio to be counted, got $stats", stats.droppedBytes > 0)
      assertTrue("ring should have filled, got $stats", stats.jitterBufferMs > 0)
    } finally {
      pipeline.close()
    }
  }
}
