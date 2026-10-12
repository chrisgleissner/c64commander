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
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.ArgumentMatchers.any
import org.mockito.ArgumentMatchers.anyInt
import org.mockito.Mockito.mock
import org.mockito.Mockito.`when`
import org.robolectric.RobolectricTestRunner
import uk.gleissner.c64commander.dsp.AudioFxHub
import uk.gleissner.c64commander.dsp.TestSignals

/** The pipeline's processing chain and spectrum tap, driven on virtual time against a recording track. */
@RunWith(RobolectricTestRunner::class)
class AudioPipelineFxTest {
  private val rate = 48000
  private val packetFrames = 240

  private class VirtualClock : PipelineClock {
    var now = 0L

    override fun nanoTime(): Long = now

    override fun park(nanos: Long) {
      now += nanos
    }
  }

  private class RecordingTrack {
    val track: AudioTrack = mock(AudioTrack::class.java)
    val played = java.io.ByteArrayOutputStream()
    private var capacity = 1

    val factory: (Int, Int) -> AudioTrack = { _, bytes ->
      capacity = maxOf(1, bytes / 4)
      track
    }

    init {
      `when`(track.bufferSizeInFrames).thenAnswer { capacity }
      `when`(track.sampleRate).thenReturn(48000)
      `when`(track.channelCount).thenReturn(2)
      `when`(track.write(any(ByteArray::class.java), anyInt(), anyInt(), anyInt())).thenAnswer { call ->
        val length = call.getArgument<Int>(2)
        played.write(call.getArgument<ByteArray>(0), call.getArgument<Int>(1), length)
        length
      }
    }

    fun frames(): Int = played.size() / 4
  }

  private class Run(val pipeline: AudioPipeline, val speaker: RecordingTrack, val tune: ByteArray) {
    private var offered = 0

    fun playSeconds(seconds: Double, packetFrames: Int) {
      val wantFrames = (seconds * 48000).toInt()
      var guard = 0
      while (speaker.frames() < wantFrames && guard++ < 2_000_000) {
        while (offered + packetFrames <= tune.size / 4 && pipeline.stats().jitterBufferMs < 1000.0) {
          pipeline.offer(tune, offered * 4, packetFrames * 4)
          offered += packetFrames
        }
        pipeline.step()
      }
    }

    fun output(): ByteArray = speaker.played.toByteArray()
  }

  private fun start(hub: AudioFxHub, tune: ByteArray): Run {
    val speaker = RecordingTrack()
    val pipeline =
        AudioPipeline(
            rate, 60, rate, 240, speaker.factory, maxRingMs = 4000, trackBursts = 8, primeMs = 100, correctDrift = false,
            clock = VirtualClock(), fxHub = hub)
    return Run(pipeline, speaker, tune)
  }

  private fun noise(frames: Int): ByteArray {
    val out = ByteArray(frames * 4)
    var state = 99L
    for (i in out.indices) {
      state = state * 6364136223846793005L + 1442695040888963407L
      out[i] = (state shr 33).toByte()
    }
    return out
  }

  private fun indexOfFirstFrame(haystack: ByteArray, needle: ByteArray): Int {
    for (frame in 0 until haystack.size / 4 - 2) {
      if (haystack[frame * 4] == needle[0] && haystack[frame * 4 + 1] == needle[1] && haystack[frame * 4 + 2] == needle[2] &&
          haystack[frame * 4 + 3] == needle[3] && haystack[frame * 4 + 4] == needle[4]) return frame
    }
    return -1
  }

  @Test
  fun withEverythingOffTheOutputIsBitIdenticalToTheRingContent() {
    val tune = noise(4 * rate)
    val run = start(AudioFxHub(), tune)
    try {
      run.playSeconds(2.0, packetFrames)
      val out = run.output()
      val first = indexOfFirstFrame(tune, out.copyOfRange(0, 8))
      assertTrue("the output is not a slice of the input", first >= 0)
      val compare = rate
      assertTrue(
          "output differs from the ring content",
          out.copyOfRange(0, compare * 4).contentEquals(tune.copyOfRange(first * 4, (first + compare) * 4)))
    } finally {
      run.pipeline.close()
    }
  }

