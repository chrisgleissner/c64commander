/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander.dsp

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.atomic.AtomicBoolean

class SpectrumAnalyzerTest {
  private var now = 1_000_000_000L
  private val analyzer = SpectrumAnalyzer { now }.also { it.prepare(48000) }
  private val rate = 48000

  private fun bandOf(hz: Double): Int = (0 until SpectrumBands.COUNT).first { hz >= SpectrumBands.edge(it) && hz < SpectrumBands.edge(it + 1) }

  private fun feedSine(hz: Double, amplitude: Double, seconds: Double = 0.5, sampleRate: Int = rate) {
    val frames = (sampleRate * seconds).toInt()
    var done = 0
    while (done < frames) {
      val n = minOf(240, frames - done)
      analyzer.feed(TestSignals.sine(n, sampleRate, hz, amplitude, done.toLong()), n, sampleRate)
      done += n
    }
  }

  @Test
  fun bandEdgesFollowTheSharedLogLayout() {
    assertEquals(48, SpectrumBands.COUNT)
    assertEquals(31.25, SpectrumBands.edge(0), 1e-9)
    assertEquals(250.0, SpectrumBands.edge(16), 1e-9)
    assertEquals(2000.0, SpectrumBands.edge(32), 1e-9)
    assertEquals(16000.0, SpectrumBands.edge(48), 1e-9)
    assertEquals(31.25 * Math.pow(2.0, 4.5), SpectrumBands.edge(24), 1e-9)
  }

  @Test
  fun aKilohertzSineLandsInItsBandAtItsTrueLevel() {
    feedSine(1000.0, 0.5)
    val frame = analyzer.read(true)
    val band = bandOf(1000.0)
    assertEquals(-6.0, frame.bands[band].toDouble(), 1.0)
    for (other in 0 until SpectrumBands.COUNT) {
      if (Math.abs(other - band) > 3) assertTrue("band $other read ${frame.bands[other]}", frame.bands[other] < -50)
    }
    assertEquals(-6.0, frame.peakDb.toDouble(), 1.0)
    assertEquals(-9.0, frame.rmsDb.toDouble(), 1.0)
  }

  @Test
  fun aSineBetweenTwoBinsReadsTheSameAsOneOnABin() {
    val binHz = rate / 4096.0
    feedSine(binHz * 85.0, 0.5)
    val onBin = analyzer.read(true).bands.max()
    val other = SpectrumAnalyzer { now }
    other.prepare(rate)
    val halfBin = binHz * 85.5
    var done = 0
    while (done < rate / 2) {
      other.feed(TestSignals.sine(240, rate, halfBin, 0.5, done.toLong()), 240, rate)
      done += 240
    }
    assertEquals(onBin.toDouble(), other.read(true).bands.max().toDouble(), 1.0)
  }

  @Test
  fun aFullScaleSineReadsZeroAndLatchesTheClipFlag() {
    feedSine(1000.0, 1.0)
    val frame = analyzer.read(true)
    assertEquals(0.0, frame.bands[bandOf(1000.0)].toDouble(), 1.0)
    assertTrue(frame.clipped)
    now += 900_000_000L
    assertTrue(analyzer.read(true).clipped)
    now += 200_000_000L
    assertFalse(analyzer.read(true).clipped)
  }

  @Test
  fun aBandNarrowerThanOneBinStillReadsTheTone() {
    feedSine(40.0, 0.5, seconds = 1.0)
    val frame = analyzer.read(true)
    assertTrue("40 Hz band read ${frame.bands[1]}", frame.bands[1] > -14)
    assertTrue(frame.bands[20] < -60)
  }

  @Test
  fun silenceReadsTheFloor() {
    val silence = ByteArray(240 * 4)
    repeat(100) { analyzer.feed(silence, 240, rate) }
    val frame = analyzer.read(true)
    assertTrue(frame.bands.all { it == -100 })
    assertEquals(-100, frame.peakDb)
    assertEquals(-100, frame.rmsDb)
  }

  @Test
  fun bandsAboveNyquistReadTheFloorWhateverTheInput() {
    analyzer.prepare(22050)
    feedSine(5000.0, 0.5, sampleRate = 22050)
    val frame = analyzer.read(true)
    assertEquals(22050, frame.sampleRate)
    assertEquals(-100, frame.bands[47])
    assertEquals(-100, frame.bands[46])
    assertTrue(frame.bands[bandOf(5000.0)] > -9)
  }

  @Test
  fun sequenceAdvancesOncePerAnalysisFrameAndStaysPutWithoutNewAudio() {
    val block = TestSignals.sine(1600, rate, 1000.0, 0.5)
    analyzer.feed(block, 1600, rate)
    val first = analyzer.read(true)
    assertEquals(1L, first.sequence)
    assertEquals(1L, analyzer.read(true).sequence)
    analyzer.feed(block, 1600, rate)
    assertEquals(2L, analyzer.read(true).sequence)
  }

