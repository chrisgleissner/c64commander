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
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

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
  fun stereoChannelMetersPreserveIndependentRmsAndPeakLevels() {
    val pcm = TestSignals.sine(4800, rate, 1000.0, 0.5)
    for (sample in 0 until 4800) {
      val at = sample * 4
      val left = ((pcm[at].toInt() and 255) or (pcm[at + 1].toInt() shl 8)).toShort().toInt()
      val right = left / 4
      pcm[at + 2] = right.toByte()
      pcm[at + 3] = (right shr 8).toByte()
    }
    analyzer.feed(pcm, 4800, rate)
    val channels = analyzer.read(true).channels
    assertEquals(2, channels.size)
    assertEquals("left", channels[0].id)
    assertEquals("right", channels[1].id)
    assertEquals(-9.0, channels[0].rmsDb.toDouble(), 1.0)
    assertEquals(-6.0, channels[0].peakDb.toDouble(), 1.0)
    assertEquals(-21.0, channels[1].rmsDb.toDouble(), 1.0)
    assertEquals(-18.0, channels[1].peakDb.toDouble(), 1.0)
  }

  @Test
  fun oppositePhaseStereoDoesNotCancelEitherChannelMeter() {
    val pcm = TestSignals.sine(4800, rate, 1000.0, 0.5)
    for (sample in 0 until 4800) {
      val at = sample * 4
      val left = ((pcm[at].toInt() and 255) or (pcm[at + 1].toInt() shl 8)).toShort().toInt()
      val right = -left
      pcm[at + 2] = right.toByte()
      pcm[at + 3] = (right shr 8).toByte()
    }
    analyzer.feed(pcm, 4800, rate)
    val channels = analyzer.read(true).channels
    for (channel in channels) {
      assertEquals(-9.0, channel.rmsDb.toDouble(), 1.0)
      assertEquals(-6.0, channel.peakDb.toDouble(), 1.0)
    }
  }

  @Test
  fun clippingIsHeldOnlyOnTheChannelThatReachedFullScaleAndResetsOnPrepare() {
    val pcm = ByteArray(4800 * 4)
    for (sample in 0 until 4800) {
      pcm[sample * 4 + 2] = 255.toByte()
      pcm[sample * 4 + 3] = 127.toByte()
    }
    analyzer.feed(pcm, 4800, rate)
    assertFalse(analyzer.read(true).channels[0].clipped)
    assertTrue(analyzer.read(true).channels[1].clipped)
    now += 900_000_000L
    assertTrue(analyzer.read(true).channels[1].clipped)
    now += 200_000_000L
    assertFalse(analyzer.read(true).channels[1].clipped)
    analyzer.prepare(rate)
    assertTrue(analyzer.read(true).channels.all { !it.clipped && it.rmsDb == -100 && it.peakDb == -100 })
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

  @Test
  fun aFeedInProgressDoesNotStopAReadFromAnalysingTheSamplesAlreadyStored() {
    val pausedWriter = AtomicReference<Thread?>(null)
    val writerPaused = CountDownLatch(1)
    val resumeWriter = CountDownLatch(1)
    val target = SpectrumAnalyzer {
      if (Thread.currentThread() === pausedWriter.get()) {
        writerPaused.countDown()
        resumeWriter.await(5, TimeUnit.SECONDS)
      }
      now
    }.also { it.prepare(rate) }
    feedTone(target, 1000.0, rate / 2, 0)
    val before = target.read(true).sequence
    val writer = Thread { target.feed(TestSignals.sine(4800, rate, 1000.0, 0.5, rate / 2L), 4800, rate) }
    pausedWriter.set(writer)
    writer.start()
    try {
      assertTrue("the writer never reached the end of its feed", writerPaused.await(5, TimeUnit.SECONDS))
      assertEquals("4800 stored samples are three analysis frames", before + 3, target.read(true).sequence)
    } finally {
      resumeWriter.countDown()
      writer.join(5_000)
    }
  }

  @Test
  fun aPauseInReadingCatchesTheLevelsUpOnlyAsFarAsAClipStaysLatched() {
    feedSine(1000.0, 0.01)
    analyzer.read(true)
    feedSine(1000.0, 1.0, seconds = 0.01)
    feedSine(1000.0, 0.01, seconds = 2.0)
    val frame = analyzer.read(true)
    assertFalse("a clip 2 s before the read is still reported", frame.clipped)
    assertTrue("peak ${frame.peakDb} dB includes the clip 2 s before the read", frame.peakDb < -30)
  }

  private fun feedTone(target: SpectrumAnalyzer, hz: Double, frames: Int, from: Long, amplitude: Double = 0.5) {
    var done = 0
    while (done < frames) {
      val n = minOf(240, frames - done)
      target.feed(TestSignals.sine(n, rate, hz, amplitude, from + done), n, rate)
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
  fun followsTheSpeakerForAQuarterSecondAfterItsLastReportAndThenFreezes() {
    val step = rate / 30
    feedTone(analyzer, 500.0, 3 * rate, 0)
    // The writer is two seconds ahead: the speaker is at 1 s of the 3 s fed.
    analyzer.presentAt(framesAheadOfSpeaker = 2L * rate, timestampNanos = now)
    assertEquals(rate.toLong() / step, analyzer.read(true).sequence)
    now += 100_000_000L
    assertEquals((rate + rate / 10).toLong() / step, analyzer.read(true).sequence)
    now += 5_000_000_000L
    assertEquals((rate + rate / 4).toLong() / step, analyzer.read(true).sequence)
  }

  @Test
  fun onDevicePlaybackKeepsTheLongBassWindowWhileTheTrebleStillUsesAShortOne() {
    val output = SpectrumAnalyzer { now }.also { it.prepareFor(live = false, sourceRate = rate, outputRate = rate) }
    feedTone(output, 500.0, rate, 0)
    feedTone(output, 6000.0, 300, rate.toLong())
    val bands = output.read(true).bands
    assertTrue("treble reads ${bands[bandOf(6000.0)]} dB", bands[bandOf(6000.0)] >= -20)
    assertTrue("bass reads ${bands[bandOf(500.0)]} dB", bands[bandOf(500.0)] >= -12)
  }

  @Test
  fun aLiveStreamPublishesAFrameEveryFourMilliseconds() {
    val live = SpectrumAnalyzer { now }.also { it.prepareFor(live = true, sourceRate = rate, outputRate = rate) }
    val step = rate / SpectrumAnalyzer.LIVE_STEPS_PER_SECOND
    feedTone(live, 1000.0, step, 0)
    assertEquals(1L, live.read(true).sequence)
    feedTone(live, 1000.0, step, step.toLong())
    assertEquals(2L, live.read(true).sequence)
  }

  @Test
  fun aClipBetweenTwoReadsIsLatchedWithItsPeak() {
    feedTone(analyzer, 1000.0, rate / 5, 0, amplitude = 0.25)
    assertFalse(analyzer.read(true).clipped)
    feedTone(analyzer, 1000.0, rate / 100, 0, amplitude = 1.0)
    feedTone(analyzer, 1000.0, rate / 10, 0, amplitude = 0.25)
    val frame = analyzer.read(true)
    assertTrue("a 10 ms clip 100 ms before the read was missed", frame.clipped)
    assertEquals(0, frame.peakDb)
  }

  @Test
  fun theLevelReadoutCoversTheLastThirtiethOfASecondNotTheWholeWindow() {
    feedTone(analyzer, 1000.0, 3000, 0, amplitude = 1.0)
    feedTone(analyzer, 1000.0, 2000, 0, amplitude = 0.1)
    val frame = analyzer.read(true)
    assertEquals(-20.0, frame.peakDb.toDouble(), 1.0)
    assertFalse(frame.clipped)
  }

  @Test
  fun aNewPipelineDoesNotInheritThePreviousSpeakerPosition() {
    feedTone(analyzer, 500.0, rate, 0)
    analyzer.presentAt(framesAheadOfSpeaker = rate.toLong(), timestampNanos = now)
    analyzer.prepare(rate)
    feedTone(analyzer, 500.0, rate, 0)
    feedTone(analyzer, 3000.0, rate, rate.toLong())
    assertEquals(bandOf(3000.0), loudestBand(analyzer.read(true)))
  }

  @Test
  fun aTrackBufferDeeperThanTheDefaultHistoryStillShowsWhatTheSpeakerPlays() {
    val deep = SpectrumAnalyzer { now }.also { it.prepareFor(live = false, sourceRate = rate, outputRate = rate, speakerLagFrames = 4 * rate) }
    feedTone(deep, 500.0, rate, 0)
    feedTone(deep, 3000.0, 4 * rate, rate.toLong())
    assertTrue(deep.presentAt(framesAheadOfSpeaker = 4L * rate, timestampNanos = now))
    assertEquals(bandOf(500.0), loudestBand(deep.read(true)))
  }

  @Test
  fun reportsASpeakerPositionBeyondItsHistory() {
    feedTone(analyzer, 500.0, 4 * rate, 0)
    assertTrue(analyzer.presentAt(framesAheadOfSpeaker = 2L * rate, timestampNanos = now))
    assertFalse(analyzer.presentAt(framesAheadOfSpeaker = 3L * rate, timestampNanos = now))
  }

  @Test
  fun reportingTheSpeakerPositionAllocatesNothing() {
    val threads = java.lang.management.ManagementFactory.getThreadMXBean() as com.sun.management.ThreadMXBean
    feedTone(analyzer, 500.0, rate, 0)
    repeat(10_000) { analyzer.presentAt(it.toLong() % rate, now) }
    val before = threads.currentThreadAllocatedBytes
    repeat(100_000) { analyzer.presentAt(it.toLong() % rate, now) }
    val allocated = threads.currentThreadAllocatedBytes - before
    assertTrue("100000 reports allocated $allocated bytes", allocated < 100_000)
  }

  private fun liveReadingOf(hz: Double): SpectrumFrame {
    val live = SpectrumAnalyzer { now }.also { it.prepareFor(live = true, sourceRate = rate, outputRate = rate) }
    feedTone(live, hz, rate / 2, 0)
    return live.read(true)
  }

  @Test
  fun aLiveStreamReadsEachBandsCentreToneAtItsLevel() {
    val binHz = rate / 2048.0
    for (band in 0 until SpectrumBands.COUNT) {
      val hz = Math.sqrt(SpectrumBands.edge(band) * SpectrumBands.edge(band + 1))
      val frame = liveReadingOf(hz)
      // Below about 330 Hz a band is narrower than the 2048-point window's main lobe and reads up to 2 dB low.
      val tolerance = if (SpectrumBands.edge(band + 1) < 330.0) 2.0 else 1.0
      assertEquals("band $band", -6.0, frame.bands[band].toDouble(), tolerance)
      assertTrue("band $band: loudest is ${loudestBand(frame)}", Math.abs(loudestBand(frame) - band) <= 1)
      for (other in 0 until SpectrumBands.COUNT) {
        val binsAway = minOf(Math.abs(SpectrumBands.edge(other) - hz), Math.abs(SpectrumBands.edge(other + 1) - hz)) / binHz
        if (Math.abs(other - band) > 3 && binsAway > 6) {
          assertTrue("band $band leaked ${frame.bands[other]} into band $other", frame.bands[other] < -45)
        }
      }
    }
  }

  @Test
  fun aLiveStreamReadsAToneBetweenTwoBinsAsOnOne() {
    val binHz = rate / 2048.0
    val onBin = liveReadingOf(binHz * 43.0)
    val betweenBins = liveReadingOf(binHz * 43.5)
    assertEquals(-6.0, onBin.bands.max().toDouble(), 1.0)
    assertEquals(onBin.bands.max().toDouble(), betweenBins.bands.max().toDouble(), 1.0)
  }

  @Test
  fun aTrebleBurstShowsInTheLiveSpectrumWithinSevenMillisecondsAndABassBurstDoesNot() {
    val burstFrames = rate * 7 / 1000
    val live = SpectrumAnalyzer { now }.also { it.prepareFor(live = true, sourceRate = rate, outputRate = rate) }
    feedTone(live, 6000.0, rate / 4, 0, amplitude = 0.0)
    feedTone(live, 6000.0, burstFrames, 0, amplitude = 0.5)
    val trebleDb = live.read(true).bands[bandOf(6000.0)]
    assertTrue("treble band reads $trebleDb dB", trebleDb >= -18)
    val bass = SpectrumAnalyzer { now }.also { it.prepareFor(live = true, sourceRate = rate, outputRate = rate) }
    feedTone(bass, 100.0, rate / 4, 0, amplitude = 0.0)
    feedTone(bass, 100.0, burstFrames, 0, amplitude = 0.5)
    val bassDb = bass.read(true).bands[bandOf(100.0)]
    assertTrue("bass band reads $bassDb dB against treble $trebleDb dB", bassDb <= trebleDb - 10)
  }

  private fun speakerAlignedBurst(): SpectrumAnalyzer {
    val speaker = SpectrumAnalyzer { now }.also { it.prepareFor(live = false, sourceRate = rate, outputRate = rate) }
    feedTone(speaker, 6000.0, rate / 2, 0, amplitude = 0.0)
    feedTone(speaker, 6000.0, 256, 0, amplitude = 0.5)
    feedTone(speaker, 6000.0, rate / 2, 0, amplitude = 0.0)
    val total = speaker.writeCountForTest()
    val burstStart = rate / 2L
    // The speaker is 1000 samples before the burst when the report is taken.
    speaker.presentAt(framesAheadOfSpeaker = total - (burstStart - 1000), timestampNanos = now)
    return speaker
  }

  @Test
  fun aTargetTimeCentresTheWindowOnTheSoundHeardAtThatMomentSoABurstShowsAtItsOwnTime() {
    val band = bandOf(6000.0)
    val atBurstCentre = speakerAlignedBurst().read(true, now + (1000 + 128) * 1_000_000_000L / rate).bands[band]
    val beforeBurst = speakerAlignedBurst().read(true, now).bands[band]
    val wellAfterBurst = speakerAlignedBurst().read(true, now + (1000 + 128 + 2000) * 1_000_000_000L / rate).bands[band]
    assertTrue("burst centre reads $atBurstCentre dB", atBurstCentre >= -20)
    assertTrue("20 ms before the burst reads $beforeBurst dB", beforeBurst <= atBurstCentre - 25)
    assertTrue("40 ms after the burst reads $wellAfterBurst dB", wellAfterBurst <= atBurstCentre - 25)
  }

  @Test
  fun withoutASpeakerReportTheLatestSamplesAreAnalysedWhateverTheTarget() {
    val live = SpectrumAnalyzer { now }.also { it.prepareFor(live = true, sourceRate = rate, outputRate = rate) }
    feedTone(live, 6000.0, rate / 4, 0, amplitude = 0.0)
    feedTone(live, 6000.0, 256, 0, amplitude = 0.5)
    val noTarget = live.read(true)
    val farFuture = live.read(true, now + 5_000_000_000L)
    assertEquals(noTarget.sequence, farFuture.sequence)
    assertTrue("the window wanted samples that do not exist yet", farFuture.shortfallSamples > 0)
  }

  @Test
  fun aTargetFarAheadStillAdvancesTheWindowWhenTheSpeakerReportIsOld() {
    val speaker = SpectrumAnalyzer { now }.also { it.prepareFor(live = false, sourceRate = rate, outputRate = rate) }
    feedTone(speaker, 1000.0, rate * 2, 0)
    speaker.presentAt(framesAheadOfSpeaker = rate.toLong(), timestampNanos = now)
    now += 200_000_000L
    val first = speaker.read(true, now + 50_000_000L).sequence
    val later = speaker.read(true, now + 50_000_000L + 8 * 16_700_000L).sequence
    assertTrue("sequence did not advance: $first then $later", later > first)
  }
  @Test
  fun readingWithoutBandsSkipsTheSpectrumAnalysisAndStillReturnsTheMeters() {
    feedSine(1000.0, 0.5)
    val frame = analyzer.read(true, bands = false)
    assertTrue(frame.sequence > 0)
    assertTrue("bands were analysed", frame.bands.all { it == SpectrumBands.FLOOR_DB })
    assertEquals(-6.0, frame.peakDb.toDouble(), 1.0)
    assertEquals(-9.0, frame.rmsDb.toDouble(), 1.0)
    assertEquals(-9.0, frame.channels[0].rmsDb.toDouble(), 1.0)
    assertEquals(-6.0, frame.channels[1].peakDb.toDouble(), 1.0)
  }

  @Test
  fun readingBandsAfterAReadWithoutThemAtTheSameSequenceAnalysesThemInsteadOfReusingTheEmptyFrame() {
    feedSine(1000.0, 0.5)
    val skipped = analyzer.read(true, bands = false)
    val full = analyzer.read(true)
    assertEquals(skipped.sequence, full.sequence)
    assertEquals(bandOf(1000.0), loudestBand(full))
    assertTrue("1 kHz reads ${full.bands[bandOf(1000.0)]} dB", full.bands[bandOf(1000.0)] >= -12)
  }

  @Test
  fun readingWithoutBandsAfterAFullReadAtTheSameSequenceReusesTheAnalysis() {
    feedSine(1000.0, 0.5)
    val full = analyzer.read(true)
    val meters = analyzer.read(true, bands = false)
    assertEquals(full.sequence, meters.sequence)
    assertEquals(full.bands.toList(), meters.bands.toList())
  }

  @Test
  fun aFrameCarriesNoWaveUnlessOneWasAskedFor() {
    feedSine(440.0, 0.5)
    val frame = analyzer.read(true)
    assertEquals(null, frame.wave)
    assertFalse(frame.waveTriggered)
  }

  @Test
  fun aDisabledAnalyzerCarriesNoWaveEvenWhenOneWasAskedFor() {
    feedSine(440.0, 0.5)
    assertEquals(null, analyzer.read(false, wave = true).wave)
  }

  @Test
  fun aLiveStreamWaveIsA256PointTriggeredWindowOfTheNewestSound() {
    val live = SpectrumAnalyzer { now }.also { it.prepareFor(live = true, sourceRate = rate, outputRate = rate) }
    feedTone(live, 440.0, rate / 2, 0, amplitude = 0.5)
    val frame = live.read(true, wave = true, bands = false)
    val wave = frame.wave!!
    assertEquals(WaveWindow.POINTS, wave.size)
    assertTrue(frame.waveTriggered)
    val peak = wave.maxOf { it.toInt() }
    assertTrue("the wave peaks at $peak of 127", peak in 55..64)
    assertTrue("the wave troughs at ${wave.minOf { it.toInt() }}", wave.minOf { it.toInt() } in -64..-55)
  }

  @Test
  fun theWaveFollowsTheSpeakerPositionAndNeverShowsSoundThatHasNotBeenPlayedYet() {
    val speaker = SpectrumAnalyzer { now }.also { it.prepareFor(live = false, sourceRate = rate, outputRate = rate) }
    feedTone(speaker, 440.0, rate, 0, amplitude = 0.5)
    feedTone(speaker, 440.0, rate, rate.toLong(), amplitude = 0.0)
    speaker.presentAt(framesAheadOfSpeaker = rate.toLong(), timestampNanos = now)
    val heard = speaker.read(true, wave = true)
    assertTrue("a window of what the speaker plays is triggered", heard.waveTriggered)
    assertTrue("the wave is silent: ${heard.wave!!.toList()}", heard.wave!!.any { it.toInt() > 40 })

    val newest = SpectrumAnalyzer { now }.also { it.prepareFor(live = false, sourceRate = rate, outputRate = rate) }
    feedTone(newest, 440.0, rate, 0, amplitude = 0.5)
    feedTone(newest, 440.0, rate, rate.toLong(), amplitude = 0.0)
    val unaligned = newest.read(true, wave = true)
    assertFalse(unaligned.waveTriggered)
    assertTrue(unaligned.wave!!.all { it.toInt() == 0 })
  }

  @Test
  fun aWaveReadBeforeAWindowOfSoundExistsIsPaddedWithSilenceInsteadOfReadingMissingSamples() {
    feedSine(440.0, 0.5, seconds = 0.01)
    val wave = analyzer.read(true, wave = true).wave!!
    assertEquals(WaveWindow.POINTS, wave.size)
    assertTrue("the start of the window holds silence", wave.take(100).all { it.toInt() == 0 })
    assertTrue("the end of the window holds the sound", wave.takeLast(100).any { it.toInt() != 0 })
  }
}