  @Test
  fun withEverythingOffTheSpectrumTapCostsNothing() {
    val hub = AudioFxHub()
    val run = start(hub, TestSignals.sine(3 * rate, rate, 1000.0, 0.5))
    try {
      run.playSeconds(1.0, packetFrames)
      assertEquals(0L, hub.analyzer.read(true).sequence)
      assertFalse(hub.readSpectrum().enabled)
    } finally {
      run.pipeline.close()
    }
  }

  @Test
  fun theSpectrumTapSeesTheFinalOutputIncludingTheMasterGain() {
    val hub = AudioFxHub()
    hub.spectrumEnabled = true
    val run = start(hub, TestSignals.sine(4 * rate, rate, 1000.0, 0.5))
    try {
      run.pipeline.setGain(0.5)
      run.playSeconds(2.5, packetFrames)
      val frame = hub.readSpectrum()
      assertTrue(frame.active)
      val band = (0 until 48).maxByOrNull { frame.bands[it] }!!
      assertTrue("peak band $band", band in 25..27)
      assertEquals(-12.0, frame.bands[band].toDouble(), 1.5)
    } finally {
      run.pipeline.close()
    }
  }

  @Test
  fun levellingBringsAQuietTuneToTheTargetOnTheWayToTheSpeaker() {
    val hub = AudioFxHub()
    hub.setParams(true, 0.0, 0.0, 0.0, 0.0, 0.0)
    val run = start(hub, TestSignals.sine(6 * rate, rate, 1000.0, TestSignals.dbToLinear(-26.0)))
    try {
      run.playSeconds(4.0, packetFrames)
      val out = run.output()
      val rms = TestSignals.linearToDb(TestSignals.rms(out, 3 * rate, 4 * rate))
      assertEquals(-20.0, rms, 1.5)
    } finally {
      run.pipeline.close()
    }
  }

  @Test
  fun theMasterGainFollowsTheProcessingChain() {
    val hub = AudioFxHub()
    hub.setParams(false, 0.0, 12.0, 0.0, 0.0, 0.0)
    val run = start(hub, TestSignals.sine(5 * rate, rate, 1000.0, 0.4))
    try {
      run.pipeline.setGain(0.5)
      run.playSeconds(3.0, packetFrames)
      val out = run.output()
      val peak = TestSignals.peak(out, 2 * rate, 3 * rate)
      assertTrue("peak $peak: the chain's boost was clipped before the master gain", peak in 25_500..26_500)
    } finally {
      run.pipeline.close()
    }
  }

  @Test
  fun aFlushRelevelsTheNextTuneFromItsFirstSecond() {
    val hub = AudioFxHub()
    hub.setParams(true, 0.0, 0.0, 0.0, 0.0, 0.0)
    val loud = TestSignals.sine(3 * rate, rate, 1000.0, TestSignals.dbToLinear(-6.0))
    val quiet = TestSignals.sine(3 * rate, rate, 1000.0, TestSignals.dbToLinear(-28.0))
    val speaker = RecordingTrack()
    val pipeline =
        AudioPipeline(
            rate, 60, rate, 240, speaker.factory, maxRingMs = 4000, trackBursts = 8, primeMs = 100, correctDrift = false,
            clock = VirtualClock(), fxHub = hub)
    try {
      val first = Run(pipeline, speaker, loud)
      first.playSeconds(2.0, packetFrames)
      pipeline.flush()
      val before = speaker.frames()
      val second = Run(pipeline, speaker, quiet)
      second.playSeconds((before + rate) / rate.toDouble() + 0.0, packetFrames)
      val out = second.output()
      val firstSecond = TestSignals.linearToDb(TestSignals.rms(out, before + 2400, before + rate))
      assertTrue("new tune started at $firstSecond dB, not levelled", firstSecond > -23.0)
    } finally {
      pipeline.close()
    }
  }
}