  @Test
  fun activeFollowsWhetherAudioIsStillArriving() {
    feedSine(1000.0, 0.5, seconds = 0.2)
    assertTrue(analyzer.read(true).active)
    now += 600_000_000L
    assertFalse(analyzer.read(true).active)
  }

  @Test
  fun disabledReportsNothingEvenWhileAudioFlows() {
    feedSine(1000.0, 0.5)
    val frame = analyzer.read(false)
    assertFalse(frame.enabled)
    assertFalse(frame.active)
    assertTrue(frame.bands.all { it == -100 })
  }

  @Test
  fun aChangeOfSampleRateRestartsTheAnalysis() {
    feedSine(1000.0, 0.5, sampleRate = 48000)
    analyzer.prepare(44100)
    feedSine(1000.0, 0.5, sampleRate = 44100)
    assertEquals(44100, analyzer.read(true).sampleRate)
  }

  @Test
  fun concurrentWriterNeverPublishesDistantBandsOrIncoherentMetadata() {
    val concurrent = SpectrumAnalyzer { System.nanoTime() }.also { it.prepare(rate) }
    val running = AtomicBoolean(true)
    val writer = Thread {
      var frame = 0L
      while (running.get()) {
        concurrent.feed(TestSignals.sine(240, rate, 1000.0, 0.5, frame), 240, rate)
        frame += 240
      }
    }
    writer.start()
    try {
      var lastSequence = 0L
      repeat(200) {
        val frame = concurrent.read(true)
        assertEquals(rate, frame.sampleRate)
        assertTrue("sequence regressed from $lastSequence to ${frame.sequence}", frame.sequence >= lastSequence)
        lastSequence = frame.sequence
        if (frame.sequence > 0) {
          val toneBand = bandOf(1000.0)
          for (band in frame.bands.indices) {
            if (Math.abs(band - toneBand) > 3) {
              assertTrue("spurious band $band at ${frame.bands[band]} dBFS", frame.bands[band] < -45)
            }
          }
        }
      }
    } finally {
      running.set(false)
      writer.join(1_000)
      assertFalse("spectrum writer did not stop", writer.isAlive)
    }
  }

  private fun feedTone(target: SpectrumAnalyzer, hz: Double, frames: Int, from: Long) {
    var done = 0
    while (done < frames) {
      val n = minOf(240, frames - done)
      target.feed(TestSignals.sine(n, rate, hz, 0.5, from + done), n, rate)
      done += n
    }
  }

  private fun loudestBand(frame: SpectrumFrame): Int = frame.bands.indices.maxByOrNull { frame.bands[it] }!!

  @Test
  fun analysesWhatTheSpeakerIsPlayingWhenTheWriterRunsAhead() {
    feedTone(analyzer, 500.0, rate, 0)
    feedTone(analyzer, 3000.0, rate, rate.toLong())
    // The writer is a whole second ahead of the speaker: the 500 Hz tone is what is being heard.
    analyzer.presentAt(framesAheadOfSpeaker = rate.toLong(), timestampNanos = now)
    assertEquals(bandOf(500.0), loudestBand(analyzer.read(true)))
  }

  @Test
  fun followsTheSpeakerBetweenReportsButFreezesWhenTheyStop() {
    feedTone(analyzer, 500.0, rate, 0)
    feedTone(analyzer, 3000.0, rate, rate.toLong())
    analyzer.presentAt(framesAheadOfSpeaker = rate.toLong(), timestampNanos = now)
    val atReport = analyzer.read(true).sequence
    now += 100_000_000L
    assertEquals(atReport + 3, analyzer.read(true).sequence)
    now += 5_000_000_000L
    val frozen = analyzer.read(true)
    now += 5_000_000_000L
    assertEquals(frozen.sequence, analyzer.read(true).sequence)
    assertEquals(bandOf(3000.0), loudestBand(frozen))
  }

  @Test
  fun aLiveStreamUsesAShortWindowSoANewToneTakesOverSooner() {
    val live = SpectrumAnalyzer { now }.also { it.prepareFor(live = true, sourceRate = rate, outputRate = rate) }
    val output = SpectrumAnalyzer { now }.also { it.prepareFor(live = false, sourceRate = rate, outputRate = rate) }
    for (target in listOf(live, output)) {
      feedTone(target, 500.0, rate, 0)
      feedTone(target, 3000.0, 1200, rate.toLong())
    }
    // 1200 new samples fill most of a 2048-point window but under a third of a 4096-point one.
    assertEquals(bandOf(3000.0), loudestBand(live.read(true)))
    assertEquals(bandOf(500.0), loudestBand(output.read(true)))
  }

  @Test
  fun aLiveStreamPublishesAFrameEveryEightMilliseconds() {
    val live = SpectrumAnalyzer { now }.also { it.prepareFor(live = true, sourceRate = rate, outputRate = rate) }
    feedTone(live, 1000.0, 400, 0)
    assertEquals(1L, live.read(true).sequence)
    feedTone(live, 1000.0, 400, 400)
    assertEquals(2L, live.read(true).sequence)
  }
}

